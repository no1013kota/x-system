-- T-M8-251: 「すべて停止／すべて再開」は文字どおり全部を対象にする（運営者の指示 2026-08-23）。
--
-- 直前（T-M8-233）は「停止操作で止めた枠だけを再開する」ため `paused_by_stop_all_at` に印を付けていた。
-- 運営者の指示で**個別に止めた枠も対象**へ変えたため、この列は誰も読まなくなった。
-- 使われない列を残すと「何のための列か」を次に読む人が推測することになるので落とす。
drop index if exists schedule_slots_paused_by_stop_all_idx;

alter table schedule_slots
  drop column if exists paused_by_stop_all_at;
