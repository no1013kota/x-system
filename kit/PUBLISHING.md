# 開発キットの作り方・配り方（運営者向け。配布物には含めない）

`kit/` と `.claude/skills/` が正本、`npm run dev-kit`（`scripts/dev-kit.mjs`）が配布物を作る。利用者向けの説明は `kit/README.md`（zip とプラグインに同梱）と `kit/MARKETPLACE_README.md`（公開リポジトリの直下）。

## 正本と出力

| 正本 | 何になるか |
|---|---|
| `kit/README.md` | zip の `README.md`／プラグインの `plugins/docdd/README.md`（`{{GITHUB_REPO}}` を埋めて出力） |
| `kit/MARKETPLACE_README.md` | 公開リポジトリ直下の `README.md` |
| `kit/VERSION` | プラグインの版（`plugin.json`・`marketplace.json`） |
| `kit/BUILD.json` | **生成時に書かれる**（版・中身のハッシュ・日付）。コミットする。「中身が変わったのに版が同じ」を次回止めるための記録 |
| `kit/templates/CLAUDE.template.md` | 雛形の `CLAUDE.md`（出力時に改名。正本を `CLAUDE.md` の名前で置くと、このリポジトリで作業中の Claude Code がサブディレクトリの CLAUDE.md として読み込んでしまう） |
| `kit/templates/{docs,tasks}/`・`package.scripts.json`・`scripts/audit-allowlist.json` | 雛形（そのまま） |
| `kit/plugin-skills/init/SKILL.md` | プラグイン専用の `init` スキル（**書き換えずに**そのまま写す。本文の呼び名は最初から `docdd:` 付き） |
| ルートの `.mcp.json`・`.claude/settings.json`（`permissions` だけ）・`scripts/check-doc-dates.mjs`・`check-doc-refs.mjs`・`audit-check.mjs` | 雛形の同名ファイル（**このリポジトリのものをそのまま配る**。kit/ 側に写しを持たない） |
| `.claude/skills/`（`blog-write`・`blog-publish` 以外の11本） | zip は**そのまま**。プラグインは本文の `/add-task` → `/docdd:add-task` 書き換え ＋ 冒頭に「`npm run …` は元アプリの実例」の前提ブロックを差し込む |

出力:

- `public/blog-files/claude-code-dev-kit.zip` — 記事の読者向け。**コミット対象**。記事本文の「約NNKB」も生成時に書き換える。
- `dist/docdd/` — マーケットプレイス一式（gitignore 済み）。公開リポジトリの直下へ中身をそのまま置く。
- `kit/BUILD.json` — 上記のとおり。

## 手順

1. `scripts/dev-kit.mjs` の `GITHUB_REPO` に公開リポジトリ（例 `<owner>/docdd`）を書く。**未設定のあいだは** zip の README の「B. プラグイン」節が「準備中」になり、dist の README には `<GITHUB_REPO 未設定>` が残る（生成は止めない。手元試用のため）。
2. `npm run dev-kit` を実行する。`claude` コマンドがあれば `claude plugin validate --strict` まで自動で通す。
3. GitHub に公開リポジトリ（`GITHUB_REPO` の名前）を作り、`dist/docdd/` の**中身**（`.claude-plugin/` `plugins/` `README.md` `LICENSE`）を直下へ置いてコミット・push する。
4. 自分の Claude Code で `/plugin marketplace add <GITHUB_REPO>` → `/plugin install docdd@claude-docdd-dev-kit` を打ち、空のフォルダ（`git init` 済み）で `/docdd:init` が最後の検査まで緑で通ることを確かめる。
5. push する前に手元で試すには `claude --plugin-dir dist/docdd/plugins/docdd` と起動する。

## 更新するとき（忘れても止まる）

- スキル・雛形・ルートの `.mcp.json`／検査スクリプトのどれかを変えたら `npm run dev-kit` を再実行する。**忘れると `src/lib/blog/dev-kit-zip.test.ts`（`npm test` に含まれる）が「npm run dev-kit を実行してください」で赤になる**（zip の中身と `kit/BUILD.json` を正本から作り直して突き合わせる）。
- 中身が変わっているのに `kit/VERSION` が前回と同じなら、`npm run dev-kit` は「kit/VERSION を上げてください」で止まる（同じ版のままだと利用者側が更新を検知しない）。`0.1.0` → `0.1.1` のように上げてから再実行する。公開前の試行錯誤で版を動かしたくないときだけ `npm run dev-kit -- --same-version`。
- 版を上げたら手順3のとおり dist の中身をもう一度公開リポジトリへ置いて push する。利用者は `/plugin` の画面（または `claude plugin update docdd`）で受け取る。
- `npm run dev-kit -- --check` は生成せずに突き合わせだけ行う（上のテストが呼ぶもの）。
