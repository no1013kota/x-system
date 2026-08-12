import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

import { requireExecutionAccess } from "./execution-guard";
import { LEGAL_CONSENT_COLUMNS, LEGAL_CONSENT_SELECT, LEGAL_CONSENT_SELECT_POOLED, acceptCurrentLegalConsents, requiredLegalConsents, type LegalConsentProfile } from "./legal-consent";

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

/**
 * 同意状態の列を3経路が同じものから引くこと（R34）。
 *
 * 同意画面・Server Action・実行ガードが同じ4列を別々に書いていた。同意対象が増えたとき
 * 実行ガードだけ古いと「画面では同意済みなのに生成が止まる」または逆に
 * 「同意していないのに生成できる」になり、**規約本文が約束している挙動から外れる**。
 */
describe("同意状態の列は1つの正本から引く", () => {
  it("pooled 用の select は同じ列から導出される（`_at` だけ ::text）", () => {
    expect(LEGAL_CONSENT_SELECT).toBe(
      "terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at",
    );
    expect(LEGAL_CONSENT_SELECT_POOLED).toBe(
      "terms_version, terms_accepted_at::text as terms_accepted_at, " +
        "privacy_version, privacy_acknowledged_at::text as privacy_acknowledged_at",
    );
  });

  it("列名は判定が読むキーと一致する（読めない列を select しない）", () => {
    // `requiredLegalConsents` が見るキーと、SQLで取る列がずれると常に未同意扱いになる。
    const profile: Record<string, null> = {};
    for (const column of LEGAL_CONSENT_COLUMNS) profile[column] = null;
    const required = requiredLegalConsents(profile as never);
    expect(required.terms).toBe(true);
    expect(required.privacy).toBe(true);
  });

  it("3経路が同じ正本を読んでいる（写経が復活したら落ちる）", () => {
    const sources = [
      "../../app/app/consent/page.tsx",
      "../../app/actions/legal-consent.ts",
      "./legal-consent-server.ts",
    ].map((rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
    for (const source of sources) {
      expect(
        source.includes("LEGAL_CONSENT_SELECT"),
        "列を写経している。LEGAL_CONSENT_SELECT を使ってください",
      ).toBe(true);
      expect(
        source,
        "列リストの直書きが残っている",
      ).not.toContain('"terms_version, terms_accepted_at');
    }
  });
});
