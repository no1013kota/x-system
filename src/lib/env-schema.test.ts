import { describe, expect, it } from "vitest";

import { buildServerEnv } from "./env-schema";

/** Minimal set that satisfies ALWAYS_REQUIRED for a development environment. */
function devBase(): Record<string, string | undefined> {
  return {
    APP_ENV: "development",
    APP_BASE_URL: "http://localhost:3000",
    CRON_SECRET: "dev-secret",
    APP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    SUPPORT_EMAIL: "support@example.com",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DATABASE_URL: "postgres://localhost:6543/postgres",
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_PRICE_STANDARD_MONTHLY: "price_std",
    STRIPE_PRICE_MD_MONTHLY: "price_md",
    STRIPE_PRICE_PREMIUM_MONTHLY: "price_prem",
    ANTHROPIC_TEXT_MODEL: "claude-x",
    OPENAI_TEXT_MODEL: "gpt-x",
    OPENAI_IMAGE_MODEL: "gpt-image-x",
    GEMINI_TEXT_MODEL: "gemini-x",
    GEMINI_IMAGE_MODEL: "gemini-image-x",
  };
}

/** Adds everything PREVIEW_PROD_REQUIRED expects on top of the base. */
function prodBase(): Record<string, string | undefined> {
  return {
    ...devBase(),
    APP_ENV: "production",
    APP_BASE_URL: "https://spaceai.example",
    ANTHROPIC_API_KEY: "sk-ant",
    NEWS_TEXT_PROVIDER: "anthropic",
    X_MANAGED_CLIENT_ID: "x-client",
    STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test",
    X_COST_CONTENT_CREATE_USD: "0.015",
    X_COST_CONTENT_CREATE_WITH_URL_USD: "0.200",
    X_COST_INTERACTION_DELETE_USD: "0.010",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "ops@example.com",
    SMTP_APP_PASSWORD: "app-password",
    EMAIL_FROM: "Exos AI <ops@example.com>",
    EMAIL_REPLY_TO: "ops@example.com",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    SENTRY_DSN: "https://sentry.example/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example/2",
    X_POSTING_MODE: "live",
  };
}

describe("buildServerEnv defaults", () => {
  it("applies defaults for optional-with-default vars", () => {
    const env = buildServerEnv(devBase());
    expect(env.X_POSTING_MODE).toBe("dry_run");
    expect(env.X_DAILY_POST_LIMIT).toBe(50);
    expect(env.SUPABASE_STORAGE_BUCKET_IMAGES).toBe("generated-images");
    expect(env.X_OAUTH_REDIRECT_PATH).toBe("/api/x/oauth/callback");
    expect(env.NEWS_TEXT_PROVIDER).toBe("anthropic");
    expect(env.PREMIUM_TEXT_PROVIDER).toBe("anthropic");
  });

  it("resolves FEATURE_QUOTE_POST_ENABLED to false when unset", () => {
    const env = buildServerEnv(devBase());
    expect(env.FEATURE_QUOTE_POST_ENABLED).toBe(false);
  });

  it("resolves FEATURE_QUOTE_POST_ENABLED to true only for the literal 'true'", () => {
    expect(
      buildServerEnv({ ...devBase(), FEATURE_QUOTE_POST_ENABLED: "true" })
        .FEATURE_QUOTE_POST_ENABLED,
    ).toBe(true);
    expect(
      buildServerEnv({ ...devBase(), FEATURE_QUOTE_POST_ENABLED: "1" })
        .FEATURE_QUOTE_POST_ENABLED,
    ).toBe(false);
  });
});

describe("CRON_SECRET requirement", () => {
  it("fails when CRON_SECRET is missing (no auth-skip fallback)", () => {
    const raw = devBase();
    delete raw.CRON_SECRET;
    expect(() => buildServerEnv(raw)).toThrow(/CRON_SECRET/);
  });

  it("fails when CRON_SECRET is blank", () => {
    expect(() => buildServerEnv({ ...devBase(), CRON_SECRET: "  " })).toThrow(
      /CRON_SECRET/,
    );
  });
});

describe("X_POSTING_MODE guard", () => {
  it("rejects live posting in development", () => {
    expect(() =>
      buildServerEnv({ ...devBase(), X_POSTING_MODE: "live" }),
    ).toThrow(/X_POSTING_MODE=live/);
  });

  it("rejects live posting in preview", () => {
    const raw = { ...prodBase(), APP_ENV: "preview", X_POSTING_MODE: "live" };
    expect(() => buildServerEnv(raw)).toThrow(/X_POSTING_MODE=live/);
  });

  it("allows live posting in production", () => {
    const env = buildServerEnv(prodBase());
    expect(env.X_POSTING_MODE).toBe("live");
  });
});

describe("STRIPE_SECRET_KEY guard", () => {
  it("rejects a live key in development（実課金を防ぐ）", () => {
    expect(() =>
      buildServerEnv({ ...devBase(), STRIPE_SECRET_KEY: "sk_live_abc123" }),
    ).toThrow(/sk_live_/);
  });

  it("rejects a live key in preview", () => {
    expect(() =>
      buildServerEnv({ ...prodBase(), APP_ENV: "preview", STRIPE_SECRET_KEY: "sk_live_abc123" }),
    ).toThrow(/sk_live_/);
  });

  it("allows a test key in preview", () => {
    const env = buildServerEnv({
      ...prodBase(),
      APP_ENV: "preview",
      X_POSTING_MODE: "dry_run",
      STRIPE_SECRET_KEY: "sk_test_abc123",
    });
    expect(env.STRIPE_SECRET_KEY).toBe("sk_test_abc123");
  });

  it("allows a live key in production", () => {
    const env = buildServerEnv({ ...prodBase(), STRIPE_SECRET_KEY: "sk_live_abc123" });
    expect(env.STRIPE_SECRET_KEY).toBe("sk_live_abc123");
  });
});

describe("preview/prod-only requirements", () => {
  it("passes in development without preview/prod-only vars", () => {
    expect(() => buildServerEnv(devBase())).not.toThrow();
  });

  it("fails in production when ANTHROPIC_API_KEY (default premium/news provider) is missing", () => {
    const raw = prodBase();
    delete raw.ANTHROPIC_API_KEY;
    expect(() => buildServerEnv(raw)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("requires the selected PREMIUM_TEXT_PROVIDER operator key (openai) in production", () => {
    const raw = prodBase();
    raw.PREMIUM_TEXT_PROVIDER = "openai";
    // ANTHROPIC_API_KEY is still present (news default), but the OpenAI operator key is missing.
    expect(() => buildServerEnv(raw)).toThrow(/OPENAI_API_KEY/);
    raw.OPENAI_API_KEY = "sk-openai";
    expect(() => buildServerEnv(raw)).not.toThrow();
  });

  it("requires the selected NEWS_TEXT_PROVIDER operator key (google) in production", () => {
    const raw = prodBase();
    raw.NEWS_TEXT_PROVIDER = "google";
    expect(() => buildServerEnv(raw)).toThrow(/GEMINI_API_KEY/);
    raw.GEMINI_API_KEY = "gm-key";
    expect(() => buildServerEnv(raw)).not.toThrow();
  });

  it("passes in production with the full set", () => {
    expect(() => buildServerEnv(prodBase())).not.toThrow();
  });

  it("fails in production when STRIPE_PORTAL_CONFIGURATION_ID is missing", () => {
    const raw = prodBase();
    delete raw.STRIPE_PORTAL_CONFIGURATION_ID;
    expect(() => buildServerEnv(raw)).toThrow(/STRIPE_PORTAL_CONFIGURATION_ID/);
  });
});

describe("coerce-number blank handling", () => {
  it("treats a blank cost var as unset (fails the prod required check, not a silent 0)", () => {
    const raw = { ...prodBase(), X_COST_CONTENT_CREATE_USD: "" };
    expect(() => buildServerEnv(raw)).toThrow(/X_COST_CONTENT_CREATE_USD/);
  });

  it("parses a real cost value (0 allowed) and keeps it as a number", () => {
    const env = buildServerEnv({ ...prodBase(), X_COST_CONTENT_CREATE_USD: "0" });
    expect(env.X_COST_CONTENT_CREATE_USD).toBe(0);
  });

  it("treats a blank SMTP_PORT as unset instead of erroring (dev)", () => {
    const env = buildServerEnv({ ...devBase(), SMTP_PORT: "" });
    expect(env.SMTP_PORT).toBeUndefined();
  });

  it("falls back to the default when X_DAILY_POST_LIMIT is blank", () => {
    expect(buildServerEnv({ ...devBase(), X_DAILY_POST_LIMIT: "" }).X_DAILY_POST_LIMIT).toBe(50);
  });
});
