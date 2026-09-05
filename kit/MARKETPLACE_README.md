# docdd — 非エンジニアのための Claude Code 開発キット（プラグイン配布用）

このリポジトリは Claude Code の**プラグイン マーケットプレイス**です。
1人の非エンジニアが Claude Code で Web アプリを作り続けるための「約束（CLAUDE.md）・仕様書（docs）・作業キュー（BACKLOG）・手順書（skills）」を、プラグイン1本で入れられるようにしています。
背景と使い方の全体像はブログ記事「[非エンジニアが Claude Code でアプリを作り続けるための仕組み](https://exosai.net/blog/claude-code-non-engineer-workflow)」にあります。

## 入れ方（3コマンド）

Claude Code の中で次を順に打つ。

1. `/plugin marketplace add {{GITHUB_REPO}}`
2. `/plugin install docdd@claude-docdd-dev-kit`
3. 自分のプロジェクトのフォルダで Claude Code を起動し、`/docdd:init`
   （前置き無しの `/init` は Claude Code 組み込みの別コマンドなので打たない）

`init` が雛形（`CLAUDE.md` `docs/` `tasks/` `scripts/` `.mcp.json` `.claude/settings.json`）を**既存ファイルを上書きせずに**置き、`package.json` に検査コマンドを3つ足し、`CLAUDE.md` の `<...>` を1回のヒアリングで埋めます。
以降のコマンドは `/docdd:add-task` `/docdd:dev-loop` のように `docdd:` の前置きで呼びます。

## このリポジトリの中身

| パス | 役割 |
|---|---|
| `.claude-plugin/marketplace.json` | マーケットプレイス定義（名前 `claude-docdd-dev-kit`） |
| `plugins/docdd/.claude-plugin/plugin.json` | プラグイン定義（名前・版） |
| `plugins/docdd/skills/<名前>/SKILL.md` | スキル（手順書）12本。`init` ＋ `add-task` `dev-loop` `doc-sync` `verify-integration` `verify-e2e` `ui-polish` `refactor` `speed-up` `security-audit` `maintenance` `playwright-cli` |
| `plugins/docdd/templates/` | `init` がプロジェクトへ置く雛形（CLAUDE.md・docs・tasks・scripts・設定） |
| `plugins/docdd/README.md` | 利用者向けの説明書（中身の一覧・2つの入れ方・注意） |

スキル本文の `npm run …`・`src/…` は元のアプリ（Exos AI・Next.js／Supabase）での実例です。各スキルの冒頭に前提として明記してあり、コマンドはあなたのプロジェクトの `CLAUDE.md`「検証コマンド」表を正にして読み替えます。
手順書そのものを自分のプロジェクトに合わせて直したい場合は、プラグインではなく zip 版（上のブログ記事から入手。`.claude/skills/` に実ファイルとして置く）を使ってください。

## 更新

新しい版は `/plugin` の画面、またはターミナルで `claude plugin update docdd` で受け取れます。
手元で試すには `claude --plugin-dir plugins/docdd` と起動します。

## ライセンス

MIT（`LICENSE`）。
