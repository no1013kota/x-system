-- T-M8-233: 「スケジュールをすべて停止」で自動投稿と下書き作成の両方を止め、「すべて再開」で戻せるようにする。
--
-- 停止は既存どおり schedule_slots.enabled = false で行う。**どの枠を停止操作で止めたか**を
-- 覚えておかないと、再開したときに「利用者が個別に止めていた枠」まで復活してしまう。
-- そこで停止操作で無効化した枠だけへ日時を刻み、再開はその枠だけを戻す（完全に可逆）。
alter table schedule_slots
  add column if not exists paused_by_stop_all_at timestamptz;

comment on column schedule_slots.paused_by_stop_all_at is
  '「すべて停止」で無効化した日時（null=それ以外）。「すべて再開」はこの列が非nullの枠だけをenabledへ戻す（T-M8-233）';

-- 再開・件数表示はアカウント単位で「停止操作で止まっている枠」を引く。
create index if not exists schedule_slots_paused_by_stop_all_idx
  on schedule_slots (x_account_id)
  where paused_by_stop_all_at is not null;
