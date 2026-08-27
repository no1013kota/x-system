import { AppError } from "@/lib/observability/errors";

import { validateManualBaseMd } from "../base-md";
import type { Queryable } from "../db/queryable";
import { toIso } from "../format";

// 同期は別ファイル（`base-md.ts` から呼ぶため。ここから再輸出して入口を1つに保つ）。
export { syncInUsePreset } from "./prompt-preset-sync";

/**
 * プロンプトの本棚（T-M8-332・運営者の指示 2026-08-27）。
 *
 * **アカウント.mdと画像生成プロンプトを複数持ち、使う1件を選べるようにする。**
 * 投稿作成プロンプト（`post_patterns`）は前から複数持てたのに、この2つは1件だけで、
 * 別の書き方を試すには上書きするしかなかった（前の内容は履歴からしか戻せない）。
 *
 * **生成が読む場所は変えない**（要件02 §3.22）。アカウント.mdは `x_accounts.base_md`、
 * 画像は `prompt_templates`（`kind='image'`）のまま。ここは人が育てる本棚で、
 * 「使用中」の1件をその置き場へ**写す**。読む側を変えないので、生成・学習・画像の
 * どの経路にも新しい失敗の種を作らない。逆に、置き場が別経路（学習・アカウント設定）で
 * 書き換わったときは `syncInUsePreset` で本棚へ書き戻す——**本棚と実物が食い違うと、
 * 画面に出ている文字と生成に使われる文字が違うことになる**（原則1）。
 */

export type PromptPresetKind = "base_md" | "image";

/** 区分ごとの本文上限。DBの CHECK と同じ値を持つ（片方だけ変えると保存で落ちる）。 */
export const PRESET_MAX_CHARS: Record<PromptPresetKind, number> = {
  base_md: 5000,
  image: 8000,
};

/**
 * 区分ごとの**持てる件数**の上限（T-M8-350・運営者の指示 2026-08-28）。
 *
 * 数えるのは**Xアカウント1件あたり**。プロンプトはXアカウントに紐づくので、
 * ここ以外に数えられる単位が無い（1アカウントの利用者なら「1ユーザーにつき」と同じ）。
 * 上限が無いと、選ぶ画面が長くなるだけで「いまどれが効いているか」が見つけにくくなる。
 */
export const PRESET_MAX_COUNT: Record<PromptPresetKind, number> = {
  base_md: 5,
  image: 5,
};

/** 区分の日本語名（上限に達したときの文言に使う）。 */
const PRESET_KIND_LABEL: Record<PromptPresetKind, string> = {
  base_md: "アカウント.md",
  image: "画像生成プロンプト",
};

/** 画面に出す1件。 */
export interface PromptPresetView {
  id: string;
  kind: PromptPresetKind;
  name: string;
  content: string;
  /** いま生成に使われている1件か。 */
  inUse: boolean;
  /** 楽観lockの `expected_updated_at`（ISO・ms精度）。 */
  updatedAt: string;
}

const PRESET_COLUMNS = `id, kind, name, content, is_default, updated_at`;

interface PresetRow {
  id: string;
  kind: PromptPresetKind;
  name: string;
  content: string;
  is_default: boolean;
  updated_at: Date | string;
}

function toView(row: PresetRow): PromptPresetView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    content: row.content,
    inUse: row.is_default,
    updatedAt: toIso(row.updated_at),
  };
}

/** 本文の検証。**アカウント.mdは見出し構造も見る**（保存できたのに生成で使えない形を作らない）。 */
export function validatePresetContent(kind: PromptPresetKind, content: string): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new AppError("validation_error", {
      message: "本文を入力してください。",
      details: { reason: "empty" },
    });
  }
  if (content.length > PRESET_MAX_CHARS[kind]) {
    throw new AppError("validation_error", {
      message: `本文は${PRESET_MAX_CHARS[kind].toLocaleString()}字以内で入力してください。`,
      details: { reason: "too_long" },
    });
  }
  if (kind === "base_md") validateManualBaseMd(content);
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 30) {
    throw new AppError("validation_error", {
      message: "名前は1〜30字で入力してください。",
      details: { reason: "name_length" },
    });
  }
  if (/[\n\r<>]/.test(trimmed)) {
    throw new AppError("validation_error", {
      message: "名前に改行や < > は使えません。",
      details: { reason: "name_unsafe" },
    });
  }
  return trimmed;
}

/**
 * 一覧を返す。**空なら「いま効いている内容」を使用中の1件として作る**（原則2）。
 *
 * 作らないと、この画面を開いた瞬間に本棚が空になり「いま何が生成に使われているのか」が
 * 画面から消える。既存アカウントの取り込みはmigrationが行うが、その後に
 * アカウント設定を保存して初めて `base_md` を持つ利用者もいるため、ここでも埋める。
 */
export async function listPromptPresets(
  db: Queryable,
  params: { xAccountId: string; kind: PromptPresetKind; fallbackContent: string },
): Promise<PromptPresetView[]> {
  const rows = await db.query<PresetRow>(
    `select ${PRESET_COLUMNS} from prompt_presets
      where x_account_id = $1 and kind = $2
      order by is_default desc, created_at`,
    [params.xAccountId, params.kind],
  );
  if (rows.rows.length > 0) return rows.rows.map(toView);

  const fallback = params.fallbackContent.trim();
  if (fallback.length === 0 || fallback.length > PRESET_MAX_CHARS[params.kind]) return [];
  const seeded = await db.query<PresetRow>(
    `insert into prompt_presets (x_account_id, kind, name, content, is_default)
     values ($1, $2, '既定', $3, true)
     on conflict do nothing
     returning ${PRESET_COLUMNS}`,
    [params.xAccountId, params.kind, params.fallbackContent],
  );
  return seeded.rows.map(toView);
}

/** 使用中の1件（無ければ null）。写す元を決めるのに使う。 */
export async function inUsePreset(
  db: Queryable,
  params: { xAccountId: string; kind: PromptPresetKind },
): Promise<PromptPresetView | null> {
  const { rows } = await db.query<PresetRow>(
    `select ${PRESET_COLUMNS} from prompt_presets
      where x_account_id = $1 and kind = $2 and is_default`,
    [params.xAccountId, params.kind],
  );
  return rows[0] ? toView(rows[0]) : null;
}

async function loadPreset(
  db: Queryable,
  params: { xAccountId: string; presetId: string },
): Promise<PresetRow> {
  const { rows } = await db.query<PresetRow>(
    `select ${PRESET_COLUMNS} from prompt_presets where id = $1 and x_account_id = $2`,
    [params.presetId, params.xAccountId],
  );
  if (!rows[0]) throw new AppError("not_found", { details: { reason: "preset_not_found" } });
  return rows[0];
}

/** 追加する。**追加しただけでは使用中にならない**（押した覚えのない切り替えを起こさない）。 */
export async function applyCreatePromptPreset(
  db: Queryable,
  input: { xAccountId: string; kind: PromptPresetKind; name: string; content: string },
): Promise<PromptPresetView> {
  const name = assertName(input.name);
  validatePresetContent(input.kind, input.content);
  /*
    **上限は作る前に見る**（T-M8-350）。書き終えてから弾かれると、書いた内容の行き先が無い。
    画面も残数を出して「増やす」を止めるが、ここでも見る（画面だけの制限は迂回できる）。
  */
  const counted = await db.query<{ n: string }>(
    `select count(*)::text as n from prompt_presets where x_account_id = $1 and kind = $2`,
    [input.xAccountId, input.kind],
  );
  const max = PRESET_MAX_COUNT[input.kind];
  if (Number(counted.rows[0]?.n ?? "0") >= max) {
    throw new AppError("validation_error", {
      message: `${PRESET_KIND_LABEL[input.kind]}は${max}件までです。使わないものを削除してから追加してください。`,
      details: { reason: "preset_limit", max },
    });
  }
  const { rows } = await db.query<PresetRow>(
    `insert into prompt_presets (x_account_id, kind, name, content, is_default)
     values ($1, $2, $3, $4, false)
     on conflict (x_account_id, kind, lower(name)) do nothing
     returning ${PRESET_COLUMNS}`,
    [input.xAccountId, input.kind, name, input.content],
  );
  if (!rows[0]) {
    throw new AppError("validation_error", {
      message: "同じ名前がすでにあります。別の名前を付けてください。",
      details: { reason: "name_taken" },
    });
  }
  return toView(rows[0]);
}

/**
 * 名前・本文を更新する（楽観lock）。
 *
 * **使用中の1件を書き換えたら、生成が読む置き場へも写す**——写さないと、画面には
 * 新しい文字が出ているのに生成は古い文字を使う（原則1で最も避けたい形）。
 * 写す処理は呼び出し側（server層）が `mirror` で渡す——本棚のこのモジュールは
 * `x_accounts` も `prompt_templates` も知らないままにしておく。
 */
export async function applyUpdatePromptPreset(
  db: Queryable,
  input: {
    xAccountId: string;
    presetId: string;
    name: string;
    content: string;
    expectedUpdatedAt: string;
  },
  mirror?: (content: string) => Promise<void>,
): Promise<PromptPresetView> {
  const current = await loadPreset(db, input);
  const name = assertName(input.name);
  validatePresetContent(current.kind, input.content);

  const { rows } = await db.query<PresetRow>(
    `update prompt_presets set name = $3, content = $4
      where id = $1 and x_account_id = $2
        and date_trunc('milliseconds', updated_at) = $5::timestamptz
      returning ${PRESET_COLUMNS}`,
    [input.presetId, input.xAccountId, name, input.content, input.expectedUpdatedAt],
  );
  if (!rows[0]) {
    // 名前の重複はDBのuniqueで落ちるが、ここまで来たら「別の場所で更新された」だけ。
    throw new AppError("job_conflict", { details: { reason: "preset_changed" } });
  }
  if (current.is_default && mirror) await mirror(input.content);
  return toView(rows[0]);
}

/**
 * 使用中を切り替える。**切り替えは1トランザクションで外して付ける**——
 * 部分unique（区分ごとに1件）があるので、外す前に付けると必ず落ちる。
 */
export async function applySetPromptPresetInUse(
  db: Queryable,
  input: { xAccountId: string; presetId: string },
  mirror?: (content: string) => Promise<void>,
): Promise<PromptPresetView> {
  const target = await loadPreset(db, input);
  validatePresetContent(target.kind, target.content);
  await db.query(
    `update prompt_presets set is_default = false
      where x_account_id = $1 and kind = $2 and is_default and id <> $3`,
    [input.xAccountId, target.kind, input.presetId],
  );
  const { rows } = await db.query<PresetRow>(
    `update prompt_presets set is_default = true where id = $1 and x_account_id = $2
     returning ${PRESET_COLUMNS}`,
    [input.presetId, input.xAccountId],
  );
  if (!rows[0]) throw new AppError("not_found", { details: { reason: "preset_not_found" } });
  if (mirror) await mirror(target.content);
  return toView(rows[0]);
}

/**
 * 削除する。**使用中の1件は削除させない**——消すと「いま何が効いているのか」が
 * 画面から消え、生成だけが古い写しで動き続ける。先に別の1件を使用中にしてもらう。
 */
export async function applyDeletePromptPreset(
  db: Queryable,
  input: { xAccountId: string; presetId: string },
): Promise<{ deletedName: string }> {
  const target = await loadPreset(db, input);
  if (target.is_default) {
    throw new AppError("validation_error", {
      message: "使用中のものは削除できません。先に別のものを使用中にしてください。",
      details: { reason: "preset_in_use" },
    });
  }
  await db.query(`delete from prompt_presets where id = $1 and x_account_id = $2`, [
    input.presetId,
    input.xAccountId,
  ]);
  return { deletedName: target.name };
}
