-- クレジット制（T-M8-108）: 上位モデルはコスト比の倍数クレジットを消費するため、
-- usage_events.delta を ±1 固定から可変量へ緩和する。0は不変（意味を持たない行を作らない）。
-- 上限10はカタログ最大倍数（現在5）の余裕。カタログの倍数を10超にするときはここも見直す。
alter table usage_events drop constraint usage_events_delta_range;
alter table usage_events
  add constraint usage_events_delta_range check (delta between -10 and 10 and delta <> 0);
alter table usage_events drop constraint usage_events_reason_delta;
alter table usage_events
  add constraint usage_events_reason_delta check (
    (reason in ('reserve', 'consume') and delta >= 1)
    or (reason = 'refund' and delta <= -1)
  );
