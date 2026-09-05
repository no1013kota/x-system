-- 要件02 §3.2 x_accounts に「書き方のチェックポイント」の選択を持つ（T-M8-447・運営者の指示 2026-09-06）。
--
-- アカウント.md（発信定義）に、AIっぽさを消す条項と伸びる投稿の型の条項を、利用者がチェックボックスで
-- 取り込めるようにする。条項の文面はコード（src/lib/prompts/writing-checkpoints.ts）が正本で、ここには
-- 選んだ条項の ID だけを持つ。本文（base_md）へ物理的に書き込まないのは、(1) 学習の反映（MD-MERGE）や
-- 本棚の切替で消えない、(2) 文面を改善したら全利用者へ届く、(3) 5,000字の本文上限を消費しない、ため。
-- 生成時は <base_md> の末尾に「## 書き方のチェックポイント」として付けて渡す（gen-context.ts）。

alter table x_accounts
  add column if not exists writing_checkpoints jsonb not null default '[]'::jsonb;

alter table x_accounts
  drop constraint if exists x_accounts_writing_checkpoints_array;
alter table x_accounts
  add constraint x_accounts_writing_checkpoints_array
    check (jsonb_typeof(writing_checkpoints) = 'array');

comment on column x_accounts.writing_checkpoints is
  '書き方のチェックポイントの選択（条項IDの配列。文面の正本は src/lib/prompts/writing-checkpoints.ts）';
