/**
 * 運営キー系プラン（premium / expert）の利用枠 reserve の**単一の正本**（R28 / T-M8-168）。
 * ファイル名は歴史的経緯のまま（docs・importの参照を壊さないため）。
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
import { concealsUsageLimits, usageLimitsForPlan } from "../plans";

import { AppError } from "../observability/errors";

import { reserveUsage, settleUsage, type UsageReserveType } from "./generation-reserve";

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

/**
 * 上限はAIクレジット1本（T-M8-109。文章・画像とも同じ月次クレジットを共有する）。
 * プランごとに枠が違う（premium=1,000 / expert=5,000・T-M8-168）ため、上限は plan から引く。
 */
export function reserveLimitFor(plan: string): number | undefined {
  return usageLimitsForPlan(plan)?.aiCredits;
}

/**
 * 利用枠を持つプラン（premium / expert）のときだけクレジットを押さえる。
 * BYOK（standard）は消費しないので何もしない。
 *
 * **消費量はモデル選択で変わる**（T-M8-108）: 基準モデル=1クレジット、上位モデルは
 * コスト比の倍数（model-catalog.ts）。倍数消費により、どのモデルを選んでも
 * 「クレジット総量 × 基準モデル単価」が運営原価の上限のまま動かない。
 *
 * **例外は握らない**。上限到達（`usage_limit_exceeded`）を失敗確定へ回すか、
 * 画像なしで確定するかは job ごとに違うため、判断は呼び出し側に残す。
 */
/**
 * 成功確定時の実費記録（T-M8-109→T-M8-324）。usage の推定原価（USD）をクレジットへ換算して書く。
 * **予約は廃止した**ので、ここが唯一の消費の書き込み。BYOK（利用枠なし）は no-op。
 */
export async function settleIfPremium(
  runInTx: RunInTx,
  params: {
    plan: string;
    jobId: string;
    type: UsageReserveType;
    estimatedCostUsdTotal: number;
    /** 実費の書き込み先（T-M8-324で予約を廃止したため、精算時にも利用者が要る）。 */
    userId: string;
    xAccountId?: string | null;
  },
): Promise<void> {
  if (!usageLimitsForPlan(params.plan)) return;
  const { creditsFromUsd } = await import("./ai-credits");
  await runInTx((tx) =>
    settleUsage(tx, {
      jobId: params.jobId,
      type: params.type,
      actualCredits: creditsFromUsd(params.estimatedCostUsdTotal),
      userId: params.userId,
      xAccountId: params.xAccountId ?? null,
    }),
  );
}

/**
 * **開始してよいかを確かめる**（T-M8-324で予約を廃止。関数名は参照を壊さないため据え置き）。
 *
 * 利用枠を持つプラン（premium / expert）のときだけ、**残量が尽きていないか**を見る。
 * BYOK（standard）は消費しないので何もしない。
 *
 * 以前はここでモデル別の見積もりを押さえていたが、**書き込むのは実費が確定したときだけ**に
 * 変えたので、見積もりは画面表示（AIモデル設定の「約N クレジット」）専用になった。
 *
 * **例外は握らない**。上限到達をどう扱うかは job ごとに違うため、判断は呼び出し側に残す。
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
  const limits = usageLimitsForPlan(params.plan);
  if (!limits) return;
  await runInTx(async (tx) => {
    try {
      await reserveUsage(tx, {
        userId: params.userId,
        xAccountId: params.xAccountId,
        jobId: params.jobId,
        type: params.type,
        limit: limits.aiCredits,
      });
    } catch (error) {
      /*
        利用枠を画面に出さないプラン（エキスパート・T-M8-168）は、上限到達を
        「一時停止」として伝える。**details の数値（残量・上限）も落とす**——
        details はServer Actionの応答へそのまま載るため、残すと内部ガード値が漏れる。
      */
      if (
        error instanceof AppError &&
        error.code === "usage_limit_exceeded" &&
        concealsUsageLimits(params.plan)
      ) {
        throw new AppError("usage_paused", { cause: error });
      }
      throw error;
    }
  });
}
