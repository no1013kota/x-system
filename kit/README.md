# 非エンジニアのための Claude Code 開発キット（プラグイン `docdd`）

このキットは、**1人の非エンジニアが Claude Code で Web アプリを作り続ける**ための最小セットです。
ブログ記事「[非エンジニアが Claude Code でアプリを作り続けるための仕組み](https://exosai.net/blog/claude-code-non-engineer-workflow)」で説明している
「守る約束（CLAUDE.md）」「仕様の正本（docs）」「作業キュー（BACKLOG）」「決まった手順（skills）」の4点に、
仕様書の検査スクリプトと設定ファイルを足したものです。特定のアプリやフレームワークには依存しません。

## 入れ方（3コマンド）

配布元は GitHub の `{{GITHUB_REPO}}` です（Claude Code から見た配布元の名前＝マーケットプレイス名は `claude-docdd-dev-kit`、プラグイン名は `docdd`。手順2の `@` の後ろにこの名前を付けます）。GitHub のアカウントは要りません。
Claude Code の中で次を順に打ちます（1・2はどのフォルダで起動していてもよく、一度入れれば全プロジェクトで使えます。3だけは自分のプロジェクトのフォルダで）。

1. `/plugin marketplace add {{GITHUB_REPO}}`
2. `/plugin install docdd@claude-docdd-dev-kit`
   （範囲（User／Project／Local）を聞かれたら User を選ぶ。終わりに「Run /reload-plugins to activate.」と出たら `/reload-plugins` と打つ。Claude Code の再起動は不要。入ったかどうかは `/plugin` と打つと開く画面の Installed で確かめられる）
3. 自分のプロジェクトのフォルダ（一番上の階層）で Claude Code を起動し、`/docdd:init`
   （**前置き無しの `/init` は Claude Code 組み込みの別コマンド**で、キットとは無関係の CLAUDE.md を作ってしまうので打たない）

`init` がすること:

- 下の表のファイルを置く（既にあるファイルは上書きしません。唯一の例外は組み込みの `/init` が作った `CLAUDE.md` で、キットのものへ置き換えるか1回だけ聞き、承知なら元を `CLAUDE.md.bak` に残します）
- `package.json` に仕様書の検査コマンドを3つ足す
- `CLAUDE.md`・`docs/PRD.md` などの `<...>` を1回のヒアリングで埋める（答えられなかった箇所は `<...>` のまま残し、報告に「未記入」と示します）
- 作成したファイルを `git add` し、`npm run check:doc-refs` を通してから、あなたに確認したうえでコミットする。コミットの後に `npm run check:doc-dates` を1回通す（この検査はコミットの日付を読むので、順番はこれで正しい）

以降のコマンドは `/docdd:add-task` `/docdd:dev-loop` のように `docdd:` の前置きで呼びます。

作業中、Claude Code は実行前に「このコマンドを実行してよいか」と英語で確認してきます。内容を見て Enter で許可すれば進みます。分からなければ「これは何をするの？」と日本語で聞けば説明します。

## 中身

### `init` がプロジェクトへ置くもの

| パス | 役割 |
|---|---|
| `CLAUDE.md` | Claude Code が毎回読む約束ごと。5つの原則・「検証コマンド」表・「変更影響 → 必須の検証」の対応表 |
| `.claude/settings.json` | Claude Code の許可設定。**ファイルの編集と変更の記録（`git add`／`git commit`）は確認なしで進む**。ファイルを読む・一覧するだけの操作（`git status` など）も聞かない。丸ごと削除（`rm -rf`）と管理者権限（`sudo`）は禁止。編集のたびに確認したいなら Claude Code に「.claude/settings.json の defaultMode の行を消して」と頼む |
| `.mcp.json` | Claude Code が使う外部ツール（MCP）の設定。初期値は Next.js 向け（shadcn/ui・Next.js DevTools）。Next.js でなければ `init` が空にする。使う道具に合わせて足す |
| `docs/README.md` | 仕様書の地図と「どこに何を書くか」のルール（`docs/` の中の README.md はどれも仕様書の一部） |
| `docs/PRD.md` | 何を作るか（雛形） |
| `docs/requirements/README.md` | どう作るか（画面・データ・処理）の分け方 |
| `docs/decisions/` | 技術判断の記録（ADR）の雛形 |
| `docs/operations/development-and-testing.md` | テストの層と「いつ回すか」 |
| `tasks/BACKLOG.md` | 作業キューと「要決定」の雛形 |
| `tasks/REFACTOR_PLAN.md` | リファクタ計画の雛形（`/docdd:refactor` が使う） |
| `scripts/check-doc-dates.mjs` | 仕様書の「更新日」が、その文書を最後に変えたコミットより古くないかを検査する |
| `scripts/check-doc-refs.mjs` | 仕様書が指しているファイルパスが実在するかを検査する |
| `scripts/audit-check.mjs` | 使っている既製の部品（ライブラリ）に既知の脆弱性が無いかの検査（npm の `package-lock.json` が前提）。結果を取れないときは「0件」と誤認せず止まる。深刻度 high のうち対応を保留するものは `scripts/audit-allowlist.json` に理由付きで書く（初期は空。critical は保留できない） |
| `package.json` の `scripts` | `check:doc-dates` `check:doc-refs` `audit:check` の3行を足す（既にある同名の行は変えない） |

### プラグインが提供するもの（プロジェクトには置かれない）

手順書（スキル）11本と、導入用の `init`。11本は `add-task` `dev-loop` `doc-sync` `verify-integration` `verify-e2e` `ui-polish` `refactor` `speed-up` `security-audit` `maintenance` `playwright-cli`。
`init` 以外の11本が何をするかは `CLAUDE.md` の「スキルの地図」にあります（`init` はこの README の「入れ方」）。本文は配布元（GitHub）の `plugins/docdd/skills/<名前>/SKILL.md`（この README と同じ場所にある [`skills/`](./skills/) フォルダ）で、開けば読めます。
スキルの中の「型検査」「単体テスト」「E2E」は、`CLAUDE.md`「検証コマンド」表のコマンドを指します（`init` のヒアリングで埋まります）。

## 最初の30分

1. `init` の報告に「未記入」と出た箇所（`CLAUDE.md`・`docs/PRD.md` の `<...>`）を自分の言葉で埋める。特に `docs/PRD.md` の「何を作るか」「やること」「やらないこと」は箇条書きで十分（ここだけは人間の仕事）。分からなければ Claude Code に「CLAUDE.md と docs/PRD.md の `<...>` を、このプロジェクトに合わせて埋めて。埋められない箇所は質問して」と頼む。
2. `/docdd:add-task` の後ろに最初に作りたいことを日本語で書いて打つ（例: `/docdd:add-task メールアドレスで登録・ログインできるようにしたい`）。
3. `/docdd:dev-loop` と打つ。`tasks/BACKLOG.md` の見本タスク（T-00・`done`）はそのまま残してよく、`dev-loop` には拾われない。

## 手順書（スキルの本文）を自分で直したいとき

プラグインのスキル本文は、利用者側では変えられません。手順書そのものを自分のプロジェクトに合わせて書き換えたいときは、手順書を自分のプロジェクトのフォルダ（`.claude/skills/`）に置く形へ切り替えます。

1. プラグインが入った状態で Claude Code に「docdd プラグインの手順書（init 以外）を .claude/skills/ に写して、写したものと CLAUDE.md の docdd: の前置きを全部外して」と頼む（配布元から自分でファイルを取ってくる必要はありません。本文の場所を見たいだけなら、配布元の `plugins/docdd/skills/` にあります）。
2. `/plugin uninstall docdd@claude-docdd-dev-kit` で外す。
3. Claude Code を終了して起動し直す。

手順1のあと、プラグインを外さないままにしない。`.claude/skills/` とプラグインに同じ名前の手順書が並ぶと、`CLAUDE.md` の呼び名と食い違って片方が呼ばれなくなる。

## 更新

新しい版は `/plugin` の画面（Installed タブ）か、Claude Code を終了したターミナルで `claude plugin update docdd` で受け取れます。受け取ったら Claude Code を起動し直す（または `/reload-plugins`）と新しい版になります。

## 注意

- `scripts/` の3本の検査は `init` と `/docdd:doc-sync` が回すので、ふだんは気にしなくてよい。自分で `npm run check:...` と打つときだけ次を守る（Node.js 20 以上と git が必要）。
  - 新しく置いたファイルは、先に `git add`（git の記録の対象にする操作）してから `check:doc-refs`／`check:doc-dates` を回す。この2本は git が追跡しているファイルだけを見るので、しないと「参照が1件も無い」で止まる。
  - `check:doc-dates` は最初のコミットの後にしか動かない（コミットの日付を読むため）。docs の「更新日」が `<YYYY-MM-DD>` のままでも「更新日を持つ文書が0件」で止まる（`init` は日付を自動で埋めます）。
  - `audit:check` は npm の `package-lock.json` があるプロジェクト専用。
- Node.js を使っていないプロジェクト（`package.json` が無い）では、`init` は `scripts/` を置いたまま「`node scripts/<名前>.mjs` で動く。使わないなら消してよい」と報告します。そのままでも害はなく、消したければ Claude Code に「scripts/ と CLAUDE.md の該当行を消して」と頼めばよい。
- このキットは 2026年9月時点の Claude Code の仕組み（CLAUDE.md・skills・plugins）を前提にしています。
  公式ドキュメント: https://code.claude.com/docs/en/memory ／ https://code.claude.com/docs/en/skills ／ https://code.claude.com/docs/en/plugins
