-- 要件04 §6 / 要件01 §3.2・§6 / ADR-0003: 定時トリガーの「時間窓ごとに受付は高々一度」を
-- 保証する重複受付防止テーブル（window claim / dedup marker）。Supavisor transaction mode
-- プーラではセッションscopeの pg_try_advisory_lock が接続checkout間で保持されず、ハンドラ全体を
-- またぐロックが成立しない。代わりに (job_name, window_key) の unique 制約を持つ行を通常
-- transaction 内で `insert ... on conflict do nothing` し、行を確保できた起動だけが本処理へ進む。
-- 完了後の再試行（launchd の HTTP 再試行・Vercel Cron の重複起動）が来ても同一窓は再受付しない。
--
-- 責務は「同一 job_name/window_key の重複受付防止」のみ。本処理の成否・完了は保持しない
-- （cron_runs だけで本体成功と判断してはならない）。完了状態の正本は、永続ジョブは
-- `generation_jobs.status` / `generation_jobs.finished_at`、状態ベースcron（scheduler_tick /
-- metrics_collector / follower_snapshot）は対象業務データの現在状態とする（ADR-0003）。
-- service role 専用（cron/worker のみが読み書き）。authenticated へは RLS ポリシー・GRANT を付けない。
create table cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  window_key text not null,
  claimed_at timestamptz not null default now(),
  constraint cron_runs_job_window_unique unique (job_name, window_key)
);
-- 保持cleanup（scheduler_tick, M4）用に受付時刻でひける index。
create index cron_runs_claimed_at_idx on cron_runs (claimed_at);

-- RLS: service role 専用（stripe_events / external_api_usage_events と同方針、§5「不可」）。
-- authenticated への select ポリシー・GRANT は作らない。
alter table cron_runs enable row level security;
