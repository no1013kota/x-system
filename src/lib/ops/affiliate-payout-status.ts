import type { Check } from "./check";

/**
 * **招待報酬の振込期限を運営者へ知らせる**（T-M8-241）。
 *
 * 振込は運営者が手作業で行う（外部Payout Provider未契約・D-33）。締めは自動でも、
 * **払うこと自体は運営者の記憶に依存していた**——期限（翌月末）を過ぎても、画面にもメールにも
 * 何も出ない。CLAUDE.md 原則3「手順を人間の記憶に依存させない」に反する。
 *
 * 判定は日数だけ。金額の正しさは `npm run affiliate:payouts -- --show` が担う。
 */

/** 期限まで何日を切ったら知らせるか。振込には銀行営業日が要るので1週間前から出す。 */
export const PAYOUT_DUE_SOON_DAYS = 7;

export interface AffiliatePayoutFacts {
  /** 未払い（`status='created'`）の件数。 */
  pending: number;
  /** 未払いの振込額（手数料を引いた net）の合計。 */
  netTotal: number;
  /** 最も近い支払期限。未払いが無ければ null。 */
  dueAt: string | null;
}

export function judgeAffiliatePayouts(
  facts: AffiliatePayoutFacts,
  now: Date = new Date(),
): Check {
  const name = "招待報酬の振込";
  if (facts.pending === 0) {
    return { name, level: "ok", detail: "未払いの振込はありません" };
  }
  const detail = `未払い ${facts.pending} 件・合計 ¥${facts.netTotal.toLocaleString("ja-JP")}`;
  const nextAction =
    "`npm run affiliate:payouts -- --show` で振込先と金額を確認し、振込後に `--paid` で記録してください";
  const dueMs = facts.dueAt ? Date.parse(facts.dueAt) : Number.NaN;
  if (Number.isNaN(dueMs)) {
    return { name, level: "warn", detail: `${detail}（支払期限が読めません）`, nextAction };
  }
  const days = Math.floor((dueMs - now.getTime()) / 86_400_000);
  if (days < 0) {
    return {
      name,
      level: "error",
      detail: `${detail}。支払期限を ${Math.abs(days)} 日過ぎています`,
      nextAction,
    };
  }
  if (days <= PAYOUT_DUE_SOON_DAYS) {
    return {
      name,
      level: "warn",
      detail: `${detail}。支払期限まであと ${days} 日です`,
      nextAction,
    };
  }
  return { name, level: "ok", detail: `${detail}（支払期限まで ${days} 日）` };
}
