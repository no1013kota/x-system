-- 要件02 §3.1〜3.7: コア7テーブル。共通ルール（§1）: uuid PK・created_at/updated_at・
-- updated_at自動更新trigger。RLSの有効化とポリシーは後続マイグレーション（T-M0-06）で行う。

-- 共通: updated_at 自動更新トリガ関数
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── §3.1 profiles ────────────────────────────────────────────
-- active_x_account_id への FK は x_accounts 作成後に ALTER で付与する（循環参照）。
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  plan plan_type not null default 'standard',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status subscription_status not null default 'incomplete',
  subscription_event_created_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  trial_used_at timestamptz,
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_version text,
  privacy_acknowledged_at timestamptz,
  active_x_account_id uuid,
  ai_purpose_config jsonb not null default '{}',
  news_config jsonb not null default '{}',
  notification_config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_active_x_account_id_idx on profiles (active_x_account_id);
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();

-- ── §3.2 user_api_keys ───────────────────────────────────────
create table user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  provider api_provider not null,
  credentials_ciphertext text not null,
  display_hint jsonb not null default '{}',
  status api_key_status not null default 'unchecked',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create trigger user_api_keys_set_updated_at before update on user_api_keys
  for each row execute function set_updated_at();

-- ── §3.3 x_accounts ──────────────────────────────────────────
create table x_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  x_user_id text not null,
  handle text not null,
  name text not null,
  profile_image_url text,
  auth_type x_auth_type not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  oauth_scopes text[] not null default '{}',
  automation_consent_version text,
  automation_consented_at timestamptz,
  automation_disabled_at timestamptz,
  token_expires_at timestamptz,
  token_refresh_locked_at timestamptz,
  token_refresh_lock_id uuid,
  status x_account_status not null default 'active',
  settings jsonb not null default '{}',
  base_md text not null default '',
  base_md_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x_accounts_user_x_user_unique unique (user_id, x_user_id),
  constraint x_accounts_base_md_version_nonneg check (base_md_version >= 0),
  -- automation_consent_version と automation_consented_at は同時にnull/同時に非null
  constraint x_accounts_automation_consent_pair check (
    (automation_consent_version is null) = (automation_consented_at is null)
  )
);
create index x_accounts_user_status_idx on x_accounts (user_id, status);
create trigger x_accounts_set_updated_at before update on x_accounts
  for each row execute function set_updated_at();

-- profiles.active_x_account_id → x_accounts.id（循環FK。所有者一致はDB triggerで別途検証: T-M0-06）
alter table profiles
  add constraint profiles_active_x_account_fk
  foreign key (active_x_account_id) references x_accounts (id) on delete set null;

-- ── §3.4 base_md_versions（履歴: on delete restrict） ─────────
create table base_md_versions (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete restrict,
  version integer not null,
  content text not null,
  change_source text not null,
  summary text,
  created_at timestamptz not null default now(),
  constraint base_md_versions_x_account_version_unique unique (x_account_id, version),
  constraint base_md_versions_version_positive check (version > 0),
  constraint base_md_versions_change_source_valid check (
    change_source in ('settings', 'learning', 'manual', 'rollback')
  )
);

-- ── §3.5 prompt_templates ────────────────────────────────────
create table prompt_templates (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid references x_accounts (id) on delete cascade,
  kind text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_templates_kind_valid check (
    kind in ('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'image')
  )
);
-- account別上書きは (x_account_id, kind) で一意、システム既定は (kind) で一意
create unique index prompt_templates_account_kind_unique
  on prompt_templates (x_account_id, kind) where x_account_id is not null;
create unique index prompt_templates_system_kind_unique
  on prompt_templates (kind) where x_account_id is null;
create trigger prompt_templates_set_updated_at before update on prompt_templates
  for each row execute function set_updated_at();

-- ── §3.6 learning_sources ────────────────────────────────────
create table learning_sources (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  type learning_source_type not null,
  url text,
  status learning_source_status not null default 'pending',
  analysis_summary jsonb,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 同一URLの重複登録防止（url有り）。own_postsはXアカウントに1件のみ。
create unique index learning_sources_account_type_url_unique
  on learning_sources (x_account_id, type, url) where url is not null;
create unique index learning_sources_own_posts_unique
  on learning_sources (x_account_id) where type = 'own_posts';
create trigger learning_sources_set_updated_at before update on learning_sources
  for each row execute function set_updated_at();

-- ── §3.7 news_items（全ユーザー共通・source_urlで重複排除） ──
create table news_items (
  id uuid primary key default gen_random_uuid(),
  category news_category not null,
  title text not null,
  summary text not null,
  source_url text not null unique,
  impact impact_level not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);
create index news_items_category_impact_fetched_idx
  on news_items (category, impact, fetched_at desc);
