# 開発キットの作り方・配り方（運営者向け。配布物には含めない）

`kit/` が正本、`npm run dev-kit`（`scripts/dev-kit.mjs`）がプラグインのマーケットプレイス一式 `dist/docdd/` を作る。配布は**プラグインだけ**（zip 配布は 2026-09-05・T-M8-435 で廃止）。
配布物は**特定のプロジェクトに依存しない文言**にする（運営者の指示 2026-09-05・T-M8-436）。本リポジトリの名前・アプリ名・作業ID・固有コマンド・`src/` のパスを含めない。`npm run dev-kit` が出力の .md／.json を機械検査し、含まれていれば止まる。

## 正本と出力

| 正本 | 何になるか |
|---|---|
| `kit/README.md` | プラグインの `plugins/docdd/README.md`（`{{GITHUB_REPO}}` を埋めて出力） |
| `kit/MARKETPLACE_README.md` | 公開リポジトリ直下の `README.md` |
| `kit/VERSION` | プラグインの版（`plugin.json`・`marketplace.json`） |
| `kit/BUILD.json` | **生成時に書かれる**（版・中身のハッシュ・日付・元スキルのハッシュ）。コミットする。「中身が変わったのに版が同じ」「元スキルが変わったのに派生が未確認」を次回止めるための記録 |
| `kit/skills/<名前>/`（11本） | **配布用スキル。`.claude/skills/<名前>/` を汎用化した派生**（手順・表・停止条件は同じ。固有名・作業ID・固有コマンド・パス・実測値だけを除く）。出力時に本文の `/add-task` → `/docdd:add-task` 書き換え ＋ 冒頭に前提ブロック |
| `kit/plugin-skills/init/SKILL.md` | プラグイン専用の `init` スキル（**書き換えずに**そのまま写す。本文の呼び名は最初から `docdd:` 付き） |
| `kit/templates/CLAUDE.template.md` | 雛形の `CLAUDE.md`（出力時に改名。正本を `CLAUDE.md` の名前で置くと、このリポジトリで作業中の Claude Code がサブディレクトリの CLAUDE.md として読み込んでしまう） |
| `kit/templates/{docs,tasks}/`・`package.scripts.json`・`scripts/audit-allowlist.json` | 雛形（そのまま） |
| ルートの `.mcp.json`・`.claude/settings.json`（`permissions` だけ）・`scripts/check-doc-dates.mjs`・`check-doc-refs.mjs`・`audit-check.mjs` | 雛形の同名ファイル（**このリポジトリのものをそのまま配る**。kit/ 側に写しを持たない。コメントに固有の作業IDを書かない） |

出力:

- `dist/docdd/` — マーケットプレイス一式（gitignore 済み）。公開リポジトリ `no1013kota/claude-docdd-dev-kit`（`scripts/dev-kit.mjs` の `GITHUB_REPO`）の直下へ中身をそのまま置く。
- `kit/BUILD.json` — 上記のとおり。

## `.claude/skills/` と `kit/skills/` の二重管理について

配布用スキルは本リポジトリのスキルの派生なので、本リポジトリ側を直すと配布側が古くなる。忘れても止まるように、`kit/BUILD.json` に**元スキル（`.claude/skills/<名前>/`）のハッシュ**を記録し、`npm run dev-kit -- --check`（`src/lib/ops/dev-kit.test.ts`）が「元スキル `<名前>` が変わりました。`kit/skills/<名前>/` へ反映するか判断してから `npm run dev-kit`」で赤にする。反映不要（本リポジトリ固有の変更だけ）なら、そのまま `npm run dev-kit` で記録を更新する（配布物の中身が同じなら版は上げない）。

## 手順（版を出す）

1. `kit/skills/`・雛形・README を直したら `kit/VERSION` を上げる（例 `0.1.1` → `0.1.2`）。
2. `npm run dev-kit` を実行する。`claude` コマンドがあれば `claude plugin validate --strict` まで自動で通す。
3. `dist/docdd/` の**中身**（`.claude-plugin/` `plugins/` `README.md`）を公開リポジトリの直下へ置き換えてコミット・push する（`LICENSE` はリポジトリ側のものを残す）。
4. 自分の Claude Code で `/plugin marketplace update claude-docdd-dev-kit`（初回は `/plugin marketplace add no1013kota/claude-docdd-dev-kit`）→ `/plugin install docdd@claude-docdd-dev-kit` を打ち、空のフォルダ（`git init` 済み）で `/docdd:init` が最後の検査まで緑で通ることを確かめる。
5. push する前に手元で試すには `claude --plugin-dir dist/docdd/plugins/docdd` と起動する。

## 更新するとき（忘れても止まる）

- 正本（`kit/**`・ルートの `.mcp.json`／検査スクリプト／許可設定）を変えたら `npm run dev-kit` を再実行する。**忘れると `src/lib/ops/dev-kit.test.ts`（`npm test` に含まれる）が「npm run dev-kit を実行してください」で赤になる**（正本から作り直した中身のハッシュを `kit/BUILD.json` と突き合わせる）。
- 中身が変わっているのに `kit/VERSION` が前回と同じなら、`npm run dev-kit` は「kit/VERSION を上げてください」で止まる（同じ版のままだと利用者側が更新を検知しない）。公開前の試行錯誤で版を動かしたくないときだけ `npm run dev-kit -- --same-version`。
- 版を上げたら手順3のとおり公開リポジトリへ push する。利用者は `/plugin` の画面（または `claude plugin update docdd`）で受け取る。
- `npm run dev-kit -- --check` は生成せずに突き合わせだけ行う（上のテストが呼ぶもの）。
