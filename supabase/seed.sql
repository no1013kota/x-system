-- 要件02 §6 seed: システム既定プロンプト。
-- **画像プロンプト（PT-IMG）だけを入れる**（T-M8-129 U2）。投稿の型プロンプト（PT-P1〜P6）は
-- `post_patterns.prompt` が正本で、null＝コード定数 `SYSTEM_DEFAULT_TEMPLATES` を使う。
-- ここに型の行を作ると「コードを直したのに反映されない」経路が復活する（T-M7-37）。
-- 内容の正本は docs/プロンプト設計書.md §6.8（PT-IMG）。
-- SYS-GEN/SYS-NEWS/PT-FIX/PT-MD-MERGE/PT-L*/PT-SUGGEST はコード管理でありDBには置かない。
-- x_account_id is null が system default。db reset で再適用されるため on conflict do nothing。

insert into prompt_templates (x_account_id, kind, content) values
(null, 'image', $prompt$# タスク
次のXポストに添える画像1枚の生成プロンプト（英語）を作る。
ポスト本文: <post>{{post_text}}</post>
トンマナ: <tone>{{tone_section}}</tone>

# 要件
- 内容を象徴するシンプルな構図。文字は短い英単語のみ（日本語文字は入れない）
- 実在の人物・企業ロゴ・ブランド・キャラクターを描かせない

# 出力
JSONのみ: {"prompt":"英語プロンプト","aspect":"16:9"}$prompt$)
on conflict (kind) where (x_account_id is null) do nothing;
