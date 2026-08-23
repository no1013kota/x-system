-- T-M8-260: Portalで予約した下位プランへの変更（subscription schedule）をアプリが保持する。
--
-- 下位への変更は期間末予約になる（Portal設定 schedule_at_period_end）。予約が入っても契約本体の
-- Priceは変わらないため、アプリの plan はそのままで**予約の存在が画面のどこにも出なかった**。
-- 利用者はPortalを開き直すしか確かめる手段が無く、取り消しは運営者のダッシュボード作業だった。
alter table profiles
  add column if not exists scheduled_plan plan_type,
  add column if not exists scheduled_plan_at timestamptz;

comment on column profiles.scheduled_plan is
  '期間末で切り替わる予約先のプラン（Stripe subscription schedule）。予約が無ければnull（T-M8-260）';
comment on column profiles.scheduled_plan_at is
  '予約が効く日時（scheduleの次フェーズ開始＝現在期間の終了）。scheduled_plan とセットでnull/非null';

alter table profiles
  add constraint profiles_scheduled_plan_pair
  check ((scheduled_plan is null) = (scheduled_plan_at is null));
