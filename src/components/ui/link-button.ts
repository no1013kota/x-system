/**
 * リンクをボタンの見た目にするクラス（T-M8-23）。
 *
 * `<Button>` は Base UI のクライアントコンポーネントなので、サーバーコンポーネントの
 * `<Link>` には使えない。そのため各画面が長いクラス文字列を手書きしていて、**主操作のはずが
 * 黒いまま残る**箇所が10か所あった（キー色にしたボタンと並んで、揃っていないことだけが分かる状態）。
 *
 * 値ではなく**名前**を配るので、次にデザインが変わったときも1か所で追随できる。
 */

/** 主操作（キー色の塗り）。`<Button variant="brand">` と同じ見た目。 */
export const primaryLinkClassName =
  "inline-flex h-9 items-center justify-center rounded-card bg-brand px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** 副操作（枠線のみ）。主操作と並べるときに使う。 */
export const secondaryLinkClassName =
  "inline-flex h-9 items-center justify-center rounded-card border border-hairline bg-surface px-4 text-body font-medium text-ink transition-colors duration-150 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Primary action used in centered empty/locked state cards. */
export const stateActionClassName =
  "mt-4 inline-flex min-h-11 items-center rounded-card bg-brand px-6 text-body font-bold text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
