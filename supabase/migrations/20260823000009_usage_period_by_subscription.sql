-- 利用枠のリセットを暦月から「契約の更新日ごと」へ（T-M8-258）。
--
-- 1) profiles.current_period_start: 契約期間の開始（Stripe subscription item の current_period_start）。
--    利用枠の期間キーはこの値の JST 日付（YYYY-MM-DD）。未同期（null）のあいだは従来どおり JST 暦月（YYYY-MM）。
-- 2) usage_events / usage_counters.month: 列名は据え置き、値を「期間キー」へ拡張する。
--    既存行（YYYY-MM）と新しい行（YYYY-MM-DD）は同じ表に共存し、移行バッチは要らない
--    （切替時点で各利用者の新しい期間キーの行が 0 から始まる＝利用者に不利にならない向き）。
--    冪等キー（job:/draft: 由来）は期間キーを含まないので再計上は起きない。

alter table profiles
  add column if not exists current_period_start timestamptz;

comment on column profiles.current_period_start is
  '契約期間の開始（Stripe）。利用枠の期間キー（JST日付）の元。null は未同期＝暦月で数える';

alter table usage_events
  drop constraint if exists usage_events_month_format,
  add constraint usage_events_month_format
    check (month ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$');

alter table usage_counters
  drop constraint if exists usage_counters_month_format,
  add constraint usage_counters_month_format
    check (month ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$');

comment on column usage_events.month is
  '利用枠の期間キー。契約期間の開始日（JST, YYYY-MM-DD）。未同期の利用者は JST 暦月（YYYY-MM）';
comment on column usage_counters.month is
  '利用枠の期間キー。契約期間の開始日（JST, YYYY-MM-DD）。未同期の利用者は JST 暦月（YYYY-MM）';
