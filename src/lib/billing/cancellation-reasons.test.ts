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
    /*
      **文言ではなく「運営キーのプランには1行多い」ことを見る**（2026-08-25）。
      以前は文面をそのまま探しており、運営者が言い回しを磨いただけでspecが落ちた。
      守りたいのは「運営がキーを用意しているプランでは、その点も止まると伝わること」。
    */
    const byok = cancellationEffects({ plan: "standard", endsAtLabel: "2026年9月15日", trialing: false });
    expect(
      e.stops.length,
      "運営キーのプランはBYOKより止まることが1つ多いはず",
    ).toBe(byok.stops.length + 1);
    const extra = e.stops.find((line) => !byok.stops.includes(line));
    expect(extra, "運営キーのプラン向けの1行が無い").toBeTruthy();
    expect(extra, "AIの生成が止まることが読めない").toMatch(/AI|生成/);
    expect(e.keeps.join(), "データが消えないことを必ず伝える").toContain("消えません");
    /*
      **「閲覧できます」とは書かない**（運営者の指摘 2026-08-24）。データは残るが、解約後は
      課金・プラン以外のタブがロックされる（T-M8-269）ので開いて見ることはできない。
      「見られる」と読める書き方に戻すと、解約してから食い違いに気付くことになる。
    */
    expect(e.keeps.join(), "解約中も見られると読めてはいけない").not.toContain("閲覧できます");
    expect(e.keeps.join()).toContain("日割り返金はありません");
  });

  it("トライアル中: その場で終了することと、残り期間で再開できることを伝える（T-M8-278）", () => {
    const e = cancellationEffects({ plan: "premium", endsAtLabel: "2026年8月30日", trialing: true });
    expect(e.title).toContain("その場で終了");
    expect(e.keeps.join()).toContain("料金は発生しません");
    expect(e.keeps.join(), "取り消せることを同じ画面で伝える").toContain("残りの期間で無料トライアルを再開できます");
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
