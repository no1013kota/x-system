-- T-M8-236: 部分返金を「累計返金額」で正しく扱えるようにする。
--
-- Stripe の charge.refunded が持つ `amount_refunded` は**その請求に対する累計**（部分返金のたびに増える）。
-- 従来は減額済みの eligible_amount からその累計をもう一度引いていたため、部分返金が2回あると
-- 二重に差し引かれ、報酬が過小になる／全額取消（reversed）に誤判定される。
-- 元の請求額を保持し、**毎回ゼロから計算し直す**（冪等になり、webhookの再送・順序入れ替えにも強い）。
alter table affiliate_commissions
  add column if not exists original_amount integer;

update affiliate_commissions set original_amount = eligible_amount where original_amount is null;

alter table affiliate_commissions
  alter column original_amount set not null;

alter table affiliate_commissions
  add constraint affiliate_commissions_original_amount_nonneg check (original_amount >= 0);

comment on column affiliate_commissions.original_amount is
  '返金前の対象売上（invoice.amount_paid）。返金は eligible_amount = original_amount - 累計返金額 で毎回計算し直す（T-M8-236）';
