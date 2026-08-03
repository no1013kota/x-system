import {
  startBillingRedirect,
  type BillingRedirectDependencies,
} from "./billing-redirect";
import type { PortalIntent } from "./portal";

const DEFAULT_ERROR_MESSAGE =
  "プラン管理画面を開けませんでした。時間をおいてもう一度お試しください。";

/**
 * Customer Portal をサーバ側で作って遷移する。
 *
 * `intent` を渡すと Stripe の該当画面へ直接入る（T-M8-31）。
 * `update` はプラン変更、`cancel` は解約。省略時はPortalのトップ。
 */
export async function startCustomerPortal(
  intent?: PortalIntent,
  dependencies?: BillingRedirectDependencies,
): Promise<void> {
  await startBillingRedirect(
    "/api/stripe/portal",
    DEFAULT_ERROR_MESSAGE,
    dependencies,
    intent
      ? {
          body: JSON.stringify({ intent }),
          headers: { "content-type": "application/json" },
        }
      : undefined,
  );
}
