-- T-M8-157: 下書きに日時を指定して投稿予約できるようにする。
--
-- これまでの予約は `schedule_slots`（曜日＋時刻の繰り返し枠）だけで、枠は「投稿を生成する」
-- トリガーだった。**既にある下書きを特定の日時に投稿する経路が無かった**（運営者の指示 2026-08-20）。
--
-- 状態の持ち方は `draft_status` に値を足さず `scheduled_at` の有無で表す。
-- enumへ `scheduled` を足すと `status = 'draft'` で絞っている画面・集計・遷移すべてに波及し、
-- 「予約済みだけ一覧から消える」類の退行を作りやすい。**不変条件は
-- 「scheduled_at is not null かつ status = 'draft' ⇒ 予約済み」**の1つだけにする。
--
-- RLSは既存のdrafts方針（x_account所有者）をそのまま使う。列追加はテーブル単位のGRANTに含まれる。

alter table public.drafts
  add column if not exists scheduled_at timestamptz;

comment on column public.drafts.scheduled_at is
  '投稿予約日時（UTC保存・画面はJST）。null は予約なし。status=draft のときだけ意味を持つ（T-M8-157）';

-- cronは「期限が来た予約済み下書き」だけを引く。部分indexにして、予約していない
-- 大多数の下書きをindexへ載せない（予約は例外的な操作）。
create index if not exists drafts_scheduled_due_idx
  on public.drafts (scheduled_at)
  where scheduled_at is not null and status = 'draft';
