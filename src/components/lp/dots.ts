/**
 * LPの図版で使う「ドットの意味 → 見た目」の対応表（R36）。
 *
 * ヒーローのモックと「できること」の図版は**同じ意味のドット**を描いているのに、
 * 対応表が3つのマップに別々のキー名（`filled`/`ring`/`off`・`draft`/`scheduled`・
 * `on`/`draft`/`off`）で書かれていた。値は完全に一致していて、`hero-mock.tsx` のコメントも
 * 「ドットの意味は④のスケジュール表と同じ」と書いている。
 *
 * 色や太さを直すと3箇所を直すことになり、1つ忘れると**同じドットが場所によって違う意味に
 * 見える**。これはどのテストにも映らない（`.tsx` は単体テストの網に入らない）。
 *
 * **寸法とグリッド幅は共有しない**（`size-2.5` と `size-2`、44px と 34px）。
 * 図版ごとに意図して変えているので、ここまで揃えると見た目が変わる。
 */

/** そのまま投稿する枠（●）／下書きまで作る枠（○）／何もしない枠。 */
export const SLOT_DOT_CLASS = {
  post: "bg-brand",
  draft: "border-[1.5px] border-brand",
  none: "border border-hairline",
} as const;

export type SlotDotKind = keyof typeof SLOT_DOT_CLASS;

/** 週の並び（月曜始まり）。図版どうしで曜日がずれないよう1箇所に置く。 */
export const WEEKDAY_LABELS_LP = ["月", "火", "水", "木", "金", "土", "日"] as const;
