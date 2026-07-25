import { describe, expect, it } from "vitest";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import {
  createScheduleSlot,
  createScheduleSlotSchema,
  deleteScheduleSlot,
  disableScheduleSlot,
  enableScheduleSlot,
  updateScheduleSlot,
  updateScheduleSlotSchema,
  type ScheduleSlotDeps,
} from "./schedule-slots";
import type { Queryable } from "./x/token-refresh";

type Row = Record<string, unknown>;

const XID = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";

const CONSENT = /select automation_consent_version/;
const OWNED = /select ss\.mode, ss\.x_account_id/;
const INSERT = /insert into schedule_slots/;
const UPDATE = /update schedule_slots\s+set pattern/;
const DISABLE = /update schedule_slots set enabled = false/;
const ENABLE = /update schedule_slots set enabled = true/;
const DELETE = /delete from schedule_slots/;

function makeDb(handler: (sql: string) => { rows: Row[]; rowCount?: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
  };
  return { db, writes };
}

function deps(db: Queryable, activeId: string | null = XID): ScheduleSlotDeps {
  return {
    runInTx: (fn) => fn(db),
    resolveActiveXAccountId: async () => activeId,
  };
}

const consentOk = () => ({
  automation_consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
  consented: true,
  disabled: false,
});
const slotRow = () => ({ id: SID, pattern: "p1", weekdays: [1], time_jst: "09:30", mode: "draft" });

const validCreate = {
  pattern: "p1" as const,
  weekdays: [1, 3, 5],
  time_jst: "09:30",
  mode: "draft" as const,
  image_enabled: false,
};

describe("createScheduleSlotSchema validation", () => {
  const parse = (over: Record<string, unknown>) =>
    createScheduleSlotSchema.safeParse({ ...validCreate, ...over });

  it("accepts a valid draft slot", () => {
    expect(parse({}).success).toBe(true);
  });
  it("rejects P-5", () => {
    expect(parse({ pattern: "p5" }).success).toBe(false);
  });
  it("rejects empty or duplicate weekdays and out-of-range values", () => {
    expect(parse({ weekdays: [] }).success).toBe(false);
    expect(parse({ weekdays: [1, 1] }).success).toBe(false);
    expect(parse({ weekdays: [7] }).success).toBe(false);
  });
  it("rejects invalid time_jst (range / minute)", () => {
    expect(parse({ time_jst: "08:30" }).success).toBe(false); // 早すぎ
    expect(parse({ time_jst: "22:30" }).success).toBe(false); // 上限超過
    expect(parse({ time_jst: "10:15" }).success).toBe(false); // 15分
    expect(parse({ time_jst: "22:00" }).success).toBe(true);
    expect(parse({ time_jst: "09:00" }).success).toBe(true);
  });
  it("requires image_provider when image is enabled", () => {
    expect(parse({ image_enabled: true }).success).toBe(false);
    expect(parse({ image_enabled: true, image_provider: "openai" }).success).toBe(true);
  });
  it("rejects instructions longer than 2000 chars", () => {
    expect(parse({ instructions: "あ".repeat(2001) }).success).toBe(false);
    expect(parse({ instructions: "あ".repeat(2000) }).success).toBe(true);
  });
});

describe("updateScheduleSlotSchema validation", () => {
  it("requires slot_id and expected_updated_at", () => {
    expect(
      updateScheduleSlotSchema.safeParse({ ...validCreate, slot_id: SID, expected_updated_at: "t" })
        .success,
    ).toBe(true);
    expect(updateScheduleSlotSchema.safeParse(validCreate).success).toBe(false);
  });
});

describe("createScheduleSlot — active account & consent", () => {
  it("throws x_account_required with no active account", async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    await expect(
      createScheduleSlot("u1", validCreate, deps(db, null)),
    ).rejects.toMatchObject({ code: "x_account_required" });
  });

  it("creates a draft slot without requiring consent", async () => {
    const { db, writes } = makeDb((sql) => (INSERT.test(sql) ? { rows: [slotRow()] } : { rows: [] }));
    const slot = await createScheduleSlot("u1", validCreate, deps(db));
    expect(slot.id).toBe(SID);
    expect(writes.some((w) => CONSENT.test(w.sql))).toBe(false); // draftは同意チェックしない
  });

  it("rejects an auto slot without valid current-version consent", async () => {
    const { db } = makeDb((sql) =>
      CONSENT.test(sql)
        ? { rows: [{ automation_consent_version: "old", consented: true, disabled: false }] }
        : { rows: [] },
    );
    await expect(
      createScheduleSlot("u1", { ...validCreate, mode: "auto" }, deps(db)),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      createScheduleSlot("u1", { ...validCreate, mode: "auto" }, deps(db)),
    ).rejects.toMatchObject({ code: "automation_consent_required" });
  });

  it("creates an auto slot when consent is current", async () => {
    const { db } = makeDb((sql) => {
      if (CONSENT.test(sql)) return { rows: [consentOk()] };
      if (INSERT.test(sql)) return { rows: [{ ...slotRow(), mode: "auto" }] };
      return { rows: [] };
    });
    const slot = await createScheduleSlot("u1", { ...validCreate, mode: "auto" }, deps(db));
    expect(slot.mode).toBe("auto");
  });
});

describe("optimistic lock (expected_updated_at)", () => {
  const lock = { slot_id: SID, expected_updated_at: "2026-07-24T00:00:00Z" };

  it("updateScheduleSlot returns job_conflict on stale version", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (UPDATE.test(sql)) return { rows: [] }; // 0件更新
      return { rows: [] };
    });
    await expect(
      updateScheduleSlot("u1", { ...validCreate, ...lock }, deps(db)),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("enableScheduleSlot re-enables a stopped draft slot", async () => {
    const { db, writes } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (ENABLE.test(sql)) return { rows: [{ ...slotRow(), enabled: true }] };
      return { rows: [] };
    });
    const slot = await enableScheduleSlot("u1", lock, deps(db));
    expect(slot.enabled).toBe(true);
    // draft の再開では同意確認は不要
    expect(writes.some((w) => CONSENT.test(w.sql))).toBe(false);
  });

  it("enableScheduleSlot requires automation consent for auto slots", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "auto", x_account_id: XID }] };
      // 未同意
      if (CONSENT.test(sql)) {
        return { rows: [{ automation_consent_version: null, consented: false, disabled: false }] };
      }
      if (ENABLE.test(sql)) return { rows: [{ ...slotRow(), mode: "auto", enabled: true }] };
      return { rows: [] };
    });
    await expect(enableScheduleSlot("u1", lock, deps(db))).rejects.toMatchObject({
      code: "automation_consent_required",
    });
  });

  it("enableScheduleSlot returns job_conflict on stale version", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (ENABLE.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    await expect(enableScheduleSlot("u1", lock, deps(db))).rejects.toMatchObject({
      code: "job_conflict",
    });
  });

  it("disableScheduleSlot returns job_conflict on stale version", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (DISABLE.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    await expect(disableScheduleSlot("u1", lock, deps(db))).rejects.toMatchObject({
      code: "job_conflict",
    });
  });

  it("deleteScheduleSlot returns job_conflict on stale version", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (DELETE.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [] };
    });
    await expect(deleteScheduleSlot("u1", lock, deps(db))).rejects.toMatchObject({
      code: "job_conflict",
    });
  });

  it("rejects updating/deleting a slot not owned by the user", async () => {
    const { db } = makeDb(() => ({ rows: [] })); // OWNED returns none
    await expect(
      deleteScheduleSlot("u1", lock, deps(db)),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("changing a slot to auto requires current consent", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rows: [{ mode: "draft", x_account_id: XID }] };
      if (CONSENT.test(sql)) return { rows: [{ automation_consent_version: "old", consented: true, disabled: false }] };
      return { rows: [] };
    });
    await expect(
      updateScheduleSlot("u1", { ...validCreate, mode: "auto", ...lock }, deps(db)),
    ).rejects.toMatchObject({ code: "automation_consent_required" });
  });
});
