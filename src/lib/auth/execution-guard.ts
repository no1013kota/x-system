import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import { requireExecutableSubscription } from "./subscription-access";

export interface ExecutionGuardProfile {
  privacyVersion: string | null;
  subscriptionStatus: string;
  termsVersion: string | null;
}

/** Common precondition gate for every generation/posting/automation mutation. */
export function requireExecutionAccess(profile: ExecutionGuardProfile): void {
  requireExecutableSubscription(profile.subscriptionStatus);
  const missing: string[] = [];
  if (profile.termsVersion !== CURRENT_TERMS_VERSION) {
    missing.push("terms_consent");
  }
  if (profile.privacyVersion !== CURRENT_PRIVACY_VERSION) {
    missing.push("privacy_acknowledgement");
  }
  if (missing.length > 0) {
    throw new AppError("legal_consent_required", {
      details: {
        currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
        currentTermsVersion: CURRENT_TERMS_VERSION,
        missing,
        settingsPath: "/app/consent",
      },
    });
  }
}
