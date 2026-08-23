# 要件詳細 02: データモデル

| 項目 | 内容 |
|---|---|
| バージョン | v1.59 |
| 更新日 | 2026-08-23 |
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
| `plan_type` | `standard`, `premium`, `expert`（T-M8-168で入れ替え。旧md→standard・旧standard→NULL） |
| `subscription_status` | `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `paused`, `canceled`, `unpaid` |
| `api_provider` | `x`, `anthropic`, `openai`, `google` |
| `api_key_status` | `valid`, `invalid`, `unchecked` |
| `x_auth_type` | `byok`, `managed` |
| `x_account_status` | `active`, `expired`, `disabled`, `error` |
| `learning_source_type` | `ref_account`, `ref_post`, `own_posts` |
| `learning_source_status` | `pending`, `analyzed`, `failed`, `removing`, `removed` |
| `news_category` | `ai`, `web3`, `investment`, `business`, `business_ops`, `sns`, `love`, `beauty`（運用は6分野＝ai/web3/sns/investment/love/beauty。business系はT-M8-189で運用終了・既存データ用に残置） |
| `impact_level` | `high`, `mid`, `low` |
| `job_kind` | `post_generation`, `image_generation`, `post_publish`, `learning_analysis`, `md_merge`, `suggestion` |
| `job_trigger` | `manual`, `news`, `schedule`, `system` |
| `job_status` | `queued`, `running`, `succeeded`, `failed`, `canceled` |
| `progress_stage` | `validating`, `research`, `writing`, `image`, `posting`, `merging` |
| `draft_status` | `draft`, `posting`, `posted`, `discarded`, `failed` |
| `posted_mode` | `auto`, `manual` |
| `schedule_mode` | `draft`, `auto` |
| `usage_counter_type` | `post_normal`, `post_url`, `generation`, `image`, `ai_credit`（T-M8-109。generation/imageは旧イベント行の互換で残置） |
| `usage_event_reason` | `reserve`, `refund`, `consume` |
| `usage_event_operation` | `generation`, `image_generation`, `post_create`, `post_delete` |
| `notification_type` | `news`, `draft_created`, `posted`, `error`, `billing`, `usage`, `summary` |

## 3. テーブル定義

### 3.1 `profiles`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK, FK `auth.users.id` | ユーザーID |
| `email` | `text` | not null | メールアドレス |
| `plan` | `plan_type` | **nullable・defaultなし**（T-M8-168） | 現在プラン。**未契約は NULL**（checkout完了時にsubscription-syncが設定） |
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
| `x_premium` | `boolean` | not null default `false` | X Premium加入（`/users/me` の `verified_type` = blue/business。users/meを呼ぶたびに更新・T-M8-219） |
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
| `base_md` | `text` | not null default `''` | 現行アカウント.md |
| `base_md_version` | `integer` | not null default 0 | 未生成は0 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`user_id`, `x_user_id`), `base_md_version >= 0`。`automation_consent_version`と`automation_consented_at`は同時にnullまたは同時に非null。

Indexes: (`user_id`, `status`)

RLS: 本人select可。writeはServer Actionのみ。

`active_x_account_id`は同じprofileが所有するx_accountだけを設定できるよう、Server ActionとDB triggerで検証する。

プラン変更のSubscription同期では、profileと同じtransaction内でXアカウントの利用可否を更新する。BYOK（standard／md）→premiumは`auth_type=byok`、premium→BYOKは`auth_type=managed`を`expired`にする。新planがstandardの場合は、互換性のないauth typeを先に失効した後、現在の`active_x_account_id`がなおactiveならその1件、そうでなければ`created_at, id`順で最古のactive 1件を維持し、他のactiveを`disabled`にする。維持候補がなければ`active_x_account_id=null`とする。

この同期は`status`／`active_x_account_id`だけを変更し、access／refresh token、OAuth scope、自動投稿同意、`settings`、`base_md`、`base_md_versions`、`learning_sources`、下書き、tweet ID、実績、利用台帳を削除・null化しない。premium→BYOKでは`ai_purpose_config.text|image`を`user_api_keys.status=valid`の登録済みproviderと照合し、textはanthropic／openai／google、imageはopenai／googleのvalidキーだけを維持して、その他を`null`へ戻す（providerが外れたら`text_model`／`image_model`も外す・T-M8-107）。`credentials_ciphertext`自体は保持する。

自動投稿への有効な同意は、`automation_consent_version`が現行説明versionと一致し、`automation_consented_at is not null`かつ`automation_disabled_at is null`の場合に限る。OAuth scopeの付与はこの同意の代わりにしない。opt-outでは同じtransactionで`automation_disabled_at`を設定し、対象Xアカウントの`mode=auto`スロットをすべて無効化する。

### 3.4 `base_md_versions`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK, not null | 対象 |
| `version` | `integer` | not null | 1始まり |
| `content` | `text` | not null | アカウント.md全文 |
| `change_source` | `text` | not null | `settings`（アカウント設定フォーム。初版作成を含む）/`learning`/`manual`/`rollback` |
| `summary` | `text` | null | 変更要約 |
| `created_at` | `timestamptz` | not null default now() |  |

Constraints: unique(`x_account_id`, `version`), `version > 0`

**保持は1 x_accountあたり最新5版まで**（T-M8-156・運営者の指示 2026-08-20）。版はアカウント.md**全文**を持ち、`md_merge`が学習のたびに自動で積むため、上限が無いと利用者の操作なしにストレージが増え続ける（原則4「費用が見える」）。刈り込みは`pruneBaseMdVersions`（`src/lib/base-md-history.ts`）で、**版を積んだのと同じtransaction内**で行う（別ジョブに寄せると忘れたら効かない手順になる・原則3）。適用対象は`settings`／`learning`／`manual`／`rollback`の全経路。**この上限はロールバック可能な範囲でもある**——6版以上前へは戻せない（要件05）。

RLS: x_account所有者select可。writeはServer Actionのみ。

### 3.5 `prompt_templates`

**画像プロンプト（`kind='image'`）専用の表**（T-M8-129 U2）。投稿の型プロンプトは §3.21 `post_patterns.prompt` が正本になった——利用者が型を追加できるようになると固定の`kind`では表せないため。`kind` の CHECK は `p1`〜`p6` も受けられる形のまま残っているが、**行は作られない**（enum `post_pattern` は U5 で撤去した）。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | FK nullable | nullはシステム既定 |
| `kind` | `text` | not null | 実際に使うのは `image` のみ（`p1`〜`p6`は§3.21へ移行済み） |
| `content` | `text` | not null | プロンプト本文 |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: `kind in ('p1','p2','p3','p4','p5','p6','image')`

Unique indexes: (`x_account_id`, `kind`) where `x_account_id is not null`; (`kind`) where `x_account_id is null`

RLS: system defaultは認証ユーザーselect可。account別は所有者select可。writeはmd/premium向けServer Actionのみ。

**system default行はコード定数（`SYSTEM_DEFAULT_TEMPLATES.image`）の写しで、`scheduler_tick`が毎回差分同期する**（T-M7-37）。解決順は「account上書き → system default行 → コード定数」なので、DB行が古いままだとコード側でプロンプトを直しても反映されない。人が思い出して実行する手順にしない（CLAUDE.md 原則3）。内容が同じときは更新しないため`updated_at`は動かない（編集画面の楽観lockに影響しない）。

型プロンプトは同じ問題を**行を作らないこと**で避ける。`post_patterns.prompt` が `null`＝システム既定で、コード定数を直接使う（§3.21）。

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
| `category` | `news_category` | not null | 分野（運用6: AI/Web3/SNS運用/投資/恋愛/美容。T-M8-189） |
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
| `pattern_id` | `uuid` | FK (`x_account_id`,`pattern_id`)→`post_patterns` nullable | 使ったパターン。パターンが削除されるとnullになる（履歴は`pattern_spec`で残る） |
| `pattern_spec` | `jsonb` | nullable | **enqueue時点のパターン設定のsnapshot**（名前・プロンプト・上限ポスト数・Web検索方針など）。実行中にパターンを編集・削除されても走り切れるようにするため凍結する。**`kind='post_generation'`では必須**（CHECK・`not valid`で追加したため過去の行は対象外）。生成の振る舞い（プロンプト・ポスト数上限・Web検索回数・出典の必須・ニュースダイジェストの有無）はすべてこのsnapshotから決まる |
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
| `pattern_id` | `uuid` | FK (`x_account_id`,`pattern_id`)→`post_patterns` nullable | 生成に使ったパターン。**削除されるとnullになる** |
| `pattern_name` | `text` | not null | **生成時のパターン名のsnapshot**。パターンを削除しても履歴の画面に内部ID（`p1`）ではなく名前が出るようにする |
| `max_posts` | `smallint` | not null | 生成時のポスト数上限のsnapshot。生成本文の件数はこの値で収める（後からパターンを編集しても過去の下書きの判定が変わらない） |
| `max_posts_edit` | `smallint` | not null | **編集で許すポスト数上限**のsnapshot。生成上限より広い（生成された分に少し足して整えられるように）。既に上限を超えている過去の下書きは、その件数まで許す（編集できない下書きを作らない） |
| `requires_quote_url` | `boolean` | not null default false | 生成時に引用URLを必須としたか（P-5相当）。`quote_url`の必須判定に使う |
| `thread` | `jsonb` | not null | 全体上限1〜8ポスト（画面のスレッド数0〜7に対応・T-M8-130）。書き込み時はpattern別最大数も検証 |
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
| `scheduled_at` | `timestamptz` | null | 投稿予約日時（UTC保存・画面はJST）。**`status=draft` のときだけ意味を持ち、`not null` が予約済みを表す**（T-M8-157） |
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
| `pattern_id` | `uuid` | FK (`x_account_id`,`pattern_id`)→`post_patterns` nullable | 使うパターン。**パターンを削除すると`null`になり、同時に`enabled=false`へ落ちる**（曜日・時刻・テーマ・追加指示はそのまま残るので、パターンを選び直すだけで再開できる） |
| `weekdays` | `integer[]` | not null | 0=日〜6=土 |
| `time_jst` | `time` | not null | 9:00〜22:00、00/30分 |
| `mode` | `schedule_mode` | not null | 下書き/自動投稿 |
| `theme` | `text` | **not null**, CHECK（テーマ選択肢マスタの8値〔運用6＋旧2・T-M8-189〕＋`other`） | **テーマ**。**保存できる語彙**は`src/lib/post/post-theme.ts`の`POST_THEME_IDS`（§4.4の8値＋`other`）のまま——旧テーマの既存枠を壊さない。**画面で選べる選択肢**は運用中テーマ＋`other`（`SELECTABLE_POST_THEME_OPTIONS`・T-M8-100。編集中の運用外テーマは「（現在の設定）」として残す）。`other`＝「追加指示に記載」でプロンプトへテーマを出さない。**「指定なし」＝NULLは許さない**（既定のまま押されると選んだつもりで選んでいない状態になる） |
| `instructions` | `text` | null | 追加指示 |
| `image_enabled` | `boolean` | not null default false |  |
| `source_url` | `text` | null, CHECK（`^https://`。投稿作成のzodと同条件） | **参考URL**（T-M8-135）。毎回このURLをAIが読んで題材にする。投稿作成画面の「参考にするURL」と同じもの |
| `placeholder_values` | `jsonb` | not null default `'{}'`, CHECK（`schedule_slots_placeholder_values_ok()`。名前→文字列のオブジェクト・各2,000字以内） | **パターンの`{名前}`へ差し込む値**（T-M8-135）。予約は繰り返すので、ここで入れた値が毎回同じように入る。**そのパターンに無い項目の値は保存時に捨てる**（画面に出ない値が残ると説明できなくなる） |
| `prompt_override` | `text` | null, CHECK（8,000字以内） | **この枠だけに使う生成プロンプト**（T-M8-135）。`null`ならパターンの本文を使う。同じパターンを少しだけ変えて別の枠に使うためのもの |
| `enabled` | `boolean` | not null default true |  |
| `created_at` | `timestamptz` | not null default now() |  |
| `updated_at` | `timestamptz` | not null default now() |  |

Constraints: patternは`p5`不可、曜日は0〜6で1件以上、時刻は09:00〜22:00かつ00/30分。**`enabled`ならば`pattern_id`は必須**（型が無いのに動いている枠を作らない）。**引用URLを必須とするパターン（`requires_quote_url`）は予約に使えない**——毎回URLの指定が要るため自動実行できない（旧`p5`不可の意図をパターン属性へ移した）。画像providerはスロットに持たず、実行時に`profiles.ai_purpose_config.image`から解決する（要件05 §5）。**`source_url`・`placeholder_values`・`prompt_override`・`instructions`は実行時に生成jobの`input`へ投稿作成画面と同じキー名で渡す**（`schedule-enqueue.ts`。キー名がずれると「予約では効かない」という画面から説明できない差になる）。

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

提案は表示専用。承認・却下の状態やアカウント.mdへの自動反映情報は持たず、画面には最新のSUGGEST job実行分を表示する。ユーザーは提案を読んでアカウント設定・アカウント.md編集（md/premium）で自ら反映する。

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
| `delta` | `integer` | not null | 消費/返還クレジット数（±1〜±100000・T-M8-109。AIクレジットは円建て見積もり/実費） |
| `reason` | `usage_event_reason` | not null |  |
| `idempotency_key` | `text` | not null unique | 二重処理防止 |
| `ref_event_id` | `uuid` | self FK nullable | refund元reserve |
| `created_at` | `timestamptz` | not null default now() |  |

Constraints: month形式、deltaは±1〜±100000かつ0でない（migration `20260816000001`）、reserve/consumeは正、refundは負、refundは`ref_event_id`必須かつ元eventと同じcounter/month/operation。**精算（settle・T-M8-109）**は`job:{id}:{type}:settle`キーの追加イベントで表す——実費>見積もりはconsume（正）、実費<見積もりはrefund（負）、いずれも元reserveを`ref_event_id`で指す。`post_create`と`post_delete`はcounter_typeが`post_normal`または`post_url`かつreason=`consume`。同じtweet_idの`post_delete`は対応する`post_create`と同じcounter_typeを使う。

Indexes: (`user_id`, `month`), `job_id`, `draft_id`, `tweet_id`

RLS: 本人select可。writeはServer only。

### 3.14 `usage_counters`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `user_id` | `uuid` | FK profiles, not null | 対象 |
| `month` | `text` | not null | JST `YYYY-MM` |
| `normal_posts_count` | `integer` | not null default 0 | URLなし通常投稿枠 |
| `url_posts_count` | `integer` | not null default 0 | URL付き投稿枠 |
| `ai_credits_used` | `integer` | not null default 0 | **AIクレジット**使用量（T-M8-109。1クレジット=1円相当・文章/画像のAI実行が実費消費。旧`generations_count`/`images_count`は回数制のため移行せず削除） |
| `updated_at` | `timestamptz` | not null default now() |  |

PK: (`user_id`, `month`)

Constraints: month形式、各countは0以上。X投稿のDB上限は**最大プラン（expert）の月次枠**（`normal_posts_count <= 1000`、`url_posts_count <= 100`。migration `20260822000003`・T-M8-196。プラン別の上限実施はアプリ側ゲートが正で、制約は破損防止の下限——200/20のままだとexpertの投稿がX公開後にcheck違反で壊れた）。`ai_credits_used`のDB上限は置かない（精算の追加消費は上限1000を超えても計上する——既に発生した実費は拒否できない・T-M8-109。上限判定はreserve時にアプリ側が行う）。

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
| `read_at` | `timestamptz` | null | 既読 |
| `created_at` | `timestamptz` | not null default now() |  |

**メール配送台帳の列（`email_status`ほか7列）と `email_delivery_status` enum はT-M8-222で削除**（メール通知の廃止・migration `20260823000002`）。

Unique index: (`user_id`, `dedupe_key`) where `dedupe_key is not null`

Indexes: (`user_id`, `read_at`, `created_at desc`)〔未読件数用〕, (`user_id`, `created_at desc`, `id desc`)〔一覧の並び順。無いと1ページ目のたびにその利用者の全通知を読む・T-M8-253〕

RLS: 本人select可。writeはServer Action/API only。 保持は`created_at`から40日で、`scheduler_tick`のcleanupが1起動500件まで削除する（**type を問わない**・T-M8-246。**既読を先に消し未読は後**——読む前に消えると「来たはずの知らせが無い」になる）。以前は`type='news'`だけを消しており、毎日1通作られる`summary`が永久に積もっていた。

ニュースダイジェストの`payload`は次の形式とする。`news_item_ids`はユーザーの`news_config`に一致した新着だけを優先度順で**固定20件**まで保存し（旧`max_items`はT-M8-187で廃止）、本文には先頭5件を掲載する。保存上限を超える場合も`total_count`には全件数を入れる。

```json
{
  "window_started_at": "2026-07-19T00:00:00Z",
  "window_ended_at": "2026-07-19T01:00:00Z",
  "total_count": 7,
  "news_item_ids": ["uuid-1", "uuid-2"]
}
```

決済失敗通知は`dedupe_key=billing:invoice:{invoice_id}:payment_failed`でinvoiceごとに1件とし、`link=/app/settings?tab=billing`を保存する。`notification_config.billing.in_app`がOFFならrowを作らない（メール通知はT-M8-222で廃止）。作成時の`in_app`は`in_app_enabled`へ反映し、監査可能なsnapshotもpayloadへ保存する。

```json
{
  "attempt_count": 2,
  "invoice_id": "in_...",
  "subscription_id": "sub_...",
  "subscription_status": "past_due",
  "notification_config_snapshot": {
    "in_app": true
  }
}
```

X再連携通知は、token refreshが**token endpointの4xx**（`invalid_grant`・`invalid_request`。Xは失効・ローテート済みrefresh tokenに`invalid_request`を返すことがある——2026-08-15に実アカウントで確認・T-M8-96）・必要scope不足・refresh token不在で`x_accounts.status`を`active`→`expired`へ遷移させたときに`type=error`で1件作成し、`link=/app/settings?tab=api-keys`と`payload={x_account_id, reason}`を保存する。`notification_config.error.in_app`がOFFならrowを作らない（`in_app`は`in_app_enabled`へ反映。メール通知はT-M8-222で廃止）。`dedupe_key`は付けない（遷移は1エピソードにつき1度だけ通知作成が走るため重複せず、再連携後の再失効でも新規に作成できる）。

### 3.16 `stripe_events`

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `event_id` | `text` | PK | Stripe event id |
| `type` | `text` | not null | event type |
| `object_id` | `text` | null | subscription等の対象ID |
| `event_created_at` | `timestamptz` | not null | Stripe event.created |

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
| `quantity` | `integer` | not null default 1 | request数または返却resource数。読取の0件応答は`0`（費用$0を正直に記録） |
| `usage` | `jsonb` | not null default `{}` | token、検索回数等の秘密値を含まない内訳 |
| `unit_cost_usd` | `numeric(12,6)` | null | 実行時に採用した単価snapshot |
| `estimated_cost_usd` | `numeric(12,6)` | null | 推定原価。算出不能はnull |
| `idempotency_key` | `text` | not null unique | job callまたはX操作単位の重複防止 |
| `occurred_at` | `timestamptz` | not null default now() | 外部呼び出し時刻 |

Constraints: `operation`は上記列挙値、`status in ('succeeded','failed')`、`quantity >= 0`（Xは応答resource数課金のため、0件応答の読取は`quantity=0`・$0で記録する。以前の`> 0`では最低1件分を過大計上していた）、HTTP statusは100〜599、金額は0以上。X media uploadは件数を運用logへ残してよいが、本台帳の原価・サービス内利用枠には含めない。

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

### 3.20 `x_timeline_posts`

投稿分析（SUGGEST・毎朝8:00 JST自動実行）が読むXタイムラインの投稿の保存先（T-M8-94、要件04 §12）。取得は増分（保存済み最新投稿の48時間前から。初回は期間で区切らず最新100件・T-M8-97）で、48時間の重なり分はメトリクスを取り直して上書きする。分析は本表の全投稿（新しい順に最大300件）を対象にする。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK |  |
| `x_account_id` | `uuid` | not null FK x_accounts on delete cascade | 対象アカウント |
| `tweet_id` | `text` | not null | XのポストID。増分取得の基準と重複排除に使う |
| `text` | `text` | not null | 本文（先頭500字まで。分析には先頭200字を渡す） |
| `posted_at` | `timestamptz` | nullable | 投稿時刻 |
| `impressions` | `bigint` | nullable | 表示回数（non_public_metrics。自分の投稿のみ・直近30日のみ提供のためnull許容＝0と区別） |
| `likes` | `integer` | nullable | いいね |
| `reposts` | `integer` | nullable | リポスト |
| `replies` | `integer` | nullable | 返信 |
| `has_image` | `boolean` | not null default false | 画像等の添付の有無 |
| `has_url` | `boolean` | not null default false | 本文URLの有無 |
| `pattern_name` | `text` | nullable | 同・**パターン名**。分析結果を画面と改善提案に出すとき内部ID（`p1`）ではなく名前を使う |
| `theme` | `text` | nullable | 同・テーマID |
| `fetched_at` | `timestamptz` | not null default now() | 初回取得時刻 |
| `metrics_updated_at` | `timestamptz` | not null default now() | メトリクスを最後に更新した時刻（重なり再取得で更新） |

Constraints: `unique (x_account_id, tweet_id)`

Indexes: `(x_account_id, posted_at desc)`

RLS: 所有者はselectのみ。writeはservice roleのみ（取得・upsertはSUGGEST jobが行う）。

### 3.21 `post_patterns`

投稿の「パターン」を**Xアカウントごとのマスタ**として持つ（T-M8-129）。以前はDB enum `post_pattern`（`p1`〜`p6`）の固定6種で、名前もプロンプトもコードにあった。利用者が**自分で追加・編集・削除できる**ようにするため表へ移す（運営者の指示・2026-08-18）。**既定の6件も削除できる。**

Xアカウントを作ると既定6件が**トリガで自動投入される**（`seed_default_post_patterns()`。手順を人の記憶に依存させない・CLAUDE.md 原則3）。削除後に復元することもでき、同名の自作パターンがあるときは`（復元）`を付けて共存させる（既存を黙って上書きしない）。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `x_account_id` | `uuid` | not null FK x_accounts on delete cascade。`unique (x_account_id, id)` | 対象アカウント。複合uniqueは参照側の複合FK用（テナント越え参照をDBで塞ぐ） |
| `name` | `text` | not null、1〜30字、`unique (x_account_id, lower(name))`、改行と`<` `>`を含まない | **画面に出る唯一の名前**。内部IDは画面に出さない（要件06 §1.0）。名前は改善提案プロンプト（PT-SUGGEST）へ差し込まれるため、プロンプトを壊す文字を受け付けない |
| `description` | `text` | nullable | 補足説明。**ポスト数はここに書かせない**（`max_posts`から画面が自動で付ける） |
| `prompt` | `text` | nullable、1〜8000字 | 生成プロンプト。**`null`＝システム既定**（コード定数を使う）で、「既定に戻す」は`null`に戻すこと。既定のままにしておけばコード側のプロンプト改善が既存アカウントへ届く。自作パターンは非null必須 |
| `max_posts` | `smallint` | not null default 4、1〜8 | **生成時**に作る総ポスト数の上限。**プロンプトの「# 構成と分量とスレッド数」に書かれた `Nスレッド目` から保存時に読む**（T-M8-132）。**読み取れないときの扱いは3段**（T-M8-139）: ①既定パターンでプロンプトを既定へ戻したならその型の既定値（`GENERATION_MAX_POSTS`。P-1=4 等）②それ以外は**今の値を保つ**③新規作成だけ全体の上限（8）。**保存しただけで分量が変わってはいけない**——既定プロンプト（PT_P1〜P6）は「1ポスト目=…」という語彙で `Nスレッド目` を含まないため、以前は既定パターンを保存するたびに8へ跳ね上がり、既定表が1クリックで失われていた。黙って短い値を当てて切り詰めることもしない |
| `max_posts_edit` | `smallint` | not null default 8、`max_posts`以上8以下 | **編集で許す**ポスト数の上限。日次枠と投稿枠の見積り（最悪ケース）にも使う。既定6種は P-1=6／P-2=1／P-3=7／P-4=5／P-5=3／P-6=7（移行前の`PATTERN_MAX_POSTS`と同じ値）。自作パターンの既定は`min(8, max_posts + 2)`（`PATTERN_MAX_POSTS_LIMIT`＝8・T-M8-130で7から引き上げ） |
| `web_search_policy` | `text` | not null default `always`、`always`\|`with_url`\|`never` | Web検索を常に使う／入力にURLがあるときだけ使う／使わない。provider のツール設定に加え、`<pattern_rules>`としてプロンプトへも渡る（T-M8-131） |
| `web_search_max_uses` | `smallint` | not null default 3、0〜5。`never`と0は必ず対応する | Web検索の最大回数。再試行時は1段階ずつ縮小する（プロンプト設計書 §5.2） |
| `source_policy` | `text` | not null default `with_url`、`always`\|`with_url`\|`never` | **投稿に参考URLを付ける**か（画面の呼称は「参考URL」・T-M8-131）。必ず付ける／入力にURLがあるときだけ／付けない。`<pattern_rules>`としてプロンプトへ渡り、生成後の検証にも使う |
| `include_news_digest` | `boolean` | not null default false | ニュースダイジェストを渡すか |
| `requires_quote_url` | `boolean` | not null default false | 引用対象のX URLを毎回指定させるか。**trueは予約に使えない**（§3.10）。`include_news_digest`との同時指定は不可 |
| `placeholders` | `jsonb` | not null default `[]`、10件まで・各要素は`{name}`（1〜20字・`{`/`}`/改行/`<`/`>`不可） | **プロンプト内の `{名前}` に差し込む入力の定義**（T-M8-132）。**プロンプト保存時に本文から自動導出して更新する**（`extractPlaceholderNames`・T-M8-186。宣言と本文を食い違わせない）。画面の入力欄は保存値ではなく表示中の本文から導出する。形の検査は`post_patterns_placeholders_ok()`（CHECKにサブクエリを書けないため関数へ切り出し） |
| `sort_order` | `integer` | not null default 100 | 画面の並び順 |
| `seed_key` | `text` | nullable、`unique (x_account_id, seed_key)`、`p1`〜`p6`のいずれか | 既定として投入されたパターンの元ID。旧enumからの引き当てと「既定の復元」に使う。自作は`null` |
| `created_at` | `timestamptz` | not null default now() | |
| `updated_at` | `timestamptz` | not null default now() | |

Constraints: `seed_key is not null or prompt is not null`（システム既定でないなら自分のプロンプトを持つ）、`name`は1〜30字で改行・`<`・`>`を含まない、`prompt`は1〜8000字、`max_posts`は1〜8、`max_posts_edit`は`max_posts`以上8以下、`web_search_max_uses`は0〜5、`(web_search_policy = 'never') = (web_search_max_uses = 0)`、`not (requires_quote_url and include_news_digest)`（引用ポストにニュースダイジェストは渡さない）。

Indexes: `(x_account_id, sort_order, created_at)`、`unique (x_account_id, lower(name))`、`unique (x_account_id, seed_key)`、`unique (x_account_id, id)`（参照側の複合FK用）

RLS: 所有者はselect可（`authenticated`へ`select`をGRANT）。writeはServer Action（service role）のみ。

**削除の意味論**（論理削除を持たない理由）。`before delete`トリガ`post_patterns_detach_references()`が参照を外す。

| 参照元 | 削除時の扱い | 理由 |
|---|---|---|
| `drafts`（下書き・投稿履歴） | `pattern_id`を`null`にする。`pattern_name`は残す | 過去の投稿履歴の表示名が消えない |
| `schedule_slots`（予約枠） | `pattern_id`を`null`にし、**同時に`enabled=false`** | 型が無いのに動く枠を作らない。曜日・時刻・テーマは残すので選び直せば再開できる |
| `generation_jobs`（実行中のjob） | `pattern_id`を`null`にする。`pattern_spec`は残す | 実行中のjobは凍結したspecでそのまま完走する |

この3つを満たすので`archived_at`のような論理削除は持たない。検査は`src/lib/post/post-patterns.db.test.ts`。


### 3.22 `affiliate_accounts`

招待プログラム（T-M8-174。正本: docs/cp/invite_cp.md）の招待者アカウント。`/app/invite` を開くと自動作成される。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `user_id` | `uuid` | not null unique FK profiles on delete cascade | 招待者（1利用者1アカウント） |
| `code` | `text` | not null unique | 招待コード（URL `/r/{code}`。紛らわしい文字を避けた8桁） |
| `status` | `text` | not null default `active`、`active`\|`suspended` | 停止すると新規帰属・新規報酬が止まる |
| `created_at` | `timestamptz` | not null default now() | |

RLS: 所有者はselect可。writeはServer（service_role）のみ（以下の4表も同じ）。

### 3.23 `affiliate_attributions`

招待リンク経由の登録の帰属。**1ユーザーにつき招待者は1人・登録後変更不可**（`referred_user_id` unique＋`on conflict do nothing`）。Last Click（Cookieが最後のコードを持つ）・自己招待禁止はアプリ側で守る。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `affiliate_account_id` | `uuid` | not null FK affiliate_accounts on delete cascade | 招待者 |
| `referred_user_id` | `uuid` | not null unique FK profiles on delete cascade | 招待された利用者 |
| `attributed_at` | `timestamptz` | not null default now() | 帰属した時刻 |
| `commission_started_at` | `timestamptz` | nullable | 初回有料課金の時刻（ここから報酬期間） |
| `commission_ends_at` | `timestamptz` | nullable | 報酬期間の終了（開始＋6ヶ月。解約で前倒し） |
| `commission_terminated_reason` | `text` | nullable、`subscription_cancelled` | 入っていたら以後Commissionを作らない（**再契約でも再開しない**） |
| `created_at` | `timestamptz` | not null default now() | |
| `updated_at` | `timestamptz` | not null default now() | |

### 3.24 `affiliate_commissions`

紹介報酬。**Stripeの支払成功（invoice.paid）がSource of Truth**。実際に支払われた金額×作成時点のランク率（snapshot）。Trial中（0円）は作らない。Refund（charge.refunded）で`reversed`。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `affiliate_account_id` | `uuid` | not null FK affiliate_accounts on delete cascade | |
| `referred_user_id` | `uuid` | not null | |
| `stripe_invoice_id` | `text` | not null unique | リトライwebhookの冪等キー |
| `eligible_amount` | `integer` | not null、>=0 | 報酬の対象額（JPY）。返金があれば `original_amount - 累計返金額` へ下がる |
| `original_amount` | `integer` | not null、>=0 | **返金前の対象売上**（`invoice.amount_paid`）。Stripeの`charge.refunded`が持つ`amount_refunded`は**その請求の累計**なので、返金は毎回この額から引き直す（減額済みの額から引くと二重に差し引かれる・T-M8-236） |
| `commission_rate_bps` | `integer` | not null、0〜10000 | 作成時点の率のsnapshot |
| `commission_amount` | `integer` | not null、>=0 | 報酬額（切り捨て） |
| `status` | `text` | not null default `pending`、`pending`\|`payable`\|`paid`\|`reversed`\|`held` | 確認期間（30日）経過で`payable`（tickが昇格）。振込完了で`paid` |
| `available_at` | `timestamptz` | not null | `payable`になれる時刻（支払＋30日） |
| `payout_id` | `uuid` | nullable FK affiliate_payouts on delete set null | 月次バッチが束ねたPayout |
| `created_at` | `timestamptz` | not null default now() | |

Indexes: (`available_at`) where `status = 'pending'`〔確認期間を過ぎた報酬を日次で払出可能へ上げる処理が全表走査になっていた・T-M8-253〕, (`referred_user_id`)

`referred_user_id` は `profiles(id) on delete set null`（T-M8-253）。**外部キーが無く、報酬率の計算（累計有料招待ユーザー数）が実在しない利用者を数えうる**状態だった。履歴（金額・支払記録）は残したいので削除ではなくnull化する。

### 3.25 `affiliate_payout_accounts`

報酬の振込先口座。**口座番号はAES-256-GCM暗号文のみ**（要決定D-33。Payout Provider未契約のため。画面は末尾4桁だけ・全桁は運営者の `npm run affiliate:payouts -- --show` が復号）。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `affiliate_account_id` | `uuid` | not null unique FK affiliate_accounts on delete cascade | 1招待者1口座 |
| `provider` | `text` | not null default `internal` | 将来Payout Providerへ移行するときの区分 |
| `external_account_id` | `text` | nullable | Provider側のID（internalでは未使用） |
| `bank_name` | `text` | not null | |
| `branch_name` | `text` | not null | |
| `account_type` | `text` | not null default `ordinary`、`ordinary`\|`checking` | 普通/当座 |
| `account_number_ciphertext` | `text` | not null | 口座番号（暗号文。平文カラムは作らない） |
| `bank_account_last4` | `text` | not null、4文字 | 画面表示用 |
| `account_holder_name` | `text` | not null | 口座名義 |
| `status` | `text` | not null default `active`、`active`\|`disabled` | |
| `created_at` | `timestamptz` | not null default now() | |
| `updated_at` | `timestamptz` | not null default now() | |

### 3.26 `affiliate_payouts`

月次の振込（月末締め・翌月末支払・invite_cp.md §9〜§14）。**Commissionと手数料は会計分離**（gross/fee/netを別に保存し、Commission自体は減額しない）。¥5,000未満・口座未登録は作らず翌月へ繰越。

| カラム | 型 | 制約/既定値 | 説明 |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `affiliate_account_id` | `uuid` | not null FK affiliate_accounts on delete cascade。`unique (affiliate_account_id, period_start)` | 複合uniqueで月次バッチの再実行を冪等に |
| `period_start` | `date` | not null | 締め期間（前月・JST）の開始 |
| `period_end` | `date` | not null | 同・終了 |
| `gross_amount` | `integer` | not null、>=0 | 束ねた報酬の合計 |
| `fee_amount` | `integer` | not null、>=0 | 振込手数料（980円・利用者負担） |
| `net_amount` | `integer` | not null、>=0 | 実際の振込額 |
| `status` | `text` | not null default `created`、`created`\|`paid`\|`canceled` | 運営者が振込後に `npm run affiliate:payouts -- --paid` で`paid`へ |
| `payment_due_at` | `timestamptz` | not null | 支払期限（翌月末・JST） |
| `paid_at` | `timestamptz` | nullable | |
| `external_reference` | `text` | nullable | 振込の控え番号など |
| `created_at` | `timestamptz` | not null default now() | |
| `updated_at` | `timestamptz` | not null default now() | |


## 4. JSONスキーマ

### 4.1 `profiles.ai_purpose_config`

```json
{
  "text": "anthropic",
  "text_model": "claude-fable-5",
  "image": null,
  "image_model": null
}
```

`text`は文章生成とリサーチ（Web検索）の両方に使う単一provider。リサーチは同providerの内蔵Web検索機能で実行し、別providerを割り当てない。BYOKでは登録済みかつ`valid`のproviderのみ指定できる。premiumの`text`は運営文章provider（既定Claude／`anthropic`）で固定し、ユーザー設定はread-only表示とする。`image`は運営側で利用可能なOpenAI/Geminiから選択できる。

`text_model`／`image_model`は選択モデル（T-M8-107・「AIモデル設定」タブ）。**選択肢の正本は`src/lib/ai/model-catalog.ts`**（各provider 代表5モデル程度・最上位を含む。IDと単価は公式docsで確認して更新する）。保存時にカタログ照合し、null・カタログ外・providerと不一致は**env既定モデルへフォールバック**（未知IDを実APIへ送らない）。providerを外すと対応するモデルも`null`へ戻す。premiumは`text`固定のままモデルだけ選べる（**運営キーの実費がモデルで変わる**。推定原価はモデル別単価`MODEL_RATES`が台帳へ反映する・原則4）。

ライフサイクル: BYOKではAIキーの保存・疎通成功時に`text`が未設定なら当該providerを自動設定し（画像対応providerの`image`も同様）、`deleteApiKey`は該当用途の設定を解除する。premiumの`text`はDBへ保存せず、ユーザー指定に依存しない運営文章provider（未設定時`anthropic`）へ実行時に解決する（`updateAiPurposeConfig`はpremiumの`text`変更を拒否）。premium→BYOKのプラン変更同期時は`text`/`image`を登録済み`valid`キーで再検証し、無効なら未設定へ戻して初期設定ガイドへ誘導する。

### 4.2 `profiles.news_config`

```json
{
  "categories": ["ai", "web3", "sns", "investment", "love", "beauty"],
  "impact_filter": ["high", "mid"]
}
```

`categories`と`impact_filter`は重複なしで各1件以上とする。既定は**取得している分野**（`NEWS_FETCH_CATEGORIES`＝運用6分野・T-M7-55の原則／T-M8-189で6分野へ。migration `20260822000001`で新規登録の既定も6分野へ変更済み。既存利用者の保存値は`20260822000002`が**旧既定値そのままの行だけ**新既定へ更新する——意図的に絞った設定は保全。放置すると新分野の通知が既存ユーザーに永久に届かない・T-M8-192）。**通知（時間単位ダイジェスト）の対象条件にのみ使う**——一覧（SC-06）は最新500件表示（T-M8-188）。旧`max_items`（表示件数）は廃止し、保存値はmigration `20260821000002`で取り除いた（schemaは旧キーを黙って落とす）。

### 4.3 `profiles.notification_config`

```json
{
  "news": { "in_app": true },
  "draft_created": { "in_app": true },
  "posted": { "in_app": true },
  "error": { "in_app": true },
  "billing": { "in_app": true },
  "usage": { "in_app": true },
  "summary": { "in_app": true }
}
```

決済停止と利用枠100%到達の常設バナーはこの設定にかかわらず表示する。

**チャネルはアプリ内のみ・既定は全種別ON**（T-M8-222・運営者の指示 2026-08-22でメール通知を廃止。認証メールと運営者向けopsアラートは別系統で残る）。この既定はコード（`DEFAULT_NOTIFICATION_CONFIG`）とprofile作成trigger（migration `20260823000002`）の両方に持つため、変更時は両方を揃える（片方だけだと新規利用者にだけ届かない）。既存利用者の保存値は同migrationが旧`email`キーを剥がすだけで、`in_app`の値は変えない（schemaも旧キーを黙って落とす）。

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

`themes.primary`/`secondary`はコード定数のテーマ選択肢マスタのIDから選ぶ。語彙は運用6テーマ（`ai=AI`、`web3=Web3`、`sns=SNS運用`、`investment=投資`、`love=恋愛`、`beauty=美容`）＋旧2テーマ（`business=ビジネス`、`business_ops=業務改善`。T-M8-189で運用終了、保存済みデータの表示・検証用に残置）で、`news_category`と1対1対応しP-6の`<news_digest>`該当判定に使う。`primary`は1件以上必須とし、両配列を通じた重複と未知IDを拒否する。**画面の選択肢は運用6テーマ**（旧テーマは選択中のときだけ表示し、開いただけで値が消えないようにする）。`free_text`は自由入力で、該当判定の対象外とする。

`tone.sentence_style`は`polite|assertive`、`emoji_policy`は`none|limited`とする。絵文字を使わない場合は`emoji_max_per_post=0`を必須とし、絵文字・ハッシュタグの上限は0以上の整数とする。初期値は要件06 §3.4を正とする。`ng`の3配列は空を許可するが、要素を持つ場合は空文字を拒否する。NGワード原文はコード照合用としてsettingsだけに保持し、アカウント.mdへ展開しない。

### 4.5 `generation_jobs.input`

```json
{
  "pattern_id": "uuid",
  "theme": "ai",
  "source_url": "https://example.com",
  "quote_url": null,
  "placeholder_values": { "名前": "値" },
  "instructions": null,
  "image_enabled": true,
  "news_item_id": "uuid",
  "prompt_override": null
}
```

キーの正本は`createGenerationJobSchema`（`src/lib/jobs/generation-jobs.ts`）。**パターンは内部ID（`p1`等）では受けず`post_patterns.id`で受ける**（T-M8-129 U5）、毎回の入力は`placeholder_values`（キーは項目名・T-M8-132）、分野`theme`は必須（T-M8-29）。対象draft/sourceは専用FK列へ保存し、`input`へ重複保存しない。使用するfieldは`job_kind`ごとにzod discriminated unionで制約する。

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
    "account_md": { "content": "アカウント.md改訂案の全文（## 1.〜## 6.構造を維持・5,000字以内）", "reason": "何をなぜ変えたか" },
    "pattern": { "recommended": "p3", "reason": "手順を数字で示すノウハウ形式が伸びている" },
    "theme": { "recommended": "ai", "reason": "AIツール紹介の題材が反応を得ている" },
    "image": { "recommended": true, "reason": "画像付きの表示回数が上回った" },
    "prompt": { "kind": "p3", "content": "# タスク\n…（そのまま貼れる生成プロンプト全文・最大8,000字）" }
  },
  "post_count": 12,
  "analyze_limit": 300,
  "previous_id": "参照した直前のレポートのid（初回はnull）"
}
```

`format`・`post_count`（分析対象の投稿数）・`analyze_limit`（分析上限のsnapshot）・`previous_id`（参照した直前のレポート。提案の連続性を後から辿れる・T-M8-98）はコード側で付与する。`good_posts`と`advice`はPT-SUGGEST出力（プロンプト設計書 §6.15）をzod検証して保存する。`advice.account_md`はアカウント.md未作成のアカウント・旧レポートではnull（T-M8-106）。`content`カラムには良かった投稿の特徴（summary）が入る。

## 5. RLS方針

**各テーブルのRLSは §3.1〜3.21 の各節末に書く**（そこが正本。構造の実物は `rls.db.test.ts` が検査する）。
ここへ一覧を写さない——以前あった表は後から足した3表（`news_fetch_outcomes`・`x_timeline_posts`・`post_patterns`）が
抜けたままで、「増えるだけで誰も見ない一覧」になっていた。

暗号化envelope（`x_accounts`のtoken類、`user_api_keys.credentials_ciphertext`）は行単位RLSにより本人のselect結果へ含まれ得る。復号鍵（`APP_ENCRYPTION_KEY`）はServer onlyであり平文はブラウザへ返さないため、ciphertextの露出は受容済みリスクとする（カラム分離・カラム単位GRANTはMVPでは行わない）。

## 6. 初期データ / seed

| データ | 内容 |
|---|---|
| システム既定プロンプト（画像） | `prompt_templates` に system default として `image` を1件作成（§3.5） |
| 投稿パターン | Xアカウント作成時に既定6件を**トリガで自動投入**（§3.21）。プロンプトは`null`＝コード定数を使うので行に本文を持たない |
| プラン定義 | コード定数で価格、Xアカウント上限、利用枠を定義。Stripe Price IDは環境変数 |
| 通知設定・ニュースカテゴリ | 既定値の正本は §4.3 / §4.4（ここへ写さない——以前写した通知設定は `summary` が抜けていた） |
| テーマ選択肢マスタ | L-5の選択肢をコード定数で定義（運用6＋旧2）。各選択肢は`news_category`と1対1対応（§4.4）。**画面で選べるテーマ（投稿作成・スケジュール）と投稿分析の推奨テーマは、運用中のニュース分野（`NEWS_FETCH_CATEGORIES`）に対応する`OPERATED_THEME_OPTIONS`＋「その他」に限定**（T-M8-100/188。最新ニュース画面のソート選択肢と同じ導出元で、運用分野を変えれば全画面が追随する） |
| Storage | private bucket `generated-images`を**migrationで作成**（`20260801000003`）。ユーザー/x_account単位でpathを分離。`config.toml` の定義は**ローカルの `supabase start` 専用**でリモートには効かないため、migrationに入れて全環境で自動的に揃うようにする（T-M7-45。2026-08-01、stagingでbucketが存在せず画像保存だけが失敗する状態を実測） |

## 7. 保持と個別対応

- MVPではアカウント削除用の画面、Server Action、API、DB一括削除functionを実装しない。
- 契約解約はStripe Customer Portal、X連携解除は`disconnectXAccount`で扱い、どちらもExos AIのアカウントや投稿履歴を自動削除しない。
- 法令上必要な開示、訂正、利用停止、消去等の請求は問い合わせ窓口で受け付け、本人確認と法務確認のうえ運営が個別対応する。この手続きはMVPのproduct機能・通常jobとして定義しない。
- 自動cleanup対象と保持期間は[システム構成 §9](./01_system_architecture.md#9-バックアップ保持)を正とする。Stripeが保持する決済記録はStripe側の方針に従う。

## 変更履歴

| version | 日付 | 変更内容 |
|---|---|---|
| v1.42 | 2026-08-18 | 投稿パターンを利用者定義マスタへ（T-M8-129〜132・ADR-0008）。`post_patterns` 新設、旧 `post_pattern` enum と関連列の撤去、`placeholders` 追加 |
| v1.43 | 2026-08-18 | 予約枠に生成入力を追加（T-M8-135）: `source_url`・`placeholder_values`・`prompt_override` |
| v1.42 | 2026-08-18 | `max_posts` の読み取り不能時の扱いを3段（既定値へ戻す／今の値を保つ／新規は上限）へ明記（T-M8-139） |
| v1.43 | 2026-08-18 | 使われていない `asks_user_opinion` を撤去（T-M8-145。T-M8-132 でプレースホルダーへ一般化した時点で読まれなくなっていた） |
| v1.44 | 2026-08-20 | `base_md_versions`の保持を1アカウント最新5版までに制限（T-M8-156） |
| v1.45 | 2026-08-20 | `generation_jobs.input`の例を実キー（pattern_id/theme/placeholder_values）へ、自作パターンのmax_posts_edit既定をmin(8,…)へ修正（T-M8-144 #23/#54） |
| v1.46 | 2026-08-20 | §5 RLS表と§6 seedの写しを各節への参照へ（T-M8-166） |
| v1.47 | 2026-08-20 | プラン再編（T-M8-168）: plan_type enumを standard/premium/expert へ入れ替え、profiles.plan を nullable（未契約=NULL）へ |
| v1.48 | 2026-08-21 | 招待プログラムの5表（affiliate_accounts/attributions/commissions/payout_accounts/payouts）を追加（T-M8-174） |
| v1.49 | 2026-08-21 | post_patterns.placeholdersをプロンプト保存時に本文から導出する旨を追記（T-M8-186） |
| v1.50 | 2026-08-21 | news_configからmax_itemsを廃止（T-M8-187・migration 20260821000002。ダイジェストpayload上限は固定20へ） |
| v1.51 | 2026-08-22 | news_categoryへlove/beautyを追加し運用6分野へ。テーマ語彙は運用6＋旧2。既定news_configを6分野へ（T-M8-189・migration 20260822000001） |
| v1.52 | 2026-08-22 | 既存news_configのbackfill（旧既定値のみ・20260822000002）とschedule_slots語彙の記述修正（T-M8-192・レビュー指摘） |
| v1.53 | 2026-08-22 | usage_countersのcheck上限をexpert枠（1000/100）へ拡張（T-M8-196・20260822000003） |
| v1.54 | 2026-08-22 | 通知既定をメール3種へ（T-M8-206・migration 20260822000004） |
| v1.55 | 2026-08-23 | schedule_slots に paused_by_stop_all_at を追加（「すべて停止/再開」・T-M8-233） |
| v1.56 | 2026-08-23 | affiliate_commissions に original_amount を追加（部分返金の二重差引を修正・T-M8-236） |
| v1.57 | 2026-08-23 | notifications の保持期間を type 全体へ広げた（T-M8-246） |
| v1.58 | 2026-08-23 | schedule_slots.paused_by_stop_all_at を削除（「すべて停止/再開」は全枠が対象になったため・T-M8-251） |
| v1.59 | 2026-08-23 | 通知・招待報酬の索引と referred_user_id の外部キーを追加。PostgRESTの権限を最小化（T-M8-252/253） |
