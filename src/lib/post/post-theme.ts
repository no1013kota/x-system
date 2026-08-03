import { THEME_IDS, THEME_OPTIONS } from "@/lib/themes";

/**
 * 投稿の分野（T-M8-29）。**選択は必須**（2026-08-03 ユーザー判断）。
 *
 * 発信テーマ選択肢マスタ（`lib/themes.ts`・6分野）に「その他」を足したもの。
 * 「その他」は**追加指示に分野を書く**という意思表示で、`themes.ts` 側へは足さない
 * （あちらはニュース6分野と1対1で対応しており、対応先の無い値を混ぜると
 * `themesToNewsCategories` が壊れる）。
 *
 * 「指定なし」という選択肢は置かない。既定のまま押されると、利用者は分野を選んだつもりで
 * 選んでいない状態になる。**選ばせるか、明示的に「その他」と言わせる。**
 */

export const OTHER_POST_THEME = "other" as const;

export const POST_THEME_IDS = [...THEME_IDS, OTHER_POST_THEME] as const;
export type PostThemeId = (typeof POST_THEME_IDS)[number];

export const POST_THEME_OPTIONS: { id: PostThemeId; label: string }[] = [
  ...THEME_OPTIONS.map((theme) => ({ id: theme.id as PostThemeId, label: theme.label })),
  { id: OTHER_POST_THEME, label: "その他（追加指示に記載）" },
];

const LABEL_BY_ID = new Map(POST_THEME_OPTIONS.map((option) => [option.id, option.label]));

export function postThemeLabel(id: string): string {
  return LABEL_BY_ID.get(id as PostThemeId) ?? id;
}

/**
 * プロンプトの `<input>` へ出す分野名。**「その他」は出さない。**
 *
 * 「その他」で `分野: その他（追加指示に記載）` と渡すと、モデルはそれを題材の手がかりとして
 * 扱おうとする。分野の指定が無いのと同じ扱いにし、追加指示とベースmdに委ねる。
 */
export function promptThemeLabel(id: string | null | undefined): string | null {
  if (!id || id === OTHER_POST_THEME) return null;
  return LABEL_BY_ID.get(id as PostThemeId) ?? null;
}
