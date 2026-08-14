# 運用メモ: リリース前チェックリスト

| 項目 | 内容 |
|---|---|
| バージョン | v1.3 |
| 更新日 | 2026-08-01 |
| 関連 | [開発とテストの進め方](./development-and-testing.md)／[デプロイ手順](./deployment.md)／[CI](./ci.md)／[システム構成 §3/§7/§9](../requirements/01_system_architecture.md)／[PRD §8.1](../PRD.md)／[DBバックアップ](./database-backup-restore.md)／[launchd→Cron](./launchd-to-vercel-cron.md)／[認証・課金・利用枠 §9](../requirements/03_auth_billing_usage.md) |

MVPリリース前の判定項目。開発側で消化できる項目は本セッション（T-M6-21, 2026-07-25）で実施・記録した。運営者アカウント・実キー・法務確認が要る項目は §3 に担当・期日欄付きで残す。

## 1. 開発側で消化済み（実施・記録）

| # | 項目 | 結果 | 根拠 |
|---|---|---|---|
| 1 | リリース判定ゲート `npm run release:check`（typecheck→lint→依存監査→**test:db**→build→**check:csp-nonce**→**test:e2e**）がローカルで全成功。`test:db` は `REQUIRE_DB=1` でDBテスト58本のskipを禁止し、`test:e2e` でE2Eの実行も必須にした（2026-07-26追加。従来はDB未起動でも緑になり、E2Eは手動起動だった） | ✅ 済 | T-M6-20（exit 0 確認・2026-07-25）。2026-07-27に GitHub Actions（[CI](./ci.md)）へ組み込み、push/PRで自動実行 |
| 2 | dev/preview で `X_POSTING_MODE=live` を設定すると起動時 env 検証が失敗（prodのみ live 可） | ✅ 済 | `env-schema.ts` superRefine ＋ `env-schema.test.ts`「rejects live in development/preview」「allows in production」 |
| 3 | DB論理バックアップの初回取得＋空DBへの復元 round-trip（schema・seed 一致） | ✅ 済 | T-M6-19（public 18テーブル・`prompt_templates` seed 7件一致、暗号化 dump は `Salted__` 暗号文） |
| 4 | セキュリティヘッダ（nonce CSP／HSTS／nosniff／Referrer-Policy）が production build で全応答に付与 | ✅ 済 | T-M6-17（`next start`＋curl 確認・ADR-0005） |
| 5 | RLS（別ユーザーの select/write 拒否・全 public table）／SSRF（private/loopback/link-local＋redirect先再検証＋timeout）／認可（CRON_SECRET・Stripe署名・Origin） | ✅ 済 | `rls.db.test.ts`／`post/source-url.test.ts`／`api/cron/route-auth.test.ts`・`jobs/auth.test.ts`・`stripe/webhook.test.ts`（release:check 内） |
| 6 | 秘密値参照モジュールの `server-only` 境界（Client import でビルド失敗） | ✅ 済 | T-M6-18（`security/server-boundary.test.ts` 動的走査） |
| 7 | ログ redact／安全なエラー変換（provider 本文・stack を返さない） | ✅ 済 | T-M6-18（`observability/redact.test.ts`・`errors.test.ts`） |
| 8 | 環境変数一覧（要件01 §3）の dev 充足で全テスト・build が稼働 | ✅ 済 | `.env.local`＋`release:check` 稼働。preview/prod 必須変数の充足は §3（人間側） |
| 9 | launchd→Vercel Cron 移行条件・手順の確認 | ✅ 済（手順整備） | [launchd-to-vercel-cron.md](./launchd-to-vercel-cron.md)。実移行はコスト/運用判断（人間側） |
| 10 | 外部API「実装時に要確認」注記の実装時点での確認 | ✅ 済（実装時） | 各コード/ドキュメントに確認日を記載（例: 要件05 §2.2 AI models list 2026-07-23、要件03 §9 Stripe、要件04 X OAuth 2026-07-23）。**AI providerのリクエスト形状は `npm run check:providers` で実APIに対して確認する**（2026-07-27追加。同日の初回実行でAnthropicのWeb検索400とGemini画像生成の404を検出）。**リリース直前の pay-per-use 単価・API バージョン最終再確認は §3（Developer Console 要）** |

## 2. dry_run → live 切替手順と rollback

### 切替手順（本番のみ）
0. **ローカルDBを本番へ持ち込む場合に限り**、先に `npm run db:clean-test-data -- --apply` を実行する。ローカル検証で作られた送信待ちのお知らせメールが残っていると、**本番で初回の定時実行がまとめて送信する**（T-M7-31・D-9 案A）。滞留の有無は `npm run doctor` の「お知らせメール」で分かる。別DBを新規に用意する通常の流れでは不要。
1. §3 の人間側項目（本番キー・アカウント・単価確認・法務確認）がすべて完了していることを確認する。
2. X 検証用アカウントで「少数ポスト投稿 → 自動 rollback 削除」の live E2E を本番相当で1回実施する（要決定 M3・費用発生のため実施タイミングは運営判断）。
3. Vercel 本番環境変数に `X_POSTING_MODE=live` を設定する（dev/preview は `dry_run` のまま。設定すると起動時検証で弾かれる）。
4. デプロイ後、起動時 env 検証がパスすること（本番なので live 許容）と、少数の実投稿で成功・rollback を確認する。

### rollback 手順
- 本番 `X_POSTING_MODE` を `dry_run` へ戻して再デプロイ（以降 X への書き込みを停止。記帳・日次上限検証は継続）。
- 進行中の自動投稿を止める場合は SC-08／SC-11 の「自動投稿をすべて停止」で当該 X アカウントの auto slot と未投稿 auto job を無効化する。
- データ不整合時は [DBバックアップと復元](./database-backup-restore.md) の手順で直近バックアップから復元する（RPO 最大7日）。

## 3. 人間側残項目（担当・期日）

> 担当は「運営者」（アカウント・キー・法務・費用判断）。期日は原則「本番リリース前」。詳細は `tasks/BACKLOG.md` の「要決定・外部準備」を正とする。

| # | 項目 | 担当 | 期日 |
|---|---|---|---|
| 1 | X Developer App（本番/運営・BYOK検証用）作成、callback URL 登録、credit/予算設定、pay-per-use 実単価確認（`X_COST_*`） | 運営者 | リリース前 |
| 2 | Stripe 本番 Price 3種・`STRIPE_WEBHOOK_SECRET`・Customer Portal Configuration・API バージョン確認（結果は実装メモ/ADR へ） | 運営者 | リリース前 |
| 3 | AI 各社（Anthropic/OpenAI/Gemini）本番キー発行と採用モデル名確定（`*_TEXT_MODEL`／`*_IMAGE_MODEL`） | 運営者 | リリース前 |
| 4 | Supabase preview/prod プロジェクト、Auth rate limit／Turnstile、Gmail App Password（SMTP）設定 | 運営者 | リリース前 |
| 5 | `SENTRY_DSN`／`NEXT_PUBLIC_SENTRY_DSN` 発行 | 運営者 | リリース前 |
| 6 | 本番 `APP_ENCRYPTION_KEY`・`CRON_SECRET` の生成と安全な保管（Vercel/1Password 等） | 運営者 | リリース前 |
| 7 | 独自ドメイン・`APP_BASE_URL`・Vercel Pro 契約 | 運営者 | リリース前 |
| 8 | 利用規約／プライバシー／特定商取引法表記の文面確定と法務専門家確認、`CURRENT_TERMS/PRIVACY_VERSION` 確定 | 運営者 | リリース前 |
| 9 | ~~依存脆弱性の残り high（`sharp`／nested `postcss`）の解消~~ → **2026-08-01 完了（T-M7-32）**。`sharp` 0.35.3・`postcss` 8.5系へ上げ、`overrides` で next の nested 版も寄せた。本番依存の high は `brace-expansion`（ビルド時のみ到達）1件のみ | 開発 | 完了 |
| 10 | 常時稼働 Mac（Asia/Tokyo・スリープ無効・launchd）の実配置、バックアップ実行環境・暗号化ファイル保管先・`BACKUP_ENCRYPTION_KEY` の保管 | 運営者 | リリース前 |
| 11 | X live E2E（少数ポスト投稿→自動 rollback 削除）の本番相当での1回実施 | 運営者 | 切替直前 |
| 12 | 自動投稿同意文（consent_version）・通知メール文面の最終確認（X Automation Rules 準拠の専門家確認含む） | 運営者 | リリース前 |
