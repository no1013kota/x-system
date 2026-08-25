import "server-only";

import type Stripe from "stripe";

import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * プラン変更で発生した日割り差額の下見（T-M8-270・運営者の指示 2026-08-23「Aにしてみましょう」）。
 *
 * **Stripe の確認画面には独自の文章を書けない**（ポータルで設定できる文字は見出し・各種リンクだけ。
 * Stripe公式ドキュメントとSDKの型で確認）。上位プランへの変更は即時に切り替わるため、Stripeの確認画面は
 * 「次回からのお支払い (毎月) ◯月◯日 以降 ¥X」しか出さず、**日割りの説明がどこにも出ない**。
 * そこで「確定」直後に戻ってくるこの画面（設定＞課金・プラン）で、**実際の差額と加算先の請求日**を出す。
 *
 * 金額は次回請求書の下見（`invoices.createPreview`）から**日割り行だけ**を合計する
 * （旧プランの未使用分マイナス＋新プランの残り期間分プラス＝差額）。まだ請求されていない差額なので、
 * 変更直後にだけ値が入り、次回の請求が終われば 0 になる。
 */

export interface ProrationPreviewGateway {
  invoices: {
    createPreview(params: {
      customer: string;
      subscription: string;
    }): Promise<Stripe.Invoice>;
    list(params: {
      customer: string;
      limit: number;
    }): Promise<{ data: Stripe.Invoice[] }>;
  };
}

/** 直後の戻りとみなす幅（T-M8-296）。Portalは確定後すぐリダイレクトするので余裕を見て15分。 */
export const RECENT_CHARGE_WINDOW_SEC = 15 * 60;

export interface ProrationPreview {
  /** 次回請求へ加算される日割り差額（円）。0以下なら preview は null を返す。 */
  amountJpy: number;
  /** 加算先の請求日（ISO）。取れなければ null（画面は日付を作らず「次回のご請求」と書く）。 */
  chargedAt: string | null;
}

/** 日割り行か（API version 2026-06-24 では `parent.*_details.proration`）。 */
function isProration(line: Stripe.InvoiceLineItem): boolean {
  const parent = line.parent;
  return (
    parent?.subscription_item_details?.proration === true ||
    parent?.invoice_item_details?.proration === true
  );
}

/**
 * **未請求のまま残っている**日割り差額を読む。差額が無い（下位変更の予約・通常の更新）ときや、
 * 取得に失敗したときは null。**失敗しても画面は止めない**——出せるのは補足説明なので、
 * 無ければ従来どおりの案内だけを見せる。
 *
 * `always_invoice`（T-M8-275）にした今、上位変更の差額はここには出ない（即時に請求される）。
 * ここに出るのは**設定を変える前に発生して未請求のまま残っている差額**なので、
 * 「いま変更した差額」として出さないこと（実際に運営者の契約で ¥10,754 が残っていた・T-M8-296）。
 */
export async function loadPendingProration(
  stripe: ProrationPreviewGateway,
  input: { customerId: string; subscriptionId: string },
): Promise<ProrationPreview | null> {
  try {
    const preview = await stripe.invoices.createPreview({
      customer: input.customerId,
      subscription: input.subscriptionId,
    });
    const amountJpy = (preview.lines?.data ?? [])
      .filter(isProration)
      .reduce((total, line) => total + (line.amount ?? 0), 0);
    if (amountJpy <= 0) return null;
    const chargedAtSec = preview.next_payment_attempt ?? preview.period_end ?? null;
    return {
      amountJpy,
      chargedAt: chargedAtSec ? new Date(chargedAtSec * 1000).toISOString() : null,
    };
  } catch (error) {
    recordUnexpectedError(error, { at: "stripe:proration-preview", subscriptionId: input.subscriptionId });
    return null;
  }
}

/**
 * **その場で支払われた日割り差額**を読む（T-M8-296）。
 *
 * Portalを `always_invoice` にした（T-M8-275）ことで、上位プランへの変更は**即時に請求・決済される**。
 * その結果、次回請求の下見（`loadPendingProration`）には日割り行が**1行も出なくなり**、
 * T-M8-270で足した「差額はいくらか」の説明が**どの経路でも出なくなっていた**
 * （2026-08-25、テストクロックで実測: 変更時に `subscription_update` の請求書が即時に paid になり、
 * 次回請求プレビューは月額1行だけになる）。支払い済みの差額はこちらから読む。
 *
 * 直近の `subscription_update` の請求書だけを見る。古い変更を「いま払った」と誤って出さないよう、
 * **戻ってきた直後（15分以内）に作られたもの**に限る。
 */
export async function loadRecentProrationCharge(
  stripe: ProrationPreviewGateway,
  input: { customerId: string; subscriptionId: string; nowSec: number },
): Promise<{ amountJpy: number; paidAt: string | null } | null> {
  try {
    const list = await stripe.invoices.list({ customer: input.customerId, limit: 5 });
    const recent = (list.data ?? []).find((invoice) => {
      if (invoice.billing_reason !== "subscription_update") return false;
      if ((invoice.amount_paid ?? 0) <= 0) return false;
      const created = invoice.created ?? 0;
      return input.nowSec - created <= RECENT_CHARGE_WINDOW_SEC;
    });
    if (!recent) return null;
    const paidAtSec = recent.status_transitions?.paid_at ?? recent.created ?? null;
    return {
      amountJpy: recent.amount_paid ?? 0,
      paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : null,
    };
  } catch (error) {
    recordUnexpectedError(error, {
      at: "stripe:proration-charge",
      subscriptionId: input.subscriptionId,
    });
    return null;
  }
}

/** 「差額 ¥7,330 をお支払いいただきました」（即時決済・T-M8-296）。 */
export function prorationChargedNotice(charge: { amountJpy: number }): string {
  const amount = new Intl.NumberFormat("ja-JP").format(charge.amountJpy);
  return `変更前後の料金を日割りで計算した差額 ¥${amount} を、ただいまお支払いいただきました。`;
}

/** 「差額 ¥2,500 は次回のご請求（2026年9月23日）に加算されます」。日付が無ければ日付を作らない。 */
export function prorationNotice(preview: ProrationPreview): string {
  const amount = new Intl.NumberFormat("ja-JP").format(preview.amountJpy);
  if (!preview.chargedAt) {
    return `変更前後の料金を日割りで計算した差額 ¥${amount} は、次回のご請求に加算されます。`;
  }
  const at = new Date(preview.chargedAt);
  if (Number.isNaN(at.getTime())) {
    return `変更前後の料金を日割りで計算した差額 ¥${amount} は、次回のご請求に加算されます。`;
  }
  const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(at);
  return `変更前後の料金を日割りで計算した差額 ¥${amount} は、次回のご請求（${date}）に加算されます。`;
}
