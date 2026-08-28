-- アカウント.mdの見出しを6→5へ（T-M8-356・運営者の指示 2026-08-28）。
--
-- **「## 5. 文体・自分らしさ」を廃止する。** 残る5つは
-- 1.ペルソナ / 2.発信テーマ / 3.トーン&マナー / 4.やらないこと / 5.参考にする型。
--
-- **書いてあった内容は消さない**（原則1）。旧5の本文は、そのまま新5（参考にする型）の
-- 先頭へ残す——「不要」と言われたのは見出しの区分であって、利用者が書いた文章ではない。
-- 空だった場合は何も足さずに見出しだけ畳む。
--
-- 対象は「生成が読む実物」だけでなく**履歴と本棚も**。片方だけ直すと、
-- 版から戻した瞬間に6見出しのmdが復活し、保存できない（構造検証で弾かれる）状態になる。
--
-- 変換できない形（見出しが揃っていない・手で崩した）はそのまま残す。
-- 触らなければ今までどおり読めるだけで、壊す方が損。

create or replace function pg_temp.base_md_to_five_sections(src text)
returns text
language sql
immutable
as $$
  select case
    -- 旧6見出しの形のときだけ畳む（新しい形・崩れた形は素通し）
    when src ~ '(?m)^## 5\. 文体・自分らしさ\s*$' and src ~ '(?m)^## 6\. 参考にする型\s*$'
      then regexp_replace(
             src,
             -- 旧5の見出しを落とし、本文（\1）を新5の見出しの下へ移す
             '(?s)^(.*?)## 5\. 文体・自分らしさ[^\n]*\n(.*?)## 6\. 参考にする型[^\n]*\n(.*)$',
             '\1## 5. 参考にする型' || E'\n' || '\2\3'
           )
    else src
  end
$$;

update x_accounts
   set base_md = pg_temp.base_md_to_five_sections(base_md)
 where base_md ~ '(?m)^## 6\. 参考にする型\s*$';

update base_md_versions
   set content = pg_temp.base_md_to_five_sections(content)
 where content ~ '(?m)^## 6\. 参考にする型\s*$';

update prompt_presets
   set content = pg_temp.base_md_to_five_sections(content)
 where kind = 'base_md'
   and content ~ '(?m)^## 6\. 参考にする型\s*$';
