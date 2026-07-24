import { describe, expect, it } from "vitest";

import { enqueueDueSlots, type ScheduleEnqueueDeps } from "./schedule-enqueue";
import type { Queryable } from "../x/token-refresh";

type Row = Record<string, unknown>;

const DUE = /from schedule_slots ss/;
const KEYS = /from user_api_keys where user_id/;
const BUDGET = /from usage_counters where user_id/;
const DAILY = /count\(\*\)::int as n from usage_events/;
const INSERT = /insert into generation_jobs/;
const LAST_RUN = /update schedule_slots set last_run_at/;
const REMOVING = /from learning_sources[\s\S]*status = 'removing'/;

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

function deps(db: Queryable, dailyLimit = 50): ScheduleEnqueueDeps {
  return { db, runInTx: (fn) => fn(db), dailyLimit };
}

function dueSlot(over: Partial<Row> = {}): Row {
  return {
    id: "s1",
    x_account_id: "xa1",
    pattern: "p1",
    time_jst: "09:00:00",
    mode: "draft",
    instructions: null,
    image_enabled: false,
    image_provider: null,
    user_id: "u1",
    x_status: "active",
    base_md_version: 1,
    auto_consent_ok: true,
    plan: "standard",
    subscription_status: "active",
    ai_purpose_config: { text: "anthropic" },
    jst_date: "2026-07-24",
    jst_month: "2026-07",
    ...over,
  };
}

/** 標準的なハンドラ: due=[slot], keys=valid, budget=0, daily=0, insert=1件。 */
function handlerFor(slot: Row, over: Partial<Record<string, () => { rows: Row[]; rowCount?: number }>> = {}) {
  return (sql: string) => {
    if (DUE.test(sql)) return over.due?.() ?? { rows: [slot] };
    if (REMOVING.test(sql)) return over.removing?.() ?? { rows: [] };
    if (KEYS.test(sql)) return over.keys?.() ?? { rows: [{ provider: "anthropic", status: "valid" }] };
    if (BUDGET.test(sql)) return over.budget?.() ?? { rows: [] };
    if (DAILY.test(sql)) return over.daily?.() ?? { rows: [{ n: 0 }] };
    if (INSERT.test(sql)) return over.insert?.() ?? { rows: [{ id: "job1" }], rowCount: 1 };
    return { rows: [] };
  };
}

describe("enqueueDueSlots — eligible", () => {
  it("enqueues an eligible standard draft slot and updates last_run_at", async () => {
    const { db, writes } = makeDb(handlerFor(dueSlot()));
    const res = await enqueueDueSlots(deps(db));
    expect(res).toEqual({ scanned: 1, enqueued: 1 });
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.sql).toContain("'schedule'");
    expect(insert?.params[6]).toBe("slot:s1:2026-07-24:09:00"); // schedule_run_key
    expect(writes.some((w) => LAST_RUN.test(w.sql))).toBe(true);
  });

  it("is idempotent: on schedule_run_key conflict no job is counted and last_run_at is not touched", async () => {
    const { db, writes } = makeDb(
      handlerFor(dueSlot(), { insert: () => ({ rows: [], rowCount: 0 }) }),
    );
    const res = await enqueueDueSlots(deps(db));
    expect(res.enqueued).toBe(0);
    expect(writes.some((w) => LAST_RUN.test(w.sql))).toBe(false);
  });

  // 条件3: BYOK（standard/md）は月間投稿枠を持たないため残量判定をskipしてenqueueする（要件04 §7.1）。
  it.each(["standard", "md"])(
    "enqueues an eligible %s (BYOK) slot without consulting the premium budget",
    async (plan) => {
      const { db, writes } = makeDb(handlerFor(dueSlot({ plan })));
      const res = await enqueueDueSlots(deps(db));
      expect(res.enqueued).toBe(1);
      expect(writes.some((w) => BUDGET.test(w.sql))).toBe(false); // 残量判定をskip
      expect(writes.some((w) => INSERT.test(w.sql))).toBe(true);
    },
  );
});

describe("enqueueDueSlots — §7.1 exclusions", () => {
  const expectSkipped = async (slot: Row, over = {}) => {
    const { db, writes } = makeDb(handlerFor(slot, over));
    const res = await enqueueDueSlots(deps(db));
    expect(res.enqueued).toBe(0);
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  };

  it("skips when subscription is not trialing/active", async () => {
    await expectSkipped(dueSlot({ subscription_status: "incomplete" }));
  });
  it("skips when the X account is not active", async () => {
    await expectSkipped(dueSlot({ x_status: "disabled" }));
  });
  it("skips when persona (base_md) is not set", async () => {
    await expectSkipped(dueSlot({ base_md_version: 0 }));
  });
  it("skips an auto slot without current-version consent", async () => {
    await expectSkipped(dueSlot({ mode: "auto", auto_consent_ok: false }));
  });
  it("skips while a learning source is being removed (removing→md_merge in progress)", async () => {
    await expectSkipped(dueSlot(), { removing: () => ({ rows: [{}], rowCount: 1 }) });
  });
  it("skips BYOK when a required AI key is not valid", async () => {
    await expectSkipped(dueSlot(), {
      keys: () => ({ rows: [{ provider: "anthropic", status: "invalid" }] }),
    });
  });
  it("skips BYOK auto when the X key is missing", async () => {
    // mode=auto は X キーも必要。keys が text のみ valid（x なし）→ 不足で skip。
    await expectSkipped(dueSlot({ mode: "auto", auto_consent_ok: true }), {
      keys: () => ({ rows: [{ provider: "anthropic", status: "valid" }] }),
    });
  });
  it("skips premium when the generation budget is exhausted", async () => {
    await expectSkipped(dueSlot({ plan: "premium" }), {
      budget: () => ({
        rows: [{ normal_posts_count: 0, url_posts_count: 0, generations_count: 100, images_count: 0 }],
      }),
    });
  });
  it("skips premium auto when the normal post budget is exhausted", async () => {
    await expectSkipped(dueSlot({ plan: "premium", mode: "auto", auto_consent_ok: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 195, url_posts_count: 0, generations_count: 0, images_count: 0 }],
      }),
    });
  });
  it("skips premium auto when the URL post budget is exhausted (p1 needs url 1)", async () => {
    await expectSkipped(dueSlot({ plan: "premium", mode: "auto", auto_consent_ok: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 0, url_posts_count: 20, generations_count: 0, images_count: 0 }],
      }),
    });
  });
  it("skips premium when the image budget is exhausted and images are enabled", async () => {
    await expectSkipped(dueSlot({ plan: "premium", image_enabled: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 0, url_posts_count: 0, generations_count: 0, images_count: 20 }],
      }),
    });
  });
  it("skips when today's posts + pattern max exceed the daily limit", async () => {
    await expectSkipped(dueSlot(), { daily: () => ({ rows: [{ n: 45 }] }) }); // 45 + p1(6) > 50
  });
});
