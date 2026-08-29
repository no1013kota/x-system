---
name: playwright-cli
description: Automate browser interactions, test web pages and work with Playwright tests.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# playwright-cli：ブラウザ操作の道具箱

他のスキル（`/ui-polish`・`/verify-e2e`）から呼ばれる。**ここは入口だけ**——詳しい使い方は
`references/` に分けてある（必要になったものだけ読む）。全コマンドは `playwright-cli --help`。

## この репо での使い方

```bash
playwright-cli open http://127.0.0.1:3000/login   # localhost ではなく 127.0.0.1（X OAuthの制約）
playwright-cli snapshot                            # 現在の画面（refは e15 のような形で返る）
playwright-cli find "ログイン"                      # 大きい画面はsnapshot全体より検索が安い
playwright-cli fill e5 "user@example.com"
playwright-cli click e15
playwright-cli eval "el => el.naturalWidth" e7     # 画像が実際に読めたかは属性で見る
playwright-cli console                             # コンソールエラー
playwright-cli requests                            # 失敗したリクエスト
playwright-cli resize 390 844                      # モバイル幅
playwright-cli screenshot --filename=/tmp/claude/x.png
playwright-cli close
```

- **ログインが要る画面**は `state-save` / `state-load` でセッションを使い回す（`references/storage-state.md`）。
- `--raw` を付けると値だけ返る（`playwright-cli --raw eval "document.title"`）。
- **スクショ・traceはコミットしない。** 置き場はscratchpad。

## 落とし穴（この repo で実際に踏んだもの）

- **要素があること ≠ 表示されていること。** 画像は `naturalWidth > 0` まで見る。CSP違反・署名URLの
  失効・デコード失敗は、実物を描画したときにしか出ない（T-M7-22）。
- **`next dev` は初回リクエストでrouteをコンパイルする。** 触った直後の1回目は数十秒かかることがある。
  「遅い＝壊れている」と決める前に、編集を挟まずもう一度開く。
- **Next.js 16 は同じディレクトリで2つ目の `next dev` を拒む。** 別ポートで確かめたいときは
  `npm run build` ＋ `PORT=<別> npx next start`。

## 詳しい話（必要になったら読む）

| やりたいこと | 参照 |
|---|---|
| Playwrightテストの実行・デバッグ | `references/playwright-tests.md` |
| リクエストのモック | `references/request-mocking.md` |
| ブラウザ内でコードを走らせる | `references/running-code.md` |
| セッション管理（複数ブラウザ） | `references/session-management.md` |
| cookie / localStorage | `references/storage-state.md` |
| テスト生成（plan / generate / heal） | `references/test-generation.md` |
| trace | `references/tracing.md` |
| 動画 | `references/video-recording.md` |
| 要素の属性を見る | `references/element-attributes.md` |

## インストール

グローバルの `playwright-cli` が無ければ `npx playwright cli`、それも無ければ
`npm install -g @playwright/cli@latest`。
