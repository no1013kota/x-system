/**
 * 投稿パターン（P-1〜P-6）の選択肢（T-M8-29）。
 *
 * **投稿作成とスケジュールで同じ定義・同じ見た目を使う。** 以前は投稿作成側がカード＋
 * 「P1」バッジ、スケジュール側がラベルだけのラジオで、説明文もスケジュール側には無かった。
 * 同じものを選ぶ操作なのに見た目と情報量が違うと、利用者は別の設定だと思う。
 *
 * **`P1` のような番号は画面に出さない**（2026-08-03 ユーザー判断）。利用者にとって意味を
 * 持たない記号で、画面の中に答えが無い。IDはURLやDBの値としてだけ使う。
 */

export interface PostPatternOption {
  id: string;
  label: string;
  /** 何が作られるか（ポスト数の目安を含む・要件06 §4.1）。押す前に分かるようにする。 */
  description: string;
}

/**
 * P-5（引用ポスト）は `FEATURE_QUOTE_POST_ENABLED` のときだけ足す。
 *
 * **ポスト数は実際に作られる数（`GENERATION_MAX_POSTS`）に合わせる**（T-M8-33）。
 * 以前は編集で許す上限（`PATTERN_MAX_POSTS`）に近い古い数字が書かれていて、
 * 画面の説明（例: P-1「4〜6ポスト」）と実際の生成（最大4）が食い違っていた。
 * **押す前に分かるようにするための説明が、実際と違っていては意味がない。**
 */
export const POST_PATTERN_OPTIONS: PostPatternOption[] = [
  { id: "p1", label: "ニュース解説", description: "話題のニュースを解説するスレッド（2〜4ポスト）" },
  { id: "p2", label: "自分の考え・意見", description: "本人の視点で述べる単発ポスト（1ポスト）" },
  { id: "p3", label: "ノウハウ・ハウツー", description: "今日から実践できる手順スレッド（4〜6ポスト）" },
  { id: "p4", label: "トレンド便乗", description: "いま話題のトピックに便乗する短いスレッド（1〜2ポスト）" },
  { id: "p6", label: "週次まとめ", description: "直近7日の関連ニュースまとめ（3〜5ポスト）" },
];

export const QUOTE_PATTERN_OPTION: PostPatternOption = {
  id: "p5",
  label: "引用ポスト",
  description: "対象ポストへの引用（URL付き投稿・1〜3ポスト）",
};

/**
 * スケジュールで選べるパターン。**P-5は対象外**（引用対象URLを毎回指定する必要があるため・
 * 要件04 §12・要件02 §3.10 の CHECK）。
 */
export const SCHEDULE_PATTERN_OPTIONS: PostPatternOption[] = POST_PATTERN_OPTIONS;
