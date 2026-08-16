-- AIクレジット（T-M8-109）: 生成クレジット・画像クレジットを1本の「AIクレジット」へ統合し、
-- 回数制から金額制（1クレジット=1円相当・月1000）へ変える。
-- 消費は実費ベース: 開始時にモデル別見積もりをreserve→成功時に実費（推定原価×160円/ドル・
-- 切り上げ）で精算（差分をconsume/refundイベントで調整）→失敗時は全額返還。
alter type usage_counter_type add value if not exists 'ai_credit';

-- 旧回数カウンタは単位が違うため移行しない（本番のプレミアム実利用は運営者の検証のみ・2026-08-16）。
alter table usage_counters drop constraint usage_counters_generations_range;
alter table usage_counters drop constraint usage_counters_images_range;
alter table usage_counters drop column generations_count;
alter table usage_counters drop column images_count;
alter table usage_counters add column ai_credits_used integer not null default 0;
-- 上限はアプリ側で判定する（精算の追加消費は上限を超えても計上するため、DBでは非負のみ縛る）。
alter table usage_counters
  add constraint usage_counters_ai_credits_nonnegative check (ai_credits_used >= 0);

-- delta は円建てクレジット。1回の消費は最大でも数百円だが余裕を持たせる。
alter table usage_events drop constraint usage_events_delta_range;
alter table usage_events
  add constraint usage_events_delta_range check (delta between -100000 and 100000 and delta <> 0);
