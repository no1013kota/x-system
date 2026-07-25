# 運用メモ: ローカル開発環境の起動

| 項目 | 内容 |
|---|---|
| バージョン | v1.0 |
| 更新日 | 2026-07-25 |
| 関連 | [supabase/README.md](../../supabase/README.md)／[システム構成 §3 環境変数](../requirements/01_system_architecture.md)／[リリース前チェックリスト](./release-checklist.md)／[DBバックアップ](./database-backup-restore.md) |

Space AI（Next.js 16 App Router + Supabase）をローカルで動かすための手順。**現在このマシンでは既にセットアップ済みで、アプリは http://localhost:3000 で起動中**。日常起動は §1、初回/別マシンは §2、動作範囲と「実キーが要る機能」は §5 を参照。

---

## 0. ポート早見表

| URL | 用途 |
|---|---|
| http://localhost:3000 | アプリ（Next.js dev） |
| http://localhost:54323 | Supabase Studio（DB/認証のGUI管理） |
| http://localhost:54324 | ローカルメール受信（Mailpit）— サインアップ確認メール等はここに届く |
| http://localhost:54321 | Supabase API（kong） |
| `127.0.0.1:54322` | ローカルDB（Postgres 17。接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`） |

---

## 1. 日常の起動（セットアップ済みの場合）

```bash
colima start                # Dockerランタイム（停止していれば）
supabase start              # ローカルSupabaseスタック（停止していれば）
npm run dev                 # → http://localhost:3000
```

- 停止: dev サーバーは `Ctrl+C`（バックグラウンド起動時は `pkill -f "next dev"`）。スタックは `supabase stop`。
- 稼働確認: `supabase status` / `docker ps | grep supabase`。

---

## 2. 初回セットアップ（別マシン / クリーン状態）

### 2.1 前提ツール

| ツール | 導入 | 備考 |
|---|---|---|
| Node.js 20以上 | （nodenv/nvm等） | 本マシンは v26。Next 16の要件 |
| colima | `brew install colima` → `colima start --cpu 4 --memory 8` | Docker Desktop 不使用（GUI/ライセンス不要） |
| Supabase CLI | `brew install supabase` | ローカルスタック管理 |
| PostgreSQL 17 クライアント + openssl | `brew install postgresql@17`（openssl は同梱/既存） | **バックアップ/復元でのみ**必要。起動には不要 |

### 2.2 手順

```bash
# 1) 依存
npm install

# 2) ローカルSupabase起動（初回はイメージpullで数分）
colima start --cpu 4 --memory 8
supabase start
supabase db reset            # migrations適用 + seed.sql投入（prompt_templates 7件）を確実に当てる

# 3) 環境変数
cp .env.example .env.local   # 下記を埋める（§3）
# root .env に Supabase CLI用の Turnstile secret を1行だけ用意（§3の注意）

# 4) 起動
npm run dev                  # → http://localhost:3000
```

---

## 3. 環境変数（`.env.local`）

`.env.example` をコピーして作る。起動時に `src/lib/env-schema.ts` が検証し、**dev(`APP_ENV=development`) でも空だと起動失敗する項目**と、**preview/prod でのみ必須（dev は空/ダミー可）**がある。

### dev で必ず値が要るもの
- `APP_BASE_URL=http://localhost:3000`, `APP_ENV=development`, `SUPPORT_EMAIL=<有効なメール形式>`
- `X_POSTING_MODE=dry_run`（**dev/preview は `dry_run` 固定。`live` にすると起動時検証で失敗**＝本番のみ）
- Supabase 4変数（`supabase start` / `supabase status` の出力から転記）
  - `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<出力のanon key>`
  - `SUPABASE_SERVICE_ROLE_KEY=<出力のservice_role key>`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- 自前生成する秘密
  - `APP_ENCRYPTION_KEY`: `openssl rand -base64 32`（AES-256の32バイト。utf8 32文字 / hex 64文字 / base64 32バイトのいずれか）
  - `CRON_SECRET`: `openssl rand -hex 32`（内部job dispatchのBearer認証）
- AIモデル名 `ANTHROPIC_TEXT_MODEL` / `OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL` / `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL`（採用モデル名の文字列）
- **スキーマ上「空NG」だが dev では実接続しないもの**（非空のダミーで起動は通る）: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_{STANDARD,MD,PREMIUM}_MONTHLY`

### dev では空/ダミーで可（preview/prod のみ必須）
`ANTHROPIC/OPENAI/GEMINI_API_KEY`、`X_MANAGED_CLIENT_ID/SECRET`、`SENTRY_DSN`／`NEXT_PUBLIC_SENTRY_DSN`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、SMTP系。
※これらを「実際に使う」には実キーが要る（§5）。

### ⚠️ 注意: 秘密の置き場は2ファイル
- アプリ用 = **`.env.local`**
- Supabase CLI（config.toml の captcha）用 = **root `.env`** に `TURNSTILE_SECRET_KEY` を1行。ローカルは Cloudflare 公式の常時成功secret `1x0000000000000000000000000000000AA` を入れる。
- 両方 gitignore 済み。Turnstile の site key（`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `.env.local`）は常時成功 site key `1x00000000000000000000AA`。

---

## 4. よく使うコマンド（package.json）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（http://localhost:3000） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` |
| `npm test` | `vitest run`（`*.db.test.ts` はSupabase稼働時のみ実行、未起動なら自動スキップ） |
| `npm run release:check` | typecheck → lint → 依存監査 → 全テスト → build（要ネットワーク＝npm audit） |
| `npm run audit:check` | 依存脆弱性ゲート（critical/allowlist外highで失敗） |
| `npm run build` / `npm run start` | 本番ビルド / 本番起動 |
| `supabase db reset` | DB再作成 + migrations再適用 + seed（DBを初期化したいとき） |
| `supabase migration new <name>` | 新規マイグレーション雛形作成（→SQL記述→`db reset`→`npm test`） |
| `npm run db:backup` / `db:restore` | 論理バックアップ/復元（[手順](./database-backup-restore.md)） |

---

## 5. ローカルで「できること」と「実キーが要ること」

現状 `.env.local` は Supabase・暗号鍵・CRON・Turnstileテストキー・モデル名が実物、**外部連携キー（AI各社・Stripe・X運営App・SMTP・Sentry）はダミー**。ダミーでも起動は通り、**実際に外部を呼ぶ操作の時点で失敗**する（起動時には落ちない）。

### 実キー無しで今すぐ試せる
- サインアップ / ログイン / パスワード再設定（Turnstileテストキーで captcha 通過）
- メール確認フロー（確認メールは **Mailpit http://localhost:54324** に届く。実SMTP不要）
- 画面閲覧全般（ホーム・プラン・設定 等）、プロフィール自動作成、法務同意保存
- **dry_run 投稿フロー**（X APIを呼ばず擬似tweet_idを返す。日次上限・記帳ロジックは動く）
- ジョブ/cron の手動起動（`CRON_SECRET` 実物）、BYOK の X APIキー「保存」自体（保存時は未検証）

### あなたが実キー/アカウントを用意しないと動かない機能

| 機能 | 必要なもの | ローカル検証で必要? |
|---|---|---|
| AI文章生成（premium: 生成/学習/提案/md-merge） | 運営 `ANTHROPIC_API_KEY`（既定provider） | 実生成を試すなら必要 |
| AIニュース生成（NEWS） | `NEWS_TEXT_PROVIDER` のキー（既定anthropic） | 実行するなら必要 |
| AI生成（standard/md=BYOK） | ユーザーが自分のAIキーを**アプリUIで入力**（envではない） | 各自入力すれば可 |
| 画像生成 | premium=運営 `OPENAI_API_KEY`/`GEMINI_API_KEY`／BYOK=UI入力 | 実生成なら必要 |
| premium X連携（運営App OAuth） | `X_MANAGED_CLIENT_ID`/`SECRET`（callback登録・credit） | 実OAuthは実App必要（原則本番） |
| BYOK X連携（standard/md） | ユーザーが自分のX AppのID/SecretをUI入力 | 入力すればローカルでも実OAuth可 |
| X 実投稿（live） | X App＋実アカウント＋credit。`X_POSTING_MODE=live` は**本番のみ** | 本番のみ（devはdry_run） |
| 課金（Checkout/Portal/Webhook） | Stripe **test** キー＋3 Price＋Webhook secret＋Portal Configuration | ローカルE2Eするなら必要（testモード可） |
| 通知メール（SMTP送信） | Gmail 2段階認証＋App Password | 本番のみ（ローカルは下記の注意参照） |
| 監視（Sentry） | `SENTRY_DSN` | 本番のみ（dev未設定でOK） |

> ⚠️ **SMTPの落とし穴**: `SMTP_USER`/`SMTP_APP_PASSWORD` が「非空ダミー」だと、通知メール処理が transport を構築して送信を試み**認証失敗（email_status=failed）**になる（GoTrue のサインアップ確認メールは別系統でMailpitに届く）。ローカルで通知メールを触るなら、この2つを**空にする**と送信skip挙動に戻る。

---

## 6. ローカルでテストユーザーを作ってログインする

いずれかで作成:
1. **最も簡単**: Supabase Studio http://localhost:54323 → Authentication → Add user（メール確認/captcha不要で確認済みユーザーを即作成）。
2. **UIサインアップ**: http://localhost:3000/signup で登録 → 確認メールを **Mailpit http://localhost:54324** で開いてリンクを踏む。
3. service role の管理API（`supabase.auth.admin.createUser`）でスクリプト作成。

---

## 7. 本番リリースに向けて

ローカルで揃わない実キー・アカウント・法務確認・依存アップグレード等の「人間側TODO」は [リリース前チェックリスト §3](./release-checklist.md) を正とする。
