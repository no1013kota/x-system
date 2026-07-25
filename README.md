# x-system — Space AI

ユーザーの発信スタイルを学習したAIが、情報収集から投稿作成・投稿実行・分析改善までを自動化／半自動化するX自動投稿Webアプリケーション。

- 仕様の正本: [docs/](docs/) - [PRD](docs/PRD.md)／[要件定義書](docs/要件定義書.md)／[要件詳細](docs/requirements/)／[プロンプト設計書](docs/プロンプト設計書.md)
- 開発バックログ: [tasks/BACKLOG.md](tasks/BACKLOG.md)（M0〜M6）
- 開発ルール: [AGENTS.md](AGENTS.md)／[CLAUDE.md](CLAUDE.md)
- 旧版アーカイブ: [old/](old/)（参照用・同期対象外）

## 開発の始め方

リポジトリに用意した開発スキルで1タスクずつ進める。

```
/dev-loop          # バックログから1タスク進める（実装→検証→doc同期→コミット）
/loop /dev-loop    # 連続で自動開発（エージェントループ）
/doc-sync          # ドキュメント同期チェックのみ実行
/ui-polish         # UIを設計・実装し、3画面幅・主要状態・アクセシビリティを実ブラウザ検証
/verify-integration # DB・API・job等の統合テストを安全に実行
/verify-e2e         # 主要ユーザーフローをブラウザから検証
```

`/dev-loop`は新規実装か既存更新かでは分けず、変更影響に応じて`/verify-integration`と`/verify-e2e`を呼び分ける。

### Claude CodeでUI開発する場合

初回のみ公式Frontend DesignプラグインとPlaywright CLIを導入する。

```bash
claude plugin install frontend-design@claude-plugins-official
npm install -g @playwright/cli@latest
playwright-cli install --skills
```

プロジェクトのshadcn/ui・Next.js DevTools MCPは`.mcp.json`から読み込まれる。初回起動時の確認画面で、この2サーバーを承認する。

## 現在のステータス

- PRD・要件定義・プロンプト設計はv1.2で確定（レビュー反映済み。設計判断は[docs/decisions/](docs/decisions/)、初期運用は[docs/operations/](docs/operations/)参照）
- バックログ作成済み（M0〜M6）。アプリ本体は未作成でM0から実装開始
- `/loop /dev-loop`で連続自動開発を実行中
