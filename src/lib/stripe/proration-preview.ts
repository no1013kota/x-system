import "server-only";

import type Stripe from "stripe";

import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * プラン変更で発生した日割り差額の下見（T-M8-267・運営者の指示 2026-08-23「Aにしてみましょう」）。
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
  };
}

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
 * 未請求の日割り差額を読む。差額が無い（下位変更の予約・通常の更新）ときや、取得に失敗したときは null。
 * **失敗しても画面は止めない**——出せるのは補足説明なので、無ければ従来どおりの案内だけを見せる。
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
