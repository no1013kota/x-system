import { describe, expect, it } from "vitest";

import { WARNING } from "./warning-codes";
import { WARNING_DETAIL, WARNING_LABEL, warningSummary } from "./warning-labels";

/**
 * 警告の画面表示（F1）。
 *
 * 表が `drafts-list.tsx` にあった間、**正本の `WARNING` にコードを足してここへ足し忘れても
 * どのゲートも落ちなかった**（`.tsx` は単体テストの網に入らない）。実際に
 * `length_over_target` と `post_count_trimmed` が抜け、その警告が付いた下書きでは
 * バッジに生の英語コードが出ていた。
 *
 * 網羅は `warning-labels.ts` の `satisfies` が typecheck で止めるが、それだけでは
 * **実行時に索引が引けること**（`Record<string, string>` へ落としたあとの中身）を守れないので、
 * ここで値そのものを固定する。
 */

describe("WARNING_LABEL", () => {
  it("正本の全コードにラベルがある（allowlistを持たない）", () => {
    const missing = Object.values(WARNING).filter((code) => !WARNING_LABEL[code]);
    expect(missing, "これらのコードのラベルを warning-labels.ts へ足してください").toEqual([]);
  });

  it("現在の対応表を固定する", () => {
    expect(WARNING_LABEL).toEqual({
      length_exceeded: "文字数超過",
      cashtag_multiple: "$タグ2件以上",
      ng_word: "NGワード",
      source_missing: "出典なし",
      injection_suspected: "要確認",
      length_over_target: "長め",
      post_count_trimmed: "ポスト数を調整",
      image_failed: "画像なし（生成失敗）",
    });
  });
});

describe("WARNING_DETAIL", () => {
  it("キーはラベルのキーの部分集合（説明だけあってラベルが無い状態を作らない）", () => {
    const orphan = Object.keys(WARNING_DETAIL).filter((code) => !WARNING_LABEL[code]);
    expect(orphan).toEqual([]);
  });

  it("止めない警告にも説明がある（何が起きたか分からないまま出さない）", () => {
    expect(WARNING_DETAIL.length_over_target).toBe("読みやすさの目安（約120字）より長めです");
    expect(WARNING_DETAIL.post_count_trimmed).toBe("長すぎたため途中のポストを省いています");
  });
});

describe("warningSummary", () => {
  it("ポスト番号を付け、説明があれば説明を使う", () => {
    expect(
      warningSummary([{ warnings: [] }, { warnings: ["ng_word"] }]),
    ).toEqual(["2ポスト目: NG設定の語が含まれています"]);
  });

  it("説明が無いコードはラベルへ落ちる", () => {
    // `image_failed` はラベルのみ（説明を持たない）。
    expect(warningSummary([{ warnings: ["image_failed"] }])).toEqual([
      "1ポスト目: 画像なし（生成失敗）",
    ]);
  });

  it("未知コードは素通しする（表示が消えるより生の値を出す）", () => {
    expect(warningSummary([{ warnings: ["unknown_code"] }])).toEqual([
      "1ポスト目: unknown_code",
    ]);
  });

  it("1ポストに複数あれば全部出す", () => {
    expect(warningSummary([{ warnings: ["length_over_target", "post_count_trimmed"] }])).toEqual([
      "1ポスト目: 読みやすさの目安（約120字）より長めです",
      "1ポスト目: 長すぎたため途中のポストを省いています",
    ]);
  });
});
