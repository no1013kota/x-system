-- 要件02 §5: 全17テーブルのRLS。§3.3: active_x_account_id 所有者検証trigger。
--
-- 方針: 全テーブルでRLSを有効化し、authenticated ロールには §5 の select ルールだけを
-- ポリシーで許可する。insert/update/delete ポリシーは authenticated へ一切作らないため、
-- ブラウザからの直接書き込みは全テーブルで拒否される（RLSは該当コマンドの許可ポリシーが
-- 無ければ拒否）。サーバー側の書き込み（Server Action / cron / webhook）は service_role
-- （BYPASSRLS）で行う。§1「認証済みクライアントには原則selectだけを許可」に対応。

-- x_account 所有判定（security definer で x_accounts のRLSに影響されず判定）
create or replace function auth_owns_x_account(target uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from x_accounts
    where id = target and user_id = (select auth.uid())
  );
$$;

-- ── RLS有効化 ───────────────────────────────────────────────
alter table profiles enable row level security;
alter table user_api_keys enable row level security;
alter table x_accounts enable row level security;
alter table base_md_versions enable row level security;
alter table prompt_templates enable row level security;
alter table learning_sources enable row level security;
alter table news_items enable row level security;
alter table generation_jobs enable row level security;
alter table drafts enable row level security;
alter table schedule_slots enable row level security;
alter table follower_snapshots enable row level security;
alter table improvement_suggestions enable row level security;
alter table usage_events enable row level security;
alter table usage_counters enable row level security;
alter table notifications enable row level security;
alter table stripe_events enable row level security;
alter table external_api_usage_events enable row level security;

-- ── select ポリシー（authenticated のみ） ────────────────────
create policy profiles_select_own on profiles
  for select to authenticated using (id = (select auth.uid()));

create policy user_api_keys_select_own on user_api_keys
  for select to authenticated using (user_id = (select auth.uid()));

create policy x_accounts_select_own on x_accounts
  for select to authenticated using (user_id = (select auth.uid()));

create policy base_md_versions_select_own on base_md_versions
  for select to authenticated using (auth_owns_x_account(x_account_id));

-- system default（x_account_id is null）は認証ユーザー全員が閲覧可、account別は所有者のみ
create policy prompt_templates_select on prompt_templates
  for select to authenticated
  using (x_account_id is null or auth_owns_x_account(x_account_id));

create policy learning_sources_select_own on learning_sources
  for select to authenticated using (auth_owns_x_account(x_account_id));

-- news_items は認証済み全員
create policy news_items_select_all on news_items
  for select to authenticated using (true);

create policy generation_jobs_select_own on generation_jobs
  for select to authenticated using (auth_owns_x_account(x_account_id));

create policy drafts_select_own on drafts
  for select to authenticated using (auth_owns_x_account(x_account_id));

create policy schedule_slots_select_own on schedule_slots
  for select to authenticated using (auth_owns_x_account(x_account_id));

create policy follower_snapshots_select_own on follower_snapshots
  for select to authenticated using (auth_owns_x_account(x_account_id));

create policy improvement_suggestions_select_own on improvement_suggestions
  for select to authenticated using (auth_owns_x_account(x_account_id));

create policy usage_events_select_own on usage_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy usage_counters_select_own on usage_counters
  for select to authenticated using (user_id = (select auth.uid()));

create policy notifications_select_own on notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- stripe_events / external_api_usage_events は authenticated へ select ポリシーを作らない
-- （§5「不可」）。service_role のみアクセス可。

-- ── テーブルレベルGRANT ─────────────────────────────────────
-- RLSポリシーはテーブルレベルのGRANTがあって初めて評価される。authenticated には
-- 読み取り可テーブルの SELECT のみ付与し（行の絞り込みは上記ポリシー）、insert/update/
-- delete は付与しない（ブラウザからの直接書き込みを防ぐ）。stripe_events /
-- external_api_usage_events は付与せず service_role 専用とする（§5「不可」）。
grant usage on schema public to authenticated;
grant select on
  profiles,
  user_api_keys,
  x_accounts,
  base_md_versions,
  prompt_templates,
  learning_sources,
  news_items,
  generation_jobs,
  drafts,
  schedule_slots,
  follower_snapshots,
  improvement_suggestions,
  usage_events,
  usage_counters,
  notifications
to authenticated;

-- ── §3.3 active_x_account_id 所有者検証 trigger ──────────────
create or replace function enforce_active_x_account_owner()
returns trigger
language plpgsql
as $$
begin
  if new.active_x_account_id is not null then
    if not exists (
      select 1 from x_accounts
      where id = new.active_x_account_id and user_id = new.id
    ) then
      raise exception 'active_x_account_id must reference an x_account owned by this profile';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_enforce_active_x_account_owner
  before insert or update of active_x_account_id on profiles
  for each row execute function enforce_active_x_account_owner();
