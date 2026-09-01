-- T-M8-407: ニュース通知をメールでも受け取れるようにする（運営者の指示 2026-09-01）。
-- 新規登録trigger既定の notification_config.news に "email": false を足す（既定OFF・opt-in）。
-- 本文は現行（20260823000002）の実体をそのまま写し、notification_configの1行だけを変更する
-- （写し漏れでT-M7-55型の巻き戻しを起こさないため、変更点はこの1行のみ）。
-- 既存利用者の保存値は触らない（email キーが無い値はコード側が OFF として読む）。
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
    -- 既定分野は**取得している分野だけ**（T-M7-55）。T-M8-189で6分野運用へ。
    '{"categories": ["ai", "web3", "sns", "investment", "love", "beauty"], "impact_filter": ["high", "mid"]}'::jsonb,
    -- アプリ内は全種別ON。ニュースだけメールも選べる（既定OFF・T-M8-407）。他の種別のメールはT-M8-222で廃止。
    '{"news": {"in_app": true, "email": false}, "draft_created": {"in_app": true}, "posted": {"in_app": true}, "error": {"in_app": true}, "billing": {"in_app": true}, "usage": {"in_app": true}, "summary": {"in_app": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
