-- T-M8-196（複数アカウント総点検・critical修正）: usage_counters のcheck制約を
-- expertプランの月次上限（通常投稿1000・URL投稿100。src/lib/plans.ts）に合わせて拡張する。
--
-- 初期migration（20260720000003）の 200/20 のままだと、expertの投稿前ゲート
-- （plans.tsの1000/100）は counter=200 を通過させるのに、X公開後の consumePostSlot の
-- UPDATEが 23514（check違反）で落ちる——**ツイートは公開されたのに記録が失敗する**
-- 最悪の形（実DBで再現済み）。上限の実施はアプリ側ゲートが正で、制約は破損防止の下限。
alter table usage_counters drop constraint usage_counters_normal_range;
alter table usage_counters drop constraint usage_counters_url_range;
alter table usage_counters
  add constraint usage_counters_normal_range check (normal_posts_count between 0 and 1000);
alter table usage_counters
  add constraint usage_counters_url_range check (url_posts_count between 0 and 100);
