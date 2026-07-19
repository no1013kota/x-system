# 要件詳細マップ

| 文書 | 主な内容 |
|---|---|
| [01_system_architecture.md](./01_system_architecture.md) | システム構成、技術スタック、環境変数、ルーティング、認証ガード |
| [02_data_model.md](./02_data_model.md) | DB17テーブル、enum、制約、index、RLS、JSONスキーマ、外部API原価台帳、seed |
| [03_auth_billing_usage.md](./03_auth_billing_usage.md) | 認証、Stripe課金状態、プラン変更、プレミアム利用枠、usage_events |
| [04_jobs_and_automation.md](./04_jobs_and_automation.md) | generation_jobs、即時dispatch、定時トリガー4本、lease、retry、失敗復旧 |
| [05_api_server_actions.md](./05_api_server_actions.md) | API Routes / Server Actions、入力/出力、認可、エラー形式 |
| [06_screens_onboarding_posting.md](./06_screens_onboarding_posting.md) | 画面、初期設定と実行前提、投稿/引用ポスト/画像投稿の詳細 |

## 読み方

- 実装前の正本は `docs/PRD.md`、本ディレクトリ、`docs/プロンプト設計書.md` の3領域。
- DB変更は [02_data_model.md](./02_data_model.md) を先に更新し、必要に応じて [05_api_server_actions.md](./05_api_server_actions.md) と [06_screens_onboarding_posting.md](./06_screens_onboarding_posting.md) へ波及させる。
- 利用上限や課金状態を変更するときは [03_auth_billing_usage.md](./03_auth_billing_usage.md) と PRD の料金・利用上限セクションを同時に更新する。
- ジョブ状態、cron、retryを変更するときは [04_jobs_and_automation.md](./04_jobs_and_automation.md) と [05_api_server_actions.md](./05_api_server_actions.md) のジョブAPIを同時に更新する。
- 同じ仕様を複数文書へ全文コピーしない。概要側は詳細文書へリンクし、数値・enum・JSONは所有文書だけで定義する。

## 仕様の所有先

| 変更対象 | 最初に更新する文書 |
|---|---|
| 技術スタック・環境変数・URL | 01 |
| table・enum・JSON・RLS | 02 |
| 課金状態・利用枠 | 03 |
| worker・定時トリガー・retry | 04 |
| API/Action契約・入力制約 | 05 |
| 画面・完了条件・投稿操作 | 06 |
