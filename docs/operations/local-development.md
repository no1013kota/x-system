# 運用メモ: ローカル開発環境の起動

| 項目 | 内容 |
|---|---|
| バージョン | v1.15 |
| 更新日 | 2026-08-31 |
| 関連 | [開発とテストの進め方](./development-and-testing.md)／[supabase/README.md](../../supabase/README.md)／[システム構成 §3 環境変数](../requirements/01_system_architecture.md)／[CI](./ci.md)／[リリース前チェックリスト](./release-checklist.md)／[DBバックアップ](./database-backup-restore.md) |

Exos AI（Next.js 16 App Router + Supabase）をローカルで動かすための手順。**現在このマシンでは既にセットアップ済みで、アプリは http://127.0.0.1:3000 で起動中**。日常起動は §1、初回/別マシンは §2、動作範囲と「実キーが要る機能」は §5 を参照。

---

## 0. ポート早見表

| URL | 用途 |
|---|---|
| http://127.0.0.1:3000 | アプリ（Next.js dev） |
| http://127.0.0.1:54323 | Supabase Studio（DB/認証のGUI管理） |
| http://127.0.0.1:54324 | ローカルメール受信（Mailpit）— サインアップ確認メール等はここに届く |
| http://127.0.0.1:54321 | Supabase API（kong） |
| `127.0.0.1:54322` | ローカルDB（Postgres 17。接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`） |

---

## 1. 日常の起動（セットアップ済みの場合）

```bash
colima start                # Dockerランタイム（停止していれば）
supabase start              # ローカルSupabaseスタック（停止していれば）
npm run dev                 # → http://127.0.0.1:3000
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
supabase db reset            # migrations適用 + seed.sql投入（prompt_templates は画像1件）を確実に当てる

# 3) 環境変数
cp .env.example .env.local   # 下記を埋める（§3）
# root .env に Supabase CLI用の Turnstile secret を1行だけ用意（§3の注意）

# 4) 起動
npm run dev                  # → http://127.0.0.1:3000
```

---

## 3. 環境変数（`.env.local`）

`.env.example` をコピーして作る。起動時に `src/lib/env-schema.ts` が検証し、**dev(`APP_ENV=development`) でも空だと起動失敗する項目**と、**preview/prod でのみ必須（dev は空/ダミー可）**がある。

### dev で必ず値が要るもの
- `APP_BASE_URL=http://127.0.0.1:3000`, `APP_ENV=development`, `SUPPORT_EMAIL=<有効なメール形式>`
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
| `npm run dev` | 開発サーバー（http://127.0.0.1:3000） |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` |
| `npm test` | `vitest run`（`*.db.test.ts` はSupabase稼働時のみ実行、未起動なら自動スキップ） |
| `npm run test:db` | `REQUIRE_DB=1 vitest run`。**Supabase未起動ならテスト前に失敗する**。skipでDBテスト（実測69本）が静かに消えるのを防ぐ（`release:check` が使う） |
| `npm run test:e2e` | Playwright E2E（`e2e/`）。devサーバーとローカルSupabaseが必要。安全既定を外れた環境では起動前に中止する |
| `npm run release:check` | typecheck → lint → **check:doc-dates** → **check:doc-refs** → 依存監査 → **test:db** → build → **check:csp-nonce** → **check:csp-runtime** → **check:blog-trace** → **check:sharp-trace** → **test:e2e**（要ネットワーク＝npm audit、要ローカルSupabase、要 `npx playwright install chromium`） |
| — | 上記ゲートは push / PR で GitHub Actions も実行する（[CI](./ci.md)）。手元で流し忘れても検査は走る |
| `npm run audit:check` | 依存脆弱性ゲート（critical/allowlist外highで失敗） |
| `npm run check:csp-nonce` | **ビルド成果物**（`.next/server/app/**/*.html`）を走査し、CSPのnonceを持てないHTMLが残っていないか確認する。**要 `npm run build`**（成果物が無ければ緑にせず終了コード2で止まる）。静的prerenderされたページはnonceを付けられず、`'strict-dynamic'` の下でscriptが1本も実行されない＝画面が壊れる（2026-08-14に本番の `/signup`・`/reset-password` で発生・T-M8-87）。E2Eは `next dev` で動きprerenderしないため、この不具合は**原理的に検出できない** |
| `npm run check:blog-trace` | **ビルド成果物**（`.next/server/app/**/*.nft.json`）を走査し、公開記事 `blog/published/*.md` が `/blog`・`/blog/[slug]`・`/api/cron/doctor` の各関数へ同梱されるか確認する。**要 `npm run build`**。記事はリクエスト時にファイルから読むため、`next.config.ts` の `outputFileTracingIncludes` が欠けると**本番だけ「準備中」**になる（ローカルとdevはcwdから読めるので他の層では見えない・T-M8-184） |
| `npm run check:sharp-trace` | **ビルド成果物**（`.next/server/app/**/*.nft.json`）を走査し、sharp（画像処理）に依存する**全route**が `next.config.ts` の `outputFileTracingIncludes` に Linux用バイナリ（`@img/sharp-linux-x64` 等）の同梱指定を持つか照合する。**要 `npm run build`**。Linux用バイナリはmacに存在しないため宣言漏れは**本番だけ500**になり、ローカル・CIでは原理的に見えない（T-M8-385。/app/posts の全Actionが本番で500になっていた） |
| `npm run blog:check` | ブログ記事の front matter と参照画像の実在を、画面（`/blog`）と同じ判定で検証する。不備は理由つきで一覧し終了コード1。`/blog-publish` が公開前に実行する |
| `npm run seed:review` | **画面確認用のアカウントを作る**（`review@example.com` / `Review-Local-Pw1`）。プレミアム契約・X連携・発信設定・下書き3件・スケジュール3件・投稿履歴と実績・フォロワー数31日分・未読通知2件を入れる。**`STRIPE_SECRET_KEY`（`sk_test_`のみ）があればStripeのテスト契約（trialing・支払い方法なし）を作って紐づけ、「プランを変更」「解約する」まで実際に試せる**（無ければその旨を出力・T-M8-56）。**何度実行しても同じ状態に戻す**（消してから入れ直す。Stripe側は同じテスト契約を再利用する）。接続先が `127.0.0.1` でなければ何もせず止まる。X APIは呼ばない |
| `npm run doctor` | **運営者向けの状態確認**。データの保存先・未適用migration・アプリの応答・直近24hのjob成否・ニュース取得（**分野ごとに「該当なし」と「全件破棄」を区別**）・Xトークン期限・止まっている処理・**当月の従量課金実績**・**データベースの使用量**・**定時実行の最終実行**・**確認メールの行き先（ローカルはMailpit）**・**溜まったテストデータ**・**請求額と表示額の一致（Stripe）**・人間確認（CAPTCHA）の有効/無効・Stripeポータルの機能・**登録/再設定メールの行き先**（デプロイ先のみ。`SUPABASE_ACCESS_TOKEN` があるとSite URLとRedirect URLsを照合する・T-M8-90）・**設定がその環境へ反映されているか**（Xへの投稿が `live`／`dry_run` のどちらか・`APP_BASE_URL` と実際の配信元の一致・決済キーの種別。**既定値を持つ設定は欠けても起動するため、画面は全部正常に見えたまま機能だけ止まる**・T-M8-147）・**メール確認が終わっていない登録**（送信元と同じアドレスで登録した場合は受信トレイに届かないことを名指しする・T-M8-147）・**決済の受付（Stripeアカウント）**（`charges_enabled`。**Priceの金額が一致していてもアカウントが未有効化なら申し込みは必ず失敗する**・T-M8-148）を日本語で一覧し、異常には次の一手を添える。読み取りのみで費用なし。`-- --base <URL>` でデプロイ先も見られる |
| `npm run smoke:live` | **実物スモーク**。起動中のアプリの `/api/cron/canary` を叩き、生成（Web検索あり）・生成＋画像・ニュース取得を**実APIで1周**して成果物まで検証する。`-- --account <xAccountId>` で生成系を含める（未指定はニュースのみ）。`-- --base <URL>` でデプロイ先も検査できる。**実費が発生し生成枠も消費する**（実測: 1周 約$0.30・40〜90秒） |
| `npm run check:suggest` | **投稿分析の実AI 1周**（現実的な12投稿を実DBへ保存→実Claudeで分析→zod検証→レポート保存。実測 約$0.02/回）。PT-SUGGESTのプロンプト・出力schemaを変えたら回す（T-M8-94） |
| `npm run check:providers` | **実APIへの provider 契約テスト**（Web検索・構造化出力・画像生成が受理されるか）。実キーと少額の費用が必要なためCI・`release:check` には入れない。外部APIの仕様変更・リクエスト形状の誤りを検出する唯一の層。Googleは既定で対象外（T-M7-17。`PROVIDER_CHECK_GOOGLE=1` で有効化） |
| `npm run build` / `npm run start` | 本番ビルド / 本番起動 |
| `supabase migration up` | **未適用のmigrationだけを当てる（ふだんはこちら）**。ローカルに作ったXアカウント・下書き・APIキーはそのまま残る |
| `supabase db reset` | DB再作成 + migrations再適用 + seed。**中のデータは全部消える**ので、使うのは下の2つが起きたときだけ: (a) 適用済みのmigrationファイルを編集・削除した（`migration up` では辻褄が合わない）、(b) seedを当て直したい |
| `supabase migration new <name>` | 新規マイグレーション雛形作成（→SQL記述→`supabase migration up`→`npm test`） |
| `npm run db:clean-test-data` | ローカルDBの掃除（既定はdry-run、`-- --apply` で反映）。テストユーザーと関連データを削除する（実メールのアカウントには触れない。旧「送信待ちお知らせメール」の掃除はT-M8-222のメール通知廃止で不要になった）。**掃除が必要になったら `npm run doctor` が教える**——activeなXアカウントが走査上限（100）を超えると `follower-snapshot.db.test.ts` などが落ち始め、**コードの不具合と見分けがつかない**（2026-08-18、原因の分からない単発失敗として4回観測した・T-M8-137） |
| `npm run db:backup` / `db:restore` | 論理バックアップ/復元（[手順](./database-backup-restore.md)） |

---

## 5. ローカルで「できること」と「実キーが要ること」

現状 `.env.local` は Supabase・暗号鍵・CRON・Turnstileテストキー・モデル名が実物、**外部連携キー（AI各社・Stripe・X運営App・SMTP・Sentry）はダミー**。ダミーでも起動は通り、**実際に外部を呼ぶ操作の時点で失敗**する（起動時には落ちない）。

### 実キー無しで今すぐ試せる
- サインアップ / ログイン / パスワード再設定（Turnstileテストキーで captcha 通過）
- メール確認フロー（確認メールは **Mailpit http://127.0.0.1:54324** に届く。実SMTP不要）
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
| 運営者向け状態メール（SMTP送信） | Gmail 2段階認証＋App Password | 本番のみ（ローカルは下記の注意参照。利用者向け通知メールはT-M8-222で廃止） |
| 監視（Sentry） | `SENTRY_DSN` | 本番のみ（dev未設定でOK） |

> ⚠️ **アプリからのメールは production 以外では送られない**（2026-07-27 追加・現在は運営者向け状態メールのみ）。`APP_ENV` が `production` でなく `SMTP_HOST` がループバック（`localhost`／`127.0.0.1`／`::1`）以外なら、transport を作らず送信をskipして警告を出す（`canSendViaSmtp`・`lib/email/smtp-guard.ts`。2026-07-27に旧通知メールが98通実送信された事故が起点）。
>
> ローカルで運営者向け状態メールの中身を確認したい場合は、`supabase/config.toml` の `[local_smtp]` で `smtp_port` を有効化して Supabase を再起動し、`SMTP_HOST=127.0.0.1` / `SMTP_PORT=<その番号>` を向ける（Mailpit http://127.0.0.1:54324 で読める）。
>
> ⚠️ **SMTPの落とし穴**: `SMTP_USER`/`SMTP_APP_PASSWORD` が「非空ダミー」だと、メール送信処理が transport を構築して送信を試み認証失敗になる（GoTrue のサインアップ確認メールは別系統でMailpitに届く）。ローカルで触るなら、この2つを**空にする**と送信skip挙動に戻る。

### 5.1 X OAuth コールバックURLの設定（X連携を試すとき）

アプリが X へ送る `redirect_uri` は **`APP_BASE_URL` + `X_OAUTH_REDIRECT_PATH`**（`src/lib/x/oauth-server.ts`）。X Developer Portal に登録する Callback URI は**この値と完全一致**させる必要がある。

- `X_OAUTH_REDIRECT_PATH`（`.env.local`）: **`/api/x/oauth/callback`（既定のまま・変更不要）**。実ルートは `src/app/api/x/oauth/callback/route.ts`。
- **X公式のローカル要件**（docs.x.com）: 「ローカル開発では **`http://127.0.0.1`（`localhost` は不可）**」「URLは**完全一致**（末尾スラッシュ含む）」。ポート付きは可。
- **本リポジトリは既定で `127.0.0.1` に揃えてある**（`.env.example` の `APP_BASE_URL=http://127.0.0.1:3000`、`supabase/config.toml` の `site_url=http://127.0.0.1:3000`）。ローカルは次を守る:
  1. `.env.local` の `APP_BASE_URL=http://127.0.0.1:3000`（→ 送信 redirect_uri = `http://127.0.0.1:3000/api/x/oauth/callback`）。
  2. X Dev Portal の **Callback URI = `http://127.0.0.1:3000/api/x/oauth/callback`**（完全一致）で登録。
  3. アプリには **http://127.0.0.1:3000** でアクセスする（cookie/origin を揃えるため。`localhost:3000` と混在させない）。
  4. `supabase/config.toml` の `site_url`/`additional_redirect_urls` は既に `127.0.0.1:3000`（config を変えたら `supabase stop && supabase start` で反映）。
  5. `next.config.ts` に `allowedDevOrigins: ["127.0.0.1"]` を設定済み。**無いと Next dev が `127.0.0.1` からの HMR WebSocket（`/_next/webpack-hmr`）をクロスオリジンとしてブロックし、client の hydration が完了せず、サインアップ等のフォーム操作・入力中バリデーション・Turnstile ウィジェットが一切動かなくなる**（画面は表示されるが対話できない）。dev のみ有効。
- **X Dev Portal のアプリ設定**（User authentication settings）:
  - Type of App: 運営App(premium)で `X_MANAGED_CLIENT_SECRET` を入れるなら confidential（Web App）。BYOK は **Web App, Automated App or Bot** を選ぶ＝confidential client なので、**Client ID と Client Secret の両方**を設定画面で保存する（Secretなしのtoken交換は 401 unauthorized_client で拒否される・2026-08-06 実測。設定画面にClient種別セレクタは無く、Secretの有無から種別を導出する）。
  - App permissions: **Read and write**（`tweet.write`・`media.write` に必要）。
  - 要求 scope（アプリが送る）: `tweet.read` / `tweet.write` / `users.read` / `media.write` / `offline.access`。
  - **Website URL**: OAuth とは無関係のアプリ情報欄。有効なURL（本番ドメインや GitHub リポジトリ等）でよく、Callback とは一致不要。
- **本番**: Callback URI = `https://<本番ドメイン>/api/x/oauth/callback`（https・完全一致）、`APP_BASE_URL=https://<本番ドメイン>`。
- BYOK（standard/md）は運営Appではなく**ユーザーが自分の X App の Client ID/Secret をアプリUIで入力**する。その X App にも同じ Callback URI を登録する必要がある。

### 5.2 Stripe（課金）のローカル設定と落とし穴

課金E2E（Checkout/Webhook/Portal）をローカルで試すときの必須ルールは **Stripe の全値を「同じ1つの環境（同一サンドボックス、または同一 test mode）」に揃える**こと。混在すると Price 不明・署名不一致・イベント不達で失敗する。

- **対象の値**: `STRIPE_SECRET_KEY` / `STRIPE_PRICE_{STANDARD,MD,PREMIUM}_MONTHLY` / `STRIPE_PORTAL_CONFIGURATION_ID` / `STRIPE_WEBHOOK_SECRET` をすべて同じサンドボックス由来にする。
- **Price は `price_...`（価格ID）を使う。`prod_...`（商品ID）は不可**。取得: ダッシュボード → Product catalog → Products → 対象商品 → Pricing セクションの `price_...` をコピー（商品ページ上部に大きく出る `prod_...` は別物なので注意）。
- **webhook secret は `stripe listen` が発行する `whsec_...`**（ダッシュボードの endpoint secret ではない）。
- **`stripe login` の既定アカウント/サンドボックスが `.env.local` のキーと違うと、`stripe listen` が別サンドボックスを監視してイベントが届かない**（署名検証以前に不達）。対処のどちらか:
  1. キーに合わせて listen する（`STRIPE_API_KEY` 環境変数は `stripe listen` でも有効）:
     ```bash
     export STRIPE_API_KEY="$(grep -E '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2- | tr -d '\r"')"
     stripe listen --print-secret          # 出た whsec_ を .env.local の STRIPE_WEBHOOK_SECRET へ
     stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
     ```
  2. `stripe login` をやり直して該当サンドボックスを選ぶ。
- **一致確認**: `.env.local` の Secret key の account と CLI の account が同じか突き合わせる（`curl -s https://api.stripe.com/v1/account -u "<secret>:"` の `id` ／ `stripe get /v1/account` の `id`）。別 account なら上記で合わせる。
- 発火テスト: listen 常駐中に別ターミナルで `stripe trigger checkout.session.completed`。

### 5.3 AIプロバイダ実キーの確認（落とし穴）

キーが「認証OK（`/models` が 200）」でも**実際の生成が通るとは限らない**。ローカルで実生成を試す前に最小コールで疎通確認する。

- **課金残高**: 認証が通っても残高が無いと生成は失敗する（例: Anthropic `credit balance is too low`）。使うプロバイダの運営キーに残高・課金設定が要る。
- **`/models` 一覧に載る ≠ 呼べる**: 一覧に出るモデルでも「新規ユーザーには提供終了」等で `generateContent`/生成が 404 になることがある（旧世代モデルで発生）。**実生成コールで確認**し、通るモデル名を `ANTHROPIC_TEXT_MODEL` 等の `*_TEXT_MODEL`/`*_IMAGE_MODEL` に設定する。
- 既定の文章 provider は `PREMIUM_TEXT_PROVIDER`／`NEWS_TEXT_PROVIDER`（既定 `anthropic`）。既定プロバイダに残高が無い場合は、残高のあるプロバイダへ切り替えるか残高を追加する。

---

## 5.4 定時トリガー（cron）はローカルでは自動で動かない

本番（Vercel）は `vercel.json` の Cron が4本の定時トリガーを起動するが、**ローカルには定時実行が無い**。
そのため次はローカルでは**手動で起動しない限り一度も動かない**（T-M8-99・2026-08-15判明）:

- 毎時のフォロワー数記録（follower-snapshot）→ 投稿分析画面の「フォロワー数の推移」が空のまま
- メトリクス収集（metrics-collector）・ニュース取得（news-fetch）・スケジュール投稿の起票

投稿分析は cron ではなく**投稿分析画面の「分析を開始」ボタン**で動く（T-M8-255で毎朝の自動起票を廃止）。ボタンはフォロワー数の当日分も記録するため、ローカルはcronを叩かなくても画面から点を付けられる。

手動起動（`npm run dev` 起動中に。同一時間窓の重複起動は `cron_runs` の窓claimで無害）:

```bash
# フォロワー数を今日の分だけ記録（active・契約有効・当日未記録のアカウントが対象）
curl -sS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/follower-snapshot
# 5分tick（スケジュール起票・job dispatch・queued/stale回収）
curl -sS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/scheduler-tick
# メトリクス収集
curl -sS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/metrics-collector
```

`$CRON_SECRET` は `.env.local` の値（`node --env-file=.env.local -e 'console.log(process.env.CRON_SECRET)'` で確認できる）。
ローカルでも自走させるかは **要決定 D-29**（tasks/BACKLOG.md）。X APIは過去のフォロワー数を提供しないため、記録開始日より前の推移は遡れない。

---

## 6. ローカルでテストユーザーを作ってログインする

いずれかで作成:
1. **最も簡単**: Supabase Studio http://127.0.0.1:54323 → Authentication → Add user（メール確認/captcha不要で確認済みユーザーを即作成）。
2. **UIサインアップ**: http://127.0.0.1:3000/signup で登録 → **Mailpit http://127.0.0.1:54324** で届いたメールを開き、**6桁の確認コードを登録画面に入力する**（T-M8-121 でリンク方式から変更）。
3. service role の管理API（`supabase.auth.admin.createUser`）でスクリプト作成。

---

## 6.1 E2E（Playwright）

- 実行: `npm run test:e2e`（`.env` / `.env.local` を読み込む）。devサーバーが起動していなければ Playwright が `npm run dev` を立ち上げる（起動済みなら再利用）。ブラウザ未取得なら `npx playwright install chromium` を先に1回だけ実行する。
- 構成: 設定は `playwright.config.ts`、シナリオとfixtureは `e2e/`。DBを共有するため直列実行（`workers: 1`）。
- 安全ゲート: `e2e/fixtures/guard.ts` が globalSetup で `APP_ENV=development`・`X_POSTING_MODE=dry_run`・SupabaseとDBとbase URLがローカル・`APP_ENCRYPTION_KEY`／`SUPABASE_SERVICE_ROLE_KEY` の存在を確認し、外れていれば**テストを1件も動かさずに中止**する。
- テストデータ: `e2e/fixtures/account.ts` が service role で確認済みユーザー＋active Xアカウント（tokenは`APP_ENCRYPTION_KEY`で封緘した偽値）を作り、終了時に**作成分だけ**をFK順で削除する。ログインはTurnstileテストキーで自動通過する。
- 投稿シナリオは `X_POSTING_MODE=dry_run` のため実際のXへは送信されない（擬似tweet_id）。

---

## 7. 本番リリースに向けて

ローカルで揃わない実キー・アカウント・法務確認・依存アップグレード等の「人間側TODO」は [リリース前チェックリスト §3](./release-checklist.md) を正とする。
