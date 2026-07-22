import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

import { requireExecutionAccess } from "./execution-guard";
import {
  acceptCurrentLegalConsents,
  type LegalConsentProfile,
} from "./legal-consent";

const NOW = new Date("2026-07-22T12:34:56.000Z");

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("legal re-consent", () => {
  it("updates both stale documents and unblocks the common execution guard", async () => {
    const profile: LegalConsentProfile = {
      privacy_acknowledged_at: null,
      privacy_version: "old-privacy",
      terms_accepted_at: null,
      terms_version: "old-terms",
    };
    const updateProfile = vi.fn(async (update) => {
      Object.assign(profile, update);
    });
    const result = await acceptCurrentLegalConsents(
      profile,
      form({
        privacy_acknowledged: "on",
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_accepted: "on",
        terms_version: CURRENT_TERMS_VERSION,
      }),
      { now: () => NOW, updateProfile },
    );
    expect(result).toMatchObject({ status: "success" });
    expect(updateProfile).toHaveBeenCalledWith({
      privacy_acknowledged_at: NOW.toISOString(),
      privacy_version: CURRENT_PRIVACY_VERSION,
      terms_accepted_at: NOW.toISOString(),
      terms_version: CURRENT_TERMS_VERSION,
    });
    expect(() =>
      requireExecutionAccess({
        privacyVersion: profile.privacy_version,
        subscriptionStatus: "active",
        termsVersion: profile.terms_version,
      }),
    ).not.toThrow();
  });

  it("updates only stale terms and preserves current privacy acknowledgement", async () => {
    const updateProfile = vi.fn(async () => undefined);
    await expect(
      acceptCurrentLegalConsents(
        {
          privacy_acknowledged_at: "2026-07-01T00:00:00Z",
          privacy_version: CURRENT_PRIVACY_VERSION,
          terms_accepted_at: "2026-07-01T00:00:00Z",
          terms_version: "old-terms",
        },
        form({
          terms_accepted: "on",
          terms_version: CURRENT_TERMS_VERSION,
        }),
        { now: () => NOW, updateProfile },
      ),
    ).resolves.toMatchObject({ status: "success" });
    expect(updateProfile).toHaveBeenCalledWith({
      terms_accepted_at: NOW.toISOString(),
      terms_version: CURRENT_TERMS_VERSION,
    });
  });

  it("rejects missing consent and a stale client version without updating", async () => {
    const updateProfile = vi.fn(async () => undefined);
    const result = await acceptCurrentLegalConsents(
      {
        privacy_acknowledged_at: null,
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_accepted_at: null,
        terms_version: "old-terms",
      },
      form({ terms_accepted: "on", terms_version: "stale-client-version" }),
      { now: () => NOW, updateProfile },
    );
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { terms_accepted: expect.any(Array) },
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op when both documents are current", async () => {
    const updateProfile = vi.fn(async () => undefined);
    const result = await acceptCurrentLegalConsents(
      {
        privacy_acknowledged_at: NOW.toISOString(),
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_accepted_at: NOW.toISOString(),
        terms_version: CURRENT_TERMS_VERSION,
      },
      form({}),
      { now: () => NOW, updateProfile },
    );
    expect(result).toMatchObject({ status: "success", update: {} });
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
