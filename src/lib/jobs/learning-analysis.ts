import { z, type ZodType } from "zod";

import { InvalidProviderOutputError, runTextGeneration } from "../ai/pipeline";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { PT_L1, PT_L2, PT_L3 } from "../prompts/gen-prompts";
import { reserveUsage, refundUsage } from "../usage/generation-reserve";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { MAX_ATTEMPTS, backoffMs } from "./retry";
import { heartbeat } from "./stale";

/**
 * learning_analysis worker（LRN-1〜3, プロンプト設計書 §6.11〜6.13/§4.2/§7, 要件04 §12, 要件03 §7.1/§7.3,
 * T-M5-03）。ソース種別ごとに取得済み投稿データを素材（<posts>/<post>/<metrics>）として PT-L1〜L3 で分析し、
 * zod検証（修復call 1回は runTextGeneration が担う）した analysis_summary を保存して source を analyzed に
 * する（MD-MERGE最終確定は T-M5-04 で置換）。premium は開始時に生成枠を +1 reserve し、最終失敗時に
 * refund する（冪等key job:{id}:generation:refund）。BYOKは枠を消費しない。base_md は読まない。
 * DB(pool)・runInTx・provider解決・X読取は注入する。
 */

export class LearningAnalysisTerminalError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message = "learning analysis failed",
  ) {
    super(message);
    this.name = "LearningAnalysisTerminalError";
  }
}

const l1Schema = z.object({
  style: z.string().min(1),
  structure: z.string().min(1),
  topics: z.string().min(1),
  takeaway: z.string().min(1),
});
const l2Schema = z.object({
  why: z.string().min(1),
  pattern: z.string().min(1),
  caution: z.string().min(1),
});
const l3Schema = z.object({
  vocabulary: z.string().min(1),
  tone: z.string().min(1),
  perspective: z.string().min(1),
  signature: z.string().min(1),
  examples: z.string().min(1),
});

type SourceType = "ref_account" | "ref_post" | "own_posts";

const PROMPT_BY_TYPE: Record<SourceType, string> = {
  ref_account: PT_L1,
  ref_post: PT_L2,
  own_posts: PT_L3,
};
const SCHEMA_BY_TYPE: Record<SourceType, ZodType<Record<string, unknown>>> = {
  ref_account: l1Schema,
  ref_post: l2Schema,
  own_posts: l3Schema,
};

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface LearningAnalysisDeps {
  db: Queryable;
  jobId: string;
  runInTx: RunInTx;
  resolveProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  /** ref_account: handle の直近ポスト本文（最大20件）。 */
  fetchReferenceAccountPosts: (input: { handle: string }) => Promise<string[]>;
  /** ref_post: 対象1件の本文＋public metrics。 */
  fetchReferencePost: (input: {
    tweetId: string;
  }) => Promise<{ text: string; metrics: Record<string, number> | null } | null>;
  /** own_posts: 自己直近ポスト本文（最大100件）。 */
  fetchOwnPosts: () => Promise<string[]>;
  /**
   * 分析成功後の同一job内 MD-MERGE（T-M5-04）。注入時は merge が source を analyzed 確定する。
   * 未注入時は本関数が analyzed 化する（merge非依存の単体経路）。
   */
  mergeAfterAnalysis?: (sourceId: string) => Promise<void>;
  now?: () => number;
  makeDeadline?: () => Deadline;
  recordStage?: (stage: string) => Promise<void>;
}

export interface LearningAnalysisResult {
  status: "analyzed" | "already_done";
  sourceId: string;
}

interface JobRow {
  learning_source_id: string | null;
  x_account_id: string;
  user_id: string;
  plan: string;
}
interface SourceRow {
  type: SourceType;
  url: string | null;
  status: string;
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.learning_source_id, gj.x_account_id, xa.user_id, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

async function loadSource(db: Queryable, sourceId: string): Promise<SourceRow | null> {
  const { rows } = await db.query<SourceRow>(
    `select type::text as type, url, status::text as status from learning_sources where id = $1`,
    [sourceId],
  );
  return rows[0] ?? null;
}

function parseHandle(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})$/);
  return m ? m[1] : null;
}
function parseTweetId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/status\/(\d+)$/);
  return m ? m[1] : null;
}

async function buildUserInput(deps: LearningAnalysisDeps, source: SourceRow): Promise<string> {
  if (source.type === "ref_account") {
    const handle = parseHandle(source.url);
    if (!handle) throw new LearningAnalysisTerminalError("invalid_source", "bad ref_account url");
    const posts = await deps.fetchReferenceAccountPosts({ handle });
    return `<posts>\n${JSON.stringify(posts.slice(0, 20))}\n</posts>`;
  }
  if (source.type === "ref_post") {
    const tweetId = parseTweetId(source.url);
    if (!tweetId) throw new LearningAnalysisTerminalError("invalid_source", "bad ref_post url");
    const post = await deps.fetchReferencePost({ tweetId });
    if (!post) throw new LearningAnalysisTerminalError("source_unavailable", "ref_post not found");
    return `<post>\n${post.text}\n</post>\n<metrics>\n${JSON.stringify(post.metrics ?? {})}\n</metrics>`;
  }
  const posts = await deps.fetchOwnPosts();
  return `<posts>\n${JSON.stringify(posts.slice(0, 100))}\n</posts>`;
}

/** 失敗確定: source=failed・error通知（dedupe job:{id}:failed）・usage/error保存（pool）。 */
async function persistFailure(
  db: Queryable,
  params: { userId: string; jobId: string; sourceId: string; code: string; usage: GenerationUsage },
): Promise<void> {
  await db.query(
    `update learning_sources set status = 'failed', updated_at = now() where id = $1`,
    [params.sourceId],
  );
  await db.query(
    `update generation_jobs set error = $2::jsonb, usage = $3::jsonb where id = $1`,
    [
      params.jobId,
      JSON.stringify({ code: params.code, message: "学習ソースの分析に失敗しました。", retryable: false, stage: "writing" }),
      JSON.stringify(params.usage),
    ],
  );
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'error', $2, '学習ソースの分析に失敗しました',
            '時間をおいて再度お試しください。対象アカウント・投稿が非公開/削除されていないかもご確認ください。',
            '/app/settings?tab=learning', jsonb_build_object('job_id', $3::text),
            coalesce((p.notification_config->'error'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'error'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, `job:${params.jobId}:failed`, params.jobId],
  );
}

export async function executeLearningAnalysis(
  deps: LearningAnalysisDeps,
): Promise<LearningAnalysisResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;
  const recordStage =
    deps.recordStage ?? (async (stage: string) => void (await heartbeat(jobId, stage)));

  const job = await loadJob(db, jobId);
  if (!job) throw new LearningAnalysisTerminalError("not_found", "job not found");
  if (!job.learning_source_id) throw new LearningAnalysisTerminalError("not_found", "job has no source");
  const sourceId = job.learning_source_id;

  const source = await loadSource(db, sourceId);
  if (!source) throw new LearningAnalysisTerminalError("not_found", "source not found");
  // 冪等: 既に分析済みなら作り直さない（worker再実行安全）。
  if (source.status === "analyzed") return { status: "already_done", sourceId };

  const isPremium = job.plan === "premium";
  // premium は開始時に生成枠 +1 reserve（同一tx・要件03 §7.1/§7.4）。BYOKは消費しない。
  if (isPremium) {
    await deps.runInTx((tx) =>
      reserveUsage(tx, { userId: job.user_id, xAccountId: job.x_account_id, jobId, type: "generation" }),
    );
  }

  const failCtx = { userId: job.user_id, jobId, sourceId };
  try {
    await recordStage("research");
    const user = await buildUserInput(deps, source);

    await recordStage("writing");
    const deadline = (deps.makeDeadline ?? createDeadline)();
    const { textGen, model } = await deps.resolveProvider({
      plan: job.plan,
      userId: job.user_id,
      deadline,
    });
    const result = await runTextGeneration({
      provider: textGen,
      request: { system: [PROMPT_BY_TYPE[source.type]], user, timeoutMs: deadline.callTimeoutMs() },
      schema: SCHEMA_BY_TYPE[source.type],
      model,
      operation: "text_generation",
      now,
    });

    // 分析結果を保存（analyzed 確定は MD-MERGE tx が担う。T-M5-04）。
    await db.query(
      `update learning_sources set analysis_summary = $2::jsonb, updated_at = now() where id = $1`,
      [sourceId, JSON.stringify({ type: source.type, ...result.parsed })],
    );
    await db.query(`update generation_jobs set usage = $2::jsonb where id = $1`, [
      jobId,
      JSON.stringify(result.usage),
    ]);

    // 同一job内 MD-MERGE（注入時）。未注入経路はここで analyzed 確定する。
    if (deps.mergeAfterAnalysis) {
      await deps.mergeAfterAnalysis(sourceId);
    } else {
      await db.query(
        `update learning_sources set status = 'analyzed', updated_at = now() where id = $1`,
        [sourceId],
      );
    }
    return { status: "analyzed", sourceId };
  } catch (error) {
    // retryable（X読取429/5xx・MD-MERGE version競合枯渇等）は attempt<3 なら job を queued へ自己終端して
    // scheduler_tick に再dispatchさせる（runJob の failed 化を空振りさせる）。reserve は保持（冪等）。
    // attempt>=3 は terminal 扱い（refund＋failed＋通知）へ落として枠を漏らさない。
    if ((error as { retryable?: boolean } | null)?.retryable === true) {
      const attempt =
        (await db.query<{ attempt: number }>(`select attempt from generation_jobs where id = $1`, [jobId]))
          .rows[0]?.attempt ?? MAX_ATTEMPTS;
      if (attempt < MAX_ATTEMPTS) {
        await deps.runInTx((tx) =>
          tx.query(
            `update generation_jobs
                set status = 'queued', locked_at = null, locked_by = null, progress_stage = null,
                    available_at = now() + ($2 || ' milliseconds')::interval
              where id = $1 and status = 'running'`,
            [jobId, backoffMs(attempt)],
          ),
        );
        throw error;
      }
      // 上限到達 → terminal（下の失敗確定＋返還へフォールスルー）
    }
    const usage: GenerationUsage =
      error instanceof InvalidProviderOutputError
        ? error.usage
        : { calls: [], estimated_cost_usd_total: 0 };
    const code =
      error instanceof LearningAnalysisTerminalError ? error.code : "analysis_failed";
    await persistFailure(db, { ...failCtx, code, usage });
    // premium は最終失敗で生成枠を返還（冪等）。
    if (isPremium) {
      await deps.runInTx((tx) => refundUsage(tx, jobId, "generation"));
    }
    throw error instanceof LearningAnalysisTerminalError
      ? error
      : new LearningAnalysisTerminalError("analysis_failed", "learning analysis failed");
  }
}
