---
name: init
description: 開発キットの雛形（CLAUDE.md・docs/・tasks/・scripts/・.mcp.json・.claude/settings.json）をいまのプロジェクトへ置き、package.json に検査コマンドを3つ足し、CLAUDE.md の <...> を運営者への1回のヒアリングで埋める。既にあるファイルは上書きしない。プロジェクトで最初に1回だけ実行する。
---

# init：開発キットの雛形をプロジェクトへ置く

このプラグインに同梱した雛形（`${CLAUDE_PLUGIN_ROOT}/templates/`）を、いま開いているプロジェクトの一番上へ置く。
**既にあるファイルは絶対に上書きしない**（運営者が育ててきた CLAUDE.md や docs を消さない）。
置くだけでなく、`CLAUDE.md` の `<...>` を埋め、検査が緑になるところまでを1回の作業にする。

雛形の中のコマンド名（`/docdd:add-task` など）は、プラグインの呼び名へ**あらかじめ書き換えてある**。init が本文を置換する必要はない。

## 手順

### 0. 置き場所を確かめる

1. `pwd` と `git rev-parse --show-toplevel` で、いまの場所がプロジェクトの一番上かを確かめる。違えば止まって伝える（別の場所に置くと Claude Code が CLAUDE.md を読まない）。
2. git 管理でなければ止まり、`git init` を勧める（`scripts/check-doc-dates.mjs` はコミットの日付を読むため、git が無いと使えない）。
3. `ls -la "${CLAUDE_PLUGIN_ROOT}/templates"` で雛形が読めることを確かめる。無ければ「プラグインが壊れている」と伝えて止まる。

### 1. 雛形をコピーする（上書き禁止）

`${CLAUDE_PLUGIN_ROOT}/templates/` 以下の**ファイルを1つずつ**、同じ相対パスでプロジェクトへコピーする。
対象は `CLAUDE.md` `docs/` `tasks/` `scripts/` `.mcp.json` `.claude/settings.json`。`package.scripts.json` はコピーしない（手順2で使うデータ）。

- コピー先に同名ファイルがあれば**飛ばして記録する**（`cp -n` ではなく、存在確認をしてからコピーする。OS によって `-n` の挙動が違う）。
- `.claude/` と `.mcp.json` は隠しファイルなので、`find "${CLAUDE_PLUGIN_ROOT}/templates" -type f` で列挙して漏らさない。
- **`.mcp.json` の初期値は Next.js 向け**（shadcn/ui と Next.js DevTools）。プロジェクトの `package.json` の `dependencies` / `devDependencies` に `next` が無ければ、雛形を写す代わりに `{"mcpServers": {}}` だけを書いた `.mcp.json` を置き、報告で「Next.js ではないので空にした。使う道具に合わせて足す」と伝える。`package.json` が無い場合も同じ。`.mcp.json` が既にあれば触らない。
- **`CLAUDE.md` が既にあって、それが Claude Code 組み込みの `/init` が自動生成したもの**（英語・「This file provides guidance to Claude Code…」で始まる体裁）に見えるなら、「キットの CLAUDE.md（5原則・変更影響 → 必須の検証）で置き換えるか、いまのままにするか」を**1回だけ**聞く。置き換える答えなら、元のファイルを `CLAUDE.md.bak` に残してからコピーする。それ以外の既存 CLAUDE.md には触れず、「キットの CLAUDE.md（`${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md`）と見比べて、足したい節を運営者が選ぶ」よう伝える。勝手に追記しない。
- 作成したファイルと飛ばしたファイルを、あとで報告に載せるため控えておく。

### 2. `package.json` に npm script を3つ足す

`package.json` があれば、`${CLAUDE_PLUGIN_ROOT}/templates/package.scripts.json` の3つ（`check:doc-dates` `check:doc-refs` `audit:check`）のうち、**まだ無いものだけ**を `"scripts"` へ足す（既にある同名の script は変えない）。
`node -e` で JSON を読み書きすると、手で編集するより崩れない。

`package.json` が無ければ（Node.js を使っていないプロジェクト）、`scripts/` は置いたまま「この3本は Node.js 20 以上で `node scripts/<名前>.mjs` として動く。使わないなら `scripts/` と CLAUDE.md の該当行を消してよい」と報告する。
`audit:check` は npm の `package-lock.json` が前提（pnpm / yarn なら足さず、その旨を報告する）。

### 3. `<...>` を1回のヒアリングで埋める

1. 新しく作ったファイルの中から `grep -n '<[^>]*>'` で `<...>` を列挙する（`CLAUDE.md`・`docs/PRD.md`・`docs/operations/development-and-testing.md`・`tasks/BACKLOG.md`・`tasks/REFACTOR_PLAN.md`）。
2. **日付**（`<YYYY-MM-DD>`）は聞かずに今日の日付で埋める。
3. 残りを**1つのメッセージ**にまとめて運営者に聞く。小出しにしない。聞くのは次の順:
   - プロジェクト名と「何を作っているか」1行（`CLAUDE.md` 冒頭と `docs/PRD.md` §1）
   - 使っている道具（フレームワーク・言語・DB。分からなければ「Claude に調べさせる」でよい。`package.json` や設定ファイルから推定して**候補を添えて**聞く）
   - `CLAUDE.md`「検証コマンド」表の各行: 型検査・lint・単体・DBテスト・ビルド・E2E・全検査（`package.json` の `scripts` から候補を添える。無いものは「無い」でよい）
   - `CLAUDE.md`「反映コマンド」表の3行（`/docdd:release` が使う）: 「staging へ反映」「本番へ反映」のコマンド（`package.json` の `scripts` やホスティングの CLI から候補を添える。無ければ「無い」でよく、本番ブランチへの取り込みだけで公開されるならその旨を書く）・「公開先 URL」（実ブラウザ確認に使う。まだ公開していなければ「無い」でよい）
   - `docs/PRD.md` の「やること」「やらないこと」（箇条書きで数行。あとで直せる）
4. 答えをもらったら該当箇所へ書き込む。「無い」「分からない」と答えられた箇所は `<...>` のまま残し、報告で「未記入」と示す（勝手に作らない）。
5. `tasks/BACKLOG.md` と `tasks/REFACTOR_PLAN.md` の `<例: ...>` は書式の見本なので、そのまま残してよい。`tasks/BACKLOG.md` の見本タスク `T-00` は `done` なので `/docdd:dev-loop` には拾われない（実タスクは `T-01` から）。

### 4. 検査を通し、承知を得てコミットし、報告する

順番が大事。`check:doc-refs` と `check:doc-dates` は **git が追跡しているファイルだけ**を見る（`git ls-files`）ので、置いたばかりの雛形は stage するまで「存在しない」扱いになり、必ず「参照が1件も見つかりません（検出器が空振り）」で止まる。さらに `check:doc-dates` は**コミットの日付**を読むため、最初のコミットの前には動かない。

1. 作成したファイルだけを **パスを明示して** `git add` する（`git add -A` は使わない。stage は取り消せるので、この段階では運営者の承知は要らない）。
2. `package.json` に script を足したなら `npm run check:doc-refs` を実行する。雛形の `CLAUDE.md` が `scripts/check-doc-dates.mjs` などを指しているので、stage 済みなら通る。落ちたら**その文面をそのまま**報告する（0件で止まるのは検出器の空振り防止で、雛形側の不備の可能性が高い）。
3. 報告に載せるもの:
   - 作成したファイル／飛ばした（既にあった）ファイルの一覧
   - `package.json` に足した script（または足せなかった理由）
   - `<...>` が残っている箇所（ファイルと行）
   - 次に打つコマンド: `/docdd:add-task 最初に作りたいこと` → `/docdd:dev-loop`（`tasks/BACKLOG.md` の見本 `T-00` は `done` なので拾われない。残しても消してもよい）
4. **運営者が承知したら** `chore: Claude Code 開発キットを導入` でコミットする。承知が無ければコミットしない（stage したままでよい）。
5. コミットした後に `npm run check:doc-dates` を1回実行する。手順3で日付を埋めていれば通る。落ちたら文面をそのまま報告する。

## やらないこと

- 既存ファイルの上書き・削除・改名（手順1で承知を得た `CLAUDE.md` の置き換えだけが例外。元は `.bak` に残す）
- `.claude/skills/` へのスキルのコピー。スキルはプラグインが提供する。**手順書の本文を自分のプロジェクトに合わせて直したいなら**、README「手順書（スキルの本文）を自分で直したいとき」の順で切り替える: (1) プラグインが入った状態で Claude Code に「docdd プラグインの手順書（init 以外）を .claude/skills/ に写して、写したものと CLAUDE.md の docdd: の前置きを全部外して」と頼む → (2) `/plugin uninstall docdd@claude-docdd-dev-kit` で外す → (3) Claude Code を起動し直す。プラグインとローカルに同名のスキルが並ぶと、`CLAUDE.md` の呼び名と食い違って片方が呼ばれなくなる。
- 雛形を置いた勢いで実装を始めること（実装は `/docdd:dev-loop` の仕事）
