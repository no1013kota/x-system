-- T-M8-222: 利用者向けメール通知を廃止（運営者の指示 2026-08-22）。通知はアプリ内のみ。
-- 認証メール（Supabase Auth）と運営者向けopsアラートメールは別系統のため対象外。
--
-- (1) 保存済み notification_config から email キーを剥がす（in_app の値は変えない）。
--     コード側schemaは .strip() で旧キーを落とすが、DBにも残さない（使われない値を残さない・原則）。
update profiles
   set notification_config = (
     select coalesce(
       jsonb_object_agg(key, value - 'email'),
       '{}'::jsonb
     )
       from jsonb_each(notification_config)
   )
 where notification_config::text like '%"email"%';

-- (2) notifications からメール配送台帳の列・index・制約を削除する。
drop index if exists notifications_email_status_available_idx;
alter table notifications
  drop constraint if exists notifications_email_attempts_nonneg,
  drop constraint if exists notifications_queued_needs_available,
  drop column if exists email_status,
  drop column if exists email_attempts,
  drop column if exists email_available_at,
  drop column if exists email_last_attempt_at,
  drop column if exists email_provider_id,
  drop column if exists email_sent_at,
  drop column if exists email_error;

drop type if exists email_delivery_status;

-- (3) 新規登録trigger既定を「アプリ内のみ・全ON」へ。
--     本文は現行（20260822000004）の実体をそのまま写し、notification_configの1行だけを変更する
--     （写し漏れでT-M7-55型の巻き戻しを起こさないため、変更点はこの1行のみ）。
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
    -- メール通知は廃止（T-M8-222）。アプリ内のみ・全種別ON。
    '{"news": {"in_app": true}, "draft_created": {"in_app": true}, "posted": {"in_app": true}, "error": {"in_app": true}, "billing": {"in_app": true}, "usage": {"in_app": true}, "summary": {"in_app": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
