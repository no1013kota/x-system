import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

/**
 * 同意状態を持つ列の**単一の正本**（R34）。
 *
 * 同じ4列を、同意画面・Server Action・実行ガードの3箇所が別々に書いていた。
 * 同意対象が増えたとき実行ガードだけ古いと「**画面では同意済みなのに生成が止まる**」または
 * 逆に「**同意していないのに生成できる**」になり、規約本文が約束している挙動から外れる。
 *
 * **文字列リテラルを正本にする**。Supabase クライアントは select 文字列の*リテラル型*から
 * 行の型を推論するので、配列から `join` した `string` を渡すと型が落ちる（実際に落ちた）。
 * 配列と pooled 用の select は、このリテラルから導出する。
 */
export const LEGAL_CONSENT_SELECT =
  "terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at" as const;

/** 上のリテラルから導出した列名（並びも同じ）。 */
export const LEGAL_CONSENT_COLUMNS: readonly string[] = LEGAL_CONSENT_SELECT.split(", ");

/**
 * pooled 接続用の select 句。timestamptz を文字列で受けるため `_at` の列だけ `::text` を付ける
 * （型は `LegalConsentProfile` と同じ形になる）。
 */
export const LEGAL_CONSENT_SELECT_POOLED = LEGAL_CONSENT_COLUMNS.map((column) =>
  column.endsWith("_at") ? `${column}::text as ${column}` : column,
).join(", ");

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
