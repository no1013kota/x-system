-- 表示名（display_name）を削除する（T-M8-61）。
--
-- T-M8-59 で入力欄・action・純関数を削除した時点で、この列はどこからも読まれていなかった
-- （メールにもヘッダーにも出ない）。既存データも不要と確認したため（2026-08-05 ユーザー判断）、
-- 列ごと落とす。要件02 のプロフィール表からも行を削除し、docs↔DB の一致は
-- `schema-doc-sync.db.test.ts` が守る。
alter table profiles drop column if exists display_name;
