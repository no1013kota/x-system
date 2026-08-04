-- 「利用者が自分で連携を解除した」ことを記録する（T-M8-54）。
--
-- `status = 'disabled'` は2つの異なる出来事に使われている。
--   (a) 利用者が「連携を解除」した
--   (b) プラン変更で自動的に停止された（standardは active 1件だけ・要件02 §4.1）
-- 一覧から `disabled` を丸ごと隠すと (b) が見えなくなり、「なぜ止まったのか分からない」状態を
-- 作ってしまう（CLAUDE.md 原則1）。区別できるようにして、(a) だけを一覧から畳む。
--
-- 行は消さない。下書き・履歴・実績が参照しているため（要件06 §14）。
alter table x_accounts
  add column if not exists disconnected_at timestamptz;

comment on column x_accounts.disconnected_at is
  '利用者が「連携を解除」した日時。プラン変更による自動停止では設定しない。再連携・再有効化でnullへ戻す（T-M8-54）';
