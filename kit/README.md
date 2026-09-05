# 非エンジニアのための Claude Code 開発キット

このキットは、**1人の非エンジニアが Claude Code で Web アプリを作り続ける**ための最小セットです。
ブログ記事「[非エンジニアが Claude Code でアプリを作り続けるための仕組み](https://exosai.net/blog/claude-code-non-engineer-workflow)」で説明している
「守る約束（CLAUDE.md）」「仕様の正本（docs）」「作業キュー（BACKLOG）」「決まった手順（skills）」の4点に、
仕様書の検査スクリプトと設定ファイルを足したものです。
CLAUDE.md・docs・tasks は特定のアプリに依存しない形に書き直し、skills は元のアプリ（Exos AI）で実際に使っているものをそのまま同封しています。

## 中身

| パス | 役割 |
|---|---|
| `CLAUDE.md` | Claude Code が毎回読む約束ごと。5つの原則・「検証コマンド」表・「変更影響 → 必須の検証」の対応表 |
| `.claude/skills/*/SKILL.md` | `/add-task` `/dev-loop` などのコマンド（手順書）11本。プラグインとして入れた場合はこのフォルダは作られず、プラグイン側から呼ばれる |
| `.claude/settings.json` | Claude Code の許可設定。**ファイルの編集と `git add`／`git commit`／`mkdir` は確認なしで進む**（`defaultMode: acceptEdits`）。`git status` などの読み取り系も聞かずに実行し、`rm -rf` と `sudo` は禁止。編集のたびに確認したいなら `defaultMode` の行を消す |
| `.mcp.json` | Claude Code が使う外部ツール（MCP）の設定。既定は shadcn/ui と Next.js DevTools。使わない構成なら消してよい |
| `docs/README.md` | 仕様書の地図と「どこに何を書くか」のルール（`docs/` の中の README.md はどれも仕様書の一部） |
| `docs/PRD.md` | 何を作るか（雛形） |
| `docs/requirements/README.md` | どう作るか（画面・データ・処理）の分け方 |
| `docs/decisions/` | 技術判断の記録（ADR）の雛形 |
| `docs/operations/development-and-testing.md` | テストの層と「いつ回すか」 |
| `tasks/BACKLOG.md` | 作業キューと「要決定」の雛形 |
| `tasks/REFACTOR_PLAN.md` | リファクタ計画の雛形（`/refactor` が使う） |
| `scripts/check-doc-dates.mjs` | 仕様書の「更新日」が、その文書を最後に変えたコミットより古くないかを検査する |
| `scripts/check-doc-refs.mjs` | 仕様書が指しているファイルパスが実在するかを検査する |
| `scripts/audit-check.mjs` | 依存ライブラリの脆弱性検査（npm の `package-lock.json` が前提）。結果を取れないときは「0件」と誤認せず止まる。据え置く high は `scripts/audit-allowlist.json` に理由付きで書く（初期は空） |
| `package.scripts.json` | `package.json` の `"scripts"` に足す3行（`check:doc-dates` `check:doc-refs` `audit:check`）。足したら消してよい |

スキル11本の内訳: `add-task` `dev-loop` `doc-sync` `verify-integration` `verify-e2e` `ui-polish` `refactor` `speed-up` `security-audit` `maintenance` `playwright-cli`。
何をするかは `CLAUDE.md` の「スキルの地図」にあります。

## 2つの入れ方

どちらでも中身は同じです。**迷ったら A**（自分のフォルダに全部入るので、あとで自由に直せる）。
B はスキルの更新を配布側から受け取れるかわりに、**スキルの本文（手順書）は自分では直せません**。手順書の中のコマンドを自分のプロジェクトのものに差し替えたいなら A にしてください。

### A. zip を展開して置く（4手順）

1. `claude-code-dev-kit.zip`（上のブログ記事から入手）を展開する。
2. 展開したフォルダの**一番上にある `README.md`（この説明書）だけ置かず**、残り（`CLAUDE.md` `.claude/` `docs/` `tasks/` `scripts/` `.mcp.json` `package.scripts.json`）を、自分のプロジェクトのフォルダの一番上に置く。
   `docs/` の中にある `README.md`（`docs/README.md` `docs/requirements/README.md` `docs/decisions/README.md`）は仕様書の一部なので**置く**。
   **既にあるファイルは上書きしない**。`.claude/` と `.mcp.json` は名前がドットで始まる隠しファイルなので、Claude Code に「このフォルダの中身を、一番上の README.md 以外すべて、このプロジェクトに置いて。docs/ の中の README.md は置いて。既にあるファイルは上書きしないで」と頼むと確実。
3. `package.json` があれば、`package.scripts.json` の3行を `"scripts"` の中に足す（これも Claude Code に頼める）。足したら `package.scripts.json` は消してよい。`package.json` が無い（Node.js を使っていない)なら、この手順と `scripts/` は飛ばす。
4. Claude Code を `exit` で終了して起動し直す（置いたばかりのスキルを読み込ませるため）。

<!-- plugin:start -->
### B. プラグインとして入れる（3コマンド）

配布元: GitHub の `{{GITHUB_REPO}}`（マーケットプレイス名 `claude-docdd-dev-kit`・プラグイン名 `docdd`）。
Claude Code の中で次を順に打つ。

1. `/plugin marketplace add {{GITHUB_REPO}}`
2. `/plugin install docdd@claude-docdd-dev-kit`
3. 自分のプロジェクトのフォルダで Claude Code を起動し、`/docdd:init`
   （**前置き無しの `/init` は Claude Code 組み込みの別コマンド**で、キットとは無関係の CLAUDE.md を作ってしまうので打たない）

`init` が `CLAUDE.md` `docs/` `tasks/` `scripts/` `.mcp.json` `.claude/settings.json` を**既存ファイルを上書きせずに**置き、`package.json` に3行を足し、`CLAUDE.md` の `<...>` を1回のヒアリングで埋め、検査を通して（承知のうえで）コミットまで行います。
プラグインとして入れた場合、コマンドは `/docdd:add-task` `/docdd:dev-loop` のように `docdd:` の前置きが付きます（プラグイン版の雛形は最初からこの表記です）。
B ではスキル本文は直せません。差し替えたいなら A（`/plugin uninstall docdd@claude-docdd-dev-kit` のあと zip の `.claude/skills/` を置き、`CLAUDE.md` の前置きを外す）。
<!-- plugin:end -->

## 最初の30分

1. `CLAUDE.md` の `<...>` で囲んだ部分を自分の言葉に直す。分からなければ Claude Code に
   「CLAUDE.md と docs/PRD.md の `<...>` を、このプロジェクトに合わせて埋めて。`.claude/skills/` の中にある元のアプリ固有のコマンド（npm run …）やファイル名も、このプロジェクトに合わせて直すか消して。埋められない箇所は質問して」と頼む（B なら `init` が同じことをする。スキル本文は B では直せないので、`CLAUDE.md` の「検証コマンド」表を正にして読み替える）。
2. `docs/PRD.md` に「何を作るか」を書く（最初は箇条書きで十分。ここだけは人間の仕事）。
3. `/add-task 最初に作りたいこと` → `/dev-loop` の順に打つ（B なら `/docdd:add-task` → `/docdd:dev-loop`）。

## 注意

- スキルの中の `npm run ...`・`src/...`・`T-M8-...` は、このキットの元になったアプリ（Next.js / Node.js / Supabase）のコマンド名・ファイル名・作業IDです。
  別の構成なら、`CLAUDE.md` の「検証コマンド」表を自分のものに書き、A ならスキルの中のコマンドも差し替えてください（上の「最初の30分」1 のとおり Claude Code に頼めます）。
  元のアプリ専用のコマンド（`release:*` `doctor` `smoke:live` `check:providers` `check:turnstile` `check:csp-nonce` `db:clean-test-data`）はキットに入っていません。
- `scripts/` の3本は Node.js 20 以上と git が必要です（`check:doc-dates` はコミットの日付を読む。`audit:check` は npm の `package-lock.json` が要る）。
  `check:doc-refs` と `check:doc-dates` は **git が追跡しているファイルだけ**を見るので、置いた直後は `git add`（stage）してから実行してください。stage 前は「参照が1件も無い（検出器が空振り）」で止まります。
  `check:doc-refs` は雛形の `CLAUDE.md` が `scripts/` の3本を指しているので、`scripts/` を残す限り通ります。
  `check:doc-dates` は**最初のコミットの後**に実行してください（コミットが無いと「最初のコミットの後に実行してください」で止まる）。docs の「更新日」が `<YYYY-MM-DD>` のままでも「更新日を持つ文書が0件」で止まるので、日付を埋めてから（B の `init` は自動で埋めます）。
- このキットは 2026年9月時点の Claude Code の仕組み（CLAUDE.md・skills・plugins）を前提にしています。
  公式ドキュメント: https://code.claude.com/docs/en/memory ／ https://code.claude.com/docs/en/skills ／ https://code.claude.com/docs/en/plugins
