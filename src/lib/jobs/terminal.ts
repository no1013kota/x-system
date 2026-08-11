import type { PoolClient } from "pg";

import {
  AppError,
  isErrorCode,
  userMessageForCode,
} from "../observability/errors";
import { refundUsage, type UsageReserveType } from "../usage/generation-reserve";
import type { JobKind } from "./handlers";
import {
  createDraftCreatedNotification,
  createFailedNotification,
  DEFAULT_FAILED_NOTICE,
  FAILED_NOTICE,
  resolveFailedNotice,
} from "./notifications";

/**
 * stale→failed 確定時の kind別終端処理（要件04 §4, 要件03 §7.3/§7.5, T-M4-08）。
 * `recoverStaleJobs` が failed 確定と**同一 transaction**（同じ `PoolClient`）で呼ぶ。
 * すべて冪等（tickを複数回実行しても二重に効かない）で、対象が無い場合は no-op:
 *
 * - 未返還 reserve の refund（生成/画像・`refundUsage`）。冪等key `job:{id}:generation:refund` /
 *   `job:{id}:image:refund` の unique と「元reserveが在る場合のみ」で二重返還を防ぐ。
 *   reserve作成は learning_analysis（T-M5-03）が生成枠で開始済み。生成/画像jobの reserve は M6。
 * - kind別の draft/source 後始末:
 *   - `post_publish`: draft を `posting`→`failed` に戻し `last_post_error` を保存（放置しない）。
 *   - `image_generation`: draft を画像なし＋警告(failed印)で確定し、draft mode は draft_created 通知、
 *     auto mode は post_publish 子job作成へ進める（本文は使えるため error 通知は出さない）。
 *   - `md_merge`: source を `removing`→`analyzed` に戻し、削除未完了を error 通知する。
 * - 上記以外（post_generation 等）は error 通知（dedupe_key `job:{id}:failed`）のみ。
 *
 * NOTE(D-5): worker の失敗経路（各 M3 handler が pool で個別に確定）との完全共通化は D-5（runJob
 * 中央finalizer）で行う。本モジュールは stale 経路の終端を自己完結で担い、worker path と同じ状態遷移・
 * 冪等key・通知dedupeを再現する。auto image failure→post_publish の mode は親 post_generation job の
 * `input.mode` から解決する（success経路の slot mode 伝播は別タスク）。
 */

/**
 * stale→failed（タイムアウト）確定時の共通 error code / message。
 * `generation_jobs.error`（stale.ts）と post_publish の draft `last_post_error`（本ファイル）で共有する。
 */
export const STALE_TIMEOUT_CODE = "stale_timeout";
export const STALE_TIMEOUT_MESSAGE =
  "処理がタイムアウトしました。しばらくしても解消しない場合は再実行してください。";

const STALE_ERROR = {
  code: STALE_TIMEOUT_CODE,
  message: STALE_TIMEOUT_MESSAGE,
};

interface JobTerminalRow {
  draft_id: string | null;
  learning_source_id: string | null;
  x_account_id: string;
  user_id: string;
  /** auto | draft。自job input優先、無ければ親jobのinputから解決（image_generation子job用）。 */
  mode: string | null;
}

async function loadJobTerminal(
  c: PoolClient,
  jobId: string,
): Promise<JobTerminalRow | null> {
  const { rows } = await c.query<JobTerminalRow>(
    `select gj.draft_id, gj.learning_source_id, gj.x_account_id, xa.user_id,
            coalesce(gj.input->>'mode', pj.input->>'mode') as mode
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       left join generation_jobs pj on pj.id = gj.parent_job_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

/** post_publish stale: draft を posting→failed へ戻し last_post_error を保存（要件04 §4）。 */
async function finalizePostPublishStale(
  c: PoolClient,
  draftId: string | null,
): Promise<void> {
  if (!draftId) return;
  await c.query(
    `update drafts
        set status = 'failed', last_post_error = $2::jsonb, updated_at = now()
      where id = $1 and status = 'posting'`,
    [draftId, JSON.stringify(STALE_ERROR)],
  );
}

/** md_merge stale: source を removing→analyzed へ戻す（削除未完了。要件04 §4/§12）。 */
async function finalizeMdMergeStale(
  c: PoolClient,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId) return;
  await c.query(
    `update learning_sources set status = 'analyzed', updated_at = now()
      where id = $1 and status = 'removing'`,
    [sourceId],
  );
}

/** auto image失敗後も投稿へ進むための post_publish 子job作成（決定的keyで冪等・二重投稿ガード）。 */
async function ensurePostPublishChild(
  c: PoolClient,
  job: JobTerminalRow,
  draftId: string,
): Promise<void> {
  const active = await c.query(
    `select 1 from generation_jobs
      where draft_id = $1 and kind = 'post_publish' and status in ('queued', 'running')
      limit 1`,
    [draftId],
  );
  if ((active.rowCount ?? 0) > 0) return;
  await c.query(
    `insert into generation_jobs
       (x_account_id, kind, trigger, draft_id, input, request_key, status)
     values ($1, 'post_publish', 'system', $2, $3::jsonb, $4, 'queued')
     on conflict (request_key) do nothing`,
    [
      job.x_account_id,
      draftId,
      JSON.stringify({ mode: "auto" }),
      `job:${draftId}:post_publish:auto`,
    ],
  );
}

/** image_generation stale: draft を画像なし＋警告で確定→draft mode通知 / auto mode post_publish（要件04 §4/§9）。 */
async function finalizeImageStale(
  c: PoolClient,
  job: JobTerminalRow,
): Promise<void> {
  const draftId = job.draft_id;
  if (!draftId) return;
  // 既に ready 画像があれば触れない（worker再実行や成功済みの取りこぼし）。無ければ failed印を残す。
  await c.query(
    `update drafts
        set images = jsonb_build_array(jsonb_build_object(
              'local_id', gen_random_uuid()::text, 'storage_path', '', 'status', 'failed')),
            updated_at = now()
      where id = $1 and not (images @> '[{"status":"ready"}]'::jsonb)`,
    [draftId],
  );
  if (job.mode === "auto") {
    await ensurePostPublishChild(c, job, draftId);
  } else {
    await createDraftCreatedNotification(c, { userId: job.user_id, draftId });
  }
}

/** 例外から原因を特定できなかったときに使う汎用コード（要件02 §4.10）。 */
/**
 * kind → 返還する利用枠の種別（要件03 §7.3）。reserve していない kind（post_publish）は無し。
 * `finalizeFailedJob`（stale経路）と worker の `failJob` で同じ対応を使う。
 */
export const RESERVE_TYPE_BY_KIND: Partial<Record<JobKind, UsageReserveType>> = {
  post_generation: "generation",
  image_generation: "image",
  learning_analysis: "generation",
  md_merge: "generation",
  suggestion: "generation",
};

export const GENERIC_JOB_ERROR_CODE = "job_failed";

/** 自前のterminal errorが持つ code の許容形（snake_case）。pgのSQLSTATEやnodeのECONNREFUSED等は弾く。 */
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

function safeCodeOf(error: unknown): string | null {
  if (error instanceof AppError) return error.code;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE_PATTERN.test(code)) return code;
  }
  return null;
}

/**
 * handler が理由を保存しないまま throw したときに `generation_jobs.error` へ入れる内容を作る
 * （要件04 §4・要件06 §10）。例外の message / stack / provider応答は**含めない**
 * （generation_jobs は所有者がRLSで参照できるため）。message は既知コードなら利用者向け文言、
 * それ以外は kind別の失敗通知と同じ定型文を使い、画面と通知で言い回しを揃える。
 */
export function fallbackJobError(
  kind: JobKind,
  error: unknown,
): { code: string; message: string } {
  const code = safeCodeOf(error) ?? GENERIC_JOB_ERROR_CODE;
  const message = isErrorCode(code)
    ? userMessageForCode(code)
    : (FAILED_NOTICE[kind]?.body ?? DEFAULT_FAILED_NOTICE.body);
  return { code, message };
}

/**
 * stale→failed 確定時の kind別終端処理のエントリポイント。`recoverStaleJobs` が failed 更新と
 * 同一 transaction で呼ぶ。job が消えていれば no-op。kind別の返還・後始末（switch）のあと、
 * `image_generation` を除き `FAILED_NOTICE` を引いてユーザー通知を出す。
 */
export async function finalizeFailedJob(
  c: PoolClient,
  jobId: string,
  kind: JobKind,
): Promise<void> {
  const job = await loadJobTerminal(c, jobId);
  if (!job) return;

  switch (kind) {
    case "post_generation":
      await refundUsage(c, jobId, "generation");
      break;
    case "image_generation":
      // 本文は使えるため error 通知は出さず、draft確定/子job作成へ進める。
      await refundUsage(c, jobId, "image");
      await finalizeImageStale(c, job);
      return;
    case "post_publish":
      await finalizePostPublishStale(c, job.draft_id);
      break;
    case "learning_analysis":
      // 生成枠を返還（premium・冪等）し、ソースを failed に戻す（stale時のworker失敗経路と同等・T-M5-03/04）。
      await refundUsage(c, jobId, "generation");
      if (job.learning_source_id) {
        await c.query(
          `update learning_sources set status = 'failed', updated_at = now()
            where id = $1 and status <> 'analyzed'`,
          [job.learning_source_id],
        );
      }
      break;
    case "md_merge":
      // 削除mergeも生成枠を1消費するため返還する（premium・冪等。T-M5-05）。
      await refundUsage(c, jobId, "generation");
      await finalizeMdMergeStale(c, job.learning_source_id);
      break;
    case "suggestion":
      // 改善提案もLLM実行時に生成枠を1消費するため返還する（premium・冪等。BYOKはreserve無しでno-op。T-M5-18）。
      await refundUsage(c, jobId, "generation");
      break;
  }

  await createFailedNotification(c, {
    userId: job.user_id,
    jobId,
    ...resolveFailedNotice(kind, job),
  });
}
