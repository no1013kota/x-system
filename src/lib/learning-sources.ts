import { z } from "zod";

import {
  assertPrereqsFromInput,
  type ExecutionPrereqInput,
} from "./execution-prereqs";
import { toIso } from "./format";
import { assertActiveAccount, assertJobBudget, MAX_ACTIVE_JOBS } from "./jobs/job-guards";
import { requestKey } from "./jobs/keys";
import { AppError } from "./observability/errors";

// 既存の import 名を保つための re-export（正本は `jobs/job-guards.ts`・R20）。
// `ops/tenant-isolation.db.test.ts` がこのパスから import している。
export { MAX_ACTIVE_JOBS };
import type { Queryable } from "./x/token-refresh";

/**
 * 学習ソースCRUDの中核（L-1〜3, 要件05 §8/§12/§1, 要件02 §3.6, SC-10, T-M5-02）。DB・前提収集を注入し
 * 純粋に保つ。追加/削除は所有権＋active一致・前提再検証・request_key冪等・queued/running 5件上限を満たす。
 * - `addLearningSource`: ref_account 3件 / ref_post 10件まで。removed済み同一URLの再追加は既存rowを復元。
 *   `learning_analysis` job を冪等作成する（本体は T-M5-03）。
 * - `removeLearningSource`: analyzed→removing化＋`md_merge` job作成、pending/failed→AIを呼ばず直接removed。
 *   同一アカウントに queued/running の learning_analysis/md_merge または removing source があれば job_conflict。
 */

export const LEARNING_LIMITS = { ref_account: 3, ref_post: 10 } as const;

const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "www.x.com",
  "www.twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
]);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** ref_account=Xアカウント URL、ref_post=/{handle}/status/{id}。canonical化して返す（不正は null）。 */
export function normalizeLearningUrl(
  type: "ref_account" | "ref_post",
  raw: string,
): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  // eslint-disable-next-line no-restricted-syntax -- URLとして解釈できないことが判定結果（null）
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!X_HOSTS.has(u.hostname.toLowerCase())) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (type === "ref_account") {
    if (segs.length !== 1 || !HANDLE_RE.test(segs[0])) return null;
    return `https://x.com/${segs[0].toLowerCase()}`;
  }
  if (segs.length !== 3 || segs[1] !== "status") return null;
  if (!HANDLE_RE.test(segs[0]) || !/^\d+$/.test(segs[2])) return null;
  return `https://x.com/${segs[0].toLowerCase()}/status/${segs[2]}`;
}

export const addLearningSourceSchema = z.object({
  request_key: z.string().min(1).max(200),
  x_account_id: z.string().uuid(),
  type: z.enum(["ref_account", "ref_post"]),
  url: z.string().url(),
});
export type AddLearningSourceInput = z.infer<typeof addLearningSourceSchema>;

export const removeLearningSourceSchema = z.object({
  request_key: z.string().min(1).max(200),
  x_account_id: z.string().uuid(),
  source_id: z.string().uuid(),
});
export type RemoveLearningSourceInput = z.infer<typeof removeLearningSourceSchema>;

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface LearningSourceDeps {
  runInTx: RunInTx;
  gatherPrereqInputs: (
    userId: string,
    opts: { imageRequested: boolean },
  ) => Promise<ExecutionPrereqInput | null>;
}

export interface LearningSourceView {
  id: string;
  type: string;
  url: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddLearningSourceResult {
  sourceId: string;
  jobId: string;
  deduped: boolean;
}

export interface RemoveLearningSourceResult {
  /** analyzed→removing で md_merge job を作った場合の job id。未適用sourceの直接removedは null。 */
  jobId: string | null;
}

async function assertPrereqs(deps: LearningSourceDeps, userId: string): Promise<void> {
  assertPrereqsFromInput(await deps.gatherPrereqInputs(userId, { imageRequested: false }));
}

/** 学習系の直列化: removing source があれば busy。remove時は queued/running の learning job も busy とする。 */
async function assertNotBusy(
  tx: Queryable,
  xAccountId: string,
  opts: { includeQueuedJobs: boolean },
): Promise<void> {
  const removing = await tx.query(
    `select 1 from learning_sources where x_account_id = $1 and status = 'removing' limit 1`,
    [xAccountId],
  );
  if ((removing.rowCount ?? 0) > 0) {
    throw new AppError("job_conflict", { details: { reason: "learning_busy" } });
  }
  if (opts.includeQueuedJobs) {
    const jobs = await tx.query(
      `select 1 from generation_jobs
        where x_account_id = $1 and kind in ('learning_analysis', 'md_merge')
          and status in ('queued', 'running') limit 1`,
      [xAccountId],
    );
    if ((jobs.rowCount ?? 0) > 0) {
      throw new AppError("job_conflict", { details: { reason: "learning_busy" } });
    }
  }
}

/** learning_analysis / md_merge job を request_key 冪等で作る。 */
async function createLearningJob(
  tx: Queryable,
  params: { key: string; xAccountId: string; kind: "learning_analysis" | "md_merge"; sourceId: string },
): Promise<{ jobId: string; deduped: boolean }> {
  const existing = (
    await tx.query<{ id: string }>(`select id from generation_jobs where request_key = $1`, [params.key])
  ).rows[0];
  if (existing) return { jobId: existing.id, deduped: true };
  const inserted = (
    await tx.query<{ id: string }>(
      `insert into generation_jobs
         (x_account_id, kind, trigger, learning_source_id, input, request_key, status)
       values ($1, $2::job_kind, 'manual', $3, '{}'::jsonb, $4, 'queued')
       on conflict (request_key) do nothing
       returning id`,
      [params.xAccountId, params.kind, params.sourceId, params.key],
    )
  ).rows[0];
  if (inserted) return { jobId: inserted.id, deduped: false };
  const raced = (
    await tx.query<{ id: string }>(`select id from generation_jobs where request_key = $1`, [params.key])
  ).rows[0];
  if (!raced) throw new AppError("job_conflict", { details: { reason: "learning_job_race" } });
  return { jobId: raced.id, deduped: true };
}

/**
 * 対象Xアカウントに `removing`（削除merge進行中）の学習ソースがあるか。削除mergeへ別の生成/変更を
 * 混ぜないための生成停止ガード（要件04 §12・要件05 §8）。生成job作成・slot enqueue の前提検証で使う。
 */
export async function hasRemovingLearningSource(
  db: Queryable,
  xAccountId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `select 1 from learning_sources where x_account_id = $1 and status = 'removing' limit 1`,
    [xAccountId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listLearningSources(
  db: Queryable,
  userId: string,
  xAccountId: string,
): Promise<LearningSourceView[]> {
  const { rows } = await db.query<{
    id: string;
    type: string;
    url: string | null;
    status: string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `select ls.id, ls.type::text as type, ls.url, ls.status::text as status, ls.created_at, ls.updated_at
       from learning_sources ls
       join x_accounts xa on xa.id = ls.x_account_id
      where ls.x_account_id = $1 and xa.user_id = $2 and ls.status <> 'removed'
      order by ls.created_at asc`,
    [xAccountId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    url: r.url,
    status: r.status,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  }));
}

export async function addLearningSource(
  userId: string,
  input: AddLearningSourceInput,
  deps: LearningSourceDeps,
): Promise<AddLearningSourceResult> {
  const url = normalizeLearningUrl(input.type, input.url);
  if (!url) throw new AppError("validation_error", { details: { field: "url" } });
  const key = requestKey(userId, input.request_key);

  return deps.runInTx(async (tx) => {
    // request_key 再送は状態ガードより前に既存jobを返す（冪等・retry安全）。
    const priorJob = (
      await tx.query<{ id: string; learning_source_id: string | null }>(
        `select id, learning_source_id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (priorJob?.learning_source_id) {
      return { sourceId: priorJob.learning_source_id, jobId: priorJob.id, deduped: true };
    }

    await assertActiveAccount(tx, userId, input.x_account_id);
    await assertNotBusy(tx, input.x_account_id, { includeQueuedJobs: false });
    await assertPrereqs(deps, userId);

    // removed済み同一URLの再追加は既存rowを復元する（要件05 §8）。
    const existing = (
      await tx.query<{ id: string; status: string }>(
        `select id, status::text as status from learning_sources
          where x_account_id = $1 and type = $2::learning_source_type and url = $3`,
        [input.x_account_id, input.type, url],
      )
    ).rows[0];

    let sourceId: string;
    if (existing) {
      if (existing.status !== "removed") {
        throw new AppError("job_conflict", { details: { reason: "already_exists" } });
      }
      await tx.query(
        `update learning_sources
            set status = 'pending', removed_at = null, analysis_summary = null, updated_at = now()
          where id = $1`,
        [existing.id],
      );
      sourceId = existing.id;
    } else {
      const active = (
        await tx.query<{ n: number }>(
          `select count(*)::int as n from learning_sources
            where x_account_id = $1 and type = $2::learning_source_type and status <> 'removed'`,
          [input.x_account_id, input.type],
        )
      ).rows[0].n;
      if (active >= LEARNING_LIMITS[input.type]) {
        throw new AppError("validation_error", { details: { reason: "limit_reached", type: input.type } });
      }
      await assertJobBudget(tx, userId);
      sourceId = (
        await tx.query<{ id: string }>(
          `insert into learning_sources (x_account_id, type, url, status)
           values ($1, $2::learning_source_type, $3, 'pending') returning id`,
          [input.x_account_id, input.type, url],
        )
      ).rows[0].id;
    }

    const { jobId, deduped } = await createLearningJob(tx, {
      key,
      xAccountId: input.x_account_id,
      kind: "learning_analysis",
      sourceId,
    });
    return { sourceId, jobId, deduped };
  });
}

export async function removeLearningSource(
  userId: string,
  input: RemoveLearningSourceInput,
  deps: LearningSourceDeps,
): Promise<RemoveLearningSourceResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    // request_key 再送は状態ガードより前に既存 md_merge job を返す（冪等・retry安全）。
    const priorJob = (
      await tx.query<{ id: string }>(`select id from generation_jobs where request_key = $1`, [key])
    ).rows[0];
    if (priorJob) return { jobId: priorJob.id };

    /*
      **削除mergeにも契約の前提を課す**（T-M8-267）。追加側（`addLearningSource`）は
      `assertPrereqs` を通すのに削除側だけ抜けており、解約後に MD-MERGE のAI実行が起票できた。
      データ整理の顔をしているが、実費が出るのは生成と同じ。
    */
    assertPrereqsFromInput(await deps.gatherPrereqInputs(userId, { imageRequested: false }));

    await assertActiveAccount(tx, userId, input.x_account_id);

    const source = (
      await tx.query<{ status: string }>(
        `select status::text as status from learning_sources
          where id = $1 and x_account_id = $2`,
        [input.source_id, input.x_account_id],
      )
    ).rows[0];
    if (!source) throw new AppError("not_found");

    // 削除mergeへ別の変更を混ぜない: removing source or queued/running learning job があれば拒否。
    await assertNotBusy(tx, input.x_account_id, { includeQueuedJobs: true });

    if (source.status === "analyzed") {
      await tx.query(`update learning_sources set status = 'removing', updated_at = now() where id = $1`, [
        input.source_id,
      ]);
      const { jobId } = await createLearningJob(tx, {
        key,
        xAccountId: input.x_account_id,
        kind: "md_merge",
        sourceId: input.source_id,
      });
      return { jobId };
    }
    if (source.status === "pending" || source.status === "failed") {
      // 未適用: AIを呼ばず直接 removed（要件04 §12・要件05 §8）。
      await tx.query(
        `update learning_sources set status = 'removed', removed_at = now(), updated_at = now() where id = $1`,
        [input.source_id],
      );
      return { jobId: null };
    }
    // removed / removing は再削除不可。
    throw new AppError("job_conflict", { details: { reason: `not_removable:${source.status}` } });
  });
}

