-- ニュース取得をAIリサーチ（Message Batches）からRSS巡回へ置き換え（T-M8-380・
-- 運営者の指示 2026-08-30「既存のAIリサーチはもう不要」）。
-- news_batches は「Batchを投げた」と「取り込んだ」の間の状態を持つ表で、
-- Batch自体を廃止したため状態も不要になる。結果の記録（news_fetch_outcomes）と
-- 記事（news_items）はそのまま使い続ける。
drop table if exists news_batches;
