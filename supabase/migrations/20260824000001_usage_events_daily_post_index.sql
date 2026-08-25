-- 当日投稿数の集計を全表走査から索引走査へ（T-M8-287）。
--
-- `countTodaysPostsForXAccount` は **/app の全描画**（App Shellの日次上限バナー）と
-- 予約枠のenqueue・投稿実行の3経路から呼ばれるが、使える索引が無く `usage_events` を
-- 全走査していた。コードには「日次上限と40日の保持期間で数千行に収まる」と書かれていたが、
-- **`usage_events` に保持期間は無い**（cleanupが消すのは external_api_usage_events で、
-- usage_events は原価・利用枠の台帳として永続する）。利用者数に比例して伸びる表を
-- 毎描画で全走査していたことになる。
--
-- `operation = 'post_create'` の部分索引にして小さく保つ（台帳全体の一部だけが対象）。
-- 述語側も範囲比較へ直すこと（`(created_at at time zone …)::date = …` は索引が効かない）。
create index if not exists usage_events_account_post_created_idx
  on usage_events (x_account_id, created_at desc)
  where operation = 'post_create';
