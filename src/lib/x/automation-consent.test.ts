import { describe, expect, it } from "vitest";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";

import {
  disableAutomationForAccount,
  disableXAutomation,
  recordXAutomationConsent,
} from "./automation-consent";
import type { Queryable } from "./token-refresh";

type Row = Record<string, unknown>;

const XID = "44444444-4444-4444-4444-444444444444";

const RECORD = /update x_accounts\s+set automation_consent_version/;
const OWNED = /select 1 from x_accounts where id = \$1 and user_id/;
const DISABLED_AT = /automation_disabled_at = coalesce/;
const SLOTS = /update schedule_slots set enabled = false/;
const JOBS = /update generation_jobs set status = 'canceled'/;

function makeDb(handler: (sql: string) => { rows?: Row[]; rowCount: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql);
      return { rows: (r.rows ?? []) as T[], rowCount: r.rowCount };
    },
  };
  return { db, writes };
}

const consentInput = {
  x_account_id: XID,
  consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
  confirmed: true,
};

describe("recordXAutomationConsent", () => {
  it("saves consent (version/consented_at) and clears disabled_at", async () => {
    const { db, writes } = makeDb((sql) => ({ rowCount: RECORD.test(sql) ? 1 : 0 }));
    const state = await recordXAutomationConsent(db, "u1", consentInput);
    expect(state).toEqual({
      consentVersion: CURRENT_AUTOMATION_CONSENT_VERSION,
      consented: true,
      disabled: false,
    });
    const upd = writes.find((w) => RECORD.test(w.sql));
    expect(upd?.sql).toContain("automation_disabled_at = null");
    expect(upd?.params).toEqual([XID, "u1", CURRENT_AUTOMATION_CONSENT_VERSION]);
  });

  it("rejects an unchecked confirmation", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 }));
    await expect(
      recordXAutomationConsent(db, "u1", { ...consentInput, confirmed: false }),
    ).rejects.toMatchObject({ code: "validation_error", details: { reason: "consent_not_confirmed" } });
  });

  it("rejects a stale consent version", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 }));
    await expect(
      recordXAutomationConsent(db, "u1", { ...consentInput, consent_version: "old" }),
    ).rejects.toMatchObject({ code: "validation_error", details: { reason: "stale_consent_version" } });
  });

  it("throws not_found when the account is not owned", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 })); // 0 rows updated
    await expect(recordXAutomationConsent(db, "u1", consentInput)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("disableAutomationForAccount", () => {
  it("sets disabled_at, disables auto slots, cancels queued auto jobs and returns counts", async () => {
    const { db, writes } = makeDb((sql) => {
      if (SLOTS.test(sql)) return { rowCount: 2 };
      if (JOBS.test(sql)) return { rowCount: 3 };
      return { rowCount: 1 };
    });
    const res = await disableAutomationForAccount(db, XID);
    expect(res).toEqual({ disabledSlots: 2, canceledJobs: 3 });
    expect(writes.some((w) => DISABLED_AT.test(w.sql))).toBe(true);
    const jobs = writes.find((w) => JOBS.test(w.sql));
    expect(jobs?.sql).toContain("kind in ('post_generation', 'post_publish')");
    expect(jobs?.sql).toContain("status = 'queued'");
    expect(jobs?.sql).toContain("mode = 'auto'");
  });
});

describe("disableXAutomation", () => {
  const deps = (db: Queryable) => ({ runInTx: <T,>(fn: (tx: Queryable) => Promise<T>) => fn(db) });

  it("throws not_found for an unowned account", async () => {
    const { db } = makeDb((sql) => ({ rowCount: OWNED.test(sql) ? 0 : 1 }));
    await expect(disableXAutomation("u1", XID, deps(db))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("disables automation for an owned account", async () => {
    const { db, writes } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rowCount: 1 };
      if (SLOTS.test(sql)) return { rowCount: 1 };
      if (JOBS.test(sql)) return { rowCount: 0 };
      return { rowCount: 1 };
    });
    const res = await disableXAutomation("u1", XID, deps(db));
    expect(res).toEqual({ disabledSlots: 1, canceledJobs: 0 });
    expect(writes.some((w) => JOBS.test(w.sql))).toBe(true);
  });
});
