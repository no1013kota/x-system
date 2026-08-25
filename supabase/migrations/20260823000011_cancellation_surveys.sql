-- 解約理由のアンケート（T-M8-277・運営者の指示 2026-08-23）。
--
-- 解約は「押したら終わり」ではなく、(1) 何を失うかを確認してもらい、(2) 理由を任意で聞く。
-- 理由が分からないと、運営者は**何を直せば解約が減るのか**を判断できない（原則4の隣にある問題）。
-- Stripe の解約画面にも理由の選択はあるが、**アプリ側で聞いた内容は自分たちのDBに残る**ので、
-- 運営者が画面・SQLで読める（Stripeのダッシュボードを見に行かなくてよい）。
create table cancellation_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  -- 選択式の理由（1つ）。値はアプリ側の定数（cancellation-reasons.ts）と対応する。
  reason text not null,
  -- 自由記述（任意・最大1000文字）。空文字は入れず null にする。
  detail text check (detail is null or char_length(detail) <= 1000),
  -- 解約手続きへ進んだか（確認画面で「やめる」を選んだ場合は false のまま残す）。
  proceeded boolean not null default false,
  -- 回答時点のプラン（後から profiles が変わっても、当時の内訳が分かるように残す）。
  plan plan_type,
  created_at timestamptz not null default now()
);

create index cancellation_surveys_created_at_idx on cancellation_surveys (created_at);
create index cancellation_surveys_user_idx on cancellation_surveys (user_id);

-- RLS: 本人のinsertのみ許す（読むのは運営者＝service role）。
alter table cancellation_surveys enable row level security;

create policy cancellation_surveys_insert_own on cancellation_surveys
  for insert to authenticated
  with check (auth.uid() = user_id);
