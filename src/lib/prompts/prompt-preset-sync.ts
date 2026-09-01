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

/** 区分ごとの持てる件数（`prompt-presets.ts` の `PRESET_MAX_COUNT` と同じ値。単体テストで一致を固定）。 */
export const PRESET_SYNC_MAX_COUNT: Record<"base_md" | "image", number> = { base_md: 5, image: 5 };

export interface AddPresetInUseResult {
  /** 1件追加できたか。false は上限で使用中の1件を書き換えた。 */
  added: boolean;
  /** 追加した（または書き換えた）名前。書き換え先が無ければ null。 */
  name: string | null;
}

/**
 * **本棚へ1件追加して使用中にする**（T-M8-411・運営者の指示 2026-09-01）。
 * 「アカウント設定を保存」で使う。以前は使用中の1件を書き換えていたが、前の内容が
 * 消えるので、追加して切り替える形にした（前のものは控えとして残る）。
 *
 * - 名前が既にあれば「（HH:MM）」を足す（同じ区分で名前はunique）
 * - 上限に達していたら**失敗させず**使用中の1件を書き換える（`added: false`。画面がその旨を言う）
 */
export async function addPresetAndSetInUse(
  db: Queryable,
  params: { xAccountId: string; kind: "base_md" | "image"; name: string; content: string },
): Promise<AddPresetInUseResult> {
  if (params.content.trim().length === 0 || params.content.length > MAX_CHARS[params.kind]) {
    return { added: false, name: null };
  }
  const counted = await db.query<{ n: string }>(
    `select count(*)::text as n from prompt_presets where x_account_id = $1 and kind = $2`,
    [params.xAccountId, params.kind],
  );
  if (Number(counted.rows[0]?.n ?? "0") >= PRESET_SYNC_MAX_COUNT[params.kind]) {
    await syncInUsePreset(db, params);
    const current = await db.query<{ name: string }>(
      `select name from prompt_presets where x_account_id = $1 and kind = $2 and is_default`,
      [params.xAccountId, params.kind],
    );
    return { added: false, name: current.rows[0]?.name ?? null };
  }
  await db.query(
    `update prompt_presets set is_default = false
      where x_account_id = $1 and kind = $2 and is_default`,
    [params.xAccountId, params.kind],
  );
  const { rows } = await db.query<{ name: string }>(
    // created_at は clock_timestamp()（同じトランザクション内で複数作っても作成順が決まる。
    // 一覧は created_at 順なので、ここが同値だと並びが不定になる）。
    `insert into prompt_presets (x_account_id, kind, name, content, is_default, created_at)
     values ($1, $2,
             case when exists (
               select 1 from prompt_presets e
                where e.x_account_id = $1 and e.kind = $2 and lower(e.name) = lower($3)
             ) then $3 || '（' || to_char(now() at time zone 'Asia/Tokyo', 'HH24:MI') || '）'
             else $3 end,
             $4, true, clock_timestamp())
     returning name`,
    [params.xAccountId, params.kind, params.name.slice(0, 22), params.content],
  );
  return { added: true, name: rows[0]?.name ?? params.name };
}
