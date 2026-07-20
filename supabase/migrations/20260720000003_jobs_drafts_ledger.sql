-- 要件02 §3.8〜3.17: ジョブ・下書き・台帳系10テーブル。
-- FK削除方針（§1）: 操作系の所有FK=cascade / 履歴・台帳の所有FK=restrict / 二次的な参照=set null。
-- RLSの有効化とポリシーは後続（T-M0-06）。

-- ── §3.10 schedule_slots（generation_jobs より先に作る） ──────
create table schedule_slots (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  pattern post_pattern not null,
  weekdays integer[] not null,
  time_jst time not null,
  mode schedule_mode not null,
  instructions text,
  image_enabled boolean not null default false,
  image_provider text,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_slots_pattern_not_p5 check (pattern <> 'p5'),
  constraint schedule_slots_weekdays_valid check (
    array_length(weekdays, 1) >= 1 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]
  ),
  constraint schedule_slots_time_valid check (
    time_jst >= time '09:00'
    and time_jst <= time '22:00'
    and extract(minute from time_jst) in (0, 30)
    and extract(second from time_jst) = 0
  ),
  -- image_provider が NULL のとき `in (...)` は NULL になり CHECK を素通りするため
  -- is not null を明示する
  constraint schedule_slots_image_provider_valid check (
    (not image_enabled)
    or (image_provider is not null and image_provider in ('openai', 'google'))
  )
);
create trigger schedule_slots_set_updated_at before update on schedule_slots
  for each row execute function set_updated_at();

-- ── §3.8 generation_jobs（draft_id FK は drafts 作成後にALTER） ──
create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  kind job_kind not null,
  trigger job_trigger not null,
  parent_job_id uuid references generation_jobs (id) on delete set null,
  slot_id uuid references schedule_slots (id) on delete set null,
  draft_id uuid,
  learning_source_id uuid references learning_sources (id) on delete set null,
  scheduled_for timestamptz,
  schedule_run_key text unique,
  request_key text unique,
  pattern post_pattern,
  input jsonb not null default '{}',
  status job_status not null default 'queued',
  progress_stage progress_stage,
  attempt integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  usage jsonb not null default '{}',
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_jobs_attempt_nonneg check (attempt >= 0)
);
create index generation_jobs_status_available_created_idx
  on generation_jobs (status, available_at, created_at);
create index generation_jobs_account_created_idx
  on generation_jobs (x_account_id, created_at desc);
create index generation_jobs_slot_idx on generation_jobs (slot_id);
create index generation_jobs_parent_idx on generation_jobs (parent_job_id);
create index generation_jobs_draft_idx on generation_jobs (draft_id);
create index generation_jobs_learning_source_idx on generation_jobs (learning_source_id);
-- 同一draftのpost_publish/image_generationはqueued/running中に1件のみ
create unique index generation_jobs_post_publish_active_unique
  on generation_jobs (draft_id)
  where kind = 'post_publish' and status in ('queued', 'running');
create unique index generation_jobs_image_active_unique
  on generation_jobs (draft_id)
  where kind = 'image_generation' and status in ('queued', 'running');
-- 同一Xアカウントのsuggestionはqueued/running中に1件のみ
create unique index generation_jobs_suggestion_active_unique
  on generation_jobs (x_account_id)
  where kind = 'suggestion' and status in ('queued', 'running');
-- 同一Xアカウントのlearning_analysis/md_mergeはrunning中に1件のみ
create unique index generation_jobs_learning_running_unique
  on generation_jobs (x_account_id)
  where kind in ('learning_analysis', 'md_merge') and status = 'running';
create trigger generation_jobs_set_updated_at before update on generation_jobs
  for each row execute function set_updated_at();

-- ── §3.9 drafts ──────────────────────────────────────────────
create table drafts (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  pattern post_pattern not null,
  thread jsonb not null,
  initial_thread jsonb not null,
  images jsonb not null default '[]',
  status draft_status not null default 'draft',
  source_job_id uuid unique references generation_jobs (id) on delete set null,
  parent_draft_id uuid references drafts (id) on delete set null,
  source_news_item_id uuid references news_items (id) on delete set null,
  quote_tweet_id text,
  quote_url text,
  root_tweet_id text,
  tweet_ids jsonb not null default '[]',
  posted_mode posted_mode,
  posted_at timestamptz,
  tweet_metrics jsonb not null default '{}',
  next_metrics_at timestamptz,
  metrics_completed_at timestamptz,
  last_post_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_account_status_created_idx
  on drafts (x_account_id, status, created_at desc);
create index drafts_account_posted_idx on drafts (x_account_id, posted_at desc);
create index drafts_next_metrics_idx on drafts (next_metrics_at)
  where metrics_completed_at is null;
create index drafts_source_news_idx on drafts (source_news_item_id);
create index drafts_parent_idx on drafts (parent_draft_id);
create trigger drafts_set_updated_at before update on drafts
  for each row execute function set_updated_at();

-- generation_jobs.draft_id → drafts（循環FK・二次参照なので set null）
alter table generation_jobs
  add constraint generation_jobs_draft_fk
  foreign key (draft_id) references drafts (id) on delete set null;

-- ── §3.11 follower_snapshots（台帳: restrict） ────────────────
create table follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete restrict,
  snapshot_date date not null,
  followers_count integer not null,
  created_at timestamptz not null default now(),
  constraint follower_snapshots_account_date_unique unique (x_account_id, snapshot_date),
  constraint follower_snapshots_count_nonneg check (followers_count >= 0)
);

-- ── §3.12 improvement_suggestions（表示専用） ─────────────────
create table improvement_suggestions (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  source_job_id uuid not null references generation_jobs (id) on delete cascade,
  content text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);
create index improvement_suggestions_account_created_idx
  on improvement_suggestions (x_account_id, created_at desc);
create index improvement_suggestions_source_job_idx
  on improvement_suggestions (source_job_id);

-- ── §3.13 usage_events（台帳: user_id restrict / 二次FK set null） ──
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete restrict,
  x_account_id uuid references x_accounts (id) on delete set null,
  job_id uuid references generation_jobs (id) on delete set null,
  draft_id uuid references drafts (id) on delete set null,
  tweet_id text,
  month text not null,
  counter_type usage_counter_type not null,
  operation usage_event_operation not null,
  delta integer not null,
  reason usage_event_reason not null,
  idempotency_key text not null unique,
  ref_event_id uuid references usage_events (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint usage_events_month_format check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint usage_events_delta_range check (delta in (-1, 1)),
  constraint usage_events_reason_delta check (
    (reason in ('reserve', 'consume') and delta = 1)
    or (reason = 'refund' and delta = -1)
  ),
  constraint usage_events_refund_ref check (
    reason <> 'refund' or ref_event_id is not null
  ),
  constraint usage_events_post_op check (
    operation not in ('post_create', 'post_delete')
    or (counter_type in ('post_normal', 'post_url') and reason = 'consume')
  )
);
create index usage_events_user_month_idx on usage_events (user_id, month);
create index usage_events_job_idx on usage_events (job_id);
create index usage_events_draft_idx on usage_events (draft_id);
create index usage_events_tweet_idx on usage_events (tweet_id);

-- ── §3.14 usage_counters（premium月間上限。台帳: restrict） ────
create table usage_counters (
  user_id uuid not null references profiles (id) on delete restrict,
  month text not null,
  normal_posts_count integer not null default 0,
  url_posts_count integer not null default 0,
  generations_count integer not null default 0,
  images_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month),
  constraint usage_counters_month_format check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint usage_counters_normal_range check (normal_posts_count between 0 and 200),
  constraint usage_counters_url_range check (url_posts_count between 0 and 20),
  constraint usage_counters_generations_range check (generations_count between 0 and 100),
  constraint usage_counters_images_range check (images_count between 0 and 20)
);
create trigger usage_counters_set_updated_at before update on usage_counters
  for each row execute function set_updated_at();

-- ── §3.15 notifications（操作系: user_id cascade） ────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  type notification_type not null,
  dedupe_key text,
  title text not null,
  body text not null,
  link text,
  payload jsonb not null default '{}',
  in_app_enabled boolean not null,
  email_status email_delivery_status not null default 'not_requested',
  email_attempts integer not null default 0,
  email_available_at timestamptz,
  email_last_attempt_at timestamptz,
  email_provider_id text,
  email_sent_at timestamptz,
  email_error text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_email_attempts_nonneg check (email_attempts >= 0),
  constraint notifications_queued_needs_available check (
    email_status <> 'queued' or email_available_at is not null
  )
);
create unique index notifications_user_dedupe_unique
  on notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_read_created_idx
  on notifications (user_id, read_at, created_at desc);
create index notifications_email_status_available_idx
  on notifications (email_status, email_available_at);

-- ── §3.16 stripe_events（Webhook冪等性） ─────────────────────
create table stripe_events (
  event_id text primary key,
  type text not null,
  object_id text,
  event_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);
create index stripe_events_object_created_idx
  on stripe_events (object_id, event_created_at desc);

-- ── §3.17 external_api_usage_events（原価台帳・二次FKは set null） ──
create table external_api_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  x_account_id uuid references x_accounts (id) on delete set null,
  job_id uuid references generation_jobs (id) on delete set null,
  provider api_provider not null,
  operation text not null,
  request_id text,
  status text not null,
  http_status integer,
  error_code text,
  quantity integer not null default 1,
  usage jsonb not null default '{}',
  unit_cost_usd numeric(12, 6),
  estimated_cost_usd numeric(12, 6),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  constraint external_api_usage_operation_valid check (
    operation in (
      'text_generation', 'web_search', 'image_generation',
      'x_post_create', 'x_post_delete', 'x_post_read', 'x_user_read'
    )
  ),
  constraint external_api_usage_status_valid check (status in ('succeeded', 'failed')),
  constraint external_api_usage_quantity_positive check (quantity > 0),
  constraint external_api_usage_http_status_range check (
    http_status is null or http_status between 100 and 599
  ),
  constraint external_api_usage_unit_cost_nonneg check (
    unit_cost_usd is null or unit_cost_usd >= 0
  ),
  constraint external_api_usage_estimated_cost_nonneg check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  )
);
create index external_api_usage_user_occurred_idx
  on external_api_usage_events (user_id, occurred_at desc);
create index external_api_usage_provider_op_occurred_idx
  on external_api_usage_events (provider, operation, occurred_at desc);
create index external_api_usage_job_idx on external_api_usage_events (job_id);
