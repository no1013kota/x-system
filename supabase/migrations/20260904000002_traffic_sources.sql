-- T-M8-423: 流入元（`?src=<slug>`）を辿る（運営者の依頼 2026-09-04）。
--
-- 運営者が /admin で流入元を登録すると追跡URL `https://exosai.net/?src=<slug>` が発行され、
-- そのURLから来た閲覧（page_views.source）と登録（profiles.signup_source）を流入元ごとに数える。
-- Cookie は足さない（要件02 §3.32 の設計を守る）。LP→/signup を直接進んだ人だけが登録に紐づく。

-- 1) 流入元の台帳（運営者だけが書く。service_role のみ）
create table traffic_sources (
  slug text primary key
    constraint traffic_sources_slug_format check (slug ~ '^[a-z0-9_-]{1,32}$'),
  label text not null
    constraint traffic_sources_label_length check (char_length(label) between 1 and 60),
  created_at timestamptz not null default now()
);
alter table traffic_sources enable row level security;
revoke all on traffic_sources from anon, authenticated;
grant all on traffic_sources to service_role;

-- 2) 閲覧記録に流入元。既定 ''（直接・不明）。主キーに source を足す（同じ人が別の流入元から来たら別行）。
alter table page_views
  add column source text not null default ''
    constraint page_views_source_format check (source ~ '^[a-z0-9_-]{0,32}$');
alter table page_views drop constraint page_views_pkey;
alter table page_views add primary key (view_date, path, visitor_hash, source);

-- 3) 登録時の流入元（/signup の hidden で受け取り、登録直後に1回だけ書く。空文字＝直接・不明）。
alter table profiles
  add column signup_source text not null default ''
    constraint profiles_signup_source_format check (signup_source ~ '^[a-z0-9_-]{0,32}$');
create index profiles_signup_source_idx on profiles (signup_source) where signup_source <> '';
