import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "../db/queryable";
import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "../prompts/gen-prompts";
import { toIso } from "../format";
import type { PatternPolicy } from "./pattern-spec";

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
  /** Web検索の方針（管理画面が編集する）。 */
  webSearchPolicy: PatternPolicy;
  /** 出典URLの方針（管理画面が編集する）。 */
  sourcePolicy: PatternPolicy;
  /** 直近のニュースをまとめて渡すか。 */
  includeNewsDigest: boolean;
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
  web_search_policy: PatternPolicy;
  source_policy: PatternPolicy;
  include_news_digest: boolean;
}

const COLUMNS = `id, seed_key, name, description, prompt, max_posts, max_posts_edit,
                 requires_quote_url, asks_user_opinion,
                 web_search_policy, source_policy, include_news_digest`;

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
    webSearchPolicy: row.web_search_policy,
    sourcePolicy: row.source_policy,
    includeNewsDigest: row.include_news_digest,
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
  const count = threadCountLabel(option.maxPosts);
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

/** 名前の上限（要件02 §3.21 の CHECK と一致）。 */
export const PATTERN_NAME_MAX_CHARS = 30;
/** 説明の上限（DBに CHECK は無いが、画面が破綻しない長さで止める）。 */
export const PATTERN_DESCRIPTION_MAX_CHARS = 120;
/**
 * 生成する総ポスト数の上限（スレッド全体の上限・要件02 §3.9）。
 * 画面は**スレッド数**（メインポストに続く本数）で見せるので `0〜7` に対応する。
 */
export const PATTERN_MAX_POSTS_LIMIT = 8;

/** 画面に出すスレッド数の上限（メインポストに続く本数）。 */
export const PATTERN_MAX_THREAD_COUNT = PATTERN_MAX_POSTS_LIMIT - 1;

/**
 * 総ポスト数 ⇄ スレッド数の変換（T-M8-130・運営者の指示 2026-08-18）。
 *
 * **DBは総ポスト数で持ち、画面はスレッド数で見せる。** `max_posts` はスレッド配列の
 * 上限としてコード全体で使われており、意味を変えると解釈が全箇所でずれる。
 * スレッド数 0 = メインポストのみ（総1ポスト）。
 */
export function threadCountOf(maxPosts: number): number {
  return Math.max(0, maxPosts - 1);
}

export function maxPostsFromThreadCount(threadCount: number): number {
  return Math.min(PATTERN_MAX_POSTS_LIMIT, Math.max(0, threadCount) + 1);
}

/** 画面に出す言い方。0 は「単発」と書く（「最大1ポスト」では単発だと伝わらない）。 */
export function threadCountLabel(maxPosts: number): string {
  const n = threadCountOf(maxPosts);
  return n === 0 ? "メインポストのみ（単発）" : `メイン＋スレッド最大${n}`;
}

/** パターンの作成・更新で受け取る値。**内部IDは受けない**。 */
export interface PatternInput {
  name: string;
  description: string | null;
  /** 自作パターンでは必須。既定パターンは `null` で「システム既定に戻す」。 */
  prompt: string | null;
  maxPosts: number;
  webSearchPolicy: PatternPolicy;
  sourcePolicy: PatternPolicy;
  includeNewsDigest: boolean;
  asksUserOpinion: boolean;
  requiresQuoteUrl: boolean;
}

/**
 * 入力を検証する。**DBのCHECKと同じ判定を、理由の分かる形で先に行う**（CLAUDE.md 原則2）。
 * トリガ任せにすると画面には「保存できませんでした」しか出せない。
 */
export function validatePatternInput(input: PatternInput, opts: { isSystemDefault: boolean }): void {
  const name = input.name.trim();
  if (name.length === 0 || name.length > PATTERN_NAME_MAX_CHARS) {
    throw new AppError("validation_error", {
      details: { reason: "name_length", max: PATTERN_NAME_MAX_CHARS },
    });
  }
  // 名前は改善提案プロンプト（PT-SUGGEST）へ差し込まれる。プロンプトを壊す文字を通さない。
  if (/[\n\r<>]/.test(name)) {
    throw new AppError("validation_error", { details: { reason: "name_unsafe_chars" } });
  }
  if (input.description !== null && input.description.length > PATTERN_DESCRIPTION_MAX_CHARS) {
    throw new AppError("validation_error", {
      details: { reason: "description_length", max: PATTERN_DESCRIPTION_MAX_CHARS },
    });
  }
if (!Number.isInteger(input.maxPosts) || input.maxPosts < 1 || input.maxPosts > PATTERN_MAX_POSTS_LIMIT) {
    // 画面は**スレッド数**（0〜7）で見せるので、範囲もその言葉で返す（T-M8-130）。
    throw new AppError("validation_error", {
      details: { reason: "max_posts_range", min: 0, max: PATTERN_MAX_THREAD_COUNT },
    });
  }
  // 自作パターンはコード側の既定を持たないので、プロンプトが無いと生成できない。
  if (!opts.isSystemDefault && (input.prompt === null || input.prompt.trim().length === 0)) {
    throw new AppError("validation_error", { details: { reason: "prompt_required" } });
  }
  if (input.prompt !== null) validatePatternPrompt(input.prompt);
  // 引用ポストにニュースダイジェストは渡さない（DBのCHECKと同じ）。
  if (input.requiresQuoteUrl && input.includeNewsDigest) {
    throw new AppError("validation_error", { details: { reason: "quote_with_digest" } });
  }
}

/** 方針から検索回数を決める。`never` は0、それ以外は既定の3回（DBの整合CHECKを満たす）。 */
function webSearchUsesFor(policy: PatternPolicy): number {
  return policy === "never" ? 0 : 3;
}

/**
 * パターンを作る。並び順は末尾（既存の最大 + 10）。
 *
 * **名前の重複は `validation_error`（`name_taken`）で返す**。DBの unique 違反をそのまま
 * 投げると画面には汎用エラーしか出ず、利用者は何を直せばよいか分からない。
 */
export async function applyCreatePattern(
  db: Queryable,
  input: PatternInput & { xAccountId: string },
): Promise<PatternOption> {
  validatePatternInput(input, { isSystemDefault: false });
  if (await nameTaken(db, input.xAccountId, input.name.trim(), null)) {
    throw new AppError("validation_error", { details: { reason: "name_taken" } });
  }
  const { rows } = await db.query<PatternRow>(
    `insert into post_patterns
       (x_account_id, name, description, prompt, max_posts, max_posts_edit,
        web_search_policy, web_search_max_uses, source_policy,
        include_news_digest, asks_user_opinion, requires_quote_url, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             coalesce((select max(sort_order) + 10 from post_patterns where x_account_id = $1), 100))
     returning ${COLUMNS}`,
    [
      input.xAccountId,
      input.name.trim(),
      emptyToNull(input.description),
      input.prompt,
      input.maxPosts,
      Math.min(PATTERN_MAX_POSTS_LIMIT, input.maxPosts + 2),
      input.webSearchPolicy,
      webSearchUsesFor(input.webSearchPolicy),
      input.sourcePolicy,
      input.includeNewsDigest,
      input.asksUserOpinion,
      input.requiresQuoteUrl,
    ],
  );
  return toOption(rows[0]);
}

/**
 * パターンを更新する。既定パターン（`seed_key` あり）も編集できる。
 *
 * `max_posts_edit` は**狭めない**（`greatest`）。狭めると既存の下書きが編集できなくなる。
 */
export async function applyUpdatePattern(
  db: Queryable,
  input: PatternInput & { xAccountId: string; patternId: string },
): Promise<PatternOption> {
  const current = await requirePattern(db, input.xAccountId, input.patternId);
  validatePatternInput(input, { isSystemDefault: current.isSystemDefault });
  if (await nameTaken(db, input.xAccountId, input.name.trim(), input.patternId)) {
    throw new AppError("validation_error", { details: { reason: "name_taken" } });
  }
  const { rows } = await db.query<PatternRow>(
    `update post_patterns
        set name = $3, description = $4, prompt = $5, max_posts = $6,
            max_posts_edit = greatest(max_posts_edit, $6::smallint),
            web_search_policy = $7, web_search_max_uses = $8, source_policy = $9,
            include_news_digest = $10, asks_user_opinion = $11, requires_quote_url = $12,
            updated_at = now()
      where x_account_id = $1 and id = $2
      returning ${COLUMNS}`,
    [
      input.xAccountId,
      input.patternId,
      input.name.trim(),
      emptyToNull(input.description),
      input.prompt,
      input.maxPosts,
      input.webSearchPolicy,
      webSearchUsesFor(input.webSearchPolicy),
      input.sourcePolicy,
      input.includeNewsDigest,
      input.asksUserOpinion,
      input.requiresQuoteUrl,
    ],
  );
  if (rows.length === 0) throw new AppError("not_found", { details: { reason: "pattern_not_found" } });
  return toOption(rows[0]);
}

/**
 * パターンを削除する。**既定パターンも削除できる**（運営者の指示・2026-08-18）。
 *
 * 参照の外し方はDBのトリガが決める（要件02 §3.21）: 下書きは名前が残り、
 * 予約は設定を残して停止し、実行中のジョブは凍結したspecで完走する。
 *
 * **最後の1件は削除させない。** 0件になると投稿を作る手段が画面から消え、
 * 利用者は「既定を復元する」を知らないと復帰できない（原則1・2）。
 */
export async function applyDeletePattern(
  db: Queryable,
  input: { xAccountId: string; patternId: string },
): Promise<{ deletedName: string; disabledSlots: number }> {
  const target = await requirePattern(db, input.xAccountId, input.patternId);
  const { rows: countRows } = await db.query<{ n: string }>(
    `select count(*)::text n from post_patterns where x_account_id = $1`,
    [input.xAccountId],
  );
  if (Number(countRows[0].n) <= 1) {
    throw new AppError("validation_error", { details: { reason: "last_pattern" } });
  }
  // 停止される予約の件数を先に数えて返す（何が起きたか画面で言えるようにする）。
  const { rows: slotRows } = await db.query<{ n: string }>(
    `select count(*)::text n from schedule_slots where pattern_id = $1 and enabled`,
    [input.patternId],
  );
  await db.query(`delete from post_patterns where x_account_id = $1 and id = $2`, [
    input.xAccountId,
    input.patternId,
  ]);
  return { deletedName: target.name, disabledSlots: Number(slotRows[0].n) };
}

/**
 * 削除した既定パターンを復元する（`seed_default_post_patterns`）。**入れた件数**を返す。
 * 同名の自作パターンがあるときは「（復元）」を付けて共存させる（既存を上書きしない）。
 */
export async function applyRestoreDefaultPatterns(
  db: Queryable,
  xAccountId: string,
): Promise<number> {
  const { rows } = await db.query<{ seed_default_post_patterns: number }>(
    `select seed_default_post_patterns($1)`,
    [xAccountId],
  );
  return Number(rows[0]?.seed_default_post_patterns ?? 0);
}

async function nameTaken(
  db: Queryable,
  xAccountId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text n from post_patterns
      where x_account_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`,
    [xAccountId, name, exceptId],
  );
  return Number(rows[0].n) > 0;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * 新しいパターンのプロンプト雛形（T-M8-130・運営者の指示 2026-08-18）。
 *
 * **空欄から書き始めさせない。** 既定パターンのプロンプトは「# タスク／# 手順／# 構成と分量」
 * という決まった形をしていて、生成の質はこの形に依存する。何を書けばよいかが分からないまま
 * 自由記述させると、指示の抜けた薄いプロンプトになりやすい。
 *
 * 分量の指示はここに数字を書かない——**実際に作られる本数は「スレッド数」の設定が決める**ので、
 * プロンプトに別の数字を書くと食い違う（T-M8-33 と同じ型の事故）。
 */
export const NEW_PATTERN_PROMPT_TEMPLATE = `# タスク
（この型でどんな投稿を作るかを1〜2文で書く。<input> が未指定のときに何を題材にするかも書く）

# 手順
（作る前に確認・準備することを書く。例: 正確性が要る点だけWeb検索で確認する）

# 構成と分量
（1ポスト目に何を書くか＝フックの型、中間で何を1ポストずつ扱うか、最終ポストで何を残すかを書く。
ポスト数は「スレッド数」の設定が決めるので、ここには本数を書かない）

# 語り口
（一人称・敬体/常体・避ける言い回しなど、この型に固有の指定があれば書く）
`;
