# ブログ記事の置き場

公開ブログ（`/blog`）の記事はこのディレクトリの Markdown ファイルです。**1ファイル＝1記事、ファイル名＝URL**（`x-prompt-basics.md` → `/blog/x-prompt-basics`）。

**フォルダで状態を分けます**（T-M8-193）:

| フォルダ | 状態 | 画面に出るか |
|---|---|---|
| `blog/published/` | 公開済み | 出る（/blog が読むのはここだけ） |
| `blog/drafts/` | 下書き（front matter に `draft: true` 必須） | 出ない |

`blog/` 直下に記事を置くと**どこにも出ません**（`npm run blog:check` が置き忘れとして知らせます）。
このファイル（`README.md`）と `_` で始まるファイルは記事として扱われません。

## 書き方

```markdown
---
title: 記事のタイトル（80文字まで）
description: 一覧とOGPに出る要約。1〜2文（200文字まで）
date: 2026-08-21
tags: [X運用, プロンプト]
draft: true
image: /blog-images/eyecatch/x-prompt-basics.png
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
| `image` | | アイキャッチ画像。`/blog-images/…` のサイト内パス（png/jpg/jpeg/webp/svg）。記事ヘッダ・一覧のサムネイル・SNS共有カード（OGP）に出る。**`npm run blog:eyecatch -- <slug>`** が 1200×630 の画像を `public/blog-images/eyecatch/<slug>.png` に作り、この行も書き足す（題名を変えたら作り直す） |

- ファイル名は**小文字英数字とハイフン**だけ（URLになる。先頭はハイフン不可・80文字まで）。`README.md` と `_` 始まりは記事にならない。
- 画像は `public/blog-images/` に置き、本文から `/blog-images/ファイル名.png` で参照する（**置き忘れは不備として公開されない**）。外部の `https://` 画像も表示できる。画像には必ず説明文（`![説明](…)`）を付ける。
- **太字の `**` は「」（）、。などの約物の内側に入れない。** `は**「配る」**へ` のように約物が太字の内側にあると太字にならず、`**` が画面にそのまま残る（Markdown の規則。`npm run blog:check` が行番号つきで止める）。`は「**配る**」へ` と約物を外に出す。
- 図（手順・比較・時系列・構造の説明）は SVG を `blog/diagrams/<slug>-<name>.svg` に書き、`npm run blog:diagram -- blog/diagrams/<slug>-<name>.svg <slug>-<name>.png` で `public/blog-images/` に PNG 化して貼る（幅 1200・色は `#7d1f75` と `#f4e8f3`）。**本文幅（約720px）とスマホ（375px）に縮小される前提で描く**：横に3つ以上並べない（縦積みか2列まで）、最小の文字は 40px 以上（日付・補足も。スマホで 12px になる下限。`blog:diagram` が下回ると止める）、長い説明文は図に入れず本文へ（1行 20 字まで。時系列は「日付＋タグ」と短文の2段に折る）、注記に「700px」のような実寸を書かない（縮小後の画面では合わなくなる。「報告の棒はいいねの468倍」のように比率で書く）。`blog:diagram` がスマホ幅（375px）のプレビューも一時ディレクトリに書くので、それを開いて文字が読めるか確かめる。
- 文章は人が書いた読み物として自然に。「（意見）」のような注記は付けず語尾で示す（「〜と考えている」「〜と報じられた」）。「〜することができます」「重要なのは」「まとめると」の多用、過剰な太字、「——」の多用を避け、読者が知らない内部用語は説明してから使う。
- 生のHTMLタグは表示されない（安全のため）。
- `date` は未来の日付でも**すぐ公開される**（予約公開の仕組みは無い。先の日付で出したくなければ `draft: true` のまま置く）。

## 運用の流れ

1. `/blog-write` — テーマと参照リンクを聞かれるので答える（引数で渡してもよい）。Claude が `blog/drafts/` に下書き（`draft: true`）を作り、アイキャッチ（`npm run blog:eyecatch -- <slug>`）と必要な図を作る
2. 内容を読んで直す。Claude のセルフレビューは2周（1周目＝事実と構成、2周目＝読み物として通し読みし、つっかえる文・前提知識が要る箇所・AIらしい言い回しを直す）で、運営者も同じ順で読むと漏れにくい（題名を変えたら `npm run blog:eyecatch -- <slug>` で画像も作り直す）
3. `/blog-publish <ファイル名>` — 検証（`npm run blog:check`）→ `blog/published/` へ移動して `draft` を外す → コミット
4. いつもの反映（`npm run release:staging` → `npm run release:production`）

`npm run blog:check` は front matter・画像（本文と `image`）の置き忘れ・太字にならない `**` の不備を**理由つきで**一覧します。不備のある記事は公開側に出ず、
ローカル（`npm run dev` → `http://127.0.0.1:3000/blog`）では画面上にも理由が表示されます（staging・本番では表示されず、
代わりに `doctor` の「ブログ記事の同梱」が警告します）。**不備を残したままだとCI（`npm test` の `blog-articles.test.ts`）が止まります。**
