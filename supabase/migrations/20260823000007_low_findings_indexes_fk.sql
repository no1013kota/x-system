-- T-M8-253: 監査（2026-08-23）で見つかった索引と参照整合性の抜け。

-- (1) 通知一覧の並び（user_id, created_at desc, id desc）に合う索引が無く、
--     1ページ目を開くたびにその利用者の全通知を読んでいた（既存の read_at 索引は未読件数用に残す）。
create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc, id desc);

-- (2) 確認期間を過ぎた報酬を payable へ上げる日次処理（settleMatureCommissions）が
--     affiliate_commissions を毎日全表走査していた。対象は pending だけなので部分索引にする。
create index if not exists affiliate_commissions_pending_idx
  on affiliate_commissions (available_at)
  where status = 'pending';

-- (3) affiliate_commissions.referred_user_id に外部キーも索引も無く、
--     報酬率の計算（累計有料招待ユーザー数）が**実在しない利用者を数えうる**状態だった。
--     履歴は残したいので `on delete set null`（誰の分だったかは失われるが、金額と支払記録は残る）。
alter table affiliate_commissions
  alter column referred_user_id drop not null;

alter table affiliate_commissions
  drop constraint if exists affiliate_commissions_referred_user_id_fkey;

alter table affiliate_commissions
  add constraint affiliate_commissions_referred_user_id_fkey
  foreign key (referred_user_id) references profiles (id) on delete set null;

create index if not exists affiliate_commissions_referred_user_idx
  on affiliate_commissions (referred_user_id);
