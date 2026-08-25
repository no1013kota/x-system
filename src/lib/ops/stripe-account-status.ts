import "server-only";

import type { Check } from "./check";

/**
 * Stripe アカウントが**実際に決済を受け付けられる状態か**を判定する（T-M8-148）。
 *
 * 2026-08-18、本番で「7日間無料で利用」を押すと必ず失敗した。原因はコードではなく
 * **Stripe側のアカウントが本番決済を有効化されていない**こと（`Your account cannot currently
 * make live charges.`・`card_payments = inactive`）。
 *
 * この状態は**アプリからは何も見えない**。鍵は本番キー、Price は存在して金額も一致し、
 * ポータル設定も有効なので、既存の検査はすべて緑だった（`doctor` の「請求額と表示額の一致」も
 * 「プラン管理」も通る）。**押した利用者だけが行き止まりになる**ため、状態確認で毎回見る。
 * 読み取りのみで費用も副作用も無い。
 */
export interface StripeAccountSummary {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  capabilities?: { card_payments?: string | null } | null;
}

/**
 * `stripe.accounts.retrieve()` を引数なしで呼ぶと**鍵が指すアカウント自身**が返る。
 * SDKの型は `id` を必須に見せるため、ここでは省略可として受ける（実行時は省略が正しい）。
 */
export interface StripeAccountGateway {
  accounts: {
    retrieve(id?: string | null, ...rest: never[]): Promise<StripeAccountSummary>;
  };
}

export interface StripeAccountProbeDeps {
  stripe?: StripeAccountGateway | null;
  /** production では有効化されていないと契約が一切できない。それ以外は情報として出す。 */
  requireLiveCharges?: boolean;
}

export interface StripeAccountSnapshot {
  /** 鍵が無い等で問い合わせられなかった。 */
  unavailable?: boolean;
  /** 問い合わせたが失敗した（ネットワーク・権限）。 */
  probeFailed?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  /** `card_payments` の状態（`active` / `pending` / `inactive`）。 */
  cardPayments?: string | null;
  requireLiveCharges?: boolean;
}

export async function probeStripeAccount(
  deps: StripeAccountProbeDeps,
): Promise<StripeAccountSnapshot> {
  if (!deps.stripe) return { unavailable: true };
  try {
    const account = await deps.stripe.accounts.retrieve();
    return {
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      detailsSubmitted: account.details_submitted === true,
      cardPayments: account.capabilities?.card_payments ?? null,
      requireLiveCharges: deps.requireLiveCharges === true,
    };
  // eslint-disable-next-line no-restricted-syntax -- 失敗したこと自体が答え（判定へ渡して「問い合わせできません」と出す）
  } catch {
    // Sentryへ送らない: 鍵が読めない・ネットワーク不通は状態確認の結果として画面に出る。
    return { probeFailed: true, requireLiveCharges: deps.requireLiveCharges === true };
  }
}

const NAME = "決済の受付（Stripeアカウント）";

export function judgeStripeAccount(snapshot: StripeAccountSnapshot): Check {
  if (snapshot.unavailable) {
    return { name: NAME, level: "ok", detail: "決済の鍵が無いため判定していません" };
  }
  if (snapshot.probeFailed) {
    return {
      name: NAME,
      level: "warn",
      detail: "Stripeへ問い合わせできませんでした（鍵の権限かネットワークを確認してください）",
    };
  }
  if (snapshot.chargesEnabled) {
    const payouts = snapshot.payoutsEnabled
      ? "入金も有効です"
      : "**入金（payouts）は未有効**——受け取りには銀行口座の登録が必要です";
    return { name: NAME, level: "ok", detail: `決済を受け付けられます。${payouts}` };
  }

  /*
    受け付けられない。**「待てば直る」と言わない**——Stripeの画面で操作するか審査を待つかの
    どちらかで、アプリ側では何もできない（CLAUDE.md 原則1・2）。
    `details_submitted` で「まだ出していない」と「出して審査中」を言い分ける。
  */
  const reviewing = snapshot.detailsSubmitted === true;
  return {
    name: NAME,
    level: snapshot.requireLiveCharges ? "error" : "warn",
    detail:
      `決済を受け付けられません（カード決済 = ${snapshot.cardPayments ?? "不明"}）。` +
      (reviewing
        ? "必要な情報は提出済みで、Stripeの有効化が完了していません。この間、契約の申し込みは必ず失敗します"
        : "アカウントの有効化（事業者情報・本人確認・銀行口座）が終わっていません"),
    nextAction: reviewing
      ? "Stripeダッシュボードのホームで有効化の残作業と審査状況を確認してください（アプリ側で直せる問題ではありません）"
      : "Stripeダッシュボード →「アカウントを有効化」から事業者情報・本人確認・銀行口座を登録してください",
  };
}
