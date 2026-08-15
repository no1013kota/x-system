import { OPERATED_THEME_IDS, THEME_IDS, THEME_OPTIONS } from "@/lib/themes";

/**
 * 投稿のテーマ（T-M8-29 / T-M8-31）。**選択は必須**（2026-08-03 ユーザー判断）。
 *
 * **画面の用語は「テーマ」で統一する**（2026-08-03 ユーザー判断）。以前は投稿作成・ニュースが
 * 「分野」、AI設定が「テーマ」と呼んでおり、同じ6つの選択肢に2つの名前があった。
 * なお**プロンプト側は `分野:` のまま**（`gen-prompts.ts` / `post-generation.ts`）。
 * 利用者には見えず、変えると全パターンのプロンプト再検証（実費）が必要になるため。
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

/**
 * **画面で選べる**テーマ（T-M8-100）: 運用中テーマ（最新ニュース画面と同じ・`OPERATED_THEME_IDS`）
 * ＋「その他」。`POST_THEME_OPTIONS`（全語彙）は保存済み値の表示・検証用に残す——
 * 選択肢を絞っても、旧テーマ（Web3等）の下書き・スケジュール・過去レポートは表示できる。
 */
export const SELECTABLE_POST_THEME_OPTIONS = POST_THEME_OPTIONS.filter(
  (option) => option.id === OTHER_POST_THEME || (OPERATED_THEME_IDS as string[]).includes(option.id),
);

const LABEL_BY_ID = new Map(POST_THEME_OPTIONS.map((option) => [option.id, option.label]));

/**
 * テーマselectの選択肢。編集中の既存値が運用外テーマ（選択肢に無い）のときは、
 * その値を「（現在の設定）」として足す——**開いただけで値が黙って変わる**のを防ぐ（原則1）。
 */
export function selectablePostThemeOptions(current?: string | null): { id: string; label: string }[] {
  if (!current || SELECTABLE_POST_THEME_OPTIONS.some((o) => o.id === current)) {
    return SELECTABLE_POST_THEME_OPTIONS;
  }
  return [...SELECTABLE_POST_THEME_OPTIONS, { id: current, label: `${postThemeLabel(current)}（現在の設定）` }];
}

export function postThemeLabel(id: string): string {
  return LABEL_BY_ID.get(id as PostThemeId) ?? id;
}

/**
 * プロンプトの `<input>` へ出す分野名。**「その他」は出さない。**
 *
 * 「その他」で `分野: その他（追加指示に記載）` と渡すと、モデルはそれを題材の手がかりとして
 * 扱おうとする。分野の指定が無いのと同じ扱いにし、追加指示とアカウント.mdに委ねる。
 */
export function promptThemeLabel(id: string | null | undefined): string | null {
  if (!id || id === OTHER_POST_THEME) return null;
  return LABEL_BY_ID.get(id as PostThemeId) ?? null;
}
