-- 下書き・履歴一覧の並び順に合う索引（T-M8-289）。
--
-- 一覧は `where x_account_id = $1 and status = any($2)
--        order by coalesce(posted_at, updated_at) desc, created_at desc`。
-- 既存の `(x_account_id, status, created_at desc)` と `(x_account_id, posted_at desc)` は
-- どちらもこの **式** の並びに一致しないため、アカウントの全行を読んでから並べ直していた。
-- 履歴タブは limit 50 を付けているが、並べ直しのために結局全件を読む形になっていて、
-- 投稿が増えた利用者ほど画面が遅くなる。
--
-- 実測（200,000行のベンチ表・履歴タブ相当）: プランコスト 3641 → 29.7、Sort が消える。
-- status は `= any($2)` でパラメータ渡しのため部分索引では計画時に絞り込めない。
-- そこで**式そのもの**を索引に載せ、status は絞り込み条件として残す。
create index if not exists drafts_account_list_order_idx
  on drafts (x_account_id, (coalesce(posted_at, updated_at)) desc, created_at desc);
