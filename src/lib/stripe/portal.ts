import type Stripe from "stripe";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import { AppError } from "@/lib/observability/errors";

export interface PortalProfile {
  stripe_customer_id: string | null;
  /** 契約中のsubscription。特定の操作（プラン変更・解約）へ直接入るのに要る。 */
  stripe_subscription_id?: string | null;
}

/**
 * Portalのどの画面へ入るか（T-M8-31）。
 *
 * 「プランを管理」という1つのボタンだと、押した先で何ができるのかが分からない。
 * **やりたいことを先に選ばせて、Stripeの該当画面へ直接入る**（`flow_data`）。
 * - `update`: プラン変更（価格の選び直し）
 * - `cancel`: 解約（期間末）
 * 未指定・subscriptionが分からないときはPortalのトップへ入る（従来と同じ）。
 */
export type PortalIntent = "update" | "cancel";

const PORTAL_INTENTS: readonly PortalIntent[] = ["update", "cancel"];

function intentFromBody(body: unknown): PortalIntent | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { intent?: unknown }).intent;
  return PORTAL_INTENTS.includes(value as PortalIntent) ? (value as PortalIntent) : null;
}

/**
 * `flow_data` を組む。**subscriptionが分からないときは組まない**（Stripeが400を返すため、
 * 「押しても開かない」より「Portalのトップが開く」方が利用者にとって良い）。
 */
export function portalFlowData(
  intent: PortalIntent | null,
  subscriptionId: string | null | undefined,
  returnUrl: string,
  retentionCouponId?: string | null,
): Stripe.BillingPortal.SessionCreateParams.FlowData | undefined {
  if (!intent || !subscriptionId) return undefined;
  const after = { after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } } };
  if (intent === "cancel") {
    /*
      **解約前にクーポンを提示する**（T-M8-272・運営者の指摘 2026-08-23「クーポンが提示されずに解約された」）。
      ダッシュボードの「顧客維持クーポン」は**Portalのトップから解約したとき**の設定で、
      `flow_data` で解約画面へ直接入るこの経路には効かない。ここで明示したものだけが出る（実測）。
      未設定なら従来どおり提示しない（環境ごとにクーポンIDが違うため env で持つ）。
    */
    const retention = retentionCouponId
      ? { retention: { type: "coupon_offer" as const, coupon_offer: { coupon: retentionCouponId } } }
      : {};
    return {
      type: "subscription_cancel",
      subscription_cancel: { subscription: subscriptionId, ...retention },
      ...after,
    };
  }
  return {
    type: "subscription_update",
    subscription_update: { subscription: subscriptionId },
    ...after,
  };
}

export interface PortalStripeGateway {
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{
        url: string;
      }>;
    };
  };
  subscriptions: {
    list(params: {
      customer: string;
      status: "all";
      limit: number;
    }): Promise<{ data: { id: string; status: string }[] }>;
  };
}

/**
 * `flow_data` に使う subscription を決める（T-M8-56）。
 *
 * 正本は `profiles.stripe_subscription_id`（webhookが同期する）だが、**同期前・同期漏れでは
 * null になる**。以前はそのとき flow_data を組まずに Portal のトップを開いていたため、
 * 「プランを変更」を押してもプラン選択に着かず、「解約する」を押しても解約の画面に着かなかった
 * （利用者が実際に踏んだ。押した先がトップでは、何が起きたのか分からない）。
 * null のときは Stripe から**その顧客の変更できる契約**を引いて補う。
 */
export async function resolveSubscriptionForFlow(
  stripe: PortalStripeGateway,
  customerId: string,
  storedSubscriptionId: string | null,
): Promise<string | null> {
  if (storedSubscriptionId) return storedSubscriptionId;
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  // 変更・解約の対象になり得る契約だけ（listは新しい順）。canceled/incomplete は対象にしない。
  const candidates = new Set(["active", "trialing", "past_due"]);
  return subs.data.find((sub) => candidates.has(sub.status))?.id ?? null;
}

export interface PortalRouteDependencies {
  appBaseUrl: string;
  configurationId?: string;
  /** 解約前に提示するクーポン（T-M8-272）。未設定なら提示しない。 */
  retentionCouponId?: string | null;
  getCurrentUser(): Promise<{ id: string } | null>;
  getProfile(userId: string): Promise<PortalProfile | null>;
  stripe: PortalStripeGateway;
}

/** Creates a short-lived Customer Portal URL from server-owned parameters. */
export async function handlePortalRequest(
  request: Request,
  deps: PortalRouteDependencies,
): Promise<Response> {
  if (!hasExactAppOrigin(request.headers.get("origin"), deps.appBaseUrl)) {
    return apiError(new AppError("forbidden"));
  }

  let user: { id: string } | null;
  try {
    user = await deps.getCurrentUser();
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!user) return apiError(new AppError("unauthorized"));

  let profile: PortalProfile | null;
  try {
    profile = await deps.getProfile(user.id);
  } catch (error) {
    // cause を捨てると apiError の記録に原因が乗らない（要件01 §8）。
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!profile) return apiError(new AppError("internal_error"));
  if (!profile.stripe_customer_id) {
    return apiError(
      new AppError("subscription_required", {
        details: { settingsPath: "/plans" },
      }),
    );
  }

  const baseUrl = deps.appBaseUrl.replace(/\/$/, "");
  const returnUrl = `${baseUrl}/api/stripe/return?source=portal`;
  // 本文が無い・壊れていても続行する（intent無し＝Portalのトップ）。
  const intent = intentFromBody(await request.json().catch(() => null));
  try {
    let subscriptionId: string | null = profile.stripe_subscription_id ?? null;
    if (intent) {
      subscriptionId = await resolveSubscriptionForFlow(
        deps.stripe,
        profile.stripe_customer_id,
        subscriptionId,
      );
      // **黙ってトップを開かない**（T-M8-56）。変更できる契約が無いのに「プランを変更」を
      // 押させても、着いた先で何もできない。正直に理由を返す。
      if (!subscriptionId) {
        return apiError(
          new AppError("subscription_required", { details: { settingsPath: "/plans" } }),
        );
      }
    }
    const base = {
      customer: profile.stripe_customer_id,
      // Checkoutと同じく日本語へ固定（T-M8-58）。
      locale: "ja" as const,
      return_url: returnUrl,
      ...(deps.configurationId ? { configuration: deps.configurationId } : {}),
    };
    const withRetention = portalFlowData(intent, subscriptionId, returnUrl, deps.retentionCouponId);
    let session: { url: string };
    try {
      session = await deps.stripe.billingPortal.sessions.create({
        ...base,
        ...(withRetention ? { flow_data: withRetention } : {}),
      });
    } catch (cause) {
      /*
        **一度クーポンを受け取った人には、同じクーポンをもう提示できない**（Stripeは顧客ごとに
        1回だけ提示を許し、2回目はセッション作成を400で断る。割引が切れた後も同じ・2026-08-23 実測）。
        ここで諦めると**解約画面そのものが開けなくなる**ので、提示なしで開き直す（T-M8-280）。
      */
      if (!isRetentionUnavailable(cause) || !withRetention) throw cause;
      const withoutRetention = portalFlowData(intent, subscriptionId, returnUrl, null);
      session = await deps.stripe.billingPortal.sessions.create({
        ...base,
        ...(withoutRetention ? { flow_data: withoutRetention } : {}),
      });
    }
    return apiJson({ ok: true, data: { url: session.url } });
  } catch (cause) {
    /*
      旧価格のまま残っている契約は、Portal設定に変更先が無くflowを開けない（T-M8-215で実発生。
      価格改定で旧Priceをアーカイブすると、その価格の契約はStripe側で
      "no price in the portal configuration available to change to" になる）。
      「通信に失敗」と言うと再試行させてしまうので、原因どおりに伝える。
      恒久対応は契約の新Priceへの移行（deployment.md）。
    */
    if (
      cause instanceof Error &&
      cause.message.includes("no price in the portal configuration")
    ) {
      // toUserFacingErrorはcode既定文へ丸めるため、この分岐だけ具体文で直接返す。
      recordUnexpectedError(cause, { at: "api-route:provider_error" });
      return apiJson(
        {
          ok: false,
          error: {
            code: "provider_error",
            message:
              "このご契約は旧価格のままのため、プラン変更画面を開けません。お手数ですがお問い合わせください（運営側で新価格へ切り替えます）。",
            details: { reason: "portal_price_unavailable" },
          },
        },
        502,
      );
    }
    return apiError(new AppError("provider_error", { cause }));
  }
}

/**
 * 「このクーポンはこの契約に適用できない」型の失敗か（T-M8-280）。
 * 顧客が既に受け取り済みのときにStripeが返す。提示なしで開き直せば解約はできるので、
 * これだけは失敗として扱わない。
 */
function isRetentionUnavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : "";
  return /coupon .* doesn't apply to the subscription|still usable by the customer/i.test(message);
}
