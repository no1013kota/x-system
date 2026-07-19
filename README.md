# x-system — Space AI

ユーザーの発信スタイルを学習したAIが、情報収集から投稿作成・投稿実行・分析改善までを自動化／半自動化するX自動投稿Webアプリケーション。

- 要件定義（正本）: [document/PRD_SpaceAI_v1.0.md](document/PRD_SpaceAI_v1.0.md)
- ドキュメント一覧と同期ルール: [document/README.md](document/README.md)
- 開発バックログ: [tasks/BACKLOG.md](tasks/BACKLOG.md)
- 開発ルール（Claude Code向け）: [CLAUDE.md](CLAUDE.md)

## 開発の始め方

開発は Claude Code 中心で行う。リポジトリ直下で `claude` を起動し:

```
/dev-loop          # バックログから1タスク進める（実装→検証→doc同期→コミット）
/loop /dev-loop    # 連続で自動開発（エージェントループ）
/doc-sync          # ドキュメント同期チェックのみ実行
```

## 現在のステータス

- 開発環境セットアップ完了
- **次のアクション**:
  1. `document/decisions/ADR-0001-tech-stack.md`（技術スタック提案）の確認・承認
  2. PRDから `tasks/BACKLOG.md` へタスクを起こす（開発開始時）
  3. `/dev-loop` で開発開始
