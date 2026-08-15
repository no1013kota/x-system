-- T-M8-94: 投稿分析の自動化（毎朝8:00 JST）に伴い、Xタイムラインの投稿を保存する。
-- 取得は増分（保存済みの最新投稿から48時間の重なりを持って再取得＝直近のメトリクスを追い直す）、
-- 分析は保存済みの全投稿（新しい順に上限件数）を対象にする（要件04 §12・要件02 §3.20）。

create table x_timeline_posts (
  id uuid primary key default gen_random_uuid(),
  x_account_id uuid not null references x_accounts (id) on delete cascade,
  -- Xのpost ID。増分取得の基準（このアカウントで最新の posted_at）と重複排除に使う。
  tweet_id text not null,
  -- 本文（先頭500字まで。分析には先頭200字を渡す）。
  text text not null,
  posted_at timestamptz,
  -- non_public_metrics は自分の投稿のみ・直近30日のみ提供されるため null を許す（0と区別する）。
  impressions bigint,
  likes integer,
  reposts integer,
  replies integer,
  has_image boolean not null default false,
  has_url boolean not null default false,
  -- 本サービス経由の投稿の型/テーマ（drafts.tweet_ids と突合して取得時に付与）。外部投稿は null。
  pattern text,
  theme text,
  fetched_at timestamptz not null default now(),
  -- メトリクスを最後に更新した時刻（48時間の重なり再取得で更新される）。
  metrics_updated_at timestamptz not null default now(),
  unique (x_account_id, tweet_id)
);

create index x_timeline_posts_account_posted_idx
  on x_timeline_posts (x_account_id, posted_at desc);

alter table x_timeline_posts enable row level security;

-- 所有者は参照のみ。書き込みは Server（service_role）だけが行う（要件02 §5 の方針に合わせる）。
create policy x_timeline_posts_select_own on x_timeline_posts
  for select using (
    exists (
      select 1 from x_accounts xa
       where xa.id = x_timeline_posts.x_account_id and xa.user_id = auth.uid()
    )
  );

grant select on x_timeline_posts to authenticated;
grant select, insert, update, delete on x_timeline_posts to service_role;

-- ── 未使用カラムの削除（T-M8-94のDB監査で確定した2つだけ） ──
-- stripe_events.processed_at: コードから一切参照されない（insert列にも含まれずDB defaultのみ）。
-- schedule_slots.last_run_at: 書き込み専用で読む箇所が無い。enqueueの冪等化は
--   generation_jobs.schedule_run_key の unique が担っており、この列は役割を持っていなかった。
-- 台帳系の「書き込みのみ」列（external_api_usage_events の明細・stripe_events の type等・
-- news_fetch_outcomes.provider_raw_error）は運営者がDBで直接読む監査記録のため**残す**。
alter table stripe_events drop column processed_at;
alter table schedule_slots drop column last_run_at;
