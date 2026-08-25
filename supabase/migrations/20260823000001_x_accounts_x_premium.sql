-- T-M8-219: XアカウントのX Premium加入状態を保持する（運営者の指示 2026-08-22）。
-- /2/users/me の verified_type（blue=Premium個人・business=認証済み組織）から導出し、
-- users/me を呼ぶ全タイミング（OAuth連携・「接続を確認」・再有効化）で更新する。
-- 表示（SC-11 設定>設定のバッジ）用。未取得の既存行は false（バッジ非表示）から始まり、
-- 次の「接続を確認」で実状態に追いつく。
alter table x_accounts
  add column if not exists x_premium boolean not null default false;

comment on column x_accounts.x_premium is
  'X Premium加入（verified_type = blue/business）。users/me を呼ぶたびに更新（T-M8-219）';
