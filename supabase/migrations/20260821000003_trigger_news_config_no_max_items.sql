-- T-M8-187: 新規登録trigger既定のnews_configから廃止済みのmax_itemsを外す。
-- 本文は現行（20260820000003）の実体をそのまま写し、news_configの1キーだけを変更する
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
    -- 既定分野は**取得している3分野だけ**（T-M7-55・20260802000001）。旧6分野へ巻き戻さないこと。
    -- max_itemsはT-M8-187で廃止（表示件数の設定は存在しない）。
    '{"categories": ["ai", "investment", "sns"], "impact_filter": ["high", "mid"]}'::jsonb,
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
