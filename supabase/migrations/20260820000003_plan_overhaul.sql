-- T-M8-168: プラン再編（運営者の指示 2026-08-20）。
--
-- 旧: standard(¥500・BYOK・1アカウント・md編集不可) / md(¥1,000) / premium(¥2,980)
-- 新: standard(¥1,480・旧mdと同内容) / premium(¥3,980・内容据え置き) / expert(¥14,800・新設)
--
-- 旧standard(¥500)は撤廃。本番の既存行は5件・すべて未契約（standard + incomplete）を
-- 実測確認済み（2026-08-20・Management API）。契約中の行は存在しない。
--
-- 値の対応: 旧md → 新standard（内容が同一） / premium → premium / 旧standard → NULL（未契約へ）。
--
-- あわせて profiles.plan を nullable にし、**「未契約」を NULL で表す**。以前は
-- not null default 'standard' で「契約していない」と「standardを契約している」が同じ値だった
-- （access判定は subscription_status 側が担っていた）。standardの意味が変わるため、
-- 未契約をプラン値で表現する形をやめる。route-guard の `!profile?.plan` 判定は元から
-- NULL を想定している（src/lib/auth/route-guard.ts）。

do $$
declare
  n_std bigint; n_md bigint; n_prem bigint; n_active_std bigint;
begin
  select count(*) filter (where plan = 'standard'),
         count(*) filter (where plan = 'md'),
         count(*) filter (where plan = 'premium'),
         count(*) filter (where plan = 'standard'
                            and subscription_status in ('trialing', 'active'))
    into n_std, n_md, n_prem, n_active_std
    from public.profiles;
  raise notice 'plan overhaul before: standard=% md=% premium=%', n_std, n_md, n_prem;
  -- 旧standard(¥500)は「全員未契約」を前提に NULL へ落とす。実測確認（2026-08-20）と
  -- 適用の間に旧standardの契約が成立していたら、支払い中なのに未契約扱いになる
  -- （route-guardが/plansへ送り続け、再購入すれば二重契約）。前提が崩れていたら止まる。
  if n_active_std > 0 then
    raise exception 'plan overhaul aborted: % contracted old-standard profile(s) exist. '
      'Migrate them manually (refund or move to a new plan) before applying.', n_active_std;
  end if;
end $$;

alter table public.profiles alter column plan drop default;
alter table public.profiles alter column plan drop not null;

create type public.plan_type_new as enum ('standard', 'premium', 'expert');

alter table public.profiles
  alter column plan type public.plan_type_new
  using ((case plan::text
            when 'md' then 'standard'
            when 'premium' then 'premium'
            else null
          end)::public.plan_type_new);

drop type public.plan_type;
alter type public.plan_type_new rename to plan_type;

-- 新規登録時は plan を持たない（未契約 = NULL）。checkout 完了時に subscription-sync が設定する。
-- トリガーは決定的・外部呼び出しなしを維持する（失敗すると signup 自体が止まるため）。
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    subscription_status,
    ai_purpose_config,
    news_config,
    notification_config
  )
  values (
    new.id,
    new.email,
    'incomplete'::public.subscription_status,
    '{"text": null, "image": null}'::jsonb,
    -- 既定分野は**取得している3分野だけ**（T-M7-55・20260802000001）。旧6分野へ巻き戻さないこと。
    '{"categories": ["ai", "investment", "sns"], "impact_filter": ["high", "mid"], "max_items": 20}'::jsonb,
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

do $$
declare
  n_std bigint; n_prem bigint; n_inf bigint; n_null bigint;
begin
  select count(*) filter (where plan = 'standard'),
         count(*) filter (where plan = 'premium'),
         count(*) filter (where plan = 'expert'),
         count(*) filter (where plan is null)
    into n_std, n_prem, n_inf, n_null
    from public.profiles;
  raise notice 'plan overhaul after: standard=% premium=% expert=% null=%', n_std, n_prem, n_inf, n_null;
end $$;
