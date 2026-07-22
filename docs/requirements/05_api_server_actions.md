# 要件詳細 05: API / Server Actions

| 項目 | 内容 |
|---|---|
| バージョン | v1.9 |
| 更新日 | 2026-07-22 |
| 関連 | 全画面、全ジョブ |

## 1. 方針

- アプリ内のフォーム操作は原則Server Actionsで実装する。
- 外部サービスから呼ばれる処理、OAuth callback、cron、webhookはAPI Routesで実装する。
- すべての入力はzodで検証する。
- Server Actionsは現在ユーザー、plan、active_x_accountをサーバー側で検証する。クライアントから渡された`user_id`は信用しない。
- 生成・投稿・自動実行に分類されるすべてのmutationは、外部API呼び出し・job作成・利用枠reserveより前に共通契約ガードを呼ぶ。`subscription_status=trialing|active`だけを許可し、他statusは`subscription_required`と不足項目／解決先を返す（要件03 §5）。
- active Xアカウントに依存するmutation系Action（生成・下書き・スロット・学習・提案）は、クライアントが表示中の`x_account_id`を明示的に送り、サーバーは所有権・`status = active`・`profiles.active_x_account_id`との一致を検証する（不一致は`job_conflict`を返し、画面へ再読込を促す。別タブ・別端末での切替と競合して意図しないアカウントへ実行されることを防ぐ）。
- エラー形式は全API/Actionで統一する。

## 2. 共通レスポンス

### 2.1 成功

```json
{
  "ok": true,
  "data": {}
}
```

### 2.2 失敗

```json
{
  "ok": false,
  "error": {
    "code": "usage_limit_exceeded",
    "message": "今月の生成枠を使い切っています。",
    "details": {}
  }
}
```

| code | HTTP目安 | 用途 |
|---|---:|---|
| `unauthorized` | 401 | 未ログイン |
| `forbidden` | 403 | プラン/所有権/RLS相当の拒否 |
| `validation_error` | 400 | 入力不正 |
| `subscription_required` | 402 | 課金状態により実行不可 |
| `usage_limit_exceeded` | 403 | premium利用枠不足 |
| `x_account_required` | 400 | Xアカウント未連携 |
| `api_key_required` | 400 | BYOKキー不足 |
| `persona_required` | 400 | 発信設定（L-4〜L-7）の必須項目が未保存 |
| `feature_disabled` | 403 | feature flagで無効化された機能 |
| `provider_error` | 502 | 外部API失敗 |
| `post_state_unknown` | 409 | X投稿の作成成否を一意に確認できない |
| `job_conflict` | 409 | lock済み/状態競合 |
| `not_found` | 404 | 対象なし |
| `internal_error` | 500 | 未分類のサーバー内部例外を集約した既定コード（provider本文・stack traceは含めない） |

実行前提の不足（`subscription_required`／`api_key_required`／`x_account_required`／`persona_required`）を返す場合、`details`に不足項目の一覧と設定画面への遷移先パスを含める。画面はエラーメッセージと「設定へ」ボタンを表示する（要件06 §3）。

## 3. API Routes

| Method | Path | 認証 | 用途 |
|---|---|---|---|
| POST | `/api/stripe/checkout` | user | Checkout Session作成 |
| POST | `/api/stripe/portal` | user | Customer Portal Session作成 |
| GET | `/api/stripe/return` | user＋復帰marker | Checkout／Portal復帰時の未反映Subscription同期 |
| POST | `/api/stripe/webhook` | Stripe署名 | 課金状態同期 |
| GET | `/auth/confirm` | Supabase `token_hash`, `type=signup|recovery`, `next`(optional) | Server側`verifyOtp`。signupは`/plans`、recoveryはuser_id・発行時刻を封緘した15分TTLのHttpOnly marker cookieを発行して`/reset-password`へ遷移。`next`は`/plans`／`/reset-password`／`/app`配下だけ許可し、token queryを除去 |
| GET | `/api/x/oauth/start` | user | X OAuth開始 |
| GET | `/api/x/oauth/callback` | OAuth state | X OAuth callback |
| GET | `/api/cron/news-fetch` | `CRON_SECRET` | ニュース取得 |
| GET | `/api/cron/scheduler-tick` | `CRON_SECRET` | スロットenqueue・dispatch／回収・cleanup |
| GET | `/api/cron/metrics-collector` | `CRON_SECRET` | tweet_id別実績取得 |
| GET | `/api/cron/follower-snapshot` | `CRON_SECRET` | フォロワー数保存 |
| POST | `/api/jobs/run` | `CRON_SECRET` | queued job 1件のworker実行（内部dispatch専用。202を即時返却し本処理は`after()`で実行） |

`POST /api/stripe/checkout`のJSON入力は`plan`（`standard`／`md`／`premium`）だけとし、Price ID、success/cancel/return URL、user_id、Customer ID、未知フィールドを拒否する。成功は共通形式の`data.url`にStripe Checkout URLを返し、30分TTLの暗号化済み復帰marker cookieを発行する。未認証は`unauthorized`、`Origin`不一致は`forbidden`、入力不正は`validation_error`、Stripe障害はprovider本文を隠した`provider_error`とし、応答を`no-store`にする。Price IDと戻り先はサーバー側の環境変数および`APP_BASE_URL`から解決する（課金処理の詳細は要件03 §2.1）。

`POST /api/stripe/portal`は入力fieldを持たず、認証済み本人の`profiles.stripe_customer_id`、サーバー側の`STRIPE_PORTAL_CONFIGURATION_ID`、`APP_BASE_URL`からPortal Sessionを作る。Customer未作成は`subscription_required`（`details.settingsPath=/plans`）、未認証は`unauthorized`、`Origin`不一致は`forbidden`、Stripe障害は`provider_error`とする。成功は`no-store`の共通形式で`data.url`だけを返し、30分TTLの暗号化済み復帰marker cookieを発行する。ブラウザはHTTPSだけへ遷移する（要件03 §2.2）。

`GET /api/stripe/return`は`source=checkout|portal`、認証済みsession、開始APIが発行した`HttpOnly`／`SameSite=Lax`の復帰markerを検証する。開始後のStripe event時刻がprofileへ反映済みなら外部APIなしで画面へredirectする。未反映時だけCheckout Sessionの本人性（checkoutのみ）を確認してSubscriptionを1回取得し、webhook共通projectionをtransaction適用する。markerは結果にかかわらず削除し、成功／反映済み／skip／失敗を秘密情報を含まない`sync` queryへ正規化する。markerのない通常画面はこのrouteを通らず、Stripe APIを呼ばない（要件03 §3）。

`POST /api/stripe/webhook`はraw bodyと`Stripe-Signature`をSDKで検証し、署名header欠落／不正は共通の安全な400を返す。対象eventは`checkout.session.completed`、`customer.subscription.created|updated|deleted`、`invoice.payment_failed|paid`だけで、対象外は記録せず200とする。処理成功・重複eventは`data.result=processed|duplicate`、対象外は`ignored`として200、未知Priceや内部処理失敗は詳細を隠した`internal_error`で500を返す。すべて`no-store`とし、非2xxはアプリ内retryせずStripe再送を利用する（transaction／順序の詳細は要件03 §4）。

初期はlaunchd、移行後はVercel Cronが同じGET routeを起動する。定時routeは`force-dynamic`とし、redirect・cacheを発生させない。呼び出し元に依存する処理分岐は持たない。

## 4. Server Actions

### 4.0 認証

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `signUp` | email, password, password_confirmation, terms_version, privacy_version, captcha_token | pending user | 現行version一致、明示checkbox、password一致、Turnstile検証を必須化 |
| `signIn` | email, password, captcha_token, next(optional) | session/redirect | Turnstile token必須。generic error。`email_not_confirmed`のみ再送状態。契約未選択は`/plans`、他はsafeな相対`next`または`/app` |
| `requestPasswordReset` | email, captcha_token | accepted | Turnstile token必須。`resetPasswordForEmail`へ`{APP_BASE_URL}/auth/confirm`を指定。メール存在有無・CAPTCHA以外のprovider結果にかかわらず同じ応答 |
| `updatePassword` | password, password_confirmation | redirect | 有効なSupabase sessionと15分TTLのrecovery markerが同じuser_idであることを必須化。成功後はlocal sessionとmarkerを破棄して`/login?password_updated=1`へ遷移 |
| `signOut` | none | redirect | session破棄 |

`signUp`はSupabase Authへ`emailRedirectTo={APP_BASE_URL}/auth/confirm`を指定し、成功画面から`resend(type=signup)`を実行できる。signup／確認メール再送／login／password reset申請は明示renderしたTurnstile widgetの`captcha_token`を必須とし、Server ActionからSupabase Authへ渡す。欠落はprovider呼び出し前に拒否し、Supabaseの安定コード`captcha_failed`（不正・期限切れ・再利用を含む）だけを共通CAPTCHAエラーへ正規化する。各widgetはAction完了後にresetする。

### 4.1 アカウント・設定

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `updateProfile` | `display_name` | profile | 本人のみ |
| `setActiveXAccount` | `x_account_id` | active account | 所有者かつ`status=active` |
| `updateNotificationConfig` | `notification_config` | config | 本人のみ |
| `updateNewsConfig` | `news_config` | config | 本人のみ |
| `updateAiPurposeConfig` | `ai_purpose_config` | config | 文章生成・リサーチは単一provider（`text`）。standard/mdは登録済みかつvalidなproviderだけ選択可。premiumの`text`は運営Claudeでread-only、画像だけ利用可能なOpenAI/Geminiから選択可 |

### 4.2 BYOK APIキー

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `saveXApiKey` | client_id, client_secret(nullable) | masked key | standard/mdのみ。confidential clientはsecret必須。既存値変更時はBYOK Xアカウントの再連携が必要 |
| `saveAiApiKey` | provider, api key | masked key | providerはanthropic/openai/google |
| `verifyApiKey` | provider | status | 失敗時は`status=invalid` |
| `deleteApiKey` | provider | deleted | AIは関連用途設定を解除。Xはtoken revoke後にBYOK Xアカウントをexpired化 |

Secretは受信後すぐ暗号化し、ログに出さない。AIキーの保存・疎通成功時、`ai_purpose_config.text`が未設定なら当該providerを自動設定する（画像対応provider〔openai/google〕で`image`未設定の場合も同様）。

X App資格情報のclient IDが変わった場合、既存OAuth tokenを新しいAppで使い回さない。`auth_type=byok`のXアカウントを`expired`にし、再連携まで投稿・読取・自動実行を停止する。

### 4.3 Xアカウント

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `listXAccounts` | none | accounts | 本人のみ |
| `enableXAccount` | `x_account_id` | status | plan上限、auth_type、tokenを検証してactive化 |
| `disconnectXAccount` | `x_account_id` | status | Xのtoken revokeをbest effortで実行後、保存tokenを削除しstatus disabled。自動投稿同意も停止し全auto slotを無効化 |
| `refreshXAccountStatus` | `x_account_id` | status | X `/users/me`で確認 |
| `recordXAutomationConsent` | `x_account_id`, `consent_version`, `confirmed` | consent state | 現行説明versionの明示checkbox必須。`automation_consented_at`を保存しdisabledを解除 |
| `disableXAutomation` | `x_account_id` | consent state, disabled slot count | `automation_disabled_at`を保存し、同じtransactionで全auto slotを無効化 |

X OAuth開始/完了はAPI Routesを使う。BYOKは保存済みX API keyをOAuth clientとして使い、premiumは運営Appを使う。どちらもOAuth 2.0 user contextで利用者本人の権限を取得し、利用者に代わって投稿する。premiumも運営Appのapp-only tokenで投稿するのではなく、利用者ごとのaccess/refresh tokenを`x_accounts`へ暗号化保存して使うため、利用者自身のDeveloper App登録は不要である。

- OAuth startとcallbackの両方で契約状態、plan上限、期待する`auth_type`を確認する。stateはuser ID、client種別、return pathと結び付け、別sessionからのcallbackを拒否する。
- callbackでauthorization codeをtokenへ交換し、`tweet.read tweet.write users.read media.write offline.access`が付与されていることと`/2/users/me`を確認してから暗号化保存する。
- OAuth callbackは自動投稿への明示同意を記録しない。`recordXAutomationConsent`は、自動投稿の対象、実行条件、失敗時の自動rollback削除とその不可逆性、停止方法、利用者本人がX上の投稿責任を負うことを専用画面で表示した後にだけ呼べる。
- access tokenが5分以内に失効する場合は、短いDB transactionで`token_refresh_lock_id`と`token_refresh_locked_at`を条件付き更新し、single-flight leaseを取ってからrefreshする。他の実行は最大10秒待って再読込し、1分超のleaseはstaleとして回収する。rotated refresh tokenと期限はlock ID一致を条件に同一transactionで更新する。
- refresh完了・失敗のどちらでもleaseを解除する。`invalid_grant`または必要scope不足はlock ID一致を確認して`status = expired`とし、自動処理を止めて再連携通知を作る。tokenの平文と外部レスポンス本文はブラウザへ返さない（暗号化済みciphertextがRLS selectに含まれることは受容済みリスクとする。データモデル §5参照）。
- `enableXAccount`は現在planの件数上限に空きがあり、planに対応する`auth_type`で、refreshと`/2/users/me`が成功する場合だけ許可する。失敗時は再連携へ誘導する。

## 5. 投稿・下書き

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `createGenerationJob` | request_key, pattern, source_url, quote_url, user_opinion, instructions, image_enabled, image_provider, news_item_id | job_id | `post_generation`を冪等作成し`after()`でdispatch。P-5は検証済み対象X URL必須 |
| `regenerateDraft` | request_key, draft_id, additional_instructions, image_enabled, image_provider | job_id | 元draftを保持し、`parent_draft_id`を持つ新draftを生成 |
| `getGenerationJob` | job_id | job | 所有者のみ |
| `retryGenerationJob` | request_key, job_id | new_job_id | failedのみ。新jobを冪等作成 |
| `cancelGenerationJob` | job_id | job | queuedのみ。runningはキャンセル不可 |
| `listDrafts` | filters | drafts | active_x_account |
| `updateDraft` | draft_id, expected_updated_at, thread, image local IDs, quote fields | draft | `status=draft`のみ。1〜pattern別最大ポスト。所有draftの既存画像だけ指定可 |
| `discardDraft` | draft_id, expected_updated_at | draft | `status=draft/failed`。未解決の投稿ID/作成成否があるfailedは不可 |
| `publishDraft` | request_key, draft_id, mode=`manual` | job_id | `draft`、またはtweet_id作成履歴・残存ID・曖昧状態のすべてがないretryable `failed`。activeな同種jobがなければ冪等作成 |
| `reconcileDraftPosting` | draft_id | draft | failedのみ。既知IDと直近投稿をXから再照合 |
| `cloneFailedDraftForRetry` | request_key, draft_id | new_draft | 投稿ID作成履歴があり、曖昧状態・残存IDが解消済みのfailedだけ。AI呼び出しなし |
| `regenerateImage` | request_key, draft_id, post_local_id, provider | job_id | `image_generation`を冪等作成し画像枠確認 |

`createGenerationJob`でP-5を指定する場合は`quote_url`を必須とする。サーバー側でtweet_idを抽出し、対象ポスト取得に成功した場合だけjobを作る。生成・編集時は対象URLをdraftへ別管理し、投稿時に1ポスト目の本文末尾へ合成する。`quote_tweet_id`をX投稿APIへ指定しない。

v1.0初期リリースは`FEATURE_QUOTE_POST_ENABLED=false`とする。OFF時は`createGenerationJob`のP-5、P-5 draftの`regenerateDraft`、`publishDraft`、`regenerateImage`を外部API呼び出しと利用枠消費の前に`feature_disabled`で拒否する。既存P-5 draftの閲覧と、未解決の投稿状態がない場合の破棄は許可する。feature flagの有効化は、X APIで取得した対象ポスト本文をLLM入力へ渡す契約と自動検証が完成した後に限る。

`regenerateDraft`は`status=draft`または未解決投稿のない`failed`の本文、pattern、検証済みsource/quote情報を入力snapshotとしてjobへ保存する。生成成功時は新しいdraftを作り、元draftを変更・破棄しない。再生成も新しいtop-level jobとして生成枠を1消費する。

`reconcileDraftPosting`は、全投稿が意図したthreadとして存在すれば不足しているtweet_id/consumeを冪等補完して`posted`にする。ロールバック対象が削除済みなら、アプリが実行して結果不明だった削除だけ`post_delete` consumeを補完し、未解決情報を消す。候補が複数または一部残存ならfailedを維持する。

`cloneFailedDraftForRetry`は本文、pattern、source/quote情報を複製し、`parent_draft_id`へ元draftを設定する。画像がある場合はStorage objectを新draft用pathへcopyし、全copy成功後に新しい画像参照を保存する。途中失敗はcopy済みobjectをbest effortで削除し、新draftを作らない。新draftは複製時の本文を`initial_thread`にも設定し、`source_job_id`、`tweet_ids`、投稿日時、実績、投稿errorは空にする。元draftは監査用に変更せず、AIを呼ばないため生成枠・画像枠は消費しない。

## 6. ニュース

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `listNewsItems` | categories, impacts, from, to, cursor, limit | items | 認証済み。from/toは最大24時間、limitは1〜100 |
| `createDraftFromNews` | request_key, news_item_id, instructions, image_enabled, image_provider | job_id | N-4。バックグラウンド生成。画像ON時は`image_provider`必須（`createGenerationJob`と同じ制約） |

作成済みバッジは`drafts.source_news_item_id`の存在から導出する。専用の更新Actionは持たない。

## 7. スケジュール

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `listScheduleSlots` | none | slots | active_x_account |
| `createScheduleSlot` | pattern, weekdays, time_jst, mode, instructions, image_enabled, image_provider | slot | P-5不可、9:00〜22:00、00/30分。autoは現行versionの明示同意必須 |
| `updateScheduleSlot` | slot_id, expected_updated_at, fields | slot | 所有者のみ。楽観lock。autoへの変更・再有効化は現行versionの明示同意必須 |
| `disableScheduleSlot` | slot_id, expected_updated_at | slot | 所有者のみ |
| `deleteScheduleSlot` | slot_id, expected_updated_at | deleted | 所有者のみ |

`disableXAutomation`は即時opt-outの正本とする。実行後はauto slotを無効化し、すでにqueuedでもX投稿を開始していないauto起点jobをcancelする。running jobもX API呼び出し直前に同意状態を再確認し、撤回済みなら投稿せず停止する。draft modeと手動投稿は継続できる。

## 8. AI設定・学習

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `listLearningSources` | none | sources | active_x_account |
| `updatePersonaSettings` | settings, expected_base_md_version | version | セクション1〜4を機械更新し新version作成。`base_md_version = 0`の初回保存はテンプレート全体から初版（version 1）を作成する（セクション5〜6は空欄） |
| `addLearningSource` | request_key, type, url | job_id/source | ref_accountは3件、ref_postは10件まで。removed再追加は既存rowを復元 |
| `removeLearningSource` | request_key, source_id | job_id/null | analyzedはremoving化してMD-MERGE。未適用sourceは直接removed |
| `reimportOwnPosts` | request_key | job_id | 直近100件、30日ごとに1回まで |
| `getBaseMd` | x_account_id | content/version | 所有者のみ |
| `updateBaseMdManual` | content, expected_version | version | md/premiumのみ。6見出し構造を検証し、現行version不一致は409 |
| `rollbackBaseMd` | version, expected_version | new_version | md/premium。指定版を内容とする新versionを作成 |
| `listPromptTemplates` | none | templates | system + account override |
| `updatePromptTemplate` | kind, content, expected_updated_at | template | md/premiumのみ。楽観lock |
| `resetPromptTemplate` | kind | template | md/premiumのみ。account override削除 |

`removeLearningSource`は同じXアカウントにqueued/runningの`learning_analysis`/`md_merge`または`removing` sourceがある場合は`job_conflict`にする。`addLearningSource`と`reimportOwnPosts`も`removing`中は拒否し、削除mergeへ別のsource変更を混ぜない。

## 9. 分析・改善

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `getAnalyticsSummary` | period_days | summary | tweet_metricsから集計 |
| `refreshSuggestions` | request_key | job_id | active jobがなければ`suggestion`を冪等作成。新metrics取得後かつ1日1回 |
| `listSuggestions` | none | suggestions | active_x_account。最新のsuggestion job実行分を返す |

改善提案は表示専用とする。承認・却下やベースmd・プロンプトへの自動反映のActionは持たず、ユーザーは提案を読んで発信設定・ベースmd編集（md/premium）で自ら反映する。

更新系Actionは対象rowのstatus/version/`updated_at`をupdate条件に含め、0件更新なら`job_conflict`を返して最新値の再読込を促す。

ベースmd更新は`x_accounts.base_md`、`base_md_version`、`base_md_versions`を同一transactionで更新する。発信設定変更はセクション1〜4だけをテンプレートから再構築し、セクション5〜6をそのまま保持する。LLMは呼ばず生成枠も消費しない。

対象Xアカウントで`learning_analysis`/`md_merge`がrunningの間、`updatePersonaSettings`、`updateBaseMdManual`、`rollbackBaseMd`は`job_conflict`を返す。base_mdを書き換えるtransactionは必ずexpected versionを条件に含める。

## 10. 通知

| Action | 入力 | 出力 | 認可/制約 |
|---|---|---|---|
| `listNotifications` | cursor, unread_only | notifications | 本人のみ |
| `markNotificationRead` | notification_id | notification | 本人のみ |
| `markAllNotificationsRead` | none | count | 本人のみ |
| `retryNotificationEmail` | notification_id | notification | `email_status=failed`のみ。attemptを0へ戻しqueued化。通知ごとに1分1回まで |

## 11. Webhook/cronの認可

| 種別 | 認可 |
|---|---|
| Stripe webhook | `STRIPE_WEBHOOK_SECRET`で署名検証。body raw必須 |
| launchd / Vercel Cron | `Authorization: Bearer ${CRON_SECRET}` |
| X OAuth callback | state/PKCE verifierを検証。署名・暗号化・HttpOnly・短TTL cookieへ保存 |
| Checkout/Portal API | Supabase sessionを検証し、`Origin`をアプリの許可originと完全一致させる |
| Checkout/Portal return | Supabase session＋暗号化済み短TTL markerのuser／source一致を検証し、markerを一度だけ消費 |

Server ActionsはNext.jsの同一origin検証を有効のまま使用し、`allowedOrigins`を設定する場合は明示的な許可リストだけを登録する。Webhook、定時トリガー、OAuth callbackはそれぞれ上表の専用検証を使い、一般的なCSRF tokenの対象外とする。

## 12. 入力制約

| 入力 | 制約 |
|---|---|
| 参考URL（`source_url`等） | `https://`形式のみ検証する。アプリは本文を取得せず、URL文字列を`<input>`でproviderへ渡し、内容確認はproviderのWeb検索が行う（確認できない場合の挙動はプロンプト側の中止条件・error返却に従う） |
| 出典URL検証 | DNS解決後のprivate/loopback/link-local IPを拒否し、redirect先も再検証する（本文は取得しない。timeout 10秒） |
| `request_key` | クライアント生成UUID。ユーザーIDをprefixしてjobのunique keyへ保存 |
| X投稿URL | hostは`x.com`/`twitter.com`、pathは`/{handle}/status/{numeric_id}`だけ許可 |
| 投稿本文 | 空不可。公式`twitter-text`互換でweighted length 280以下、cashtagは1件以下 |
| password | 12〜64文字、UTF-8で72 bytes以下、確認用入力と一致 |
| `time_jst` | 09:00〜22:00、分は00または30 |
| `weekdays` | 0〜6、重複なし、1件以上 |
| `image_provider` | `openai`/`google`のみ。BYOKはvalidな登録キー、premiumは運営キーが設定済みのproviderに限定 |
| `instructions` / `user_opinion` | 各2,000文字以下 |
| prompt / base_md | prompt 8,000文字、base_md 5,000文字以下 |
| image | JPG/PNG/WEBP、5MB以下、1枚 |
| `news_config` | categories/impact_filterは重複なしで各1件以上、`max_items`は1〜100 |
| `captcha_token` | signup／確認メール再送／login／password reset申請ごとに発行された1〜2,048文字のTurnstile token。Server側でSupabase Authへ渡す。5分TTL・1回限りで、Action完了後にwidgetをresetして再利用を許可しない |

同一ユーザーが`queued/running`のjobを5件持つ場合、新規生成・学習・提案を`job_conflict`で拒否する。投稿はさらに`X_DAILY_POST_LIMIT`とpremium残量を確認する。

## 13. 監査ログ

MVPでは専用audit tableは作らない。最低限、次を永続化して追跡可能にする。

- ジョブ実行: `generation_jobs`
- 利用枠: `usage_events`
- 課金webhook: `stripe_events`
- 投稿結果・部分失敗: `drafts.tweet_ids`, `drafts.last_post_error`
- ベースmd変更: `base_md_versions`
- 通知/メール送信: `notifications`
- 外部API利用量・推定原価: `external_api_usage_events`
