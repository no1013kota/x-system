# docdd — 非エンジニアのための Claude Code 開発キット

このリポジトリは Claude Code の**プラグイン マーケットプレイス**です。
1人の非エンジニアが Claude Code で Web アプリを作り続けるための「約束（CLAUDE.md）・仕様書（docs）・作業キュー（BACKLOG）・手順書（skills）」を、プラグイン1本で入れられるようにしています。特定のアプリやフレームワークには依存しません。
背景と使い方の全体像はブログ記事「[非エンジニアが Claude Code でアプリを作り続けるための仕組み](https://exosai.net/blog/claude-code-non-engineer-workflow)」にあります。

## 入れ方（3コマンド）

Claude Code の中で次を順に打つ。GitHub のアカウントは要らない。

1. `/plugin marketplace add {{GITHUB_REPO}}`
2. `/plugin install docdd@claude-docdd-dev-kit`
   - 範囲（User／Project／Local）を聞かれたら User を選ぶ
   - 終わりに「Run /reload-plugins to activate.」と出たら `/reload-plugins` と打つ（Claude Code の再起動は不要）
3. 自分のプロジェクトのフォルダ（一番上の階層）で Claude Code を起動し、`/docdd:init`
   （前置き無しの `/init` は Claude Code 組み込みの別コマンドなので打たない）

1・2 はどのフォルダで起動していてもよく、一度入れれば全プロジェクトで使えます。3 だけはプロジェクトのフォルダで打ちます。

`init` が雛形（`CLAUDE.md` `docs/` `tasks/` `scripts/` `.mcp.json` `.claude/settings.json`）を**既存ファイルを上書きせずに**置き、`package.json` に検査コマンドを3つ足し、`CLAUDE.md`・`docs/PRD.md` などの `<...>` を1回のヒアリングで埋めます。
以降のコマンドは `/docdd:add-task` `/docdd:dev-loop` のように `docdd:` の前置きで呼びます。

## このリポジトリの中身

| パス | 役割 |
|---|---|
| `.claude-plugin/marketplace.json` | マーケットプレイス定義（名前 `claude-docdd-dev-kit`） |
| `plugins/docdd/.claude-plugin/plugin.json` | プラグイン定義（名前・版） |
| `plugins/docdd/skills/<名前>/SKILL.md` | 手順書（スキル）11本と、導入用の `init`。`add-task` `dev-loop` `doc-sync` `verify-integration` `verify-e2e` `ui-polish` `refactor` `speed-up` `security-audit` `maintenance` `playwright-cli` ＋ `init` |
| `plugins/docdd/templates/` | `init` がプロジェクトへ置く雛形（CLAUDE.md・docs・tasks・scripts・設定） |
| `plugins/docdd/README.md` | 利用者向けの説明書（入れ方・`init` が置くもの・手順書を自分で直したいとき・注意） |

スキル本文の「型検査」「単体テスト」「E2E」は、あなたのプロジェクトの `CLAUDE.md`「検証コマンド」表のコマンドを指します（`init` のヒアリングで埋まります）。
手順書そのものを自分のプロジェクトに合わせて直したいときは、プラグインが入った状態で Claude Code に「docdd プラグインの手順書（init 以外）を .claude/skills/ に写して、写したものと CLAUDE.md の docdd: の前置きを全部外して」と頼み、そのあと `/plugin uninstall docdd@claude-docdd-dev-kit` で外して Claude Code を起動し直します（手順は `plugins/docdd/README.md`）。本文を読みたいだけなら `plugins/docdd/skills/` にあります。

## 更新

新しい版は `/plugin` の画面（Installed タブ）か、Claude Code を終了したターミナルで `claude plugin update docdd` で受け取れます。受け取ったら Claude Code を起動し直す（または `/reload-plugins`）と新しい版になります。
手元で試すには `claude --plugin-dir plugins/docdd` と起動します。

## ライセンス

Apache-2.0（`LICENSE`）。
