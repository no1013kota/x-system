-- 要件02 §2: enum types (23種)。値・順序は src/lib/db/enums.ts と一致させる。
create type plan_type as enum ('standard', 'md', 'premium');

create type subscription_status as enum (
  'incomplete', 'incomplete_expired', 'trialing', 'active',
  'past_due', 'paused', 'canceled', 'unpaid'
);

create type api_provider as enum ('x', 'anthropic', 'openai', 'google');

create type api_key_status as enum ('valid', 'invalid', 'unchecked');

create type x_auth_type as enum ('byok', 'managed');

create type x_account_status as enum ('active', 'expired', 'disabled', 'error');

create type learning_source_type as enum ('ref_account', 'ref_post', 'own_posts');

create type learning_source_status as enum (
  'pending', 'analyzed', 'failed', 'removing', 'removed'
);

create type news_category as enum ('ai', 'web3', 'investment');

create type impact_level as enum ('high', 'mid', 'low');

create type job_kind as enum (
  'post_generation', 'image_generation', 'post_publish',
  'learning_analysis', 'md_merge', 'suggestion'
);

create type job_trigger as enum ('manual', 'news', 'schedule', 'system');

create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');

create type progress_stage as enum (
  'validating', 'research', 'writing', 'image', 'posting', 'merging'
);

create type post_pattern as enum ('p1', 'p2', 'p3', 'p4', 'p5', 'p6');

create type draft_status as enum ('draft', 'posting', 'posted', 'discarded', 'failed');

create type posted_mode as enum ('auto', 'manual');

create type schedule_mode as enum ('draft', 'auto');

create type usage_counter_type as enum ('post_normal', 'post_url', 'generation', 'image');

create type usage_event_reason as enum ('reserve', 'refund', 'consume');

create type usage_event_operation as enum (
  'generation', 'image_generation', 'post_create', 'post_delete'
);

create type notification_type as enum (
  'news', 'draft_created', 'posted', 'error', 'billing', 'usage'
);

create type email_delivery_status as enum ('not_requested', 'queued', 'sent', 'failed');
