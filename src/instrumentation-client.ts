import * as Sentry from "@sentry/nextjs";

import { initClientSentry } from "@/lib/observability/sentry";

// Browser Sentry init (no-op without NEXT_PUBLIC_SENTRY_DSN).
initClientSentry();

// Required by @sentry/nextjs for client-side navigation instrumentation.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
