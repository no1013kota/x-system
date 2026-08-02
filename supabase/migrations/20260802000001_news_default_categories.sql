-- T-M7-55: 新規プロフィールのニュース分野の既定を、**実際に取得している3分野**へ揃える。
--
-- 2026-08-02、ニュース取得を6分野×毎時12回から3分野（ai・investment・sns）×2時間おき6回へ
-- 縮小した（実測で月$518〜1,071かかり、1人運用の前提に見合わなかったため。PRD v1.5）。
--
-- トリガーの既定が6分野のままだと、**新規利用者は最初から「設定はあるのに記事が来ない」分野を
-- 選んだ状態**になる。画面上は正常に見えるため気付けない（CLAUDE.md 原則1）。
-- コード側の既定（`src/lib/config-defaults.ts`）と食い違わないよう同時に変える。
-- 食い違いは `src/lib/supabase/auth.local.test.ts` が検出する。
--
-- **既存行は触らない。** 利用者が明示的に選んだ設定を勝手に変えない。取得しない分野が選ばれて
-- いても、その分野の記事が増えないだけで壊れはしない（設定画面の選択肢は3分野へ絞ってある）。
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
    '{"categories": ["ai", "investment", "sns"], "impact_filter": ["high", "mid"], "max_items": 20}'::jsonb,
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
