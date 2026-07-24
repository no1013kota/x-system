import { z } from "zod";

/**
 * Environment-variable schema for Space AI (要件01 §3).
 *
 * Kept free of the `server-only` marker so it can be unit-tested directly; the
 * runtime entrypoint (`env.ts`) adds `server-only` and calls `buildServerEnv`.
 *
 * Required-by-environment is enforced in `superRefine` rather than per-field so
 * that the same schema loads in every APP_ENV and only complains about the
 * variables that environment actually needs.
 */

export const APP_ENVS = ["development", "preview", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const AI_PROVIDERS = ["anthropic", "openai", "google"] as const;

type RawEnv = Record<string, string | undefined>;

/**
 * True when a value is actually provided. Handles both raw strings (blank ==
 * unset) and already-coerced values such as numbers from `z.coerce.number()`,
 * whose absent form is `undefined`.
 */
function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Coerce-number env fields: treat a blank/whitespace string as unset
 * (`undefined`). Without this, `z.coerce.number()` turns "" into 0, which would
 * (a) silently pass the preview/prod required check for cost fields and corrupt
 * cost aggregation, and (b) fail `.positive()` fields set to "" with a
 * confusing error instead of falling back to unset/default.
 */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Variables that must be present in preview and production (optional in dev). */
const PREVIEW_PROD_REQUIRED = [
  // 文章運営キー（ANTHROPIC/OPENAI/GEMINI）は PREMIUM_TEXT_PROVIDER / NEWS_TEXT_PROVIDER の選択に応じて
  // superRefine で動的に必須化する（既定anthropicなら ANTHROPIC_API_KEY を要求）。
  "NEWS_TEXT_PROVIDER",
  "X_MANAGED_CLIENT_ID",
  "STRIPE_PORTAL_CONFIGURATION_ID",
  "X_COST_CONTENT_CREATE_USD",
  "X_COST_CONTENT_CREATE_WITH_URL_USD",
  "X_COST_INTERACTION_DELETE_USD",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_APP_PASSWORD",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
] as const;

/** Variables that must be present in every environment (incl. dev). */
const ALWAYS_REQUIRED = [
  "APP_BASE_URL",
  "APP_ENV",
  // CRON_SECRET authenticates every job dispatch (POST /api/jobs/run); a missing
  // value must fail startup, never fall back to skipping auth (要件01 §3.1).
  "CRON_SECRET",
  "APP_ENCRYPTION_KEY",
  "SUPPORT_EMAIL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STANDARD_MONTHLY",
  "STRIPE_PRICE_MD_MONTHLY",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "ANTHROPIC_TEXT_MODEL",
  "OPENAI_TEXT_MODEL",
  "OPENAI_IMAGE_MODEL",
  "GEMINI_TEXT_MODEL",
  "GEMINI_IMAGE_MODEL",
] as const;

const schema = z
  .object({
    // §3.1 アプリ共通
    APP_BASE_URL: z.string().url().optional(),
    APP_ENV: z.enum(APP_ENVS),
    CRON_SECRET: z.string().min(1).optional(),
    APP_ENCRYPTION_KEY: z.string().min(1).optional(),
    X_POSTING_MODE: z.enum(["dry_run", "live"]).default("dry_run"),
    FEATURE_QUOTE_POST_ENABLED: z
      .string()
      .optional()
      .transform(parseBooleanFlag),
    X_DAILY_POST_LIMIT: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().positive().default(50),
    ),
    X_COST_CONTENT_CREATE_USD: z.preprocess(
      blankToUndefined,
      z.coerce.number().nonnegative().optional(),
    ),
    X_COST_CONTENT_CREATE_WITH_URL_USD: z.preprocess(
      blankToUndefined,
      z.coerce.number().nonnegative().optional(),
    ),
    X_COST_INTERACTION_DELETE_USD: z.preprocess(
      blankToUndefined,
      z.coerce.number().nonnegative().optional(),
    ),

    // §3.2 Supabase
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET_IMAGES: z.string().min(1).default("generated-images"),

    // §3.3 Stripe
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_PORTAL_CONFIGURATION_ID: z.string().min(1).optional(),
    STRIPE_PRICE_STANDARD_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_MD_MONTHLY: z.string().min(1).optional(),
    STRIPE_PRICE_PREMIUM_MONTHLY: z.string().min(1).optional(),

    // §3.4 X API
    X_MANAGED_CLIENT_ID: z.string().min(1).optional(),
    X_MANAGED_CLIENT_SECRET: z.string().min(1).optional(),
    X_OAUTH_REDIRECT_PATH: z.string().min(1).default("/api/x/oauth/callback"),

    // §3.5 AI・画像
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    PREMIUM_TEXT_PROVIDER: z.enum(AI_PROVIDERS).default("anthropic"),
    NEWS_TEXT_PROVIDER: z.enum(AI_PROVIDERS).default("anthropic"),
    ANTHROPIC_TEXT_MODEL: z.string().min(1).optional(),
    OPENAI_TEXT_MODEL: z.string().min(1).optional(),
    OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
    GEMINI_TEXT_MODEL: z.string().min(1).optional(),
    GEMINI_IMAGE_MODEL: z.string().min(1).optional(),

    // §3.6 メール・監視
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.preprocess(
      blankToUndefined,
      z.coerce.number().int().positive().optional(),
    ),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_APP_PASSWORD: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    EMAIL_REPLY_TO: z.string().min(1).optional(),
    SUPPORT_EMAIL: z.string().email().optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    SENTRY_DSN: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
  })
  .superRefine((values, ctx) => {
    const appEnv = values.APP_ENV;
    const require = (key: string, raw: unknown) => {
      if (!present(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} は ${appEnv} 環境で必須です`,
        });
      }
    };

    for (const key of ALWAYS_REQUIRED) {
      require(key, values[key as keyof typeof values]);
    }

    if (appEnv === "preview" || appEnv === "production") {
      for (const key of PREVIEW_PROD_REQUIRED) {
        require(key, values[key as keyof typeof values]);
      }
      // 運営文章キー: premium（PREMIUM_TEXT_PROVIDER・既定anthropic）と news（NEWS_TEXT_PROVIDER）は
      // 運営キーで実行するため、実際に選択された provider の API キーを起動時に必須とする（要件01 §7・O-4）。
      // 明示設定で openai/google を選んだ場合はその運営キーが無いと起動を失敗させる。
      const TEXT_KEY_BY_PROVIDER: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GEMINI_API_KEY",
      };
      for (const provider of new Set([values.PREMIUM_TEXT_PROVIDER, values.NEWS_TEXT_PROVIDER])) {
        const keyName = TEXT_KEY_BY_PROVIDER[provider];
        require(keyName, values[keyName as keyof typeof values]);
      }
    }

    // dev/preview must never post for real (要件01 §3.1).
    if (appEnv !== "production" && values.X_POSTING_MODE === "live") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["X_POSTING_MODE"],
        message: `X_POSTING_MODE=live は production 環境でのみ許可されます（現在: ${appEnv}）`,
      });
    }
  });

export type ServerEnv = z.infer<typeof schema>;

/**
 * Validates raw environment variables and returns the typed, defaulted config.
 * Throws a ZodError listing every problem when validation fails.
 */
export function buildServerEnv(raw: RawEnv): ServerEnv {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`環境変数の検証に失敗しました:\n${details}`);
  }
  return result.data;
}
