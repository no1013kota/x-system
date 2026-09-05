# 非エンジニアのための Claude Code 開発キット

このフォルダは、**1人の非エンジニアが Claude Code で Web アプリを作り続ける**ための最小セットです。
ブログ記事「非エンジニアが Claude Code でアプリを作り続けるための仕組み」で説明している
「守る約束（CLAUDE.md）」「仕様の正本（docs）」「作業キュー（BACKLOG）」「決まった手順（skills）」の4点です。
CLAUDE.md・docs・tasks は特定のアプリに依存しない形に書き直し、skills は元のアプリで実際に使っているものをそのまま同封しています。

## 使い方（最初の30分）

1. 自分のプロジェクトのフォルダの一番上に、`CLAUDE.md` `.claude/skills/` `docs/` `tasks/` の4つを置く
   （この README.md は置かなくてよい。`.claude/` は隠しフォルダなので、Claude Code に配置を頼むと確実）
2. `CLAUDE.md` の `<...>` で囲んだ部分を自分の言葉に直す
   （分からなければ Claude Code に「CLAUDE.md と docs/PRD.md の <...> を、このプロジェクトに合わせて埋めて。
   .claude/skills/ の中にある元のアプリ固有のコマンド（npm run …）やファイル名も、このプロジェクトに合わせて直すか消して」と頼む）
3. `docs/PRD.md` に「何を作るか」を書く（最初は箇条書きで十分）
4. Claude Code を起動し、`/add-task 最初に作りたいこと` → `/dev-loop` の順に打つ

## 中身

| パス | 役割 |
|---|---|
| `CLAUDE.md` | Claude Code が毎回読む約束ごと。原則・手順・検証の対応表 |
| `.claude/skills/*/SKILL.md` | `/add-task` `/dev-loop` などのコマンド（手順書） |
| `docs/README.md` | 仕様書の地図と「どこに何を書くか」のルール |
| `docs/PRD.md` | 何を作るか（雛形） |
| `docs/requirements/README.md` | どう作るか（画面・データ・処理）の分け方 |
| `docs/decisions/` | 技術判断の記録（ADR）の雛形 |
| `docs/operations/development-and-testing.md` | テストの層と「いつ回すか」 |
| `tasks/BACKLOG.md` | 作業キューと「要決定」の雛形 |

## 注意

- スキルの中の `npm run ...` は、このキットの元になったアプリ（Next.js / Node.js）のコマンド名です。
  別の構成なら、`CLAUDE.md` の「変更影響 → 必須の検証」表とスキルの中のコマンドを自分のものに差し替えてください
  （上の 2 のとおり Claude Code に頼めます）。
- このキットは 2026年9月時点の Claude Code の仕組み（CLAUDE.md・skills）を前提にしています。
  公式ドキュメント: https://code.claude.com/docs/en/memory ／ https://code.claude.com/docs/en/skills
