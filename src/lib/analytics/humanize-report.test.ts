import { describe, expect, it } from "vitest";

import { humanizeReportText } from "./humanize-report";

/**
 * T-M8-114。実際に本番アカウント（@ai_newinfo）のレポートへ出ていた文で検証する。
 * 作文した例ではなく、運営者が実際に読めなかった文をそのまま入力にする。
 */
describe("humanizeReportText", () => {
  it("数値とくっついた impressions を「表示N回」にする", () => {
    expect(humanizeReportText("冒頭41impressionsは最高パフォーマンス")).toBe(
      "冒頭表示41回は最高パフォーマンス",
    );
    expect(humanizeReportText("合計227impressionsを獲得")).toBe("合計表示227回を獲得");
    expect(humanizeReportText("短編単発の40impressions程度より高く")).toBe(
      "短編単発の表示40回程度より高く",
    );
  });

  it("単独の英語項目名を日本語にする", () => {
    expect(humanizeReportText("impressionsとlikesを見る")).toBe("表示回数といいねを見る");
    expect(humanizeReportText("has_imageがtrueの投稿")).toBe("画像の有無がtrueの投稿");
    expect(humanizeReportText("new_posts_since_previousは0")).toBe("前回以降の新規投稿数は0");
  });

  it("型の内部ID（p1〜p6）を選択画面と同じ日本語名にする", () => {
    expect(humanizeReportText("スレッド型（p1）は各投稿が100字")).toBe(
      "スレッド型（ニュース解説）は各投稿が100字",
    );
    expect(humanizeReportText("p6の週次まとめ")).toContain("週次まとめ");
  });

  it("型に見えるだけの別語は変えない（p10・語中のp1）", () => {
    expect(humanizeReportText("p10のような値")).toBe("p10のような値");
    expect(humanizeReportText("gpt-p1x")).toBe("gpt-p1x");
    // 型番号は1〜6のみ。p7以降は選択肢に無いのでそのまま。
    expect(humanizeReportText("p7")).toBe("p7");
  });

  it("本文に紛れた投稿ID（17〜20桁）を「ある投稿」に言い換える", () => {
    expect(humanizeReportText("速報系（2045460385856377140等の週次まとめ）")).toBe(
      "速報系（ある投稿等の週次まとめ）",
    );
  });

  it("表示回数・年月日・金額はIDと誤認しない", () => {
    expect(humanizeReportText("41回・2026年8月16日・1000円")).toBe("41回・2026年8月16日・1000円");
    expect(humanizeReportText("合計227")).toBe("合計227");
  });

  it("空文字はそのまま返す", () => {
    expect(humanizeReportText("")).toBe("");
  });

  it("実際に出ていた文が最後まで日本語になる（英語の項目名と内部IDが残らない）", () => {
    const real =
      "6月8日のスレッド（冒頭41impressions）が依然として最高パフォーマンスであり、" +
      "スレッド型（p1）は各投稿が100～140字で段階的に掘り下げ、反応率が安定している。" +
      "速報系（2045460385856377140等）は画像付きが目立つ。";
    const out = humanizeReportText(real);
    expect(out).not.toMatch(/impressions|likes|reposts|replies|has_image/i);
    expect(out).not.toMatch(/(^|[^0-9A-Za-z_])p[1-6](?![0-9A-Za-z_])/);
    expect(out).not.toMatch(/\d{17,20}/);
    expect(out).toContain("表示41回");
    expect(out).toContain("ニュース解説");
  });
});

describe("重複する括弧書き", () => {
  it("型名を入れた結果、直前と同じ語になる括弧は落とす", () => {
    expect(humanizeReportText("ニュース解説スレッド型（p1）の有効性")).toBe(
      "ニュース解説スレッド型の有効性",
    );
  });

  it("直前と違う語の括弧は残す（説明を消さない）", () => {
    expect(humanizeReportText("スレッド型（p1）は強い")).toBe("スレッド型（ニュース解説）は強い");
    expect(humanizeReportText("Gotchas（落とし穴）欄")).toBe("Gotchas（落とし穴）欄");
  });
});
