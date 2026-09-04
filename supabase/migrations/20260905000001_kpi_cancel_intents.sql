-- T-M8-427（D-55(3)）: kpi_daily の指標 'cancellations' を 'cancel_intents' へ改名する。
--
-- 元の値は cancellation_surveys.proceeded=true の件数＝「解約手続きへ進んだ数」で、
-- 確認画面の後に引き止めクーポンで残った人も含む。実解約ではないのに名前がそう読めた
-- （2026-09-04 の監査）。書き手（src/lib/ops/kpi.ts）は同じ変更で新しい名前で書く。
--
-- 冪等: 2回目は改名対象が無く何もしない。コードのデプロイが migration より先に来て
-- 新名の行が既にある日（直近3日は毎回書き直す）は、**新しく書かれた方（updated_at が後）**を残す。
-- 同じキーが2つになると primary key に弾かれるため、単純な update ではなく insert … on conflict で寄せる。
insert into kpi_daily (metric_date, metric, dimension, value, updated_at)
select metric_date, 'cancel_intents', dimension, value, updated_at
  from kpi_daily
 where metric = 'cancellations'
on conflict (metric_date, metric, dimension) do update
   set value = excluded.value, updated_at = excluded.updated_at
 where kpi_daily.updated_at < excluded.updated_at;

delete from kpi_daily where metric = 'cancellations';
