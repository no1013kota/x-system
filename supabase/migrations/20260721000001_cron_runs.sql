-- 要件04 §6 / 要件01 §3.2・§6 / ADR-0003: 定時トリガーの「時間窓ごとに一度だけ実行」を
-- 保証する lease テーブル。Supavisor transaction mode プーラではセッションscopeの
-- pg_try_advisory_lock が接続checkout間で保持されず、ハンドラ全体をまたぐロックが成立しない。
-- 代わりに (job_name, window_key) の unique 制約を持つ行を通常 transaction 内で
-- `insert ... on conflict do nothing` し、行を確保できた起動だけが本処理を実行する。
-- 完了後の再試行（launchd の HTTP 再試行・Vercel Cron の重複起動）が来ても同一窓は再実行しない。
-- service role 専用（cron/worker のみが読み書き）。authenticated へは RLS ポリシー・GRANT を付けない。
create table cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  window_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint cron_runs_job_window_unique unique (job_name, window_key)
);
-- 保持・cleanup（scheduler_tick, M4）用に取得時刻でひける index。
create index cron_runs_started_at_idx on cron_runs (started_at);

-- RLS: service role 専用（stripe_events / external_api_usage_events と同方針、§5「不可」）。
-- authenticated への select ポリシー・GRANT は作らない。
alter table cron_runs enable row level security;
