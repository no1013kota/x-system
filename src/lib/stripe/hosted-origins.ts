/** Stripe-hosted pages opened after the server creates a short-lived session. */
export const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";
export const STRIPE_PORTAL_ORIGIN = "https://billing.stripe.com";

export const STRIPE_HOSTED_ORIGINS = [
  STRIPE_CHECKOUT_ORIGIN,
  STRIPE_PORTAL_ORIGIN,
] as const;
