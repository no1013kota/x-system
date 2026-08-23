-- 適用中の割引（クーポン）の写し（T-M8-279・運営者の指示 2026-08-23）。
--
-- 解約の引き止めクーポン（半額・3か月）を受け取ったあと、**画面のどこにも割引が出ていなかった**。
-- 「いくら払うのか」は契約者がいちばん知りたいことなので、プラン名の下に出す。
-- 契約の正本はStripeで、ここはその写し（webhookで同期）。
alter table profiles
  add column if not exists discount_percent_off integer
    check (discount_percent_off is null or (discount_percent_off > 0 and discount_percent_off <= 100)),
  add column if not exists discount_amount_off_jpy integer
    check (discount_amount_off_jpy is null or discount_amount_off_jpy > 0),
  add column if not exists discount_ends_at timestamptz;

comment on column profiles.discount_percent_off is '適用中クーポンの割引率（%）。無ければ null（T-M8-279）';
comment on column profiles.discount_amount_off_jpy is '適用中クーポンの割引額（円）。率と排他ではないがStripeはどちらか一方';
comment on column profiles.discount_ends_at is '割引の終了日時。null は終了日なし（ずっと適用）';
