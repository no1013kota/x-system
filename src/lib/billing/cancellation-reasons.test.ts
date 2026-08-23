import { describe, expect, it } from "vitest";

import { CANCELLATION_REASONS, cancellationEffects, isCancellationReason } from "./cancellation-reasons";

/**
 * 解約前の確認とアンケート（T-M8-277）。**煽らず事実だけ**を出し、残ることも同時に伝える。
 */
describe("cancellationEffects", () => {
  it("有料契約: 期間終了日まで使えることと、止まる機能を出す", () => {
    const e = cancellationEffects({ plan: "premium", endsAtLabel: "2026年9月15日", trialing: false });
    expect(e.title).toContain("2026年9月15日までご利用いただけます");
    expect(e.stops.join()).toContain("自動投稿");
    expect(e.stops.join(), "運営キーのプランはその点も伝える").toContain("運営が用意しているAIキー");
    expect(e.keeps.join(), "データが消えないことを必ず伝える").toContain("残ります");
    expect(e.keeps.join()).toContain("日割り返金はありません");
  });

  it("トライアル中: 終了日で使えなくなることと、料金が発生しないことを伝える", () => {
    const e = cancellationEffects({ plan: "premium", endsAtLabel: "2026年8月30日", trialing: true });
    expect(e.title).toContain("無料トライアルが終了");
    expect(e.keeps.join()).toContain("料金が発生しません");
    expect(e.keeps.join()).not.toContain("日割り返金");
  });

  it("BYOKプラン（standard）では運営キーの話を出さない", () => {
    const e = cancellationEffects({ plan: "standard", endsAtLabel: "2026年9月15日", trialing: false });
    expect(e.stops.join()).not.toContain("運営が用意しているAIキー");
  });
});

describe("CANCELLATION_REASONS", () => {
  it("選択肢は重複せず、その他を含む", () => {
    const values = CANCELLATION_REASONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("other");
  });

  it("未知の値は受け付けない（DBへ入る値なので絞る）", () => {
    expect(isCancellationReason("price")).toBe(true);
    expect(isCancellationReason("なんとなく")).toBe(false);
    expect(isCancellationReason(null)).toBe(false);
  });
});
