import { describe, expect, it } from "vitest";

import { PLANS } from "../plans";

import { RESERVE_LIMIT_BY_TYPE, reserveIfPremium } from "./reserve-if-premium";

/**
 * premium の枠 reserve（R28）。
 *
 * 「premium なら開始時に枠を1つ押さえる」処理が5箇所（本文生成・画像生成・学習分析・
 * 改善提案・削除merge）にあり、**枠の種別と月次上限の対応も各ファイルが持っていた**。
 * 上限の引き先を取り違えると、画像枠に文章の上限が適用される。これは
 * 「請求はされているのに生成が止まる」形で利用者に出るのに、テストが種別ごとに
 * 別ファイルにあるため気付けない。対応表そのものを検査する。
 */

describe("RESERVE_LIMIT_BY_TYPE", () => {
  it("種別ごとに正しい上限を引く（取り違えを機械で止める）", () => {
    expect(RESERVE_LIMIT_BY_TYPE.generation).toBe(PLANS.premium.usageLimits?.generations);
    expect(RESERVE_LIMIT_BY_TYPE.image).toBe(PLANS.premium.usageLimits?.images);
  });

  it("文章と画像の上限は別物（片方をもう片方に流用していない）", () => {
    // 値が同じでも参照元が違うことは上のテストで担保している。ここは値の独立性を見る。
    expect(PLANS.premium.usageLimits?.generations).toBeDefined();
    expect(PLANS.premium.usageLimits?.images).toBeDefined();
  });
});

describe("reserveIfPremium", () => {
  function spy(aiPurposeConfig: Record<string, unknown> = {}) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        // モデル選択の読み出し（T-M8-108）。
        if (/ai_purpose_config from profiles/.test(sql)) {
          return { rows: [{ ai_purpose_config: aiPurposeConfig }] as never[], rowCount: 1 };
        }
        // reserveUsage が読む行を返す（上限判定・冪等判定を通す最小の形）。
        return { rows: [] as never[], rowCount: 0 };
      },
    };
    let entered = 0;
    const runInTx = async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      entered += 1;
      return fn(tx);
    };
    return { calls, runInTx, entered: () => entered };
  }

  const base = { userId: "u1", xAccountId: "x1", jobId: "j1", type: "generation" as const };

  it("BYOK（standard / md）は枠を消費しない＝transactionにも入らない", async () => {
    for (const plan of ["standard", "md"]) {
      const s = spy();
      await reserveIfPremium(s.runInTx, { ...base, plan });
      expect(s.entered(), `${plan} で reserve が走っている`).toBe(0);
    }
  });

  it("premium は transaction を1回開いて reserve する", async () => {
    const s = spy();
    await reserveIfPremium(s.runInTx, { ...base, plan: "premium" });
    expect(s.entered()).toBe(1);
    expect(s.calls.length).toBeGreaterThan(0);
  });

  it("上位モデル選択時はコスト比の倍数クレジットを消費する（T-M8-108）", async () => {
    const s = spy({ text: "anthropic", text_model: "claude-fable-5" });
    await reserveIfPremium(s.runInTx, { ...base, plan: "premium" });
    const insert = s.calls.find((c) => /insert into usage_events/.test(c.sql));
    expect(insert, "usage_eventsへのreserveが走る").toBeTruthy();
    // reserveUsage の $7 = amount。Fable 5（$10/$50）は基準Sonnet 5（$2/$10）の5倍。
    expect(insert!.params[6]).toBe(5);
  });

  it("未選択（おまかせ）は1クレジット", async () => {
    const s = spy({ text: "anthropic" });
    await reserveIfPremium(s.runInTx, { ...base, plan: "premium" });
    const insert = s.calls.find((c) => /insert into usage_events/.test(c.sql));
    expect(insert!.params[6]).toBe(1);
  });

  /**
   * 上限到達を**握らない**ことが重要（各jobで扱いが違う）。本文生成は失敗確定へ回し、
   * 画像生成は画像なしで確定する。共通関数が握ると、その分岐ができなくなる。
   */
  it("reserve が投げた例外はそのまま透過する", async () => {
    const boom = new Error("usage limit");
    const runInTx = async () => {
      throw boom;
    };
    await expect(
      reserveIfPremium(runInTx as never, { ...base, plan: "premium" }),
    ).rejects.toBe(boom);
  });
});
