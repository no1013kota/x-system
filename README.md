# x-system — Exos AI

ユーザーの発信スタイルを学習したAIが、情報収集から投稿作成・投稿実行・分析改善までを自動化／半自動化するX自動投稿Webアプリケーション。

| 入口 | 場所 |
|---|---|
| 仕様の正本と地図 | [docs/README.md](docs/README.md) |
| 開発ルール・スキルの地図・必須の検証 | [CLAUDE.md](CLAUDE.md) |
| 作業キュー・要決定 | [tasks/BACKLOG.md](tasks/BACKLOG.md) |
| 運用中の見張り方 | [docs/operations/monitoring.md](docs/operations/monitoring.md) |

## 開発の始め方

**スキルの一覧と使い分けは [CLAUDE.md](CLAUDE.md)「スキルの地図」が正本。** 流れは
要望 → `/add-task` → `/dev-loop`（中で `/doc-sync` と検証スキルを呼ぶ）→ コミット。
連続自動開発は `/loop /dev-loop`。

### 初回セットアップ（Claude CodeでUI開発する場合）

初回のみ公式Frontend DesignプラグインとPlaywright CLIを導入する。

```bash
claude plugin install frontend-design@claude-plugins-official
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

プロジェクトのshadcn/ui・Next.js DevTools MCPは`.mcp.json`から読み込まれる。初回起動時の確認画面で、この2サーバーを承認する。

## 現在のステータス

**[tasks/BACKLOG.md](tasks/BACKLOG.md) 冒頭の「現在の状況と次の一手」を見る。**
ここへ写すと片方だけ古くなる（以前この節は「アプリ本体は未作成」と書いたままM8まで進んでいた）。
