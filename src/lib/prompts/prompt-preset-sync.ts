import type { Queryable } from "../db/queryable";

/**
 * 本棚と実物の同期（T-M8-332）。**`prompt-presets.ts` とは別ファイルにしてある**——
 * 呼ぶのは `base-md.ts`・`persona-settings-store.ts`・`md-merge.ts` で、
 * 本体（`prompt-presets.ts`）は検証のために `base-md.ts` を読むため、
 * 同じファイルに置くと import が円環になる。
 */

/** 区分ごとの本文上限（`prompt_presets` の CHECK と同じ値）。 */
const MAX_CHARS: Record<"base_md" | "image", number> = { base_md: 5000, image: 8000 };

/**
 * 置き場（`x_accounts.base_md` / `prompt_templates`）が別経路で書き換わったとき、
 * 使用中の1件へ書き戻す（学習反映・アカウント設定の保存・旧プロンプト編集）。
 *
 * **本棚と実物が食い違う状態を残さない。** 使用中が無ければ何もしない
 * （次に画面を開いたとき `listPromptPresets` が実物から1件目を作る）。
 */
export async function syncInUsePreset(
  db: Queryable,
  params: { xAccountId: string; kind: "base_md" | "image"; content: string },
): Promise<void> {
  if (params.content.trim().length === 0) return;
  if (params.content.length > MAX_CHARS[params.kind]) return;
  await db.query(
    `update prompt_presets set content = $3
      where x_account_id = $1 and kind = $2 and is_default and content is distinct from $3`,
    [params.xAccountId, params.kind, params.content],
  );
}
