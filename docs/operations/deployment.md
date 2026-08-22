# 運用メモ: デプロイ手順（ローカル → staging → production）

| 項目 | 内容 |
|---|---|
| バージョン | v1.16 |
| 更新日 | 2026-08-22 |
| 関連 | [開発とテストの進め方](./development-and-testing.md)／[CI](./ci.md)／[システム構成 §3 環境変数](../requirements/01_system_architecture.md)／[リリース前チェックリスト](./release-checklist.md)／[launchd→Vercel Cron](./launchd-to-vercel-cron.md)／[DBバックアップ](./database-backup-restore.md)／[ローカル開発](./local-development.md) |

Vercel（Next.js）＋ Supabase（Postgres/Auth/Storage）構成のデプロイ手順。**staging = Vercel の preview 環境（`APP_ENV=preview`）**、production = 同 production 環境（`APP_ENV=production`）とする。

環境の分離方針: **Supabase プロジェクトは staging と production で分ける**。同一DBを共有すると、staging の検証データが本番の利用枠・実績・課金状態へ混入する。

さらに **organization（組織）も分ける**（2026-08-01 決定）。Supabase の無料枠（DBサイズ・転送量・ストレージ）は**プロジェクトではなく組織単位**で、超過すると `All services are restricted` として**組織内の全プロジェクトが402で停止する**。同一組織に staging を置くと、検証で枠を使い切ったときに**本番が巻き添えで止まる**。2026-08-01、実際に「DB Size Exceeded」で組織全体が停止し、新規に作った staging プロジェクトすら restore できなくなった。

| | 同一組織 | 組織を分ける |
|---|---|---|
| stagingの枠超過 | **本番も停止する** | 本番は無事 |
| 無料枠 | 2プロジェクトで共有 | それぞれに1組織分 |
| Pro化 | 組織単位の課金なので**stagingも対象**になる | **本番だけPro**にできる |

停止中のプロジェクトは使用量が0と表示され**原因の特定ができない**（計測が止まるため）。復旧も restore が制限で弾かれるので、**枠に近づく前に気付く**必要がある（`npm run doctor` のDBサイズ表示）。

---

## 0.0 反映は1コマンドで行う（T-M7-35）

**初回の環境構築（§1〜§4）が済んだあとは、毎回の反映はこのコマンドだけで足りる。**

```bash
npm run release:staging      # stg → staging
npm run release:production   # main → production
```

順番をコマンドが強制する。**どれか1つでも欠けていれば、そこで止まって理由と次の一手を出す**（黙って進めない）。

1. ブランチが期待どおりか（staging=`stg` / production=`main`）
2. 未コミットの変更が無いか
3. 未pushのコミットが無いか（反映されるのはリモートの内容）
4. 自動テスト（CI）が緑か（赤・実行中・結果なしは止まる）
5. 反映先のURLが分かるか（`-- --base https://<URL>` で渡すか、`.env.local` の `STAGING_BASE_URL` / `PRODUCTION_BASE_URL`）
6. **未適用のmigrationが無いか** — あれば止まる。`-- --apply` を付けて実行すると `supabase db push` まで行い、適用後にもう一度確認を通す

**ブログ記事（`blog/published/*.md`）の公開も同じ手順。** 記事のコミット（`/blog-publish`）→ `release:staging` → `release:production`。記事がデプロイへ同梱されることは `release:check` の `check:blog-trace` が出荷前に、デプロイ先では `doctor` の「ブログ記事の同梱」が確認する（T-M8-184）。

すべて通ると、続けて**デプロイ後の検証**（`smoke:live --base <URL>`・実費 約$0.30）を実行する。`-- --account <Xのユーザー名>`（UUIDも可。または `SMOKE_X_ACCOUNT_ID`）を渡すと生成・画像も含め、無ければニュース取得だけを検証する。

```bash
# 引数で渡す例（.env.local を触らずに済む）
npm run release:staging -- --base https://x-system-stg.vercel.app --account ai_newinfo
```

> **これらは「手元のコマンドがどこを検証するか」を知るための値**で、アプリが読む環境変数ではない。アプリ自身が使う `APP_BASE_URL` 等は Vercel 側に設定する（§1）。両者は別物なので、Vercelに入れてあっても手元のコマンドには別途渡す必要がある。

**`.env.local` へ置く手元用の値**（`.env.example` にも記載がある。2026-08-04 に追記。**どこにも書かれておらず、初回のリリースで「反映先のURLが設定されていません」で詰まった**）。

| 変数 | 用途 |
|---|---|
| `STAGING_BASE_URL` / `PRODUCTION_BASE_URL` | `release:*`・`doctor -- --base`・`smoke:live` の対象URL |
| `STAGING_CRON_SECRET` / `PRODUCTION_CRON_SECRET` | デプロイ先の cron エンドポイントを叩く鍵（**環境ごとに違う**のが正しい） |
| `SUPABASE_ACCESS_TOKEN` | `doctor` が **Supabase Auth のURL設定**（Site URL・Redirect URLs）を読むための Personal Access Token。Dashboard → Account → Access Tokens で発行。**プロジェクト設定を書き換えられる強い権限**なので `.env.local` にだけ置く。無くても `doctor` は動くが、この項目だけ「確認できません」になる（T-M8-90） |
| `PRODUCTION_STRIPE_SECRET_KEY` ほか `PRODUCTION_STRIPE_*` | `stripe:portal:setup -- --target production` が読む。price と Portal 構成IDはStripeアカウント単位なので接頭辞付きで持つ（T-M8-35） |

### migration 適用時に出る警告

`supabase db push` の後に `failed to cache migrations catalog: ... pgdelta-target-ca.crt: ENOENT` が出ることがある。**migration 自体は適用されている**（`Applying migration ...` が各ファイルに出て `Finished supabase db push.` で終わる）。CLIのカタログキャッシュだけが失敗しているので、`release:staging` をもう一度実行して「データ構造の更新: すべて適用済みです」を確認すればよい。

> migration適用を飛ばすと**X連携が `internal_error` で壊れる**。ここを警告ではなく停止にしているのは、警告では忘れたときと同じ結果になるため（`CLAUDE.md` 原則3）。判定は `src/lib/ops/release-gate.ts`（単体テストあり）。

以下の§1〜§4は**環境を作るときだけ**必要な手順、§5以降は各段の詳細と手動で確認したいときの内容。

---

## 0. 前提の確認

デプロイ前に、ローカルで次がすべて緑であること。

```bash
npm run release:check    # typecheck → lint → check:doc-dates → check:doc-refs → 依存監査 → test:db → build → check:csp-nonce → check:blog-trace → test:e2e
```

同じゲートは push / PR で GitHub Actions も実行する（[CI](./ci.md)）。

**リリースの流れ（要決定D-8 案A・2026-07-30）**

**`main` への直pushは branch protection で拒否される**（実測 2026-08-18: `GH006 Protected branch update failed`・
「Changes must be made through a pull request」「2 of 2 required status checks are expected」）。
必ずPR経由で入れる。

1. `main` から**作業ブランチ**を切る（例 `release/YYYY-MM-DD-<内容>`）
2. そのブランチを push → CI が緑になるのを確認
3. ブランチ → `main` の **プルリクエストを作る**（`gh pr create`）
4. 必須チェック2本が緑になったらマージ → production ビルドが始まる
5. `npm run release:production -- --apply` で migration 適用とデプロイ後検証を行う

> **`stg` → `main` のPRは使えない**（D-28）。`stg` と `main` は**ツリーは同一だがSHAが分岐**しており、
> PRにすると同じ内容の55件が差分として並ぶ。staging を検証したいときは `stg` へ別途 push する
> （`supabase link` の向き先を張り替えてから・§5）。**本番へ入れるのは `main` から切った作業ブランチ**にする。

保護の必須チェックは `型・lint` と `release:check（DB・build・E2E）` の2本。
**2026-07-30 時点では「private × GitHub Free では保護が使えない」と記録していたが、現在は有効になっている**
（要決定D-14 の結果）。CIが赤いとマージできないので、pushの前に手元で `npm run release:check` を通しておく。

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
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe。**非productionでは `sk_test_` のみ**（`sk_live_` を置くと起動時検証で落ちる。実課金を防ぐため・T-M7-51） |
| `STRIPE_PRICE_STANDARD_MONTHLY` / `_PREMIUM_` / `_EXPERT_` | Stripe の Price ID 3種 |
| `ANTHROPIC_TEXT_MODEL` / `OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL` / `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` | 採用モデル名 |
| `NEWS_TEXT_MODEL` | ニュース取得専用モデル（任意・T-M8-200）。未設定は `NEWS_TEXT_PROVIDER` の `*_TEXT_MODEL`。`claude-haiku-4-5` にすると本番のプレミアム生成（Sonnet）を保ったままニュースだけ約45%安くなる（実測$0.152→$0.093/回） |

### 1.2 preview / production で追加必須（16）

| 変数 | 取得元 |
|---|---|
| `NEWS_TEXT_PROVIDER` | `anthropic` / `openai` / `google` |
| `X_MANAGED_CLIENT_ID` | 運営 X App（premium 用）の Client ID |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Customer Portal 構成ID（Stripe Dashboard で1つ作り、内容は下の §1.4 で合わせる） |
| `X_COST_CONTENT_CREATE_USD` / `_WITH_URL_USD` / `X_COST_INTERACTION_DELETE_USD` / `X_COST_POST_READ_USD` / `X_COST_USER_READ_USD` | X Developer Console の pay-per-use 実単価（読取2つはT-M8-91で追加。読取は応答のresource数で乗算課金される） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_APP_PASSWORD` | Gmail App Password 等。**`npm run auth:templates -- --apply` が Supabase Auth のカスタムSMTP設定にも同じ値を流用する**（アプリの通知メールと認証メールで同じ資格情報・T-M8-136） |
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

### 1.4 Stripe Customer Portal の設定（環境ごとに1回＋設定を変えたとき）

画面の「プランを管理」は Portal の `subscription_update` / `subscription_cancel` が**Stripe側で有効**でないと、ボタンは出るのに押すと失敗する。有効化はコードでは決まらないので、環境ごとに1回実行する。

```bash
# 1. まず実行する。足りない値を**5件まとめて**教えてくれるので、それを .env.local へ貼る
npm run stripe:portal:setup -- --target staging
# 2. 言われた5つをVercelの環境変数（staging=Preview / production=Production）からコピーして .env.local へ
#    STAGING_STRIPE_SECRET_KEY / _PRICE_STANDARD_MONTHLY / _PRICE_MD_MONTHLY /
#    _PRICE_PREMIUM_MONTHLY / _PORTAL_CONFIGURATION_ID（＋ STAGING_BASE_URL）
# 3. もう一度実行し、出力の target / appBaseUrl / configurationId / valueSources を目で確認する
npm run stripe:portal:setup -- --target staging
# 4. 画面側の判定でも確認する
npm run doctor -- --base "$STAGING_BASE_URL"     # 「プラン管理（Stripe）」が ✅ になる
```

- **`--target` は必須**。既定を持たせていない。2026-08-04、stagingを直すつもりで実行したところ `.env.local` のローカル値が読まれ、**ローカルの構成を更新して「成功」と表示**した（stagingは直っていないのに出力は緑だった）。
- **環境ごとに別のStripeアカウント**（2026-08-04 実測）。したがって鍵・price 3つ・構成IDの**5つすべて**が接頭辞付きで必須で、接頭辞なしの値へは落とさない。落とすと *staging の鍵でローカルの price を参照して `No such price`* になる（実際に踏んだ）か、最悪**別環境を書き換える**。
- **足りない値は5件まとめて出る**（T-M8-50）。以前は1件ずつ止めていたため「1つ足す→また別のが足りないと言われる」を3往復した（原則5に反していた）。
- **`valueSources` を目で確認する**。すべて `STAGING_` 付きになっていること。接頭辞なしが混じっていたら別環境を触ろうとしている。
- 「別アカウントかどうか」の確かめ方: 手元の鍵で `billingPortal.configurations.list` を叩き、対象環境の構成が**一覧に出てこない**こと。doctorが「使えない操作があります」と言えている（＝対象環境からは取得できている）と組み合わせると、別アカウントだと確定できる。
- **構成IDだけが足りないときは、コマンドが候補を一覧して教える**（T-M8-50）。鍵が揃っていればアカウントの中は見えるので、Vercelを開かずに済むことが多い。1件だけなら doctor が機能名まで出せている事実と合わせて、それが対象だと確定できる。**IDの採用は人が決める**（自動採用すると「取り違えたまま成功と表示する」に戻る）。

### 実測: staging を設定したときの記録（2026-08-04）

stagingのStripeアカウントには **Stripeが自動生成した既定の構成が1件だけ**あり、`subscription_update` が無効・`default_return_url` が未設定だった（＝このスクリプトが一度も適用されていない状態）。適用後は `features` が両方 `true` になり、`npm run doctor -- --base <stg>` の「プラン管理（Stripe）」が ✅ になる。
- スクリプトは既存の構成を**上書き更新**する（新規作成しない）。IDが変わらないので Vercel 側の書き換えは不要。
- 実行後に読み戻して機能が有効か確認し、無効なら exit 1 する。

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
5. **確認メールの送信元を決める。** サインアップ確認・パスワード再設定のメールは**Supabase Authが送る**（アプリの `SMTP_*` は通知メール用で別物）。Supabase内蔵の送信は **2通/時**、かつ**その組織のメンバーのアドレス宛にしか届かない**（それ以外は `Email address not authorized`）。
   - **stagingの動作確認だけなら**: 自分（Supabaseの組織メンバー）のアドレスで登録すれば内蔵送信で足りる。
   - **本番、または他人のアドレスで試すなら**: Supabase の Authentication → Emails → SMTP Settings へ**カスタムSMTPを設定する**（アプリ用と同じGmail App Passwordを流用できる）。設定後の上限は 30通/時から。
5.5. **認証メールのテンプレートを反映する（`npm run auth:templates -- --target production --apply`）。** **2026-08-18、この手順を忘れて本番の新規登録が止まった**（画面には「リンクを確認できませんでした」だけが出る）。**手順を1コマンドへ畳んだので、以後は手作業で貼り替えない**（原則3）。コマンドは (1) カスタムSMTPが未設定なら `SMTP_*` から先に設定し（Freeプラン＋内蔵送信では**テンプレートを変更できない**）(2) `supabase/templates/*.html` を反映し (3) 反映後に読み直して確認する。`npm run doctor` も**確認メールに6桁コード（`{{ .Token }}`）が入っているか**を見るようになったので、忘れたら気付ける。以下は手作業の場合の説明。 ** `supabase/config.toml` の `[auth.email.template.*]` は**ローカル専用**で、リモートには効かない。既定テンプレートは `{{ .ConfirmationURL }}` を使うため、**確認メールに入力すべき6桁コード（`{{ .Token }}`）が載らず、登録を完了できない**（T-M8-121でコード方式へ移行。それ以前はリンク方式で `token_hash` が付かず「リンクを確認できませんでした」になった。2026-08-02と08-18に発生。T-M7-45 のStorage bucketと同じ「config.tomlにしか無い」型）。パスワード再設定は引き続きリンク方式（`{{ .TokenHash }}`）。
   - Authentication → Emails → Templates の **Confirm signup** と **Reset password** を、`supabase/templates/confirmation.html` / `recovery.html` と**同じ内容へ貼り替える**。**2つは方式が違う**（T-M8-121）: **Confirm signup は6桁コード方式**（`{{ .Token }}` を本文に出す。リンクは使わない）、**Reset password はリンク方式**（`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`）。確認メールにリンクを貼っても**入力すべきコードが載らず登録を完了できない**（2026-08-02 と 08-18 に発生）。貼る内容は実ファイルを正とし、ここには写さない。
   - Authentication → URL Configuration → **Redirect URLs** に `<APP_BASE_URL>/auth/confirm` を追加する。無いと `{{ .RedirectTo }}` が Site URL へ戻され、リンクが `/auth/confirm` を通らない（**パスワード再設定に効く**。確認メールは6桁コード方式なのでリンクを使わない）。
6. `profiles` 自動作成トリガーが入っていることを確認（マイグレーション同梱）。

適用結果の確認:

```bash
npx supabase migration list      # ローカルとリモートの差分が無いこと
```

### 2.9 ホスト版Supabaseで手で設定する項目（**環境ごとに1回ずつ**）

**これらはプロジェクト単位の設定で、stagingで設定してもproductionには一切引き継がれない。** `supabase/config.toml` はローカルのスタックにしか効かず、migrationでも表現できないため、**ダッシュボードで手作業するしかない**（2026-08-01〜02に、Storage bucket・メールテンプレート・CAPTCHAの3件が続けてこの穴で壊れた）。

> ⚠️ **`supabase config push` は使わない。** 一見「設定を同期するコマンド」だが、いまの `config.toml` にはローカル用の値（`site_url = http://127.0.0.1:3000`・localhostのredirect URLs・**Turnstileの常時成功テストsecret**）が入っており、送るとリモートの人間確認が無効化される。`[remotes.*]` を整備するまで実行しないこと。

| 設定 | 場所 | staging と production で | 抜けたときの症状 |
|---|---|---|---|
| **カスタムSMTP** | Authentication → Emails → SMTP Settings | **同じGmailでよい**（Sender name は `Exos AI`。本番は独自ドメインのアドレスが望ましい） | 内蔵送信のままだと**2通/時・組織メンバー宛のみ**。他人には永久に届かないのに画面は「送信しました」と出る。**カスタムSMTPを有効にしないとテンプレートを編集できない** |
| **メールテンプレート**（Confirm signup / Reset password） | Authentication → Emails → Templates | **同じ内容でよい**（`{{ .RedirectTo }}` を使うためドメインに依存しない） | 確認リンクとパスワード再設定が「リンクを確認できませんでした」になる |
| **メール送信数/時** | Authentication → Rate Limits | **同じ（30以上）** | 数通で黙って止まる |
| **CAPTCHA** | Authentication → Attack Protection | **環境ごとに違う**（Turnstileウィジェットを分けるため secret が異なる） | OFFだと人間確認が飾りになる（アプリはトークンの真偽を検証しない → T-M7-53）。secret不一致だとログイン・登録・再設定が全滅 |
| **Site URL / Redirect URLs** | Authentication → URL Configuration | **環境ごとに違う**（各環境の `APP_BASE_URL` と `<APP_BASE_URL>/auth/confirm`） | メール内リンクが別の場所を指し、押しても何も起きない |
| **Confirm email** 有効 / **最小パスワード長 8**（既定6）/ **Secure email change** 有効 / **Secure password change** は触らない | Authentication → Providers → Email | **同じ** | 最小長6のままだとアプリの案内（8文字）と食い違う。Secure password change を有効にすると**パスワード再設定が完全に死ぬ** |
| **Upload file size limit を 50MiB のまま**（5MiB未満に下げない） | Storage → Settings | **同じ** | 画像アップロードだけが失敗する（`smoke:live` が検出する） |
| Storage bucket `generated-images` | — | **migrationで自動**（`20260801000003`）。手作業不要 | — |

**Redirect URLs が効いているかは外から確認できる**（認証情報不要）:

```bash
curl -sD- -o /dev/null "https://<project-ref>.supabase.co/auth/v1/verify?token=x&type=email&redirect_to=<確かめたいURL>" | grep -i ^location
```

指定したURLがそのまま返れば許可されている。Site URL に化けていれば未許可。

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
| Stripe | Webhook endpoint に `APP_BASE_URL/api/stripe/webhook` を登録し、払い出された署名シークレットを `STRIPE_WEBHOOK_SECRET` へ。購読イベントは要件05のwebhook節の一覧（`charge.refunded` を含む・T-M8-174）と揃える |
| Turnstile | **Hostname Management にそのドメインを登録**（staging/production 別キー）。登録漏れだと `error-callback` 110200 になり**ログインも新規登録もできない**。`npm run check:turnstile -- --base <URL>` で確認する |
| Supabase Auth | Site URL / Redirect URLs に `APP_BASE_URL` を登録 |

---

## 4.5 つまずきやすい設定（実際に踏んだもの）

| 症状 | 原因 | 直し方 |
|---|---|---|
| デプロイ先が全部 `vercel.com/sso-api` へ飛ぶ | Vercel の **Deployment Protection**（Preview既定でON）。X のOAuthコールバック・Stripe webhook・`smoke:live` が全部弾かれる | Settings → Deployment Protection → **Vercel Authentication を Off**。stagingでもアプリ側のログインは必要なので二重の保護は不要 |
| `getaddrinfo ENOTFOUND db.<ref>.supabase.co` | `DATABASE_URL` に**直接接続**の文字列を入れた。Supabaseの直接接続はIPv6のみで、VercelはIPv4のため名前解決に失敗する | Supabase → Settings → Database → **Transaction pooler**（ポート**6543**・ホストが `pooler.supabase.com`）の文字列へ差し替えてRedeploy。**ホストに `db.` が付いていたら直接接続**で誤り |
| `401: 鍵が一致しません` | **`CRON_SECRET` は環境ごとに違う**（違うのが正しい）。ローカルの鍵でデプロイ先を叩いていた | 対象環境の鍵を `.env.local` へ `STAGING_CRON_SECRET` / `PRODUCTION_CRON_SECRET` として置く |
| Redeploy が `can not be redeployed` | 古いデプロイは再実行できない | **新しいコミットをpush**する（空コミットでも可） |
| 「未適用migrationが11件」と言い続ける | CLIの出力形式（JSON）を読めていなかった | 修正済み（`parseAppliedRemote`。両形式対応・解釈不能なら止まる） |
| **ログインも新規登録もできない**。人間確認の欄が空で「もう一度お試しください」だけ出る | Cloudflare の Turnstile で**そのドメインを許可していない**（エラーコード110200）。何度再試行しても直らない | Cloudflare → Turnstile → 該当ウィジェット → **Hostname Management** へそのドメイン（例 `x-system-stg.vercel.app`）を追加。`npm run check:turnstile -- --base <URL>` で確認できる |
| 人間確認の欄が出ず「読み込めませんでした」 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` が未設定、または**設定後に再デプロイしていない**（この値はビルド時にバンドルへ埋まる） | Vercelへ設定し、**新しいデプロイを作る**（Redeployでも可） |
| サインアップしても**確認メールが届かない** | 確認メールは**Supabase Authが送る**（アプリの `SMTP_*` とは別）。内蔵送信は**2通/時・組織メンバー宛のみ** | 自分のアドレスで試す、または Supabase → Authentication → Emails → **SMTP Settings** にカスタムSMTPを設定する（§2-5） |
| **カスタムSMTP設定済みなのに確認メールが届かない**（コード入力画面までは進む） | 登録したアドレスが**カスタムSMTPの送信元（`SMTP_USER`）と同じ**だった。Gmailは自分のSMTPで自分宛に送ったメールを Message-ID で重複排除するため、**受信トレイに入らず「送信済み」にだけ残る**。Supabase側は送信成功でSMTPエラーも出ず、`auth_logs` にも何も残らないので**どのログを見ても分からない**（2026-08-18 本番で発生・T-M8-147） | Gmailの**「送信済み」または「すべてのメール」**でコードを探す。動作確認は**送信元とは別のアドレス**で行う。`npm run doctor -- --base <URL>` の「メール確認が終わっていない登録」がこの状態を名指しする |
| **未確認のまま同じアドレスで再登録した**とき、既登録の案内が出ずコード入力画面へ進む | Supabase の仕様。**確認済み**のアドレスは `user_already_exists` を返すが、**未確認**のアドレスは成功扱いで確認メールを再送する（ローカルで実測・毎回1通送られる）。総当たりでアドレスの存在を調べられないようにするための挙動 | 異常ではない。届いたコードを入力すればそのまま確認が完了する |
| 確認メールのリンクを開くと**「リンクを確認できませんでした」** | メールテンプレートは `supabase/config.toml` で指定しているが**これはローカル専用**。リモートは既定テンプレートで、アプリが要求する `token_hash` がリンクに付かない（T-M7-45 のStorage bucketと同じ型） | Supabase → Authentication → Emails → Templates の **Confirm signup / Reset password** を `supabase/templates/*.html` と同じ内容へ差し替える。あわせて URL Configuration の **Redirect URLs** に `<APP_BASE_URL>/auth/confirm` を追加する（§2-5.5）。※既定テンプレートでもSupabase側の確認自体は完了するので、**そのままログインできる**ことがある |
| **「7日間無料で利用」を押すと必ず「決済画面を開けませんでした」** | Stripeアカウントが**本番決済を受け付けられない状態**（`Your account cannot currently make live charges.`・`card_payments = inactive`）。**鍵は本番・Priceの金額も一致・ポータルも有効なので、既存の検査は全部緑**だった（2026-08-18・T-M8-148） | Stripeダッシュボードのホームで有効化の残作業と審査状況を確認する。アプリ側では直せない。`npm run doctor -- --base <URL>` の「決済の受付（Stripeアカウント）」で状態が読める |
| **登録済みのアドレスで登録してもエラーが出ずコード入力画面へ進む** | ホスト版のSupabaseは列挙対策で、登録済みでも成功と同じ形（`identities` が空配列）を返し**メールを送らない**。ローカルのSupabaseは `user_already_exists` を返すため、**エラーコードだけを見ていると本番でだけ通り抜けた**（T-M8-149） | 修正済み（`classifySignUpUser` が成功応答からも判定してログイン導線付きのエラーを出す） |
| stagingの動作確認で**本当に課金されないか不安** | 判定はキーの種別だけで決まる | 非productionに `sk_live_` を置くと**起動時に落ちる**ので、起動していれば `sk_test_` である（T-M7-51）。Checkout画面に **TEST MODE** の帯が出ること、テストカード `4242 4242 4242 4242` が通ることでも確認できる |

**デプロイ先を覗くコマンドだけが鍵を要る。** `smoke:live -- --base <URL>` と `doctor -- --base <URL>` の2つで、**E2Eはローカル限定**（`e2e/fixtures/guard.ts` がローカル以外を拒否する）なので鍵は不要。`check:turnstile -- --base <URL>` はログイン画面を見るだけなので鍵は不要。本番の鍵を手元に置きたくない場合は、これらをCIから実行する構成も選べる。

---

## 5. デプロイ後の検証

環境ごとに次を確認する。**7 は実APIを叩き費用が発生する**（1周 約$0.30）。

1. `/` `/login` `/signup` `/terms` `/privacy` が 200。
2. **人間確認（Turnstile）がその環境で動くこと。** 許可ドメインの登録漏れだと**ログインも新規登録もできない**うえ、画面には「もう一度お試しください」しか出ない（2026-08-01に staging で発生）。Cloudflare側の設定が原因なのでモックしたテストでは検出できない。

   ```bash
   npm run check:turnstile -- --base <その環境のURL>
   ```

3. サインアップ → 確認メール受信 → ログイン（実ブラウザ。メール内リンクの遷移先が正しいこと）。
4. セキュリティヘッダ: `curl -sI <URL> | grep -iE "content-security-policy|strict-transport-security|x-content-type-options|referrer-policy"`
5. cron エンドポイントの認証: `CRON_SECRET` 無しで 401、有りで 2xx。

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$APP_BASE_URL/api/cron/scheduler-tick"                              # 401
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "$APP_BASE_URL/api/cron/scheduler-tick" -H "authorization: Bearer $CRON_SECRET"  # 2xx
   ```

6. Sentry にイベントが届くこと。
7. 実物スモーク（その環境で生成・画像・ニュースが実際に通ること）。ローカルでは出ない環境差（env欠落・migration未適用・CSP）はここで初めて分かる。

   ```bash
   npm run smoke:live -- --base <その環境のURL> --account <検証用アカウントのXユーザー名>
   ```

   `/api/cron/canary` は **cron へ登録していない**（手動実行のみ。D-11で2026-07-28に決定）。定期実行へ切り替えるなら `vercel.json` に `crons` を追加する。
8. staging では **X_POSTING_MODE が dry_run のまま**であることを確認する（実投稿しない）。

**2 と 7 は `npm run release:staging` / `release:production` が自動で実行する**（この順。2は費用ゼロ、7は約$0.30）。片方が失敗しても両方の結果を出してから終わる。

---

## 6. 定時実行（cron）

**production は Vercel Cron で4本を回す**（2026-08-14 移行・T-M8-88。`vercel.json` の `crons`。schedule は要件04 §6 の表が正本で、一致は `src/lib/ops/vercel-crons.test.ts` が検査する）。`ops/launchd/` の4本は移行前の構成で、ローカル（`http://127.0.0.1`）向けのまま残してある。**手順とロールバックは [launchd→Vercel Cron](./launchd-to-vercel-cron.md) を正とする**。

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
