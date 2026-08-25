-- 期間キーの世代（`#N`）を month の形式検査へ通す（T-M8-306）。
--
-- T-M8-299 で `usage_epoch` を足し、期間キーを `YYYY-MM-DD#1` の形にした。ところが
-- `usage_events` / `usage_counters` の `month` は `^\d{4}-\d{2}(-\d{2})?$` のままで、
-- **世代が付いた瞬間に書き込みが check 制約で落ちる**。つまりトライアル中に下位プランへ
-- 切り替えた利用者は、その後の生成・投稿で利用枠を記録できず**何もできなくなる**。
--
-- 世代を進めた後に利用枠を書くテストが1本も無かったため、この経路は誰にも踏まれずに通っていた
-- （2026-08-25、実DBで再現して発見）。形式検査は「読める形であること」を守るのが目的なので、
-- 世代の接尾辞を明示的に許す（何でも通す形にはしない）。
alter table usage_events
  drop constraint if exists usage_events_month_format,
  add constraint usage_events_month_format
    check (month ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(#[0-9]+)?$');

alter table usage_counters
  drop constraint if exists usage_counters_month_format,
  add constraint usage_counters_month_format
    check (month ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(#[0-9]+)?$');

comment on column usage_counters.month is
  '利用枠の期間キー。契約期間の開始（JST日付）＋リセットの世代（`#N`・T-M8-299）。null期間は暦月。';
