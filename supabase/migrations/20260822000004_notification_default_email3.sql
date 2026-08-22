-- T-M8-206: 新規登録の通知既定を変更（運営者の指示 2026-08-22）。
-- アプリ内=全ON、メール=ニュース・投稿完了・毎日のまとめのみON（下書き・エラー・課金・利用枠はOFF）。
-- 既存利用者の保存値は変更しない。
-- 本文は現行（20260822000001）の実体をそのまま写し、notification_configの1行だけを変更する
-- （写し漏れでT-M7-55型の巻き戻しを起こさないため、変更点はこの1行のみ）。
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
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": false}, "posted": {"in_app": true, "email": true}, "error": {"in_app": true, "email": false}, "billing": {"in_app": true, "email": false}, "usage": {"in_app": true, "email": false}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
