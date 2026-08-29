import { describe, expect, it } from "vitest";

import { PLANS } from "../plans";

import { reserveIfPremium, reserveLimitFor } from "./reserve-if-premium";

/**
 * premium の枠 reserve（R28）。
 *
 * 「premium なら開始時に枠を1つ押さえる」処理が5箇所（本文生成・画像生成・学習分析・
 * 改善提案・削除merge）にあり、**枠の種別と月次上限の対応も各ファイルが持っていた**。
 * 上限の引き先を取り違えると、画像枠に文章の上限が適用される。これは
 * 「請求はされているのに生成が止まる」形で利用者に出るのに、テストが種別ごとに
 * 別ファイルにあるため気付けない。対応表そのものを検査する。
 */

describe("reserveLimitFor", () => {
  it("上限はプランのAIクレジット枠（premium=1000 / expert=5000・T-M8-109/168）", () => {
    expect(reserveLimitFor("premium")).toBe(PLANS.premium.usageLimits?.aiCredits);
    expect(reserveLimitFor("expert")).toBe(PLANS.expert.usageLimits?.aiCredits);
    expect(PLANS.premium.usageLimits?.aiCredits).toBe(100_000);
    expect(PLANS.expert.usageLimits?.aiCredits).toBe(500_000);
    // BYOK・未知は上限なし（reserve自体が走らない）。
    expect(reserveLimitFor("standard")).toBeUndefined();
    expect(reserveLimitFor("")).toBeUndefined();
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
        // 利用枠の期間キー（T-M8-258）。実DBでは必ず1行返る。
        if (/current_period_start[\s\S]*as key$/.test(sql)) {
          return { rows: [{ key: "2026-08-15" }] as never[], rowCount: 1 };
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

  it("BYOK（standard）と未契約は枠を消費しない＝transactionにも入らない", async () => {
    for (const plan of ["standard", ""]) {
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



  it("**usage_events へは1行も書かない**（予約を廃止した・T-M8-324）", () => {
    const s = spy({ text: "anthropic", text_model: "claude-fable-5" });
    return reserveIfPremium(s.runInTx, { ...base, plan: "premium" }).then(() => {
      const insert = s.calls.find((c) => /insert into usage_events/.test(c.sql));
      expect(insert, "開始前に消費を書いている（完了時に数字が下がって見える）").toBeUndefined();
    });
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
