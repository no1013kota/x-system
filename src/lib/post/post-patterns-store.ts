import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "../db/queryable";
import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "../prompts/gen-prompts";
import { toIso } from "../format";

/**
 * 投稿パターンの読み出し（T-M8-129 U3・ADR-0008）。
 *
 * **画面はここから選択肢を得る。** 以前は `POST_PATTERN_OPTIONS`（コード定数の6件）を
 * 各画面が直接importしていたため、利用者が作ったパターンはどの画面にも現れなかった。
 *
 * 返す `id` は `post_patterns.id`（uuid）で、**内部ID（`p1`）は返さない**。
 * 画面に内部IDを出さない（要件06 §1.0）という決めごとを、型のうえで守れるようにする。
 */

export interface PatternOption {
  /** `post_patterns.id`。画面とServer Actionはこれで指す。 */
  id: string;
  /**
   * 既定として投入されたときの内部ID（`p1`〜`p6`）。自作は null。
   * **画面に出さない**（要件06 §1.0）。旧 `pattern` 列へ並べて書くため／既定の復元判定のために持つ。
   */
  seedKey: string | null;
  name: string;
  description: string | null;
  /** 生成時に作るポスト数の上限。画面の説明（「2〜4ポスト」）はこれから組む。 */
  maxPosts: number;
  /** 下書き編集で許すポスト数の上限。 */
  maxPostsEdit: number;
  /** 引用対象のX URLを毎回指定させるか。true は予約に使えない。 */
  requiresQuoteUrl: boolean;
  /** 利用者の意見・視点を入力として求めるか（画面の入力欄の出し分けに使う）。 */
  asksUserOpinion: boolean;
  /** システム既定として投入されたものか（`p1`〜`p6`）。既定を復元する導線の判定に使う。 */
  isSystemDefault: boolean;
  /** プロンプトを自分で書き換えているか（false = システム既定のまま）。 */
  hasCustomPrompt: boolean;
}

interface PatternRow {
  id: string;
  seed_key: string | null;
  name: string;
  description: string | null;
  prompt: string | null;
  max_posts: number;
  max_posts_edit: number;
  requires_quote_url: boolean;
  asks_user_opinion: boolean;
}

const COLUMNS = `id, seed_key, name, description, prompt, max_posts, max_posts_edit,
                 requires_quote_url, asks_user_opinion`;

function toOption(row: PatternRow): PatternOption {
  return {
    id: row.id,
    seedKey: row.seed_key,
    name: row.name,
    description: row.description,
    maxPosts: row.max_posts,
    maxPostsEdit: row.max_posts_edit,
    requiresQuoteUrl: row.requires_quote_url,
    asksUserOpinion: row.asks_user_opinion,
    isSystemDefault: row.seed_key !== null,
    hasCustomPrompt: row.prompt !== null,
  };
}

/** 画面の並び順（`sort_order` → 作成順）でパターンを返す。 */
export async function listPatterns(
  db: Queryable,
  xAccountId: string,
): Promise<PatternOption[]> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns
      where x_account_id = $1 order by sort_order, created_at`,
    [xAccountId],
  );
  return rows.map(toOption);
}

/**
 * 予約（スケジュール）で選べるパターン。**引用URLが必須のものは除く**——
 * 毎回URLの指定が要るため自動実行できない（DBのトリガも同じ判定で拒否する）。
 */
export async function listSchedulablePatterns(
  db: Queryable,
  xAccountId: string,
): Promise<PatternOption[]> {
  const all = await listPatterns(db, xAccountId);
  return all.filter((p) => !p.requiresQuoteUrl);
}

/**
 * 1件を取り、無ければ `not_found`。**所有者チェックを兼ねる**ので、
 * Server Action は必ずこれを通してから書き込む（他人のパターンで生成させない）。
 */
export async function requirePattern(
  db: Queryable,
  xAccountId: string,
  patternId: string,
): Promise<PatternOption> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns where x_account_id = $1 and id = $2`,
    [xAccountId, patternId],
  );
  const row = rows[0];
  if (!row) throw new AppError("not_found", { details: { reason: "pattern_not_found" } });
  return toOption(row);
}

/**
 * 旧 enum（`p1`〜`p6`）から現在の行を引く。**移行の間だけ使う**（U5 で撤去）。
 * 既定パターンを削除済みなら null。
 */
export async function findPatternBySeedKey(
  db: Queryable,
  xAccountId: string,
  seedKey: string,
): Promise<PatternOption | null> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns where x_account_id = $1 and seed_key = $2`,
    [xAccountId, seedKey],
  );
  return rows[0] ? toOption(rows[0]) : null;
}

/**
 * 画面に出す説明文。**ポスト数はここで付ける**（説明文に書かせない・T-M8-33）。
 * 説明とポスト数が別々に書かれていると、片方だけ直して食い違う。
 */
export function patternDescriptionWithCount(option: PatternOption): string {
  const count = option.maxPosts === 1 ? "1ポスト" : `最大${option.maxPosts}ポスト`;
  return option.description ? `${option.description}（${count}）` : count;
}

/**
 * 予約に使えるパターンか検証する（使えなければ `validation_error`）。
 *
 * DBのトリガも同じ判定で拒否するが、**画面へ理由を返せるのはここだけ**。
 * トリガに任せると「保存できませんでした」しか出せない（CLAUDE.md 原則2）。
 */
export function assertSchedulable(option: PatternOption): void {
  if (option.requiresQuoteUrl) {
    throw new AppError("validation_error", {
      details: { reason: "pattern_requires_quote_url", pattern: option.name },
    });
  }
}

export interface PatternPromptView {
  /** 表示中の本文（上書きが無ければシステム既定）。 */
  content: string;
  /** 自分で書き換えているか。false は「システム既定のまま」。 */
  isOverride: boolean;
  /** 上書きの更新時刻（楽観lockの `expected_updated_at`）。未上書きは null。 */
  updatedAt: string | null;
}

/**
 * パターンID → プロンプト本文。**投稿作成画面の「この生成にだけ使うプロンプト」と
 * パターン管理画面の両方がこれを使う**（T-M8-129 U3）。
 *
 * 以前は `prompt_templates` の `kind`（`p1`〜`p6`）で引いていたため、
 * 利用者が作ったパターンのプロンプトを画面に出せなかった。
 */
export async function listPatternPrompts(
  db: Queryable,
  xAccountId: string,
): Promise<Record<string, PatternPromptView>> {
  const { rows } = await db.query<{
    id: string;
    seed_key: string | null;
    prompt: string | null;
    updated_at: Date | string;
  }>(
    `select id, seed_key, prompt, updated_at from post_patterns where x_account_id = $1`,
    [xAccountId],
  );
  const out: Record<string, PatternPromptView> = {};
  for (const row of rows) {
    const fallback = row.seed_key
      ? (SYSTEM_DEFAULT_TEMPLATES[row.seed_key as PromptTemplateKind] ?? "")
      : "";
    out[row.id] = {
      content: row.prompt ?? fallback,
      isOverride: row.prompt !== null,
      updatedAt: row.prompt !== null ? toIso(row.updated_at) : null,
    };
  }
  return out;
}

/** プロンプト本文の上限（`prompt_templates` と同じ・要件02 §3.21 の CHECK と一致）。 */
export const PATTERN_PROMPT_MAX_CHARS = 8000;

/** 空・長すぎを拒否する（DBのCHECKと同じ判定を、理由の分かる形で先に行う）。 */
export function validatePatternPrompt(content: string): void {
  if (content.trim().length === 0) {
    throw new AppError("validation_error", { details: { reason: "empty" } });
  }
  if (content.length > PATTERN_PROMPT_MAX_CHARS) {
    throw new AppError("validation_error", {
      details: { reason: "too_long", max: PATTERN_PROMPT_MAX_CHARS, length: content.length },
    });
  }
}

/**
 * パターンのプロンプトを保存する（`post_patterns.prompt`）。
 *
 * 楽観lockの意味は `prompt_templates` と揃える: `expectedUpdatedAt === null` は
 * 「まだ上書きが無い」（＝`prompt is null`）状態からの初回保存。
 */
export async function applyUpdatePatternPrompt(
  db: Queryable,
  input: {
    xAccountId: string;
    patternId: string;
    content: string;
    expectedUpdatedAt: string | null;
  },
): Promise<PatternPromptView> {
  validatePatternPrompt(input.content);
  const first = input.expectedUpdatedAt === null;
  const res = await db.query(
    first
      ? `update post_patterns set prompt = $3, updated_at = now()
          where x_account_id = $1 and id = $2 and prompt is null`
      : `update post_patterns set prompt = $3, updated_at = now()
          where x_account_id = $1 and id = $2 and prompt is not null
            and date_trunc('milliseconds', updated_at) = $4::timestamptz`,
    first
      ? [input.xAccountId, input.patternId, input.content]
      : [input.xAccountId, input.patternId, input.content, input.expectedUpdatedAt],
  );
  if ((res.rowCount ?? 0) !== 1) {
    throw new AppError("job_conflict", { details: { reason: "prompt_template_changed" } });
  }
  return requirePatternPrompt(db, input.xAccountId, input.patternId);
}

/**
 * システム既定へ戻す（`prompt = null`）。**行は消さない。**
 * 自作パターンは既定を持たないため戻せない（`validation_error`）。
 */
export async function applyResetPatternPrompt(
  db: Queryable,
  input: { xAccountId: string; patternId: string },
): Promise<PatternPromptView> {
  const option = await requirePattern(db, input.xAccountId, input.patternId);
  if (!option.isSystemDefault) {
    throw new AppError("validation_error", { details: { reason: "no_system_default" } });
  }
  await db.query(
    `update post_patterns set prompt = null, updated_at = now()
      where x_account_id = $1 and id = $2 and prompt is not null`,
    [input.xAccountId, input.patternId],
  );
  return requirePatternPrompt(db, input.xAccountId, input.patternId);
}

async function requirePatternPrompt(
  db: Queryable,
  xAccountId: string,
  patternId: string,
): Promise<PatternPromptView> {
  const prompts = await listPatternPrompts(db, xAccountId);
  const view = prompts[patternId];
  if (!view) throw new AppError("not_found", { details: { reason: "pattern_not_found" } });
  return view;
}
