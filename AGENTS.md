# x-system（Exos AI）— Codex向け入口

**開発ガイドの正本は `CLAUDE.md`。** 前提となる運営者原則、docs同期ルール、ディレクトリ構成、
仕様の読み方、開発の進め方、「変更影響 → 必須の検証」、Definition of Done、技術スタック、規約は
すべてそちらにある。**このファイルへ写さない。**

> 以前はここへ全文を写していたが、写した後に `CLAUDE.md` 側だけが更新され続けて陳腐化した
> （「DB17テーブル」＝実際は21／存在しない `old/` への参照／**Definition of Done から
> 「必須の検証をすべて実行した」の行が欠落**）。**欠落は最悪で、これを読んだだけでは
> 検証を飛ばして完了扱いにできてしまう。** 同じ数字・同じ規則を2か所に置かない。

## Codex固有

| パス | 内容 |
|---|---|
| `.agents/skills/` | Codex向けスキル。中身は `.claude/skills/<名前>/SKILL.md` が正本 |

Definition of Done は `CLAUDE.md`「Definition of Done（全タスク共通）」を見る。
