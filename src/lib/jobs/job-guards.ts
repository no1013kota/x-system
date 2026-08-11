/**
 * job作成時の**共通ガード**（R20）。
 *
 * 「表示中アカウントと実行対象が一致しているか」「同時実行が上限に達していないか」は、
 * 生成job・提案job・学習ソースの3経路すべてが同じ条件で拒否する。以前はこの2つが
 * `generation-jobs.ts` / `suggestion-jobs.ts` / `learning-sources.ts` に**同一のSQL・
 * 同一のエラーcode・同一の `details.reason` で3重に書かれ**、`MAX_ACTIVE_JOBS = 5` も
 * それぞれのファイルが持っていた。
 *
 * 上限を 5→3 にするには3ファイルを直す必要があり、1つ忘れると「生成は3件で止まるが
 * 学習は5件通る」状態になる。どのテストにも映らないので、判断はここだけに置く。
 *
 * このモジュールは `Queryable` を引数で受け取り、DB接続・env・providerを自分では触らない
 * （`server-only` を付けない純粋層）。
 */

import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "../db/queryable";

/** 1ユーザーが同時に走らせられる job の上限（queued + running）。 */
export const MAX_ACTIVE_JOBS = 5;

/**
 * 表示中アカウントが本人所有かつ active 選択中か（要件05 §1・§4.1）。
 *
 * 別タブ・別端末でアカウントを切り替えたまま操作した場合の競合を拒否する。
 */
export async function assertActiveAccount(
  tx: Queryable,
  userId: string,
  xAccountId: string,
): Promise<void> {
  const row = (
    await tx.query<{ status: string; active_x_account_id: string | null }>(
      `select xa.status, p.active_x_account_id
         from x_accounts xa join profiles p on p.id = xa.user_id
        where xa.id = $1 and xa.user_id = $2`,
      [xAccountId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  if (row.active_x_account_id !== xAccountId) {
    throw new AppError("job_conflict", { details: { reason: "x_account_mismatch" } });
  }
}

/** 同時実行中の job が上限に達していないか。 */
export async function assertJobBudget(tx: Queryable, userId: string): Promise<void> {
  const active = (
    await tx.query<{ n: number }>(
      `select count(*)::int as n from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = $1 and gj.status in ('queued', 'running')`,
      [userId],
    )
  ).rows[0].n;
  if (active >= MAX_ACTIVE_JOBS) {
    throw new AppError("job_conflict", { details: { reason: "too_many_active_jobs" } });
  }
}
