-- T-M8-189: ニュース・発信テーマを6分野（AI・Web3・SNS・投資・恋愛・美容）へ（運営者の指示 2026-08-22）。
-- 旧分野 business / business_ops は運用終了（enum値と保存データは残す——旧値を持つ
-- schedule_slots・persona設定・news_items の表示と検証を壊さないため。選択肢からは外れる）。

alter type news_category add value if not exists 'love';
alter type news_category add value if not exists 'beauty';

-- 投稿テーマの許容値へ love / beauty を追加（旧値は既存データのため残す）。
alter table schedule_slots
  drop constraint schedule_slots_theme_valid;

alter table schedule_slots
  add constraint schedule_slots_theme_valid
  check (
    theme = any (array['ai', 'web3', 'investment', 'business', 'business_ops', 'sns', 'love', 'beauty', 'other'])
  );

comment on column schedule_slots.theme is
  '分野（発信テーマ）。必須。値は src/lib/post/post-theme.ts の POST_THEME_IDS（運用6テーマ＋旧2テーマ＋other）。other は追加指示に分野を書く意思表示で、プロンプトへは分野を出さない。';

-- 新規登録の既定 news_config.categories を運用6分野へ（既定＝取得している分野・T-M7-55の原則）。
-- 本文は現行（20260821000003）の実体をそのまま写し、categoriesの1行だけを変更する
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
    '{"news": {"in_app": true, "email": true}, "draft_created": {"in_app": true, "email": true}, "posted": {"in_app": true, "email": false}, "error": {"in_app": true, "email": true}, "billing": {"in_app": true, "email": true}, "usage": {"in_app": true, "email": true}, "summary": {"in_app": true, "email": true}}'::jsonb
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
