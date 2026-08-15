-- X読取の0リソース応答（例: 直近30日に投稿が無いアカウントの毎朝の自動読取）を
-- quantity=0 / $0 で正直に記録できるようにする（T-M8-94のフォロー）。
-- X APIは応答リソース数課金のため、0件応答に費用は発生しない。
-- 従来は quantity>0 制約に合わせて最低1件分（$0.005/日）を過大計上していた。
alter table external_api_usage_events
  drop constraint external_api_usage_quantity_positive;
alter table external_api_usage_events
  add constraint external_api_usage_quantity_nonnegative check (quantity >= 0);
