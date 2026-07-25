# リファクタリング計画（REFACTOR_PLAN）

- 生成元: `/refactor` 監査（10領域並列, 2026-07-25）。候補 70件（うち振る舞い保存＆低リスク 62件, エラー0）。
- 方針: **外部の振る舞い・DB/API契約・画面仕様・プロンプト出力を変えない**。1単位=1コミット（WIP=1）、各単位で `typecheck→lint→test`（必要に応じ build）を通す。
- ステータス: `todo` / `doing` / `done` / `blocked`。上ほど高優先（価値×低リスク）。

## 実行順（優先度順）

| ID | 単位 | 種別 | 規模 | リスク | 状態 |
|---|---|---|---|---|---|
| R1 | `pool.ts` に `import "server-only"` を付与（Clientバンドル混入の静的防止） | boundary | S | low | done |
| R2 | デッドコード削除（未使用export/型）: `planForStripePriceId` / `StripeWebhookEventType` / `pool.claimForUpdateSkipLocked` / `oauth-server.openState`・`openTokenCiphertext`。※`SubscriptionAccess.action`・`canBrowseApp`はR6で対応 | deadcode | S | low | done |
| R3 | **`pooledQueryable()` / `runInPooledTx()` を `lib/db/pool.ts` に集約**し約30ファイルの `const pooledDb: Queryable = {...} as unknown as ...` と `runInTx` を置換。あわせて `Queryable` 型を `x/token-refresh.ts` → `lib/db/queryable.ts` へ移設し re-export（境界是正）。31ファイル修正 | duplication/boundary | L | low | done |
| R4 | Stripe/ライブラリの重複集約: **HTTP応答基盤 `apiJson`/`apiError`/`statusForErrorCode` を `lib/http/api-response.ts` へ抽出**（checkout.ts/portal.ts の重複解消）＋ `idOf`/`expandedId` 統合。※route内 `selectProfile`/billing-return cookieラッパは次パス（R4b）へ | duplication | M | low | done |
| R5 | ブラウザ決済フロー共通化: `checkout-browser`/`portal-browser` の URL検証＋fetch→json→navigate 骨格を `billing-redirect.ts`（`startBillingRedirect`/`httpsUrlFromResponse`）へ集約。2ファイルは薄いラッパに | duplication | M | low | done |
| R6 | 認証共通化: `captchaTokenSchema`/`emailSchema` 抽出（signin/signup/recovery/resend, `form-schemas.ts`）＋ `hasErrorCode()` 集約（isCaptchaFailure/isEmailUnconfirmed） | duplication | S | low | done |
| R6b | `getAppEncryptionKey()` を `lib/crypto` に追加し `resolveKey(env.APP_ENCRYPTION_KEY)` の重複（confirm route/actions/billing-return-server）を集約 | duplication | S | low | done |
| R6c | `canBrowseApp(status)` 述語（route-guard/actions の `viewScope!=='app'` 重複を集約）＋ 未使用 `SubscriptionAccess.action`/`canBrowseApp` フィールド削除（R2繰越・テスト更新） | duplication/deadcode | S | low | done |
| R7 | 認証フォームUI共通化: `authInputClassName` 共有定数化（4フォーム）＋ `FieldError` を `components/auth/field-error.tsx` へ切り出し、login/reset系のインラインerror<p>を置換 | duplication | M | low | done |
| R8 | `yen()`（`lib/format.ts`）＋ JST当月式 `CURRENT_MONTH_JST_SQL`（`lib/usage/current-month.ts`, 重複6箇所）を集約 | duplication | M | low | done |
| R8b | 投稿パターンlabel p1〜p6 を `lib/post/pattern-labels.ts`（`POST_PATTERN_LABELS`）に集約（badge4ファイル＋prompt-editorはspread再利用。schedule-managerのoptions由来は別） | duplication | M | low | done |
| R8c | `formatJst()`（ja-JP/Asia/Tokyo・short+short 日時フォーマッタ）を `lib/format.ts` に集約。完全一致の8ファイル（confirmation-queue/history-list/base-md-editor/learning-sources-manager/news-browser/analytics-view/drafts-list/notification-bell）のローカル整形を置換。null分岐（`"-"`/`""`/`"—"`）は呼び出し側維持。※オプションの異なる settings/page（long）・api-key-settings（medium/tz無）・follower-chart（月日）・usage-summary（long）は対象外。X設定パス定数は下記「除外」参照 | duplication | M | low | done |
| R9a | 型の狭め①（DB_ENUMS由来ユニオン）: `ExternalApiUsageInput.provider` を `string`→`ApiProvider`（`api_provider` 由来）／`XAuthType` を `DB_ENUMS.x_auth_type` 由来へ導出（ドリフト防止・生成結果は同一）。ついでに api-usage-ledger の `Queryable` import を R3正本パス `./queryable` へ是正 | types | S | low | done |
| R9b | 型の狭め②（`ProviderCall`↔`providerCallSchema` 単一化）: 手書き interface（normalize.ts）を廃し、`providerCallSchema` を正本に `export type ProviderCall = z.infer<...>`（usage-schema.ts）へ。normalize.ts は type-only re-export で後方互換。`Citation`/`Provider` と schema の enum は構造同一のため型不変・runtime不変 | types/duplication | S | low | done |
| R9c | 型の狭め③（x_account status/auth_type union化）: account-actions.ts の `status: string`→`XAccountStatus`（`x_account_status` 由来）、`authType/auth_type: string`→`XAuthType`（read行generics・`XAccountListItem`・`OwnedAccount`・返り値）。server wrapper と action DTO（`accountStatus?: string`）は app境界のため string 維持。Queryable import も `../db/queryable` へ是正。consumer は read/比較のみで型のみ変更・runtime不変 | types | M | low | done |
| R9d | 型の狭め④（非null断定 `!` の全除去）: クロージャで narrowing が失われる 6ファイル（create-post-form/analytics/drafts/news-browser/notification-bell/api-key-settings）の postfix `!` を const退避・`?.` で除去。全て振る舞い保存。`readAt` センチネルは下記「除外」参照。src全体で postfix `!` = 0 を確認 | types | S | low | done |
| R10a | 複雑度の分割①: `subscription-sync.applyPreparedStripeEvent` から支払失敗通知INSERTを `notifyInvoicePaymentFailed` helper へ抽出（~120行→本体を短縮）。SQL・params・ガード等価で振る舞い保存 | complexity | S | low | done |
| R10b | 複雑度の分割②: `update-session` の route-guard 用 profiles 取得を `loadRouteGuardProfile` helper へ抽出（getUser・/appパスガード・maybeSingle・null既定すべて等価）。`updateSupabaseSession` 本体を短縮 | complexity | S | low | done |
| R10c | 複雑度の分割③: `jobs/terminal.finalizeFailedJob` の kind別通知文言を `FAILED_NOTICE` テーブル＋`DEFAULT_FAILED_NOTICE` に集約。switch は返還額・付随処理（finalizeImageStale/PostPublishStale/MdMergeStale・learning_sources更新）のみ担い、通知は switch 後段で一括（`image_generation` は早期returnで通知無しを維持、post_publish の link は関数解決）。順序・文言・dedupe 等価で振る舞い保存。terminal/stale テスト17件緑 | complexity | M | low〜med | done |
| R11a | AI/プロンプト重複集約①（`textModelFor`）: post/image の各 server 配線に重複していた `textModelFor(provider)`（env text model 引き）を削除。`resolveTextProvider` が既に返す `resolved.model` を使用（BYOK/operator とも `config.textModels[provider]`=env値、未設定は resolveTextKey が throw のため常に一致＝冗長）。`Provider` import も除去 | duplication | S | low | done |
| R11b | AI/プロンプト重複集約②（引用dedup）: 3アダプタ（anthropic/openai/gemini）で同一だった URL キー重複排除ロジックを `createCitationCollector`（`ai/citations.ts`）へ集約。各 `extract*Citations` は `add`/`values` を使用。anthropic 継続ループの引用マージは last-wins 挙動維持のため据え置き。アダプタ19テスト緑 | duplication | S | low | done |
| R11c | AI/プロンプト重複集約③（テンプレート解決）: `resolvePromptTemplate`／`getPromptTemplateView` に重複していた「system default→コード定数」末尾を `systemTemplateContent` に集約。上書きクエリは各関数の必要列（content only / content+updated_at）を維持しホットパスに updated_at/toIso を持ち込まない（当初の統合案はホットパスに toIso を混入させテスト失敗→末尾のみ共通化に修正）。Queryable import も `../db/queryable` へ是正 | duplication | S | low | done |
| R11d | AI/プロンプト重複集約④（画像encode metadata）: `image-normalize.ts` の `encode()` が圧縮ループ（最大16回）で毎回 `sharp(bytes).metadata()` を呼び直していたのを、`normalizeForX` 冒頭の `inspectImage` で既知の width を渡して回避。pre-rotation width 由来で等価・振る舞い保存。`resolveByokKey` は実在せず対象外 | perf | S | low | done |
| R12a | ジョブ重複集約①（`defaultRecordStage`）: 6 handler（post-publish/learning-analysis/image-generation/suggestion/post-generation/md-merge）に重複していた `deps.recordStage ?? (async (s)=>heartbeat(jobId,s))` を `stale.ts` の `defaultRecordStage(jobId)`＋`RecordStage` 型に集約。heartbeat import は defaultRecordStage import へ置換。振る舞い保存 | duplication | S | low | done |
| R12b | ジョブ重複集約②（`STALE_ERROR`）: terminal.ts と stale.ts に重複していた `stale_timeout` の code/長文message を `terminal.ts` の `STALE_TIMEOUT_CODE`/`STALE_TIMEOUT_MESSAGE` に一本化。各 error オブジェクトは shape（2/4フィールド）を維持しつつ定数を参照。振る舞い保存 | duplication | S | low | done |
| R12c | ジョブ重複集約③（testability）: `stale.terminalHandler` グローバル可変＋`setStaleTerminalHandler` を廃し `recoverStaleJobs(opts?)` の引数注入へ（既定 finalizeFailedJob）。呼び出し元は cron.ts（引数なし）＋stale.db.test（注入spy）。テストは注入形へ更新 | testability | S | low | todo |
| R12d | ジョブ重複集約④: 毎時cron受付枠（auth→hour window claim→run）の共通化。ただしレスポンスJSON形が route毎に差異（news-fetch=result spread／follower-snapshot=result nest 等）＝外部契約のため、auth＋claim部のみ共通化しレスポンス生成は各routeに残す方針で要検討 | duplication | M | low〜med | todo |
| R13 | UIコンポーネント重複集約: `XAccountRequiredNotice`／focus-ring ユーティリティ定数／`page-state` の scaffold共通化（a11y維持）／`app-navigation` 状態クラス一元化／タブナビ | duplication | M | low〜med | todo |
| R14 | テスト容易性: SMTPエラー分類 `classifySmtpError` を純粋モジュールへ抽出しユニットテスト追加 | testability | S | low | todo |

## 要決定 / 除外（振る舞い変更のため今回の対象外）

- **成功アラートの緑色ドリフト**（emerald-900/800/700）や **resend-confirmation-form の transition 欠落**の統一は「見た目の変更＝振る舞い変更」。リファクタではなく別途 dev-loop で扱う（暫定: 現状維持）。
- **R9 の env 型（`ALWAYS_REQUIRED` を非optional化して `as string` を全廃）** は型変更が広範に波及するため中リスク。今回は「検証後に必須項目を非nullで返す型付きアクセサ」に留め、schema自体の非optional化は要決定として保留（暫定案: アクセサ方式）。
- **`readAt` センチネル `"read"`（notification-bell）** の是正（R9d で当初予定）は見送り。表示はローカル楽観更新の真偽値（既読ドットの有無）でしか使われず、`"read"` は「サーバ確定前のローカル目印」として機能している。型は `string | null`（ISO時刻）だが、偽のISO時刻（例 `new Date().toISOString()`）へ置換すると「本物の既読時刻」に見えてかえって誤解を招く。値は表示・送信されず上書きされるため、現状維持が安全（振る舞い保存の観点でも据え置きが妥当）。
- **X設定パス定数 `/app/settings?tab=api-keys` の一元化**（R8c で当初予定）は見送り。値が安定（滅多に変わらない）で価値が低い一方、13+箇所に散在し token-refresh の SQL文字列リテラルや execution-prereqs の Record 値・app-banners/route/actions 等の別領域に跨るため、集約すると分散した import を各領域に張ることになり費用対効果が低い。振る舞い保存は可能だが低価値・高分散のため今回対象外（現状維持）。

## 進め方メモ

- R1・R2（quick win）→ R3（最大の重複解消）を先頭に。R3は広範だが機械的なので領域ごとに検証しながら進める。
- 各単位: テストが薄ければ特性テストを先に追加 → 実装 → `typecheck/lint/test`(+build) → `/doc-sync` → `refactor(<scope>): …` でコミット。
