-- 利用枠を期間の途中でリセットできるようにする（T-M8-299・運営者の指示 2026-08-25）。
--
-- 無料トライアル中に上位プランから下位プランへ切り替えたら、**その場でプランが変わり、
-- 利用枠もリセットされる**。ところが Stripe はトライアル中の価格変更で
-- `current_period_start` を動かさない（2026-08-25 実測）ため、期間キーだけでは区切れない。
--
-- **日付ではなく世代（epoch）で区切る。** 同じ日にリセットしても必ず別のキーになる
-- （`current_period_start` を書き換える案は、Stripe の値との写しが崩れるので採らない）。
-- 0 のあいだはキーの形が従来どおりなので、既存の利用者の枠は動かない。
alter table profiles
  add column usage_epoch integer not null default 0
    check (usage_epoch >= 0);

comment on column profiles.usage_epoch is
  '利用枠の世代。増やすと期間キーが変わり、その時点から枠が0で数え直しになる（T-M8-299）。usage_events は消さないので原価の台帳は残る。';
