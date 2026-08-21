/**
 * Single source of truth for all Postgres enum types (要件02 §2).
 *
 * The migration SQL and the DB-backed enum test both derive from this map, so
 * DB, TypeScript types, and future zod schemas stay in lockstep. Order matches
 * the SQL `CREATE TYPE ... AS ENUM (...)` value order.
 */
export const DB_ENUMS = {
  plan_type: ["standard", "premium", "expert"],
  subscription_status: [
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "paused",
    "canceled",
    "unpaid",
  ],
  api_provider: ["x", "anthropic", "openai", "google"],
  api_key_status: ["valid", "invalid", "unchecked"],
  x_auth_type: ["byok", "managed"],
  x_account_status: ["active", "expired", "disabled", "error"],
  learning_source_type: ["ref_account", "ref_post", "own_posts"],
  learning_source_status: [
    "pending",
    "analyzed",
    "failed",
    "removing",
    "removed",
  ],
  news_category: ["ai", "web3", "investment", "business", "business_ops", "sns", "love", "beauty"],
  impact_level: ["high", "mid", "low"],
  job_kind: [
    "post_generation",
    "image_generation",
    "post_publish",
    "learning_analysis",
    "md_merge",
    "suggestion",
  ],
  job_trigger: ["manual", "news", "schedule", "system"],
  job_status: ["queued", "running", "succeeded", "failed", "canceled"],
  progress_stage: [
    "validating",
    "research",
    "writing",
    "image",
    "posting",
    "merging",
  ],
  draft_status: ["draft", "posting", "posted", "discarded", "failed"],
  posted_mode: ["auto", "manual"],
  schedule_mode: ["draft", "auto"],
  usage_counter_type: ["post_normal", "post_url", "generation", "image", "ai_credit"],
  usage_event_reason: ["reserve", "refund", "consume"],
  usage_event_operation: [
    "generation",
    "image_generation",
    "post_create",
    "post_delete",
  ],
  notification_type: [
    "news",
    "draft_created",
    "posted",
    "error",
    "billing",
    "usage",
    "summary",
  ],
  email_delivery_status: ["not_requested", "queued", "sent", "failed"],
} as const satisfies Record<string, readonly string[]>;

export type DbEnumName = keyof typeof DB_ENUMS;
