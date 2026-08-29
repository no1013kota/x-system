import { z } from "zod";

import { providerRawOutputOf, runTextGeneration, usageFromError } from "../ai/pipeline";
import { formatFailureRawError } from "../ai/raw-error";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { OPERATED_THEME_IDS, OPERATED_THEME_OPTIONS } from "../themes";
import { listPatterns } from "../post/post-patterns-store";
import { PT_SUGGEST } from "../prompts/gen-prompts";
import { PROMPT_TEMPLATE_MAX_CHARS } from "../prompts/prompt-templates";
import { BASE_MD_MAX_CHARS, validateManualBaseMd } from "../base-md";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { persistJobFailure } from "./notifications";
import { defaultRecordStage } from "./stale";
import { toJstLabel, type SuggestionInput } from "./suggestion-input";
import { SUGGEST_ANALYZE_MAX } from "./suggestion-timeline";

/**
 * suggestion worker（SUGGEST, K-2, プロンプト §6.15/§4.2, 要件04 §12, 要件02 §3.12/§4.11, T-M8-91）。
 *
 * 2026-08-15 刷新: Xタイムラインの投稿（Exos製かに依らない・最新100件から増分蓄積）を PT-SUGGEST で自由分析し、
 * **1件の提案**（良かった投稿の特徴 summary＋実行可能な advice: 型・テーマ・画像・そのまま貼れるプロンプト全文）
 * を improvement_suggestions へ保存する。固定の分析軸と「3投稿以上・差20%」条件は廃止。
 * 保存形は evidence.format=2 で旧形式（axis等）と区別する。
 *
 * T-M8-94 で**毎朝8:00 JSTの自動実行**になった（起票は scheduler_tick・request_key冪等で1日1回）。
 * X取得はハンドラ側（suggestion-server）が増分＋48h重なりで行い、保存済み全投稿（新しい順に最大
 * SUGGEST_ANALYZE_MAX 件）を分析する。**自動実行のため premium の生成枠は消費しない**
 * （利用者の操作なしで枠が減るのを避ける。費用は原価台帳で見える）。base_md は読まない。
 */

export class SuggestionTerminalError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message = "suggestion failed",
  ) {
    super(message);
    this.name = "SuggestionTerminalError";
  }
}

/** advice.pattern の選択肢。p5（引用）はfeature flag停止中のため提案させない。 */
/**
 * 推奨できるパターンは**そのアカウントのパターン名**（T-M8-129 U5）。
 * 以前は `p1`〜`p6` の固定enumだったが、利用者が作ったパターンを推奨できなかった。
 * 引用URLが必須のパターンは毎回URLの指定が要るので推奨しない（実行できない提案を出さない）。
 */
export function suggestablePatternNames(
  patterns: readonly { name: string; requiresQuoteUrl: boolean }[],
): string[] {
  return patterns.filter((p) => !p.requiresQuoteUrl).map((p) => p.name);
}

/**
 * PT-SUGGEST 出力スキーマ（T-M8-91）。
 * good_posts.id は `<posts>`内IDのみ（修復1回は runTextGeneration が担う）。
 * prompt.content の上限は AI設定＞プロンプトの保存上限（8,000字）と同じにする——
 * 「そのまま貼れる」が要件なので、貼った先で保存できない長さを許さない。
 */
function makeSuggestionSchema(allowedIds: Set<string>, patternNames: readonly string[]) {
  const reasoned = <T extends z.ZodTypeAny>(recommended: T) =>
    z.object({ recommended, reason: z.string().min(1) });
  // アカウント.mdの改訂案は**保存時と同じ検証**（6見出し構造＋5,000字）を通す——
  // 「そのまま貼れる」が要件なので、貼った先で保存できない構造を許さない（T-M8-106）。
  const accountMdProposal = z
    .object({
      content: z
        .string()
        .min(1)
        .max(BASE_MD_MAX_CHARS)
        .refine(
          (content) => {
            try {
              validateManualBaseMd(content);
              return true;
              // eslint-disable-next-line no-restricted-syntax -- 構造検証の失敗がrefineの判定結果。修復はrunTextGenerationが担う
            } catch {
              return false;
            }
          },
          { message: "account_md.content must keep the ## 1.-## 6. heading structure" },
        ),
      reason: z.string().min(1),
    })
    // null=提案なし。キー省略も同義に扱う（省略のたびに修復callを1回浪費しない）。
    .nullish();
  return z.object({
    summary: z.string().min(1),
    good_posts: z
      .array(z.object({ id: z.string().min(1), why: z.string().min(1) }))
      .min(1)
      .max(3)
      .refine((items) => items.every((i) => allowedIds.has(i.id)), {
        message: "good_posts[].id must be a subset of <posts> ids",
      }),
    advice: z
      .object({
        // アカウント.mdの編集提案（T-M8-106）。<account_md>が"none"（未作成）のときはnull。
        account_md: accountMdProposal,
      // **そのアカウントに実在する名前だけを通す**。存在しない型を推奨されると
        // 「近づけるための設定」を画面で選べない（実行できない提案になる）。
        pattern: reasoned(
          patternNames.length > 0
            ? z.enum(patternNames as [string, ...string[]])
            : z.string().min(1),
        ),
        // 「その他」は提案として実行可能でない（追加指示に書く意思表示）ため不可。
        // 選択肢は運用中テーマ（最新ニュース画面と同じ・T-M8-100）に限定する——
        // 運用していない分野を推奨しても投稿作成で選べない。
        theme: reasoned(z.enum(OPERATED_THEME_IDS as [string, ...string[]])),
        image: reasoned(z.boolean()),
        prompt: z.object({
            // 推奨した型と同じ名前（下の refine で一致を必須にする）。
            kind:
              patternNames.length > 0
                ? z.enum(patternNames as [string, ...string[]])
                : z.string().min(1),
          content: z.string().min(1).max(PROMPT_TEMPLATE_MAX_CHARS),
        }),
      })
      .refine((a) => a.prompt.kind === a.pattern.recommended, {
        message: "advice.prompt.kind must equal advice.pattern.recommended",
      }),
  });
}

export type SuggestionOutput = z.infer<ReturnType<typeof makeSuggestionSchema>>;

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface SuggestionDeps {
  db: Queryable;
  jobId: string;
  runInTx: RunInTx;
  resolveProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  /**
   * Xタイムライン（初回は最新100件・以後は増分・メトリクス付き）＋Exos投稿の型/テーマタグを整形済みで返す。
   * server側（suggestion-server）が token 復号・読取・drafts 突合を担う。
   */
  fetchPosts: (job: { xAccountId: string; xUserId: string; userId: string }) => Promise<SuggestionInput>;
  now?: () => number;
  makeDeadline?: () => Deadline;
  recordStage?: (stage: string) => Promise<void>;
}

export interface SuggestionResult {
  status: "saved" | "no_suggestions";
  count: number;
}

interface JobRow {
  x_account_id: string;
  x_user_id: string;
  user_id: string;
  /** 現行アカウント.md（編集提案の土台・T-M8-106）。未作成（version 0）は提案対象外。 */
  base_md: string;
  base_md_version: number;
  plan: string;
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.x_account_id, xa.x_user_id, xa.user_id, xa.base_md, xa.base_md_version, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

/** テーマの選択肢を「id=ラベル」で列挙する（LLMがidを選び、理由をラベルで書けるように）。運用中テーマのみ（T-M8-100）。 */
/** 型の選択肢を1行にする。名前だけを出す（内部IDは持たない）。 */
function patternChoices(names: readonly string[]): string {
  return names.length > 0 ? names.join(" / ") : "（利用できる型がありません）";
}

function themeChoices(): string {
  return OPERATED_THEME_OPTIONS.map((t) => `${t.id}=${t.label}`).join(" / ");
}

/** 直前のレポート（format=2のみ。旧形式は前回参照に使えない）。 */
export interface PreviousSuggestion {
  id: string;
  createdAt: string;
  summary: string;
  /** evidence.advice（保存時にzod検証済み。読み出しは形だけ信頼して渡す）。 */
  advice: unknown;
}

/**
 * 同アカウントの直前のレポートを読む（T-M8-98）。前回の推奨・プロンプトをLLMへ渡し、
 * 効果検証と「何を残し何を変えたか」の分かる提案にする（惰性の繰り返しと全とっかえの両方を防ぐ）。
 */
export async function loadPreviousSuggestion(
  db: Queryable,
  xAccountId: string,
): Promise<PreviousSuggestion | null> {
  const { rows } = await db.query<{
    id: string;
    created_at: string;
    content: string;
    advice: unknown;
  }>(
    `select id, created_at::text as created_at, content, evidence->'advice' as advice
       from improvement_suggestions
      where x_account_id = $1 and evidence->>'format' = '2'
      order by created_at desc
      limit 1`,
    [xAccountId],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, createdAt: row.created_at, summary: row.content, advice: row.advice };
}

/**
 * `<previous>` に入れる形。無ければ "none"（プロンプト側の約束）。
 * 「前回以降の新規投稿数」は**コードで数えて渡す**——LLMに日付比較をさせると、新規投稿が
 * 無いのに「大量に追加された」と誤認する（2026-08-15、実アカウントで2回連続で観測）。
 * posted_at_jst と created_at_jst は同じ `YYYY-MM-DD HH:mm` 形式なので辞書順比較でよい。
 */
/**
 * 前回レポートから**アカウント.md改訂案の全文を落とす**（T-M8-335・運営者の指示 2026-08-27）。
 *
 * 全文は最大5,000字あり、毎回そのまま送り返していた。だが**いまのアカウント.mdは
 * `<account_md>` で別に渡している**ので、前回の「提案」の本文は要らない——
 * 利用者が採用したなら `<account_md>` に入っており、採用しなかったなら
 * もう一度同じ文章を見せる意味がない。何を提案したか（reason）だけ残す。
 *
 * **投稿作成プロンプトの全文は残す**——PT-SUGGESTが「前回のプロンプトを土台に磨く
 * （ゼロから書き直さない）」と指示しており、そこは前回の本文が要る。
 */
function withoutAccountMdBody(advice: unknown): unknown {
  if (typeof advice !== "object" || advice === null) return advice;
  const record = advice as Record<string, unknown>;
  const accountMd = record.account_md;
  if (typeof accountMd !== "object" || accountMd === null) return advice;
  const rest = Object.fromEntries(
    Object.entries(accountMd as Record<string, unknown>).filter(([key]) => key !== "content"),
  );
  return { ...record, account_md: { ...rest, content_omitted: true } };
}

function renderPreviousBlock(previous: PreviousSuggestion | null, input: SuggestionInput): string {
  if (!previous) return "none";
  const createdAtJst = toJstLabel(previous.createdAt);
  const newPosts = createdAtJst
    ? input.posts.filter((p) => p.posted_at_jst !== null && p.posted_at_jst > createdAtJst).length
    : null;
  return JSON.stringify({
    created_at_jst: createdAtJst,
    new_posts_since_previous: newPosts,
    summary: previous.summary,
    advice: withoutAccountMdBody(previous.advice),
  });
}

function renderPrompt(
  input: SuggestionInput,
  previous: PreviousSuggestion | null,
  accountMd: string | null,
  patternNames: readonly string[],
): string {
  return PT_SUGGEST.replaceAll("{{themes}}", themeChoices())
    .replaceAll("{{patterns}}", patternChoices(patternNames))
    .replaceAll("{{previous}}", renderPreviousBlock(previous, input))
    .replaceAll("{{account_md}}", accountMd ?? "none")
    .replaceAll("{{posts}}", JSON.stringify(input.posts));
}

async function persistFailure(
  db: Queryable,
  params: {
    userId: string;
    xAccountId: string;
    jobId: string;
    code: string;
    message: string;
    stage: "research" | "writing";
    usage: GenerationUsage;
    /** AIが何を返して落ちたか（F5）。X取得失敗時は null。 */
    providerRawError: string | null;
  },
): Promise<void> {
  await persistJobFailure(db, {
    jobId: params.jobId,
    userId: params.userId,
    xAccountId: params.xAccountId,
    keyPrefix: `sug:${params.jobId}`,
    error: {
      code: params.code,
      message: params.message,
      stage: params.stage,
      providerRawError: params.providerRawError,
    },
    usage: params.usage,
    notifyKind: "suggestion",
  });
}

export async function executeSuggestion(deps: SuggestionDeps): Promise<SuggestionResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;
  const recordStage = deps.recordStage ?? defaultRecordStage(jobId);

  const job = await loadJob(db, jobId);
  if (!job) throw new SuggestionTerminalError("not_found", "job not found");

  await recordStage("research");
  let input: SuggestionInput;
  try {
    input = await deps.fetchPosts({
      xAccountId: job.x_account_id,
      xUserId: job.x_user_id,
      userId: job.user_id,
    });
  } catch (error) {
    // X取得の失敗は「静かに0件」にしない（原則1）。理由を保存して通知する。
    await persistFailure(db, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      code: "x_fetch_failed",
      message: "Xから投稿を取得できませんでした。時間をおいてもう一度お試しください。",
      stage: "research",
      usage: { calls: [], estimated_cost_usd_total: 0 },
      providerRawError: null,
    });
    throw new SuggestionTerminalError("x_fetch_failed", String(error));
  }

  // 分析対象の投稿が1件も無ければ（Xに投稿が無い・保存も空）、LLMを呼ばずレポート0件で正常終了。
  if (input.posts.length === 0) {
    return { status: "no_suggestions", count: 0 };
  }

  try {
    await recordStage("writing");
    const deadline = (deps.makeDeadline ?? createDeadline)();
    const { textGen, provider: textProviderId, model } = await deps.resolveProvider({
      plan: job.plan,
      userId: job.user_id,
      deadline,
    });
    const allowedIds = new Set(input.posts.map((p) => p.id));
      // 推奨できる型はこのアカウントのパターン（引用URL必須は除く・T-M8-129 U5）。
      const patternNames = suggestablePatternNames(await listPatterns(db, job.x_account_id));
    // 前回のレポートを参照する（T-M8-98）。読めなくても分析自体は止めない。
    const previous = await loadPreviousSuggestion(db, job.x_account_id);
    // アカウント.mdが未作成（version 0）なら編集提案の対象外（貼り先が無い）。
    const accountMd = job.base_md_version >= 1 ? job.base_md : null;
    const result = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request: {
        system: [renderPrompt(input, previous, accountMd, patternNames)],
        user: "上記の投稿一覧を分析し、指定のJSONで出力してください。",
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: makeSuggestionSchema(allowedIds, patternNames),
      model,
      operation: "text_generation",
      now,
    });

    const output = result.parsed;
    // 1件の提案として保存する（content=summary、evidence.format=2 で旧形式と区別・§4.11）。
    await deps.runInTx(async (tx) => {
      await tx.query(
        `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
         values ($1, $2, $3, $4::jsonb)`,
        [
          job.x_account_id,
          jobId,
          output.summary,
          JSON.stringify({
            format: 2,
            good_posts: output.good_posts,
            advice: { ...output.advice, account_md: output.advice.account_md ?? null },
            // 分析対象＝保存済みの全投稿（新しい順に上限件数）。件数を根拠として残す（T-M8-94）。
            post_count: input.posts.length,
            analyze_limit: SUGGEST_ANALYZE_MAX,
            // 参照した前回レポート（無ければnull）。提案の連続性を後から辿れるように残す（T-M8-98）。
            previous_id: previous?.id ?? null,
          }),
        ],
      );
      await tx.query(`update generation_jobs set usage = $2::jsonb where id = $1`, [
        jobId,
        JSON.stringify(result.usage),
      ]);
    });
    // 提案生成の provider call を原価台帳へ冪等記録する（poolで確定・要件02 §3.17）。
    await recordProviderCalls(db, result.usage.calls, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      keyPrefix: `sug:${jobId}`,
    });
    return { status: "saved", count: 1 };
  } catch (error) {
    const usage: GenerationUsage =
      usageFromError(error) ?? { calls: [], estimated_cost_usd_total: 0 };
    const code = error instanceof SuggestionTerminalError ? error.code : "suggestion_failed";
    await persistFailure(db, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      code,
      message: "投稿分析に失敗しました。",
      stage: "writing",
      usage,
      // refine 失敗（`<posts>` に無いIDを返した等）の中身は運営者が最も知りたい情報（F5）。
      providerRawError: formatFailureRawError(error, providerRawOutputOf(error)),
    });
    // 生成枠の返還は runJob の failJob が失敗確定時に行う（要件03 §7.3）。
    throw error instanceof SuggestionTerminalError
      ? error
      : new SuggestionTerminalError("suggestion_failed", "suggestion failed");
  }
}
