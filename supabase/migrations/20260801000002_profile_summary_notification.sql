-- T-M7-29: 新規プロフィールの通知既定へ `summary`（日次サマリ）を追加する。
--
-- コード側の既定（`DEFAULT_NOTIFICATION_CONFIG`）とDBのトリガー既定が食い違うと、
-- 新規利用者だけサマリが届かない（読み出し側はフォールバックするので気付きにくい）。
-- 既存行にも同じ既定を足す（未設定キーは読み出し時にフォールバックするが、
-- 設定画面のトグルが初期状態で正しく見えるように揃える）。
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
    plan,
    subscription_status,
    ai_purpose_config,
    news_config,
    notification_config
  )
  values (
    new.id,
    new.email,
    'standard'::public.plan_type,
    'incomplete'::public.subscription_status,
    '{"text": null, "image": null}'::jsonb,
    '{"categories": ["ai", "web3", "investment", "business", "business_ops", "sns"], "impact_filter": ["high", "mid"], "max_items": 20}'::jsonb,
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- 既存行: `summary` キーが無いものだけへ既定を足す（利用者が変えた他の設定は触らない）。
update public.profiles
   set notification_config = notification_config
       || '{"summary": {"in_app": true, "email": true}}'::jsonb
 where notification_config ? 'news'
   and not (notification_config ? 'summary');
