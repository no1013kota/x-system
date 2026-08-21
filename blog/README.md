# ブログ記事の置き場

公開ブログ（`/blog`）の記事はこのディレクトリの Markdown ファイルです。**1ファイル＝1記事、ファイル名＝URL**（`x-prompt-basics.md` → `/blog/x-prompt-basics`）。

このファイル（`README.md`）と `_` で始まるファイルは記事として扱われません。

## 書き方

```markdown
---
title: 記事のタイトル（80文字まで）
description: 一覧とOGPに出る要約。1〜2文（200文字まで）
date: 2026-08-21
tags: [X運用, プロンプト]
draft: true
---

## 最初の見出し

本文。**太字**・*斜体*・[リンク](https://example.com)・箇条書き・番号付き・引用・表・コードが使えます。
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `title` | ○ | 記事タイトル。ページの h1 になるので本文に `#` の見出しは書かない（書いても h2 として表示） |
| `description` | ○ | 一覧カード・検索結果・OGPに出る要約 |
| `date` | ○ | 公開日 `YYYY-MM-DD`。一覧はこの日付の新しい順 |
| `updated` | | 更新日 `YYYY-MM-DD`（`date` 以降） |
| `draft` | | `true` のあいだは公開されない（既定は `false`） |
| `tags` | | `[a, b]` または `a, b` |

- ファイル名は**小文字英数字とハイフン**だけ（URLになる）。
- 画像は `public/blog-images/` に置き、本文から `/blog-images/ファイル名.png` で参照する。外部の `https://` 画像も表示できる。
- 生のHTMLタグは表示されない（安全のため）。

## 運用の流れ

1. `/blog-write <テーマ or 参考URL>` — Claude が下書き（`draft: true`）を作る
2. 内容を読んで直す
3. `/blog-publish <ファイル名>` — 検証（`npm run blog:check`）→ `draft` を外す → コミット
4. いつもの反映（`npm run release:staging` → `npm run release:production`）

`npm run blog:check` は front matter の不備を**理由つきで**一覧します。不備のある記事は公開側に出ず、
ローカル／staging の `/blog` では画面上にも理由が表示されます（本番では表示されません）。
