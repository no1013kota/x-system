# 要件詳細 02: データモデル

| 項目 | 内容 |
|---|---|
| バージョン | v1.28 |
| 更新日 | 2026-08-15 |
| 関連 | PRD A/L/N/P/S/K/M/O |

## 1. 共通ルール

- 主キーは原則`uuid`、既定値は`gen_random_uuid()`。
- 作成日時は`created_at timestamptz not null default now()`、更新対象は`updated_at timestamptz not null default now()`を持つ。
- DB保存時刻はUTC、表示・月次カウント・スケジュール判定・日次上限はJST。
- ユーザー所有データは`user_id`または`x_account_id`経由でRLSを適用する。
- 認証済みクライアントには原則selectだけを許可し、insert/update/deleteはzod検証と所有権確認を行うServer Action/APIだけに許可する。
- `service_role`にはpublicスキーマ全体のDML権限を付与する（Supabase既定と同じ姿勢。以降追加されるテーブルにも既定権限で自動付与）。RLSをバイパスするserver-only専用ロールであり、PostgREST経由の管理系クエリが権限エラーで落ちないようにする。付与漏れは直結pg（postgresで接続）では露見しないため、`service-role-grants.db.test.ts`で全テーブルを検査する。
- APIキーとOAuth tokenはversion、nonce、ciphertext、auth tagを含む暗号化envelopeをJSON文字列化して`text`へ保存し、Server onlyで復号する。
- JSONBは本書のスキーマを正とし、書き込み前後にzodで検証する。
- FKの削除方針は、履歴・台帳は`RESTRICT`、一時的参照は`SET NULL`を基本とする。MVPではセルフサービスのアカウント一括削除と、それを前提にした専用cascade・削除手順を定義しない。

## 2. Enum

| enum | 値 |
|---|---|
| `plan_type` | `standard`, `md`, `premium` |
| `subscription_status` | `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `paused`, `canceled`, `unpaid` |
| `api_provider` | `x`, `anthropic`, `openai`, `google` |
| `api_key_status` | `valid`, `invalid`, `unchecked` |
| `x_auth_type` | `byok`, `managed` |
| `x_account_status` | `active`, `expired`, `disabled`, `error` |
| `learning_source_type` | `ref_account`, `ref_post`, `own_posts` |
| `learning_source_status` | `pending`, `analyzed`, `failed`, `removing`, `removed` |
| `news_category` | `ai`, `web3`, `investment`, `business`, `business_ops`, `sns` |
| `impact_level` | `high`, `mid`, `low` |
| `job_kind` | `post_generation`, `image_generation`, `post_publish`, `learning_analysis`, `md_merge`, `suggestion` |
| `job_trigger` | `manual`, `news`, `schedule`, `system` |
| `job_status` | `queued`, `running`, `succeeded`, `failed`, `canceled` |
| `progress_stage` | `validating`, `research`, `writing`, `image`, `posting`, `merging` |
| `post_pattern` | `p1`, `p2`, `p3`, `p4`, `p5`, `p6` |
| `draft_status` | `draft`, `posting`, `posted`, `discarded`, `failed` |
| `posted_mode` | `auto`, `manual` |
| `schedule_mode` | `draft`, `auto` |
| `usage_counter_type` | `post_normal`, `post_url`, `generation`, `image` |
| `usage_event_reason` | `reserve`, `refund`, `consume` |
| `usage_event_operation` | `generation`, `image_generation`, `post_create`, `post_delete` |
| `notification_type` | `news`, `draft_created`, `posted`, `error`, `billing`, `usage`, `summary` |
| `email_delivery_status` | `not_requested`, `queued`, `sent`, `failed` |

## 3. テーブル定義

### 3.1 `profiles`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK, FK `auth.users.id` | ユーザーID |
| `email` | `text` | not null | メールアドレス |
| `plan` | `plan_type` | not null default `standard` | 現在プラン |
| `stripe_customer_id` | `text` | unique null | Stripe customer |
| `stripe_subscription_id` | `text` | unique null | Stripe subscription |
| `subscription_status` | `subscription_status` | not null default `incomplete` | 課金状態 |
| `subscription_event_created_at` | `timestamptz` | null | 最後に反映したStripe event時刻 |
| `current_period_end` | `timestamptz` | null | 現在期間終了 |
| `cancel_at_period_end` | `boolean` | not null default false | 期間末解約予定 |
| `trial_ends_at` | `timestamptz` | null | trial終了 |
| `trial_used_at` | `timestamptz` | null | 初回trial付与日時。再付与防止 |
| `terms_version` | `text` | null | 同意済み利用規約version |
| `terms_accepted_at` | `timestamptz` | null | 利用規約同意日時 |
| `privacy_version` | `text` | null | 確認済みprivacy policy version |
| `privacy_acknowledged_at` | `timestamptz` | null | privacy policy確認日時 |
| `active_x_account_id` | `uuid` | FK nullable, `ON DELETE SET NULL` | 現在操作対象 |
| `ai_purpose_config` | `jsonb` | not null default `{}` | 用途別AI provider |
| `news_config` | `jsonb` | not null default `{}` | ニュース表示設定 |
| `notification_config` | `jsonb` | not null default `{}` | 通知種別×channel |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Indexes: `stripe_customer_id`, `stripe_subscription_id`, `active_x_account_id`

RLS: 本人select可。writeはServer only。

作成ライフサイクル: `auth.users`へのinsert後、`security definer`かつ空の`search_path`を持つAFTER INSERT triggerが`profiles`を作成する。`email`は`auth.users.email`、`plan=standard`、`subscription_status=incomplete`とし、`ai_purpose_config`／`news_config`／`notification_config`は§4.1〜4.3の初期値を保存する。既存・過去ユーザーでprofileが欠落している場合は、認証後の初回アクセスでservice roleが同じ初期値を`id`競合時DO NOTHINGでinsertし、既存profileの設定・契約値を更新しない。

重大改定後の再同意は、現行versionと不一致の文書だけを対象とする。利用規約は`terms_version`／`terms_accepted_at`、プライバシーポリシーは`privacy_version`／`privacy_acknowledged_at`を同時に更新する。既に現行の文書とその時刻は上書きしない。明示同意前やクライアント送信versionが現行と不一致の場合は4項目とも更新しない。

### 3.2 `user_api_keys`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK profiles, not null | 所有者 |
| `provider` | `api_provider` | not null | `x`はBYOK X App資格情報 |
| `credentials_ciphertext` | `text` | not null | 暗号化envelope |
| `display_hint` | `jsonb` | not null default `{}` | Client ID/API key等の末尾4文字 |
| `status` | `api_key_status` | not null default `unchecked` | 検証状態 |
| `verified_at` | `timestamptz` | null | 最終疎通確認 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`user_id`, `provider`)

RLS: 本人select可。writeはServer Actionのみ。レスポンスへ`credentials_ciphertext`を含めない。

`display_hint`はX App資格情報で`{client_id_last4, client_type, has_client_secret}`、AIキーで`{api_key_last4}`とし、秘密値の全文やClient Secret末尾は保存しない。Xの`credentials_ciphertext`をServer onlyで復号した平文は`{clientId, clientSecret, clientType}`のJSONとし、AIはAPIキー文字列そのものとする。保存・差し替え時は`status=unchecked`、`verified_at=null`へ戻す。

削除は即時に対象行を物理削除する。AI provider削除時は同一transactionで`profiles.ai_purpose_config`の一致する`text`／`image`だけを`null`へ戻す。X削除時は事前に保存済みaccess／refresh tokenのrevokeをbest effortで試み、同一transactionで全BYOK Xアカウントを`expired`へ変更する。revoke失敗時もApp資格情報の削除を優先し、OAuth token ciphertextは再連携・個別切断処理との整合のため保持する。

### 3.3 `x_accounts`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK profiles, not null | 所有者 |
| `x_user_id` | `text` | not null | X user id |
| `handle` | `text` | not null | `@`なし |
| `name` | `text` | not null | X表示名 |
| `profile_image_url` | `text` | null | Xプロフィール画像 |
| `auth_type` | `x_auth_type` | not null | BYOK/managed |
| `access_token_ciphertext` | `text` | null | 切断時はnull |
| `refresh_token_ciphertext` | `text` | null | 暗号化済み |
| `oauth_scopes` | `text[]` | not null default `{}` | 同意済みscope |
| `automation_consent_version` | `text` | null | 自動投稿説明文の同意version |
| `automation_consented_at` | `timestamptz` | null | 自動投稿への明示同意日時 |
| `automation_disabled_at` | `timestamptz` | null | 自動投稿の同意撤回日時。再同意時はnull |
| `token_expires_at` | `timestamptz` | null | 期限 |
| `token_refresh_locked_at` | `timestamptz` | null | refresh single-flight lease |
| `token_refresh_lock_id` | `uuid` | null | refresh実行者識別子 |
| `status` | `x_account_status` | not null default `active` | 連携状態 |
| `settings` | `jsonb` | not null default `{}` | L-4〜L-7フォーム値 |
| `base_md` | `text` | not null default `''` | 現行ベースmd |
| `base_md_version` | `integer` | not null default 0 | 未生成は0 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`user_id`, `x_user_id`), `base_md_version >= 0`。`automation_consent_version`と`automation_consented_at`は同時にnullまたは同時に非null。

Indexes: (`user_id`, `status`)

RLS: 本人select可。writeはServer Actionのみ。

`active_x_account_id`は同じprofileが所有するx_accountだけを設定できるよう、Server ActionとDB triggerで検証する。

プラン変更のSubscription同期では、profileと同じtransaction内でXアカウントの利用可否を更新する。BYOK（standard／md）→premiumは`auth_type=byok`、premium→BYOKは`auth_type=managed`を`expired`にする。新planがstandardの場合は、互換性のないauth typeを先に失効した後、現在の`active_x_account_id`がなおactiveならその1件、そうでなければ`created_at, id`順で最古のactive 1件を維持し、他のactiveを`disabled`にする。維持候補がなければ`active_x_account_id=null`とする。

この同期は`status`／`active_x_account_id`だけを変更し、access／refresh token、OAuth scope、自動投稿同意、`settings`、`base_md`、`base_md_versions`、`learning_sources`、下書き、tweet ID、実績、利用台帳を削除・null化しない。premium→BYOKでは`ai_purpose_config.text|image`を`user_api_keys.status=valid`の登録済みproviderと照合し、textはanthropic／openai／google、imageはopenai／googleのvalidキーだけを維持して、その他を`null`へ戻す。`credentials_ciphertext`自体は保持する。

自動投稿への有効な同意は、`automation_consent_version`が現行説明versionと一致し、`automation_consented_at is not null`かつ`automation_disabled_at is null`の場合に限る。OAuth scopeの付与はこの同意の代わりにしない。opt-outでは同じtransactionで`automation_disabled_at`を設定し、対象Xアカウントの`mode=auto`スロットをすべて無効化する。

### 3.4 `base_md_versions`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `version` | `integer` | not null | 1始まり |
| `content` | `text` | not null | ベースmd全文 |
| `change_source` | `text` | not null | `settings`（発信設定フォーム。初版作成を含む）/`learning`/`manual`/`rollback` |
| `summary` | `text` | null | 変更要約 |
| `created_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`x_account_id`, `version`), `version > 0`

RLS: x_account所有者select可。writeはServer Actionのみ。

### 3.5 `prompt_templates`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK nullable | nullはシステム既定 |
| `kind` | `text` | not null | `p1`〜`p6`, `image` |
| `content` | `text` | not null | プロンプト本文 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: `kind in ('p1','p2','p3','p4','p5','p6','image')`

Unique indexes: (`x_account_id`, `kind`) where `x_account_id is not null`; (`kind`) where `x_account_id is null`

RLS: system defaultは認証ユーザーselect可。account別は所有者select可。writeはmd/premium向けServer Actionのみ。

**system default行はコード定数（`SYSTEM_DEFAULT_TEMPLATES`）の写しで、`scheduler_tick`が毎回差分同期する**（T-M7-37）。解決順は「account上書き → system default行 → コード定数」なので、DB行が古いままだとコード側でプロンプトを直しても反映されない。人が思い出して実行する手順にしない（CLAUDE.md 原則3）。内容が同じときは更新しないため`updated_at`は動かない（編集画面の楽観lockに影響しない）。

### 3.6 `learning_sources`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `type` | `learning_source_type` | not null |  |
| `url` | `text` | null | `own_posts`はnull |
| `status` | `learning_source_status` | not null default `pending` |  |
| `analysis_summary` | `jsonb` | null | LRN出力 |
| `removed_at` | `timestamptz` | null | soft delete日時 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Unique indexes: (`x_account_id`, `type`, `url`) where `url is not null`; (`x_account_id`) where `type = 'own_posts'`

RLS: x_account所有者select可。writeはServer Actionのみ。

### 3.7 `news_items`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `category` | `news_category` | not null | 6分野（AI/Web3/投資/ビジネス/業務改善/SNS運用） |
| `title` | `text` | not null |  |
| `summary` | `text` | not null |  |
| `source_url` | `text` | not null unique | canonical化して重複排除 |
| `impact` | `impact_level` | not null |  |
| `published_at` | `timestamptz` | null | 元記事公開日時 |
| `fetched_at` | `timestamptz` | not null default now() | 取得日時 |

Indexes: (`category`, `impact`, `fetched_at desc`)

`source_url`のcanonical化（保存前・T-M4-11 `canonicalizeSourceUrl`）: scheme/hostを小文字化、既定ポート（http:80/https:443）除去、fragment除去、トラッキングパラメータ（`utm_*`・`fbclid`・`gclid`等）除去、残クエリをキー順で安定化、末尾スラッシュ除去。窓の重なりで届く同一記事の別URL表記を1件へcollapseする（解釈不能なURLはtrimのみ）。

RLS: 認証済みユーザーselect可。writeはservice roleのみ。

### 3.8 `generation_jobs`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `kind` | `job_kind` | not null | 実行内容 |
| `trigger` | `job_trigger` | not null | 起点 |
| `parent_job_id` | `uuid` | self FK nullable | 再試行・派生元 |
| `slot_id` | `uuid` | FK nullable | schedule起点 |
| `draft_id` | `uuid` | FK nullable | 投稿・画像jobの対象draft |
| `learning_source_id` | `uuid` | FK nullable | 学習jobの対象source |
| `scheduled_for` | `timestamptz` | null | schedule slotの予定時刻 |
| `schedule_run_key` | `text` | unique null | slot定時実行の冪等key |
| `request_key` | `text` | unique null | ユーザー操作・子job作成の冪等key |
| `pattern` | `post_pattern` | null | 投稿生成時 |
| `input` | `jsonb` | not null default `{}` | kind別入力 |
| `status` | `job_status` | not null default `queued` | 状態 |
| `progress_stage` | `progress_stage` | null | UI進捗 |
| `attempt` | `integer` | not null default 0 | worker取得回数 |
| `available_at` | `timestamptz` | not null default now() | retry可能時刻 |
| `locked_at` | `timestamptz` | null | lease開始/heartbeat |
| `locked_by` | `text` | null | worker id |
| `usage` | `jsonb` | not null default `{}` | provider呼び出し実績 |
| `error` | `jsonb` | null | 構造化エラー |
| `started_at` | `timestamptz` | null | 初回開始 |
| `finished_at` | `timestamptz` | null | 終了 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: `attempt >= 0`

Indexes: (`status`, `available_at`, `created_at`), (`x_account_id`, `created_at desc`), `slot_id`, `parent_job_id`, `draft_id`, `learning_source_id`

Partial unique indexes: (`draft_id`) where kind=`post_publish` and status in (`queued`,`running`); (`draft_id`) where kind=`image_generation` and status in (`queued`,`running`); (`x_account_id`) where kind=`suggestion` and status in (`queued`,`running`); (`x_account_id`) where kind in (`learning_analysis`,`md_merge`) and status=`running`。

「同一Xアカウントの全kind直列」と「同一userの`post_publish`直列」は、workerのlease transactionが取得する`pg_advisory_xact_lock`で強制する（要件04 §4。上記indexはDBレベルの追加ガード）。

RLS: 本人select可。writeはServer only。

### 3.9 `drafts`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `pattern` | `post_pattern` | not null |  |
| `thread` | `jsonb` | not null | 全体上限1〜7ポスト。書き込み時はpattern別最大数も検証 |
| `initial_thread` | `jsonb` | not null | 生成確定時の本文snapshot。下書き承認率算出用で更新しない |
| `images` | `jsonb` | not null default `[]` | Storage path・provider・状態 |
| `status` | `draft_status` | not null default `draft` |  |
| `source_job_id` | `uuid` | FK nullable, unique | 生成元job |
| `parent_draft_id` | `uuid` | self FK nullable | 再生成元draft |
| `source_news_item_id` | `uuid` | FK nullable | ニュース起点 |
| `quote_tweet_id` | `text` | null | P-5対象ID。取得検証用で投稿APIには指定しない |
| `quote_url` | `text` | null | P-5で1ポスト目へ付与する対象X URL |
| `root_tweet_id` | `text` | null | スレッド先頭 |
| `tweet_ids` | `jsonb` | not null default `[]` | 投稿順のtweet_id配列 |
| `posted_mode` | `posted_mode` | null | auto/manual |
| `posted_at` | `timestamptz` | null | 投稿完了時刻。部分失敗で残存IDが確定した時も設定し、metrics_collectorのcheckpoint基準（アンカー）とする（要件04 §13） |
| `tweet_metrics` | `jsonb` | not null default `{}` | tweet_id・checkpoint別実績 |
| `next_metrics_at` | `timestamptz` | null | 次checkpoint/retryのdue時刻 |
| `metrics_completed_at` | `timestamptz` | null | 全tweet_idの収集終了日時 |
| `last_post_error` | `jsonb` | null | 部分失敗・残存tweet_id |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Indexes: (`x_account_id`, `status`, `created_at desc`), (`x_account_id`, `posted_at desc`), (`next_metrics_at`) where `metrics_completed_at is null`, `source_news_item_id`, `parent_draft_id`

RLS: x_account所有者select可。本文編集は`status = draft`のみServer Action経由。投稿状態とjobからの更新はServer only。

投稿完了時はrowを削除せず`status=posted`へ遷移する。これにより未投稿の下書き一覧からは外れるが、投稿履歴として`thread`、`initial_thread`、`tweet_ids`、`tweet_metrics`を保持する。

### 3.10 `schedule_slots`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `pattern` | `post_pattern` | not null | P-1〜P-4/P-6 |
| `weekdays` | `integer[]` | not null | 0=日〜6=土 |
| `time_jst` | `time` | not null | 9:00〜22:00、00/30分 |
| `mode` | `schedule_mode` | not null | 下書き/自動投稿 |
| `theme` | `text` | **not null**, CHECK（テーマ選択肢マスタの6値＋`other`） | **テーマ**。値は`src/lib/post/post-theme.ts`の`POST_THEME_IDS`（§4.4の6値＋`other`）。`other`＝「追加指示に記載」でプロンプトへテーマを出さない。**「指定なし」＝NULLは許さない**（既定のまま押されると選んだつもりで選んでいない状態になる） |
| `instructions` | `text` | null | 追加指示 |
| `image_enabled` | `boolean` | not null default false |  |
| `enabled` | `boolean` | not null default true |  |
| `last_run_at` | `timestamptz` | null | 最後のenqueue |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: patternは`p5`不可、曜日は0〜6で1件以上、時刻は09:00〜22:00かつ00/30分。画像providerはスロットに持たず、実行時に`profiles.ai_purpose_config.image`から解決する（要件05 §5）。

RLS: x_account所有者select可。writeはServer Actionのみ。

### 3.11 `follower_snapshots`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `snapshot_date` | `date` | not null | JST日付 |
| `followers_count` | `integer` | not null |  |
| `created_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`x_account_id`, `snapshot_date`), `followers_count >= 0`

RLS: x_account所有者select可。writeはservice roleのみ。

### 3.12 `improvement_suggestions`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `source_job_id` | `uuid` | FK, not null | SUGGEST job |
| `content` | `text` | not null | 提案文 |
| `evidence` | `jsonb` | not null | 根拠 |
| `created_at` | `timestamptz` | not null default now() |  |

Indexes: (`x_account_id`, `created_at desc`), `source_job_id`

RLS: x_account所有者select可。writeはServer only（SUGGEST jobのみ作成）。

提案は表示専用。承認・却下の状態やベースmdへの自動反映情報は持たず、画面には最新のSUGGEST job実行分を表示する。ユーザーは提案を読んで発信設定・ベースmd編集（md/premium）で自ら反映する。

### 3.13 `usage_events`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK profiles, not null | 対象 |
| `x_account_id` | `uuid` | FK nullable | 対象Xアカウント |
| `job_id` | `uuid` | FK nullable | 対象job |
| `draft_id` | `uuid` | FK nullable | 対象draft |
| `tweet_id` | `text` | null | 通常/URL付き投稿枠consume時 |
| `month` | `text` | not null | JST `YYYY-MM` |
| `counter_type` | `usage_counter_type` | not null |  |
| `operation` | `usage_event_operation` | not null | 消費・予約の操作種別 |
| `delta` | `integer` | not null | `+1`/`-1` |
| `reason` | `usage_event_reason` | not null |  |
| `idempotency_key` | `text` | not null unique | 二重処理防止 |
| `ref_event_id` | `uuid` | self FK nullable | refund元reserve |
| `created_at` | `timestamptz` | not null default now() |  |

Constraints: month形式、deltaは±1、reserve/consumeは+1、refundは-1、refundは`ref_event_id`必須かつ元eventと同じcounter/month/operation。`post_create`と`post_delete`はcounter_typeが`post_normal`または`post_url`かつreason=`consume`。同じtweet_idの`post_delete`は対応する`post_create`と同じcounter_typeを使う。

Indexes: (`user_id`, `month`), `job_id`, `draft_id`, `tweet_id`

RLS: 本人select可。writeはServer only。

### 3.14 `usage_counters`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `user_id` | `uuid` | FK profiles, not null | 対象 |
| `month` | `text` | not null | JST `YYYY-MM` |
| `normal_posts_count` | `integer` | not null default 0 | URLなし通常投稿枠 |
| `url_posts_count` | `integer` | not null default 0 | URL付き投稿枠 |
| `generations_count` | `integer` | not null default 0 | 生成枠 |
| `images_count` | `integer` | not null default 0 | 画像枠 |
| `updated_at` | `timestamptz` | not null default now() |  |

PK: (`user_id`, `month`)

Constraints: month形式、各countは0以上。上限はpremiumの`normal_posts_count <= 200`、`url_posts_count <= 20`、`generations_count <= 100`、`images_count <= 20`。

RLS: 本人select可。writeはServer only。

### 3.15 `notifications`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK profiles, not null | 対象 |
| `type` | `notification_type` | not null | 通知種別 |
| `dedupe_key` | `text` | null | 同一イベント重複防止 |
| `title` | `text` | not null |  |
| `body` | `text` | not null |  |
| `link` | `text` | null | アプリ内相対パス |
| `payload` | `jsonb` | not null default `{}` | 種別固有データ。ニュースダイジェストは時間窓、件数、対象news item IDを保存 |
| `in_app_enabled` | `boolean` | not null | 作成時設定のsnapshot |
| `email_status` | `email_delivery_status` | not null default `not_requested` | メール送信状態 |
| `email_attempts` | `integer` | not null default 0 | 送信試行回数 |
| `email_available_at` | `timestamptz` | null | 次回retry可能時刻 |
| `email_last_attempt_at` | `timestamptz` | null | 最終送信試行 |
| `email_provider_id` | `text` | null | 送信サービスのmessage ID |
| `email_sent_at` | `timestamptz` | null | 送信成功日時 |
| `email_error` | `text` | null | 秘密値を含めない失敗要約 |
| `read_at` | `timestamptz` | null | 既読 |
| `created_at` | `timestamptz` | not null default now() |  |

Unique index: (`user_id`, `dedupe_key`) where `dedupe_key is not null`

Indexes: (`user_id`, `read_at`, `created_at desc`), (`email_status`, `email_available_at`)

Constraints: `email_attempts >= 0`。`email_status = queued`のとき`email_available_at`必須。

RLS: 本人select可。writeはServer Action/API only。

ニュースダイジェストの`payload`は次の形式とする。`news_item_ids`はユーザーの`news_config`に一致した新着だけを優先度順で`max_items`（1〜100、既定20）まで保存し、本文・メールには先頭5件を掲載する。保存上限を超える場合も`total_count`には全件数を入れる。

```json
{
  "window_started_at": "2026-07-19T00:00:00Z",
  "window_ended_at": "2026-07-19T01:00:00Z",
  "total_count": 7,
  "news_item_ids": ["uuid-1", "uuid-2"]
}
```

決済失敗通知は`dedupe_key=billing:invoice:{invoice_id}:payment_failed`でinvoiceごとに1件とし、`link=/app/settings?tab=billing`を保存する。`notification_config.billing`の両channelがOFFならrowを作らない。作成時の`in_app`は`in_app_enabled`、`email`は`email_status=queued|not_requested`と`email_available_at`へ反映し、監査可能なsnapshotもpayloadへ保存する。

```json
{
  "attempt_count": 2,
  "invoice_id": "in_...",
  "subscription_id": "sub_...",
  "subscription_status": "past_due",
  "notification_config_snapshot": {
    "in_app": true,
    "email": true
  }
}
```

X再連携通知は、token refreshが`invalid_grant`・必要scope不足・refresh token不在で`x_accounts.status`を`active`→`expired`へ遷移させたときに`type=error`で1件作成し、`link=/app/settings?tab=api-keys`と`payload={x_account_id, reason}`を保存する。`notification_config.error`の両channelがOFFならrowを作らない（`in_app`は`in_app_enabled`、`email`は`email_status=queued|not_requested`と`email_available_at`へ反映）。`dedupe_key`は付けない（遷移は1エピソードにつき1度だけ通知作成が走るため重複せず、再連携後の再失効でも新規に作成できる）。

### 3.16 `stripe_events`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `event_id` | `text` | PK | Stripe event id |
| `type` | `text` | not null | event type |
| `object_id` | `text` | null | subscription等の対象ID |
| `event_created_at` | `timestamptz` | not null | Stripe event.created |
| `processed_at` | `timestamptz` | not null default now() | 処理済み日時 |

Indexes: (`object_id`, `event_created_at desc`)

RLS: select/writeともservice roleのみ。

### 3.17 `external_api_usage_events`

プレミアム原価と外部API利用量をユーザー別・処理別に集計する台帳。利用枠を増減する`usage_events`とは責務を分ける。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `user_id` | `uuid` | FK profiles, null | 共通NEWSはnull |
| `x_account_id` | `uuid` | FK null | 対象Xアカウント |
| `job_id` | `uuid` | FK null | 対象job |
| `provider` | `api_provider` | not null | X/AI provider |
| `operation` | `text` | not null | `text_generation`, `web_search`, `image_generation`, `x_post_create`, `x_post_delete`, `x_post_read`, `x_user_read` |
| `request_id` | `text` | null | provider request ID |
| `status` | `text` | not null | `succeeded` / `failed` |
| `http_status` | `integer` | null | provider HTTP status |
| `error_code` | `text` | null | 秘密値を含まない正規化error code |
| `quantity` | `integer` | not null default 1 | request数または返却resource数 |
| `usage` | `jsonb` | not null default `{}` | token、検索回数等の秘密値を含まない内訳 |
| `unit_cost_usd` | `numeric(12,6)` | null | 実行時に採用した単価snapshot |
| `estimated_cost_usd` | `numeric(12,6)` | null | 推定原価。算出不能はnull |
| `idempotency_key` | `text` | not null unique | job callまたはX操作単位の重複防止 |
| `occurred_at` | `timestamptz` | not null default now() | 外部呼び出し時刻 |

Constraints: `operation`は上記列挙値、`status in ('succeeded','failed')`、`quantity > 0`、HTTP statusは100〜599、金額は0以上。X media uploadは件数を運用logへ残してよいが、本台帳の原価・サービス内利用枠には含めない。

Indexes: (`user_id`, `occurred_at desc`), (`provider`, `operation`, `occurred_at desc`), `job_id`

RLS: select/writeともservice roleのみ。投稿本文、prompt、APIキー、token、外部レスポンス本文は保存しない。明細は`occurred_at`から40日保持し、期限後にcleanupする（前月分の月次集計・実測分析は翌月10日までにSQLで実施する。要件01 §9）。

### 3.18 `cron_runs`

定時トリガーの「`job名 + 時間窓`の受付は高々一度」を保証する重複受付防止テーブル（window claim / dedup marker、要件04 §6、ADR-0003）。Supavisor transaction modeプーラではセッションscope advisory lockが接続checkout間で保持されないため、unique制約付きの受付行で重複起動・完了後の再試行を防ぐ。**責務は重複受付防止のみで、本処理の成否・完了は持たない**（この行だけで本体成功を判断しない）。完了状態の正本は、永続ジョブは`generation_jobs.status`/`generation_jobs.finished_at`、状態ベースcron（tick/metrics/follower）は対象業務データの現在状態とする。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `job_name` | `text` | not null | cron種別（`news_fetch`/`scheduler_tick`/`metrics_collector`/`follower_snapshot`） |
| `window_key` | `text` | not null | 対象時刻窓（毎時=`YYYY-MM-DDTHH`、5分tick=`YYYY-MM-DDTHH:MM`、いずれもUTC） |
| `claimed_at` | `timestamptz` | not null default now() | 受付（claim）時刻。完了時刻ではない |

Constraints: `unique (job_name, window_key)`（同一窓の重複受付を防ぐ。`insert ... on conflict do nothing`で行を確保できた起動だけが本処理へ進む）

Indexes: `claimed_at`（保持cleanup用）

RLS: select/writeともservice roleのみ。行は受付ごとに増えるため`claimed_at`から40日保持し、期限後に`scheduler_tick`がcleanupする（M4、要件01 §9）。cleanup後は同一`window_key`を再claim可能になるが、`window_key`は時刻由来で単調増加するため通常運用で保持期間超過窓が再来・再実行されることはない。

### 3.19 `news_fetch_outcomes`

`news_fetch`の**分野ごとの結果**を残す表（要件04 §6、T-M7-40）。`cron_runs`が「受付は高々一度」だけを保証するのに対し、こちらは**業務結果**を持ち、運営者向けの状態確認（`npm run doctor`／`GET /api/cron/doctor`）が「0件」の意味を説明するために読む。cronの受付判定には使わない。

これが無いと、ある分野が0件のとき「該当ニュースが無かった（正常な空）」のか「取得したが規定を満たさず全件破棄した（失敗による空）」のかを運営者が区別できない。除外理由が`console.warn`にしか出ていなかったため、2026-07-28のweb3全滅（T-M7-24）と2026-07-31の0件がどちらも見えなかった。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `window_key` | `text` | not null | 対象時刻窓（`cron_runs`と同じ`YYYY-MM-DDTHH`・UTC） |
| `category` | `news_category` | not null | 分野 |
| `ok` | `boolean` | not null | 分野の処理が例外で終わらなかったか。falseは既存ニュースを保持して次回起動へ委ねた場合 |
| `fetched` | `integer` | not null default 0 | 契約と新しさの検証を通った件数 |
| `saved` | `integer` | not null default 0 | 重複除外後に保存した件数 |
| `dropped` | `integer` | not null default 0 | 規定を満たさず捨てた件数。**`fetched = 0 and dropped > 0`が「全件破棄」** |
| `future_adjusted` | `integer` | not null default 0 | 未来日時のため`published_at`を落として取得時刻扱いへ寄せた件数 |
| `drop_reasons` | `jsonb` | not null default `'{}'` | 除外理由の内訳（例`{"title:too_big": 3}`）。運営者向け表示の材料 |
| `error_code` | `text` | nullable | 失敗の種別を表す短く安全な識別子（`http_429`／`InvalidProviderOutputError` 等）。**providerの応答本文は入れない**ので運営者向け状態確認（doctor）に出してよい |
| `provider_raw_error` | `text` | nullable | providerが実際に返した内容（検証に落ちたitemの中身など）。**画面にもHTTP応答にも出さない**（要件01 §8）。上限と切り詰めは`src/lib/ai/raw-error.ts`が正本。記録が無ければNULL（「正常な空」と区別する） |
| `ran_at` | `timestamptz` | not null default now() | 記録時刻 |

Constraints: `unique (window_key, category)`（同一窓の再実行は行を増やさず上書きする）

Indexes: `ran_at desc`（直近の結果を引く／保持cleanup用）

RLS: select/writeともservice roleのみ。`ran_at`から40日保持し、期限後は`scheduler_tick`が1起動500件まで削除する（要件01 §9）。

## 4. JSONスキーマ

### 4.1 `profiles.ai_purpose_config`

```json
{
  "text": "anthropic",
  "image": null
}
```

`text`は文章生成とリサーチ（Web検索）の両方に使う単一provider。リサーチは同providerの内蔵Web検索機能で実行し、別providerを割り当てない。BYOKでは登録済みかつ`valid`のproviderのみ指定できる。premiumの`text`は運営文章provider（既定Claude／`anthropic`）で固定し、ユーザー設定はread-only表示とする。`image`は運営側で利用可能なOpenAI/Geminiから選択できる。

ライフサイクル: BYOKではAIキーの保存・疎通成功時に`text`が未設定なら当該providerを自動設定し（画像対応providerの`image`も同様）、`deleteApiKey`は該当用途の設定を解除する。premiumの`text`はDBへ保存せず、ユーザー指定に依存しない運営文章provider（未設定時`anthropic`）へ実行時に解決する（`updateAiPurposeConfig`はpremiumの`text`変更を拒否）。premium→BYOKのプラン変更同期時は`text`/`image`を登録済み`valid`キーで再検証し、無効なら未設定へ戻して初期設定ガイドへ誘導する。

### 4.2 `profiles.news_config`

```json
{
  "categories": ["ai", "web3", "investment", "business", "business_ops", "sns"],
  "impact_filter": ["high", "mid"],
  "max_items": 20
}
```

`categories`と`impact_filter`は重複なしで各1件以上、`max_items`は1〜100とする。表示一覧と時間単位ダイジェストの両方へ適用する。

### 4.3 `profiles.notification_config`

```json
{
  "news": { "in_app": true, "email": true },
  "draft_created": { "in_app": true, "email": true },
  "posted": { "in_app": true, "email": false },
  "error": { "in_app": true, "email": true },
  "billing": { "in_app": true, "email": true },
  "usage": { "in_app": true, "email": true },
  "summary": { "in_app": true, "email": true }
}
```

決済停止と利用枠100%到達の常設バナーはこの設定にかかわらず表示する。

`summary`は日次サマリ（T-M7-29）。**1日1通なのでメールも既定ON**とする（画面を見に行かなくても静かな劣化に気付ける形にするのが目的で、既定OFFでは目的を果たさない）。この既定はコード（`DEFAULT_NOTIFICATION_CONFIG`）とprofile作成triggerの両方に持つため、変更時は両方を揃える（片方だけだと新規利用者にだけ届かない）。

### 4.4 `x_accounts.settings`

```json
{
  "persona": {
    "speaker": "中小企業向け業務改善コンサルタント",
    "audience": "従業員30名以下の経営者",
    "value": "明日の実務で使える効率化"
  },
  "themes": {
    "primary": ["business_ops"],
    "secondary": ["ai", "sns"],
    "free_text": "個人事業主向け"
  },
  "tone": {
    "sentence_style": "polite",
    "first_person": "私",
    "emoji_policy": "limited",
    "emoji_max_per_post": 1,
    "hashtags_max": 0,
    "thread_numbering": true
  },
  "ng": { "words": [], "topics": [], "rules": [] }
}
```

`themes.primary`/`secondary`はコード定数のテーマ選択肢マスタ（6テーマ）のIDから選ぶ。6テーマは表示名と`news_category`を`ai=AI`、`web3=Web3`、`investment=投資`、`business=ビジネス`、`business_ops=業務改善`、`sns=SNS運用`で1対1対応させ、P-6の`<news_digest>`該当判定に使う。`primary`は1件以上必須とし、両配列を通じた重複と未知IDを拒否する。`free_text`は自由入力で、該当判定の対象外とする。

`tone.sentence_style`は`polite|assertive`、`emoji_policy`は`none|limited`とする。絵文字を使わない場合は`emoji_max_per_post=0`を必須とし、絵文字・ハッシュタグの上限は0以上の整数とする。初期値は要件06 §3.4を正とする。`ng`の3配列は空を許可するが、要素を持つ場合は空文字を拒否する。NGワード原文はコード照合用としてsettingsだけに保持し、ベースmdへ展開しない。

### 4.5 `generation_jobs.input`

```json
{
  "pattern": "p1",
  "source_url": "https://example.com",
  "quote_url": null,
  "quote_tweet_id": null,
  "user_opinion": null,
  "instructions": null,
  "image_enabled": true,
  "news_item_id": "uuid",
  "requested_mode": "draft"
}
```

対象draft/sourceは専用FK列へ保存し、`input`へ重複保存しない。使用するfieldは`job_kind`ごとにzod discriminated unionで制約する。

### 4.6 `generation_jobs.usage`

```json
{
  "calls": [
    {
      "provider": "anthropic",
      "model": "model-name",
      "operation": "generate",
      "request_id": "provider-request-id",
      "status": "succeeded",
      "stop_reason": "end_turn",
      "latency_ms": 1200,
      "input_tokens": 0,
      "output_tokens": 0,
      "web_search_count": 0,
      "cache_hit": false,
      "citations": [{ "url": "https://example.com", "title": "Source" }],
      "error_code": null,
      "estimated_cost_usd": 0
    }
  ],
  "estimated_cost_usd_total": 0
}
```

各`estimated_cost_usd`は単価表を持たないprovider（画像生成等）では算出不能として`null`になる（`estimated_cost_usd_total`はnullを0として合算する）。同じcallは`operation`・数量・実行時単価snapshot・推定原価を`external_api_usage_events`（§3.17）へ`{job種別}:{job_id}:{連番}`の冪等keyで記録する。画像生成callは`operation=image_generation`・単価null（画像は単価表を持たない）で記録する。

### 4.7 `drafts.thread`

```json
[
  {
    "local_id": "p1",
    "text": "投稿本文",
    "weighted_length": 120,
    "sources": ["https://example.com"],
    "warnings": []
  }
]
```

`initial_thread`も同じschemaを使う。生成確定時に`thread`と同値で保存し、以後は不変とする。比較文字列は投稿順の`text`を取り出し、Unicode NFC、改行コードLF、各ポスト前後の空白除去、連続空白の1文字化を行って`\n---\n`で連結する。URL、絵文字、ハッシュタグは除外しない。投稿時の最終`thread`とのUnicode code point単位Levenshtein距離を、長い方のcode point数で割った値が10%以下なら「ほぼ修正なし」と数える。

`warnings`はポスト単位の警告コード配列（生成後検証, プロンプト設計書 §7.2〜7.7）。コードは`length_exceeded`（PT-FIXで最大2回短縮してもなお加重280超過＝編集必須）／`cashtag_multiple`（cashtag2件以上）／`ng_word`（L-7 NGワード検出）／`source_missing`（出典必須パターンで通過出典なし）／`injection_suspected`（指示への言及・検証済み出典に無い不自然なURL）。これらの警告を持つポストを含む下書きは自動投稿を阻害し手動確認へ切り替える（要件06 §4.3）。`sources`はSSRF検証（要件05 §12）を通過した出典だけをコードで付加する（通常は最終ポスト）。

### 4.8 `drafts.images`

```json
[
  {
    "local_id": "img1",
    "post_local_id": "p1",
    "storage_path": "user/x-account/draft/image.webp",
    "provider": "openai",
    "mime_type": "image/webp",
    "size_bytes": 123456,
    "status": "ready"
  }
]
```

署名URLは表示時に生成し、DBへ永続化しない。

### 4.9 `drafts.tweet_metrics`

```json
{
  "1234567890": {
    "checkpoints": {
      "1": {
        "impressions": 2800,
        "likes": 52,
        "reposts": 8,
        "profile_clicks": 20,
        "collected_at": "2026-07-13T21:00:00Z"
      },
      "7": {
        "impressions": 4200,
        "likes": 85,
        "reposts": 12,
        "profile_clicks": 34,
        "collected_at": "2026-07-19T21:00:00Z"
      }
    },
    "latest_checkpoint_days": 7,
    "unavailable_at": null
  }
}
```

checkpoint keyは`1`/`7`/`30`だけを許可する。取得できない値は`null`とし、`0`と区別する。同じcheckpointの再取得は値と`collected_at`を上書きし、異なるcheckpointを削除しない。

### 4.10 `generation_jobs.error` / `drafts.last_post_error`

```json
{
  "code": "provider_error",
  "message": "ユーザー表示用メッセージ",
  "retryable": true,
  "stage": "posting",
  "failed_post_index": 1,
  "remaining_tweet_ids": [],
  "deleted_tweet_ids": [],
  "ambiguous_create_indices": [],
  "ambiguous_delete_tweet_ids": [],
  "provider_request_id": null
}
```

`code`は原因が特定できた場合のエラーコード（`invalid_output`、`x_token_invalid`等）。特定できない失敗にはworkerが汎用の`job_failed`を入れる（要件04 §4）。

### 4.11 `improvement_suggestions.evidence`

2026-08-15（T-M8-91）に刷新。`format: 2`で新旧を区別する（`format`が無い行は旧形式＝軸ベース。表示は縮退し、次回の実行で置き換わる）。

```json
{
  "format": 2,
  "good_posts": [{ "id": "tweet_id_1", "why": "表示回数が3,200と最多だった" }],
  "advice": {
    "pattern": { "recommended": "p3", "reason": "手順を数字で示すノウハウ形式が伸びている" },
    "theme": { "recommended": "ai", "reason": "AIツール紹介の題材が反応を得ている" },
    "image": { "recommended": true, "reason": "画像付きの表示回数が上回った" },
    "prompt": { "kind": "p3", "content": "# タスク\n…（そのまま貼れる生成プロンプト全文・最大8,000字）" }
  },
  "window_days": 30,
  "post_count": 12
}
```

`format`・`window_days`（=30）・`post_count`（分析対象のタイムライン投稿数）はコード側で付与する。`good_posts`と`advice`はPT-SUGGEST出力（プロンプト設計書 §6.15）をzod検証して保存する。`content`カラムには良かった投稿の特徴（summary）が入る。

## 5. RLS方針

| 対象 | select | insert/update/delete |
|---|---|---|
| `profiles` | `id = auth.uid()` | Server only |
| `user_api_keys` | 本人。ciphertextはAPIで返さない | Server Actionのみ |
| `x_accounts` | `user_id = auth.uid()` | Server only |
| `base_md_versions` | x_account所有者 | Server only |
| `prompt_templates` | system defaultまたはx_account所有者 | md/premiumのServer Actionのみ |
| `learning_sources` | x_account所有者 | Server only |
| `news_items` | 認証済み全員 | service roleのみ |
| `generation_jobs` | x_account所有者 | Server only |
| `drafts` | x_account所有者 | Server only |
| `schedule_slots` | x_account所有者 | Server Actionのみ |
| `follower_snapshots` | x_account所有者 | service roleのみ |
| `improvement_suggestions` | x_account所有者 | Server only |
| `usage_events` | `user_id = auth.uid()` | service roleのみ。post_create/post_delete consumeは全プランで通常/URL付き種別も記録し、他eventはpremium |
| `usage_counters` | `user_id = auth.uid()` | service roleのみ |
| `notifications` | `user_id = auth.uid()` | Server only |
| `stripe_events` | 不可 | service roleのみ |
| `external_api_usage_events` | 不可 | service roleのみ |
| `cron_runs` | 不可 | service roleのみ |

暗号化envelope（`x_accounts`のtoken類、`user_api_keys.credentials_ciphertext`）は行単位RLSにより本人のselect結果へ含まれ得る。復号鍵（`APP_ENCRYPTION_KEY`）はServer onlyであり平文はブラウザへ返さないため、ciphertextの露出は受容済みリスクとする（カラム分離・カラム単位GRANTはMVPでは行わない）。

## 6. 初期データ / seed

| データ | 内容 |
|---|---|
| システム既定プロンプト | system defaultとして`p1`〜`p6`、`image`を1件ずつ作成 |
| プラン定義 | コード定数で価格、Xアカウント上限、利用枠を定義。Stripe Price IDは環境変数 |
| 通知設定 | アプリ内は全種別ON。メールはニュースの時間単位ダイジェスト、下書き、エラー、課金、利用枠をON |
| テーマ選択肢マスタ | L-5の6選択肢をコード定数で定義。各選択肢は`news_category`の6分野と1対1対応（§4.4） |
| ニュースカテゴリ | `ai`, `web3`, `investment`, `business`, `business_ops`, `sns`をコード定数化 |
| Storage | private bucket `generated-images`を**migrationで作成**（`20260801000003`）。ユーザー/x_account単位でpathを分離。`config.toml` の定義は**ローカルの `supabase start` 専用**でリモートには効かないため、migrationに入れて全環境で自動的に揃うようにする（T-M7-45。2026-08-01、stagingでbucketが存在せず画像保存だけが失敗する状態を実測） |

## 7. 保持と個別対応

- MVPではアカウント削除用の画面、Server Action、API、DB一括削除functionを実装しない。
- 契約解約はStripe Customer Portal、X連携解除は`disconnectXAccount`で扱い、どちらもExos AIのアカウントや投稿履歴を自動削除しない。
- 法令上必要な開示、訂正、利用停止、消去等の請求は問い合わせ窓口で受け付け、本人確認と法務確認のうえ運営が個別対応する。この手続きはMVPのproduct機能・通常jobとして定義しない。
- 自動cleanup対象と保持期間は[システム構成 §9](./01_system_architecture.md#9-バックアップ保持)を正とする。Stripeが保持する決済記録はStripe側の方針に従う。
