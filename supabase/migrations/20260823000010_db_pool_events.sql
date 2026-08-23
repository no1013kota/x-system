-- DB接続プールの混み具合の観測（T-M8-198・要件01 §9 の移行条件を実際に見えるようにする）。
--
-- `poolStats()` は実装済みだったが**どこからも読まれておらず**、要件01 §9 の
-- 「pooler接続の枯渇・待ち行列が観測された」を判断する材料が無かった（原則1・原則4）。
-- 接続の取得が待たされたときだけ1行入れ、doctor が直近24時間を見て運営者へ知らせる。
--
-- **入れるのは待たされたときだけ**（正常時は0行）。プロセスごとに間引くのでアプリ側の
-- 書き込み負荷は無視できる。保持は cleanup（40日）に合わせる。
create table db_pool_events (
  id uuid primary key default gen_random_uuid(),
  -- 取得までに待った時間。閾値を超えたときだけ記録する。
  waited_ms integer not null check (waited_ms >= 0),
  -- 記録時点のプールの状態（pg の totalCount / idleCount / waitingCount）。
  total_count integer not null check (total_count >= 0),
  idle_count integer not null check (idle_count >= 0),
  waiting_count integer not null check (waiting_count >= 0),
  -- どこで待たされたか（"query" / "transaction"）。原因追跡用。
  source text not null,
  occurred_at timestamptz not null default now()
);

create index db_pool_events_occurred_at_idx on db_pool_events (occurred_at);

-- RLS: service role 専用（cron_runs / external_api_usage_events と同方針）。
alter table db_pool_events enable row level security;
