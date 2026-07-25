import {
  startBillingRedirect,
  type BillingRedirectDependencies,
} from "./billing-redirect";

const DEFAULT_ERROR_MESSAGE =
  "お支払い管理画面を開けませんでした。時間をおいてもう一度お試しください。";

/** Starts a server-owned Customer Portal Session and navigates to it. */
export async function startCustomerPortal(
  dependencies?: BillingRedirectDependencies,
): Promise<void> {
  await startBillingRedirect(
    "/api/stripe/portal",
    DEFAULT_ERROR_MESSAGE,
    dependencies,
  );
}
