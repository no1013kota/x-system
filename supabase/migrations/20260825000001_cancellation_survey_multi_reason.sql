-- 解約理由を複数選べるようにする（T-M8-294・運営者の指示 2026-08-25）。
--
-- 解約の理由は1つに絞れないことが多い（「料金が高い」かつ「あまり使わなかった」など）。
-- 1つしか選べないと、運営者が見る集計は**回答者が仕方なく選んだ1つ**に寄り、
-- 何を直せば解約が減るのかの判断を誤らせる。
--
-- `reason text` を `reasons text[]` へ移す。既存の回答は1要素の配列として残す
-- （消さない——少数でも実際の回答で、集計の連続性が切れると比較できなくなる）。
alter table cancellation_surveys add column reasons text[];

update cancellation_surveys set reasons = array[reason] where reasons is null;

alter table cancellation_surveys
  alter column reasons set not null,
  add constraint cancellation_surveys_reasons_not_empty
    check (array_length(reasons, 1) >= 1),
  -- 選択肢は8つなので、それ以上入るのは実装かデータの異常。
  add constraint cancellation_surveys_reasons_max
    check (array_length(reasons, 1) <= 8);

alter table cancellation_surveys drop column reason;

-- 集計は `unnest(reasons)` で数える。理由での絞り込みに効かせる。
create index cancellation_surveys_reasons_idx on cancellation_surveys using gin (reasons);
