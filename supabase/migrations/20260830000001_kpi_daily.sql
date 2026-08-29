-- 事業KPIの日次スナップショット（T-M8-373・運営者の指示 2026-08-29）。
--
-- なぜ要るか: 元データの多くは消える（原価台帳400日・generation_jobs 90日）か、
-- 現在の状態しか持たない（profiles.plan は変わると前の値が消える）。
-- 「その日いくつだったか」を日次で書き出しておかないと、後から推移を描けない。
--
-- 形は (日付, 指標名, 内訳, 値) のロング形式。列を足さずに指標を増やせる。
-- 書くのは scheduler_tick（1日1回・冪等upsert）だけ、読むのは /admin だけ。
create table kpi_daily (
  metric_date date not null,
  metric text not null,
  -- 内訳キー（provider名・プラン名など）。内訳が無い指標は '' を入れる。
  -- null にすると primary key に使えない（nullは重複可能）ため空文字を既定にする。
  dimension text not null default '',
  value numeric(14, 4) not null,
  updated_at timestamptz not null default now(),
  primary key (metric_date, metric, dimension)
);

-- 運営だけが見る表（利用者の画面には出ない）。`authenticated` へは grant しない（T-M8-252）。
alter table kpi_daily enable row level security;
revoke all on kpi_daily from anon, authenticated;
grant all on kpi_daily to service_role;
