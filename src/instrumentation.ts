import * as Sentry from "@sentry/nextjs";

import { initServerSentry } from "@/lib/observability/sentry";

/**
 * Next.js instrumentation hook. Initializes Sentry for the Node.js and Edge
 * runtimes (no-op without SENTRY_DSN). Client init is in instrumentation-client.ts.
 */
export function register(): void {
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    initServerSentry();
  }
}

// Surfaces server-side request errors to Sentry (Next.js onRequestError hook).
export const onRequestError = Sentry.captureRequestError;
