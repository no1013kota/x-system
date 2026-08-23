import type Stripe from "stripe";

import { apiError, apiJson } from "@/lib/http/api-response";
import { hasExactAppOrigin } from "@/lib/http/origin";
import { AppError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import type { PlanId } from "@/lib/plans";

import { syntheticSubscriptionEvent } from "./billing-return";
import { LIVE_SUBSCRIPTION_STATUSES } from "./checkout";
import { isLiveChargesDisabled } from "./stripe-errors";
import {
  subscriptionProjection,
  type SubscriptionApplyResult,
  type SubscriptionProjection,
} from "./subscription-sync";

/**
 * 解約済み（`subscription_status = 'canceled'`）契約の再開（T-M8-264）。
 *
 * Portalの `flow_data` は `active/trialing/past_due` の契約にしか入れないため、canceled の
 * 利用者には「プランを変更」が行き止まりだった（押してもPortalトップが開くだけ）。ここは
 * **保存済みのお支払い方法で同じプランのsubscriptionを作り直し、その場で再開する**。
 *
 * - **トライアルは付けない**（解約→再開の2回目無料を渡さない・T-M8-244と同じ理由）
 * - `payment_behavior: "error_if_incomplete"`——カード決済が通らなければ**契約を作らず**失敗を
 *   返す（incomplete の中途半端な契約を残すと、画面は「未完了」のまま誰も操作できなくなる）
 * - 冪等キーは `exos-ai:resume:{customer}:{支払い方法ID}:{10分バケット}`——二度押しは同じ作成に
 *   まとまり、失敗（カード拒否）後の再試行は次のバケットで新しいリクエストになる。**Stripeは
 *   成功も失敗も同一キーで24時間リプレイする**ため、時刻成分が無いと「限度額を直して再試行」が
 *   24時間構造的に無効になり、解約→再々開では過去の作成応答を新規成立と誤認する（レビューで検出）
 * - **createの応答をそのまま信用せず、`retrieve` で現在状態を取り直してから反映する**——
 *   冪等リプレイで返るのは「作成時のスナップショット」で、その契約は既に解約済みかもしれない。
 *   取り直した状態が生きていなければ成功と偽らない
 * - 成功したら現在状態を合成イベントとして `applyPreparedStripeEvent` へ流し、webhookを待たず
 *   DBへ反映する（billing-return と同じ作法）。開いたままのCheckoutセッションは**best effortで
 *   expire**する（完了時点にはガードが無く、後から完了されると2本目の契約＝二重請求になるため）
 */

/** 二度押しをまとめ、再試行をStripeの24時間冪等リプレイから逃がす時間幅（秒）。 */
const RESUME_ATTEMPT_BUCKET_S = 600;

export interface ResumeProfile {
  plan: PlanId | null;
  stripe_customer_id: string | null;
}

export interface ResumeStripeGateway {
  checkout: {
    sessions: {
      expire(id: string): Promise<unknown>;
      list(
        params: Stripe.Checkout.SessionListParams,
      ): Promise<{ data: { id: string }[] }>;
    };
  };
  paymentMethods: {
    list(
      params: Stripe.PaymentMethodListParams,
    ): Promise<{ data: Stripe.PaymentMethod[] }>;
  };
  subscriptions: {
    create(
      params: Stripe.SubscriptionCreateParams,
      options?: { idempotencyKey?: string },
    ): Promise<Stripe.Subscription>;
    list(
      params: Stripe.SubscriptionListParams,
    ): Promise<{ data: Stripe.Subscription[] }>;
    retrieve(id: string): Promise<Stripe.Subscription>;
  };
}

export interface ResumeRouteDependencies {
  appBaseUrl: string;
  applyProjection(projection: SubscriptionProjection): Promise<SubscriptionApplyResult>;
  getCurrentUser(): Promise<{ id: string } | null>;
  getProfile(userId: string): Promise<ResumeProfile | null>;
  /** Unix秒。冪等キーのバケットと合成イベントの`created`に使う。 */
  now(): number;
  priceIds: Record<PlanId, string>;
  stripe: ResumeStripeGateway;
}

function billingError(cause: unknown): AppError {
  if (isLiveChargesDisabled(cause)) {
    return new AppError("feature_disabled", {
      cause,
      details: { feature: "billing", reason: "live_charges_disabled" },
    });
  }
  return new AppError("provider_error", { cause });
}

/** Stripeのカード拒否か（型名はSDKの実挙動。誤検出しても文言が丁寧になるだけ）。 */
function isCardError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { type?: unknown }).type === "StripeCardError"
  );
}

/** Resumes a canceled subscription with the saved card, on the server. */
export async function handleResumeRequest(
  request: Request,
  deps: ResumeRouteDependencies,
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

  let profile: ResumeProfile | null;
  try {
    profile = await deps.getProfile(user.id);
  } catch (error) {
    return apiError(new AppError("internal_error", { cause: error }));
  }
  if (!profile) return apiError(new AppError("internal_error"));
  if (!profile.stripe_customer_id || !profile.plan) {
    // 再開できる下地（Stripe顧客と元のプラン）が無い＝新規契約の話なので /plans へ。
    return apiError(
      new AppError("subscription_required", { details: { settingsPath: "/plans" } }),
    );
  }
  const customerId = profile.stripe_customer_id;

  try {
    /*
      **契約が生きているなら作らない**（T-M8-237と同じ二重契約ガード）。DBが canceled でも
      Stripe側が正——webhook遅延で「解約済み」に見えるだけの利用者が押しても、2本目を作らない。
      （DBの status をゲートに使わないのは意図的: webhook遅延時に正当な再開を弾く逆害があるため）
    */
    const existing = await deps.stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
      status: "all",
    });
    const live = existing.data.find((sub) => LIVE_SUBSCRIPTION_STATUSES.has(sub.status));
    if (live) {
      return apiError(
        new AppError("subscription_required", {
          details: {
            missing: ["subscription"],
            reason: "already_subscribed",
            settingsPath: "/app/settings?tab=billing",
          },
        }),
      );
    }

    /*
      保存済みカードの最新1枚で払う。無ければその場で再開できないので、正直に /plans
      （Checkout＝カード入力つき）へ誘導する。**エラーにせず案内として返す**——
      カード未保存は利用者の状態であって障害ではない。
    */
    const cards = await deps.stripe.paymentMethods.list({
      customer: customerId,
      limit: 1,
      type: "card",
    });
    const card = cards.data[0];
    if (!card) {
      return apiJson(
        {
          ok: false,
          error: {
            code: "subscription_required",
            message:
              "お支払いに使えるカードが見つかりませんでした。料金プランからカードを登録してお手続きください。",
            details: { reason: "payment_method_missing", settingsPath: "/plans" },
          },
        },
        402,
      );
    }

    const attemptBucket = Math.floor(deps.now() / RESUME_ATTEMPT_BUCKET_S);
    let created: Stripe.Subscription;
    try {
      created = await deps.stripe.subscriptions.create(
        {
          customer: customerId,
          default_payment_method: card.id,
          items: [{ price: deps.priceIds[profile.plan] }],
          metadata: { user_id: user.id },
          // 決済が通らないなら契約を作らない（incompleteを残さない）。
          payment_behavior: "error_if_incomplete",
        },
        { idempotencyKey: `exos-ai:resume:${customerId}:${card.id}:${attemptBucket}` },
      );
    } catch (cause) {
      if (isCardError(cause)) {
        // カード拒否は再試行しても直らない。直し方（カードの確認・登録し直し）まで言う。
        // apiJson直返しでは apiError のSentry記録（T-M8-128）を通らないため、明示的に記録する。
        recordUnexpectedError(cause, { at: "api-route:provider_error" });
        return apiJson(
          {
            ok: false,
            error: {
              code: "provider_error",
              message:
                "登録済みのカードでのお支払いができませんでした。カードの有効期限・限度額をご確認いただくか、料金プランから別のカードでお手続きください。",
              details: { reason: "card_declined" },
            },
          },
          502,
        );
      }
      throw cause;
    }

    /*
      **応答が冪等リプレイ（過去の作成のスナップショット）かもしれない**ので、現在状態を
      取り直してから信用する。取り直した契約が生きていなければ——そのバケット内で作成→解約が
      挟まった稀な形——成功と偽らず、次のバケットでの再試行を促す。
    */
    let current: Stripe.Subscription;
    try {
      current = await deps.stripe.subscriptions.retrieve(created.id);
    } catch (error) {
      // 取り直しの一時失敗は作成応答で続行する（通常の新規作成なら同じ内容）。
      recordUnexpectedError(error, { at: "stripe-resume:refetch", subscriptionId: created.id });
      current = created;
    }
    if (!LIVE_SUBSCRIPTION_STATUSES.has(current.status)) {
      recordUnexpectedError(
        new Error(`resume replayed a non-live subscription: ${current.id} (${current.status})`),
        { at: "api-route:provider_error" },
      );
      return apiJson(
        {
          ok: false,
          error: {
            code: "provider_error",
            message: "再開を確定できませんでした。しばらく待ってからもう一度お試しください。",
            details: { reason: "resume_not_confirmed" },
          },
        },
        502,
      );
    }

    /*
      開いたままのCheckoutセッションをbest effortで無効化する。Checkoutの完了時点には
      二重契約ガードが無いため、/plansで開いたセッションを後から完了されると2本目の契約
      （どの画面にも出ないまま請求が続く）になる。失敗しても再開自体は成立している。
    */
    try {
      const open = await deps.stripe.checkout.sessions.list({
        customer: customerId,
        limit: 10,
        status: "open",
      });
      for (const session of open.data) {
        await deps.stripe.checkout.sessions.expire(session.id);
      }
    } catch (error) {
      recordUnexpectedError(error, { at: "stripe-resume:expire-checkout", customerId });
    }

    /*
      webhookを待たずにDBへ反映する（billing-return と同じ合成イベント）。ここが失敗しても
      契約自体は成立しており、webhookが後から追いつくので **成功として返す**。
    */
    let synced = true;
    try {
      const projection = subscriptionProjection(
        syntheticSubscriptionEvent(current, deps.now()),
        current,
        deps.priceIds,
      );
      await deps.applyProjection(projection);
    } catch (error) {
      // 契約は成立している。反映漏れはwebhookが追いつくが、失敗自体は記録する（原則1）。
      recordUnexpectedError(error, { at: "stripe-resume:apply", subscriptionId: current.id });
      synced = false;
    }

    return apiJson({ ok: true, data: { status: current.status, synced } });
  } catch (error) {
    if (error instanceof AppError) return apiError(error);
    return apiError(billingError(error));
  }
}
