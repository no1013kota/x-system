---
name: blog-publish
description: blog/ の下書き記事を公開状態にしてコミットする。front matter を検証（npm run blog:check）→ draft を外す → 記事ファイルだけをコミット。引数はファイル名（例 /blog-publish x-prompt-basics.md）。書くのは /blog-write。
model: inherit
---

# blog-publish：下書きを公開してコミットする

`blog/<slug>.md` の **`draft: true` を外し、記事ファイルだけをコミットする**。公開の正本は [blog/README.md](../../../blog/README.md)（front matter・制約・運用の流れ）。

**このスキルは本文を書き換えない。** 直すべき点があれば止めて報告する（直すのは `/blog-write` か運営者）。

## 手順

### 0. 対象を決める

| 引数 | すること |
|---|---|
| ファイル名あり（`x-prompt-basics.md`／`.md` 省略可） | `blog/` 直下のそのファイル。無ければ止める |
| 引数なし | `grep -l "^draft: true" blog/*.md` で下書きを列挙。1件ならそれ、複数なら**どれを公開するか聞く** |

### 1. 読んで最終確認する

記事全文を読み、次に該当すれば**公開せずに止めて報告する**（判断は運営者）。

- 新しい学び・具体例（数字・手順・プロンプト）が無い、または「適切に」「しっかり」等の曖昧語だけで構成されている
- 効果の保証・誇大表現（「必ず伸びる」「フォロワー○倍」）や、出典の無い統計・他社の断定
- 本文中の画像 `/blog-images/...` が `public/blog-images/` に実在しない
- 生HTMLタグ（表示されない）、`#` 見出し（h2 に落ちる。意図的でなければ `##` へ）

### 2. 検証する（公開前）

```bash
npm run blog:check -- <file>
```

不備があれば**理由がそのまま出る**。front matter の形式だけの不備（日付の書式・タグの書き方・長さ超過）は直してよい。本文は変えない。

### 3. 公開状態にする

- `draft: true` の行を削除する
- `date` を**今日**（公開日）にする。下書き時の日付のままだと過去日付で公開され、一覧の順が狂う。運営者が日付を指定したときだけそれに従う
- `updated` は触らない（再公開・改稿時に `/blog-write` か運営者が入れる）

もう一度 `npm run blog:check -- <file>` を実行し、`✅ ... 公開 <date>「<title>」 → /blog/<slug>` と出ることを確認する。

### 4. コミットする

```bash
git status --short            # 無関係な変更を巻き込まない（並行編集中のファイルがあり得る）
git add blog/<file>           # 画像を足したなら public/blog-images/<画像> も明示して add
git commit -m "blog: <記事タイトル>"
```

**`git add -A` は使わない。** 記事と画像以外は stage しない。

### 5. 報告する

- 公開URL: `/blog/<slug>`（本番なら `https://exosai.net/blog/<slug>`）
- 反映は通常どおり: `npm run release:staging` → 確認 → `npm run release:production`（[デプロイ手順 §0.0](../../../docs/operations/deployment.md)）
- 本番反映後、`npm run doctor -- --base https://exosai.net` の「ブログ記事の同梱」が緑で、公開件数が1増えていること

## ルール

- 1回に公開するのは**1記事**。まとめて公開しない（問題が出たとき切り分けられない）。
- push・release は自動で行わない。運営者がコマンドを叩く。
- 本文の誤字・表現の修正は**提案に留める**（公開の判断と文責は運営者）。
- `blog:check` が赤のままコミットしない。
