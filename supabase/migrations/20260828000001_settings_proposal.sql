-- 要件02 §3.3 x_accounts.settings_proposal 追加（T-M8-349・運営者の指示 2026-08-28）。
--
-- **参考ソースからの反映を「保存前の下書き」にする。**
-- これまで「参考ソースからアカウント設定を作る」は md_merge が `settings` を直接
-- 書き換えていた。押した瞬間に本番の設定が変わるため、**利用者は中身を見る前に
-- 反映されてしまい**、気に入らなければ手で戻すしかなかった。
--
-- これからは merge の結果をここへ置き、画面のフォームがその値を読み込む。
-- 利用者が確認して「アカウント設定を保存」を押したときに初めて `settings` と
-- アカウント.mdが変わる（保存時にこの列を null へ戻す）。
--
-- **null と「空の提案」を区別する。** null は「提案が無い」で、
-- 提案がある間だけ画面が「参考ソースから反映しました」を出す（原則1）。

alter table x_accounts
  add column if not exists settings_proposal jsonb;

comment on column x_accounts.settings_proposal is
  '参考ソースの反映で作った保存前のアカウント設定（T-M8-349）。保存すると null に戻る。';
