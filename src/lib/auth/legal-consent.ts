import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

export interface LegalConsentProfile {
  privacy_acknowledged_at: string | null;
  privacy_version: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
}

export interface LegalConsentUpdate {
  privacy_acknowledged_at?: string;
  privacy_version?: string;
  terms_accepted_at?: string;
  terms_version?: string;
}

export interface LegalConsentResult {
  fieldErrors?: Record<string, string[]>;
  message: string;
  status: "error" | "success";
  update?: LegalConsentUpdate;
}

export function requiredLegalConsents(profile: LegalConsentProfile): {
  privacy: boolean;
  terms: boolean;
} {
  return {
    privacy: profile.privacy_version !== CURRENT_PRIVACY_VERSION,
    terms: profile.terms_version !== CURRENT_TERMS_VERSION,
  };
}

/** Validates explicit re-consent and persists only documents that are stale. */
export async function acceptCurrentLegalConsents(
  profile: LegalConsentProfile,
  formData: FormData,
  dependencies: {
    now(): Date;
    updateProfile(update: LegalConsentUpdate): Promise<void>;
  },
): Promise<LegalConsentResult> {
  const required = requiredLegalConsents(profile);
  const fieldErrors: Record<string, string[]> = {};
  if (
    required.terms &&
    (formData.get("terms_accepted") !== "on" ||
      formData.get("terms_version") !== CURRENT_TERMS_VERSION)
  ) {
    fieldErrors.terms_accepted = [
      "最新の利用規約を確認し、同意してください。",
    ];
  }
  if (
    required.privacy &&
    (formData.get("privacy_acknowledged") !== "on" ||
      formData.get("privacy_version") !== CURRENT_PRIVACY_VERSION)
  ) {
    fieldErrors.privacy_acknowledged = [
      "最新のプライバシーポリシーを確認してください。",
    ];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      message: "更新内容をご確認ください。",
      status: "error",
    };
  }

  const acceptedAt = dependencies.now().toISOString();
  const update: LegalConsentUpdate = {};
  if (required.terms) {
    update.terms_version = CURRENT_TERMS_VERSION;
    update.terms_accepted_at = acceptedAt;
  }
  if (required.privacy) {
    update.privacy_version = CURRENT_PRIVACY_VERSION;
    update.privacy_acknowledged_at = acceptedAt;
  }
  if (Object.keys(update).length > 0) {
    await dependencies.updateProfile(update);
  }
  return {
    message: "更新内容への同意を記録しました。",
    status: "success",
    update,
  };
}
