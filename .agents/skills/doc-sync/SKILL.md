---
name: doc-sync
description: コード変更をdocs/配下の該当ドキュメントへ反映する。コミット前に実行する。引数でgit diff範囲を指定可（例 /doc-sync HEAD~3）。--full でコード全体との乖離を監査する。
model: inherit
---

# doc-sync

**内容の正本は `.claude/skills/doc-sync/SKILL.md`。それを読んで従うこと。**

> 以前はここへ全文を写していたが、`.claude/skills/` 側だけが更新され続けて旧版が取り残された
> （古い description、`npm test` のままの検証手順）。**同じ手順を2か所に置かない。**
