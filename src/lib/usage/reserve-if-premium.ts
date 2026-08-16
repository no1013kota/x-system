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

import { isImageProvider } from "../ai/resolve-provider";
import type { Queryable } from "../db/queryable";
import { PLANS } from "../plans";

import { imageReserveEstimate, textReserveEstimate } from "./ai-credits";
import { reserveUsage, settleUsage, type UsageReserveType } from "./generation-reserve";

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

/** 上限はAIクレジット1本（T-M8-109。文章・画像とも同じ月次クレジットを共有する）。 */
export const RESERVE_LIMIT_BY_TYPE: Record<UsageReserveType, number | undefined> = {
  generation: PLANS.premium.usageLimits?.aiCredits,
  image: PLANS.premium.usageLimits?.aiCredits,
};

/**
 * premium のときだけクレジットを押さえる。BYOK（standard / md）は消費しないので何もしない。
 *
 * **消費量はモデル選択で変わる**（T-M8-108）: 基準モデル=1クレジット、上位モデルは
 * コスト比の倍数（model-catalog.ts）。倍数消費により、どのモデルを選んでも
 * 「クレジット総量 × 基準モデル単価」が運営原価の上限のまま動かない。
 *
 * **例外は握らない**。上限到達（`usage_limit_exceeded`）を失敗確定へ回すか、
 * 画像なしで確定するかは job ごとに違うため、判断は呼び出し側に残す。
 */
/**
 * 成功確定時の実費精算（T-M8-109）。usage の推定原価（USD）をクレジット（円・切り上げ）へ換算し、
 * reserveした見積もりとの差分を調整する。BYOK（reserveなし）は no-op。
 */
export async function settleIfPremium(
  runInTx: RunInTx,
  params: {
    plan: string;
    jobId: string;
    type: UsageReserveType;
    estimatedCostUsdTotal: number;
  },
): Promise<void> {
  if (params.plan !== "premium") return;
  const { creditsFromUsd } = await import("./ai-credits");
  await runInTx((tx) =>
    settleUsage(tx, {
      jobId: params.jobId,
      type: params.type,
      actualCredits: creditsFromUsd(params.estimatedCostUsdTotal),
    }),
  );
}

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
  await runInTx(async (tx) => {
    // 選択モデル（AIモデル設定）からクレジット消費量を決める。text providerは運営固定（anthropic）。
    const { rows } = await tx.query<{ ai_purpose_config: unknown }>(
      `select ai_purpose_config from profiles where id = $1`,
      [params.userId],
    );
    const cfg =
      rows[0]?.ai_purpose_config && typeof rows[0].ai_purpose_config === "object"
        ? (rows[0].ai_purpose_config as Record<string, unknown>)
        : {};
    const textModel = typeof cfg.text_model === "string" ? cfg.text_model : null;
    const imageProvider =
      typeof cfg.image === "string" && isImageProvider(cfg.image) ? cfg.image : "openai";
    const imageModel = typeof cfg.image_model === "string" ? cfg.image_model : null;
    // 見積もりクレジット（T-M8-109）。成功時に実費で精算（settleIfPremium）、失敗時は全額返還。
    const amount =
      params.type === "generation"
        ? textReserveEstimate("anthropic", textModel)
        : imageReserveEstimate(imageProvider, imageModel);
    await reserveUsage(tx, {
      userId: params.userId,
      xAccountId: params.xAccountId,
      jobId: params.jobId,
      type: params.type,
      limit: RESERVE_LIMIT_BY_TYPE[params.type],
      amount,
    });
  });
}
