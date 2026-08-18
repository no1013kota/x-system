import { describe, expect, it } from "vitest";

import { enqueueDueSlots, type ScheduleEnqueueDeps } from "./schedule-enqueue";
import type { Queryable } from "../x/token-refresh";

type Row = Record<string, unknown>;

const DUE = /from schedule_slots ss/;
const KEYS = /from user_api_keys where user_id/;
const BUDGET = /from usage_counters where user_id/;
const DAILY = /count\(\*\)::int as n from usage_events/;
const INSERT = /insert into generation_jobs/;
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

/** `pattern_spec_of()` が返す形（T-M8-129 U3）。予約の枠計算はここから決まる。 */
function slotPatternSpec(over: Record<string, unknown> = {}) {
  return {
    id: "pat-p1",
    seed_key: "p1",
    name: "ニュース解説",
    description: "話題のニュースを解説するスレッド",
    prompt: null,
    max_posts: 4,
    max_posts_edit: 6,
    web_search_policy: "always",
    web_search_max_uses: 4,
    source_policy: "always",
    include_news_digest: false,
    asks_user_opinion: false,
    requires_quote_url: false,
    ...over,
  };
}

function dueSlot(over: Partial<Row> = {}): Row {
  return {
    id: "s1",
    x_account_id: "xa1",
    pattern: "p1",
    pattern_id: "pat-p1",
    pattern_spec: slotPatternSpec(),
    time_jst: "09:00:00",
    mode: "draft",
    instructions: null,
    image_enabled: false,
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
  it("enqueues an eligible standard draft slot", async () => {
    const { db, writes } = makeDb(handlerFor(dueSlot()));
    const res = await enqueueDueSlots(deps(db));
    expect(res).toEqual({ scanned: 1, enqueued: 1 });
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert?.sql).toContain("'schedule'");
    expect(insert?.params[6]).toBe("slot:s1:2026-07-24:09:00"); // schedule_run_key
  });

  it("is idempotent: on schedule_run_key conflict no job is counted", async () => {
    // 冪等化は schedule_run_key unique だけが担う（last_run_at 列は T-M8-94 で削除した）。
    const { db } = makeDb(
      handlerFor(dueSlot(), { insert: () => ({ rows: [], rowCount: 0 }) }),
    );
    const res = await enqueueDueSlots(deps(db));
    expect(res.enqueued).toBe(0);
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
        rows: [{ normal_posts_count: 0, url_posts_count: 0, ai_credits_used: 1000 }],
      }),
    });
  });
  it("skips premium auto when the normal post budget is exhausted", async () => {
    await expectSkipped(dueSlot({ plan: "premium", mode: "auto", auto_consent_ok: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 195, url_posts_count: 0, ai_credits_used: 0 }],
      }),
    });
  });
  it("skips premium auto when the URL post budget is exhausted (p1 needs url 1)", async () => {
    await expectSkipped(dueSlot({ plan: "premium", mode: "auto", auto_consent_ok: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 0, url_posts_count: 20, ai_credits_used: 0 }],
      }),
    });
  });
  it("skips premium when the image budget is exhausted and images are enabled", async () => {
    await expectSkipped(dueSlot({ plan: "premium", image_enabled: true }), {
      budget: () => ({
        rows: [{ normal_posts_count: 0, url_posts_count: 0, ai_credits_used: 1000 }],
      }),
    });
  });
  it("skips when today's posts + pattern max exceed the daily limit", async () => {
    await expectSkipped(dueSlot(), { daily: () => ({ rows: [{ n: 45 }] }) }); // 45 + p1(6) > 50
  });
});

/**
 * T-M8-135。**枠に保存した生成入力が job の `input` へ載ること。**
 *
 * ここがずれると「予約では設定が効かない」という、画面からは説明できない差になる。
 * 生成側（`post-generation.ts`）は `job.input` のキー名しか見ないので、
 * **投稿作成画面と同じキー名**であることを固定する。
 */
describe("enqueueDueSlots — 枠の生成入力（T-M8-135）", () => {
  it("参考URL・プレースホルダー・この枠のプロンプトを input へ渡す", async () => {
    const slot = dueSlot({
      // プロンプトの上書きは md/premium だけ有効（下の standard のテストが境界を固定する）。
      plan: "md",
      source_url: "https://example.com/a",
      placeholder_values: { 自分の考え: "私はこう考える" },
      prompt_override: "# タスク\nこの枠だけのプロンプト",
      instructions: "冒頭に「検証:」を付ける",
    });
    const { db, writes } = makeDb(handlerFor(slot));
    const res = await enqueueDueSlots(deps(db));
    expect(res.enqueued).toBe(1);
    const insert = writes.find((w) => INSERT.test(w.sql));
    expect(insert, "generation_jobs への insert が無い").toBeDefined();
    // `input` は insert の params にJSON文字列で入る。
    const input = JSON.parse(
      insert!.params.find((x) => typeof x === "string" && x.startsWith("{")) as string,
    );
    expect(input.source_url).toBe("https://example.com/a");
    expect(input.placeholder_values).toEqual({ 自分の考え: "私はこう考える" });
    expect(input.prompt_override).toBe("# タスク\nこの枠だけのプロンプト");
    expect(input.instructions).toBe("冒頭に「検証:」を付ける");
  });

  it("standardプランでは prompt_override を渡さない（画面に出ない指示で生成しない）", async () => {
    // プロンプトの編集は md/premium だけ。standard へ下がった枠の上書きは画面から消えるので、
    // 実行でも使わない（使うと「画面に無い指示で生成される」状態になる）。
    const slot = dueSlot({ plan: "standard", prompt_override: "# 画面から見えない指示" });
    const { db, writes } = makeDb(handlerFor(slot));
    await enqueueDueSlots(deps(db));
    const insert = writes.find((w) => INSERT.test(w.sql));
    const input = JSON.parse(
      insert!.params.find((x) => typeof x === "string" && x.startsWith("{")) as string,
    );
    expect(input.prompt_override).toBeNull();
    // 参考URL・プレースホルダーはプラン境界の外（プロンプト編集ではない）。
    expect(input.source_url).toBeDefined();
  });

  it("md/premium では prompt_override を渡す", async () => {
    for (const plan of ["md", "premium"]) {
      const slot = dueSlot({ plan, prompt_override: "# この枠の指示" });
      const { db, writes } = makeDb(handlerFor(slot));
      await enqueueDueSlots(deps(db));
      const insert = writes.find((w) => INSERT.test(w.sql));
      const input = JSON.parse(
        insert!.params.find((x) => typeof x === "string" && x.startsWith("{")) as string,
      );
      expect(input.prompt_override, plan).toBe("# この枠の指示");
    }
  });

  it("未設定なら null で渡す（空文字や undefined を混ぜない）", async () => {
    const { db, writes } = makeDb(handlerFor(dueSlot()));
    await enqueueDueSlots(deps(db));
    const insert = writes.find((w) => INSERT.test(w.sql));
    const input = JSON.parse(
      insert!.params.find((x) => typeof x === "string" && x.startsWith("{")) as string,
    );
    expect(input.source_url).toBeNull();
    expect(input.placeholder_values).toBeNull();
    expect(input.prompt_override).toBeNull();
  });
});
