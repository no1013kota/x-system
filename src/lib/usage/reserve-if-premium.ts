/**
 * premium の利用枠 reserve の**単一の正本**（R28）。
 *
 * 「premium なら開始時に枠を1つ押さえる」処理が5箇所（本文生成・画像生成・学習分析・
 * 改善提案・削除merge）に同じ形で書かれ、**枠の種別（generation / image）と月次上限の
 * 対応も各ファイルが持っていた**。
 *
 * 上限の引き先を取り違えると、画像枠に文章の上限が適用されるといった間違いが起きる。
 * これは「請求はされているのに生成が止まる」形で利用者に出るうえ、テストは
 * 種別ごとに別ファイルにあるため気付きにくい。対応表をここだけに置く。
 *
 * `runInTx` を引数で受け取り DB・env を自分では触らない（`server-only` を付けない純粋層）。
 * 呼び出し側には server-only のもの（`md-merge-server.ts`）もあるため。
 */

import type { Queryable } from "../db/queryable";
import { PLANS } from "../plans";

import { reserveUsage, type UsageReserveType } from "./generation-reserve";

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

/** 枠の種別 → premium の月次上限（未設定＝上限なし）。 */
export const RESERVE_LIMIT_BY_TYPE: Record<UsageReserveType, number | undefined> = {
  generation: PLANS.premium.usageLimits?.generations,
  image: PLANS.premium.usageLimits?.images,
};

/**
 * premium のときだけ枠を1つ押さえる。BYOK（standard / md）は枠を消費しないので何もしない。
 *
 * **例外は握らない**。上限到達（`usage_limit_exceeded`）を失敗確定へ回すか、
 * 画像なしで確定するかは job ごとに違うため、判断は呼び出し側に残す。
 */
export async function reserveIfPremium(
  runInTx: RunInTx,
  params: {
    plan: string;
    userId: string;
    xAccountId: string;
    jobId: string;
    type: UsageReserveType;
  },
): Promise<void> {
  if (params.plan !== "premium") return;
  await runInTx((tx) =>
    reserveUsage(tx, {
      userId: params.userId,
      xAccountId: params.xAccountId,
      jobId: params.jobId,
      type: params.type,
      limit: RESERVE_LIMIT_BY_TYPE[params.type],
    }),
  );
}
