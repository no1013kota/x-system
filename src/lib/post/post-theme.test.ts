import { describe, expect, it } from "vitest";

import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import { OPERATED_THEME_IDS } from "@/lib/themes";
import {
  OTHER_POST_THEME,
  SELECTABLE_POST_THEME_OPTIONS,
  selectablePostThemeOptions,
} from "./post-theme";

/**
 * 画面で選べるテーマ＝最新ニュース画面と同じ運用テーマ＋「その他」（T-M8-100）。
 * ここが崩れると「投稿作成とニュース画面でテーマが食い違う」（運営者の指摘 2026-08-15）に戻る。
 */
describe("SELECTABLE_POST_THEME_OPTIONS", () => {
  it("運用中のニュース分野（NEWS_FETCH_CATEGORIES）＋その他 と一致する", () => {
    expect(SELECTABLE_POST_THEME_OPTIONS.map((o) => o.id)).toEqual([
      ...NEWS_FETCH_CATEGORIES,
      OTHER_POST_THEME,
    ]);
  });

  it("運用テーマの導出元は themes.ts の OPERATED_THEME_IDS（単一の導出元）", () => {
    expect(OPERATED_THEME_IDS).toEqual([...NEWS_FETCH_CATEGORIES]);
  });

  it("ラベルはニュース画面と同じ（AI・投資・SNS運用）", () => {
    expect(SELECTABLE_POST_THEME_OPTIONS.map((o) => o.label)).toEqual([
      "AI",
      "投資",
      "SNS運用",
      "その他（追加指示に記載）",
    ]);
  });
});

describe("selectablePostThemeOptions（既存値の保全）", () => {
  it("編集中の値が運用外テーマなら「（現在の設定）」として選択肢に足す", () => {
    const opts = selectablePostThemeOptions("business_ops");
    expect(opts[opts.length - 1]).toEqual({ id: "business_ops", label: "業務改善（現在の設定）" });
  });

  it("運用中テーマ・その他・未選択では選択肢を増やさない", () => {
    expect(selectablePostThemeOptions("ai")).toEqual(SELECTABLE_POST_THEME_OPTIONS);
    expect(selectablePostThemeOptions(OTHER_POST_THEME)).toEqual(SELECTABLE_POST_THEME_OPTIONS);
    expect(selectablePostThemeOptions(null)).toEqual(SELECTABLE_POST_THEME_OPTIONS);
    expect(selectablePostThemeOptions("")).toEqual(SELECTABLE_POST_THEME_OPTIONS);
  });
});
