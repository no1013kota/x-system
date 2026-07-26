# 運用メモ: デプロイ手順（ローカル → staging → production）

| 項目 | 内容 |
|---|---|
| バージョン | v1.1 |
| 更新日 | 2026-07-27 |
| 関連 | [CI](./ci.md)／[システム構成 §3 環境変数](../requirements/01_system_architecture.md)／[リリース前チェックリスト](./release-checklist.md)／[launchd→Vercel Cron](./launchd-to-vercel-cron.md)／[DBバックアップ](./database-backup-restore.md)／[ローカル開発](./local-development.md) |

Vercel（Next.js）＋ Supabase（Postgres/Auth/Storage）構成のデプロイ手順。**staging = Vercel の preview 環境（`APP_ENV=preview`）**、production = 同 production 環境（`APP_ENV=production`）とする。

環境の分離方針: **Supabase プロジェクトは staging と production で分ける**。同一DBを共有すると、staging の検証データが本番の利用枠・実績・課金状態へ混入する。

---

## 0. 前提の確認

デプロイ前に、ローカルで次がすべて緑であること。

```bash
npm run release:check    # typecheck → lint → 依存監査 → test:db → build → test:e2e
```

同じゲートは push / PR で GitHub Actions も実行する（[CI](./ci.md)）。ただし **CIはデプロイをブロックしない**（`main` への push でCIとVercelのproductionビルドは並行して走る）。ブロックしたい場合は branch protection で `main` を保護し、CIをrequired status checkにしてPR経由でのみマージする。

---

## 1. 用意するもの（環境ごと）

`src/lib/env-schema.ts` が起動時に検証する。1つでも欠けると**起動に失敗する**（黙って劣化しない）。

### 1.1 全環境で必須（19）

| 変数 | 取得元 |
|---|---|
| `APP_BASE_URL` | デプロイ先URL（例 `https://stg.example.com`） |
| `APP_ENV` | `preview` / `production` |
| `CRON_SECRET` | 自分で生成（下記）。cron・job dispatch の認証 |
| `APP_ENCRYPTION_KEY` | 自分で生成（下記）。**環境ごとに別の値**。紛失すると保存済みトークン・APIキーを復号できない |
| `SUPPORT_EMAIL` | 問い合わせ先 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase プロジェクト設定 → API |
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler**（Supavisor）。直結ではなくpooler側 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe（stagingはtest、本番はlive） |
| `STRIPE_PRICE_STANDARD_MONTHLY` / `_MD_` / `_PREMIUM_` | Stripe の Price ID 3種 |
| `ANTHROPIC_TEXT_MODEL` / `OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL` / `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` | 採用モデル名 |

### 1.2 preview / production で追加必須（16）

| 変数 | 取得元 |
|---|---|
| `NEWS_TEXT_PROVIDER` | `anthropic` / `openai` / `google` |
| `X_MANAGED_CLIENT_ID` | 運営 X App（premium 用）の Client ID |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Customer Portal 構成ID（`npm run stripe:portal:setup` で作成可） |
| `X_COST_CONTENT_CREATE_USD` / `_WITH_URL_USD` / `X_COST_INTERACTION_DELETE_USD` | X Developer Console の pay-per-use 実単価 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_APP_PASSWORD` | Gmail App Password 等 |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | 送信元・返信先 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry |

さらに `PREMIUM_TEXT_PROVIDER` / `NEWS_TEXT_PROVIDER` で選んだ provider の**運営APIキー**（`ANTHROPIC_API_KEY` 等）が必須。未設定だと起動しない。

### 1.3 秘密値の生成

```bash
# 32バイト鍵（環境ごとに別値。1Password 等へ保管してから登録する）
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

`.env*` はコミットしない。値は Vercel の環境変数と保管庫にだけ置く。

---

## 2. Supabase プロジェクトの用意（staging → production で各1回）

1. Supabase で新規プロジェクトを作成（region は東京 `ap-northeast-1` 推奨）。
2. マイグレーションを適用する。

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # supabase/migrations/*.sql を順に適用
   ```

3. seed（`prompt_templates` 等）が必要なら投入する。`supabase/seed.sql` はローカル用なので、本番へ入れる範囲を確認してから流す。
4. Auth 設定: メール確認を有効化、**rate limit** を設定、Turnstile（CAPTCHA）を有効化。
5. `profiles` 自動作成トリガーが入っていることを確認（マイグレーション同梱）。

適用結果の確認:

```bash
npx supabase migration list      # ローカルとリモートの差分が無いこと
```

---

## 3. Vercel プロジェクトの用意

1. GitHub リポジトリを Vercel へ import（Framework: Next.js、Root: リポジトリ直下）。
2. 環境変数を **Preview** と **Production** で別々に登録する（§1 の一覧）。
   - `APP_ENV` は Preview=`preview`、Production=`production`
   - `X_POSTING_MODE` は **Preview では設定しない（既定 `dry_run`）**。`live` を入れると起動時検証で落ちる（意図的な保護）
   - `APP_BASE_URL` は各環境の実URL
3. Node バージョンは Vercel の LTS 既定のままでよい（ローカルの Node 26 Current とは異なる）。
4. デプロイ後、**起動時 env 検証が通ること**をログで確認する。落ちていれば不足変数名がそのまま出る。

---

## 4. 外部サービス側の登録（URLが決まってから）

| サービス | 登録内容 |
|---|---|
| X Developer App | callback URL に `APP_BASE_URL + X_OAUTH_REDIRECT_PATH` を登録。scope 5種。staging と production で**別App**にする |
| Stripe | Webhook endpoint に `APP_BASE_URL/api/stripe/webhook` を登録し、払い出された署名シークレットを `STRIPE_WEBHOOK_SECRET` へ |
| Turnstile | サイトのドメインを登録（staging/production 別キー） |
| Supabase Auth | Site URL / Redirect URLs に `APP_BASE_URL` を登録 |

---

## 5. デプロイ後の検証

環境ごとに次を確認する。

1. `/` `/login` `/signup` `/terms` `/privacy` が 200。
2. サインアップ → 確認メール受信 → ログイン（Turnstile が動作すること）。
3. セキュリティヘッダ: `curl -sI <URL> | grep -iE "content-security-policy|strict-transport-security|x-content-type-options|referrer-policy"`
4. cron エンドポイントの認証: `CRON_SECRET` 無しで 401、有りで 2xx。

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$APP_BASE_URL/api/cron/scheduler-tick"                              # 401
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$APP_BASE_URL/api/cron/scheduler-tick" -H "authorization: Bearer $CRON_SECRET"  # 2xx
   ```

5. Sentry にイベントが届くこと。
6. staging では **X_POSTING_MODE が dry_run のまま**であることを確認する（実投稿しない）。

---

## 6. 定時実行（cron）

初期は**常時稼働 Mac の launchd** で4本を叩く構成。Vercel Cron へ移す場合は `vercel.json` に `crons` を追加して production へデプロイする。**手順とロールバックは [launchd→Vercel Cron](./launchd-to-vercel-cron.md) を正とする**。

- staging（preview）では Vercel Cron は動かない。定時処理を検証したい場合は cron エンドポイントを手動で叩く。
- launchd と Vercel Cron が一時的に重複しても、handler の時間窓受付（`cron_runs`）と冪等keyで外部処理は重複しない。

---

## 7. production 固有の手順

1. [リリース前チェックリスト §3](./release-checklist.md) の運営者項目がすべて完了していること。
2. 法務3ページの文面確定と `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` の確定。
3. `X_POSTING_MODE=live` への切替は**最後**。手順とロールバックは [リリース前チェックリスト §2](./release-checklist.md)。
4. 切替前に DB バックアップを取得する（[手順](./database-backup-restore.md)）。

---

## 8. ロールバック

| 事象 | 対応 |
|---|---|
| デプロイ後に不具合 | Vercel Dashboard で直前のデプロイへ Instant Rollback |
| X へ誤投稿 | `X_POSTING_MODE=dry_run` へ戻して再デプロイ。進行中の自動投稿は SC-08／SC-11 の「自動投稿をすべて停止」 |
| DB不整合 | [DBバックアップと復元](./database-backup-restore.md)（RPO 最大7日） |
| マイグレーション失敗 | `supabase db push` は失敗時に中断する。復元は上記バックアップ手順 |
