# リファクタリング計画（REFACTOR_PLAN）

- 生成元: `/refactor` 監査（10領域並列, 2026-07-25）。候補 70件（うち振る舞い保存＆低リスク 62件, エラー0）。
- 方針: **外部の振る舞い・DB/API契約・画面仕様・プロンプト出力を変えない**。1単位=1コミット（WIP=1）、各単位で `typecheck→lint→test`（必要に応じ build）を通す。
- ステータス: `todo` / `doing` / `done` / `blocked`。上ほど高優先（価値×低リスク）。

## 現況（2026-07-25 時点）

R1〜R18・R4b・R15・R17 と R13d（app-navigation 状態クラス）まで完了（全緑維持・振る舞い保存）。
**価値×低リスクの候補は尽きた**ため、計画上の実行可能項目は完了。R13d の残り（タブ解決ヘルパー／muted空状態
カードのバリアント集約／セグメント／amberカード）は低価値 or 中リスク（UIクラスのドリフトは検証ゲートで捕捉
できず、着手時は純関数 `*ClassName`＋クラス集合テストで担保が必要）のため見送り（末尾「除外/見送り」参照）。

## 実行順（優先度順）

| ID | 単位 | 種別 | 規模 | リスク | 状態 |
|---|---|---|---|---|---|
| R1 | `pool.ts` に `import "server-only"` を付与（Clientバンドル混入の静的防止） | boundary | S | low | done |
| R2 | デッドコード削除（未使用export/型）: `planForStripePriceId` / `StripeWebhookEventType` / `pool.claimForUpdateSkipLocked` / `oauth-server.openState`・`openTokenCiphertext`。※`SubscriptionAccess.action`・`canBrowseApp`はR6で対応 | deadcode | S | low | done |
| R3 | **`pooledQueryable()` / `runInPooledTx()` を `lib/db/pool.ts` に集約**し約30ファイルの `const pooledDb: Queryable = {...} as unknown as ...` と `runInTx` を置換。あわせて `Queryable` 型を `x/token-refresh.ts` → `lib/db/queryable.ts` へ移設し re-export（境界是正）。31ファイル修正 | duplication/boundary | L | low | done |
| R4 | Stripe/ライブラリの重複集約: **HTTP応答基盤 `apiJson`/`apiError`/`statusForErrorCode` を `lib/http/api-response.ts` へ抽出**（checkout.ts/portal.ts の重複解消）＋ `idOf`/`expandedId` 統合。※route内 `selectProfile`/billing-return cookieラッパは次パス（R4b）へ | duplication | M | low | done |
| R4b | Stripe route の billing-return cookie ラッパ集約: checkout/portal route に重複していた「userId捕捉つき getCurrentUser ラッパ＋応答ok時の set-cookie append」を `billing-return-server.ts` の `captureBillingUser()`＋`appendBillingReturnCookie()` へ集約。認証・cookie 発行の一貫性を1箇所に（新billing route の付与漏れ防止）。getCurrentUser は構造的代入で型維持、cookie/挙動不変。stripe/billing 32テスト＋build 緑。※getProfile コア（SELECT列が checkout/portal で異なる）は低価値のため見送り | duplication | S | low | done |
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
| R12c | ジョブ重複集約③（testability）: `stale.terminalHandler` グローバル可変＋`setStaleTerminalHandler` を廃し `recoverStaleJobs(opts?: {limit?, terminalHandler?})` の引数注入へ（既定 finalizeFailedJob）。`limit` も positional→options 化（positional呼び出し元なし）。cron.ts は引数なしのまま、stale.db.test は spy を注入する形へ更新（afterEach リセット不要に）。振る舞い保存 | testability | S | low | done |
| R12d | ジョブ重複集約④（cron受付枠）: 4 cron route 共通の「CRON_SECRET認証→windowKey算出→window claim→JSON応答」を `handleCronRoute`（`jobs/cron-route.ts`）へ集約。認証を1箇所に集約し新route の認証書き忘れ事故を防ぐ。windowKey種別（hour/5min）・本処理・応答JSON形（spread/nest）は route毎に注入し外部契約を厳密維持。`now` は helper で単一生成し work へ渡す（news-fetch の clock/digest整合）。route-auth 4テスト緑・build緑・振る舞い保存 | duplication | M | low〜med | done |
| R13a | UIコンポーネント重複集約①（`XAccountRequiredNotice`）: posts/schedule ページに同一マークアップで重複していたX未連携アラート（amber枠＋「設定へ」導線）を `components/x-account-required-notice.tsx` へ抽出。理由文のみ `description` prop 化しクラス/role/href/文言は同一維持（レンダリング等価）。schedule の未使用 `Link` import も除去 | duplication | S | low | done |
| R13b | UIコンポーネント重複集約②（`EmptyNotice`）: 4ファイル（x-accounts-settings/schedule-manager/history-list/drafts-list）で文字通り同一だった破線カード空状態 `<div class="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">{msg}</div>` を `page-state.tsx` の軽量 `EmptyNotice({children})` に集約（重量版 `EmptyState` と対）。role無し維持・レンダリング等価。test+build緑 | duplication | S | low | done |
| R13c | UIコンポーネント重複集約③（`TabNav`）: URL駆動タブナビ（settings/posts/ai-settings）を共有 `TabNav`（`app-shell/tab-nav.tsx`）へ集約。クラス計算を純関数 `tabNavClassName`/`tabLinkClassName` に抽出し、**クラス集合の等価を `tab-nav.test.ts` で検証**（UIクラスdrift は typecheck/lint/build で捕捉不可のため必須）。ai-settings の追加クラス（gap-1/overflow/shrink-0/focus-ring/hover）は className/linkClassName/inactiveLinkClassName で吸収し twMerge が gap 競合を後勝ち解決。見た目等価・未使用 Link import 除去。test 1127+build 緑 | duplication | M | low〜med | done |
| R13d | UIコンポーネント重複集約④（一部）: app-navigation の active/inactive 状態クラス（mobile/desktop で同一だった2×2文字列）をループ内 `stateClass` const に単一化（連結結果はバイト同一・表示不変）。**残りは見送り**（下記「除外/見送り」参照） | duplication | S | low | done |
| R14 | テスト容易性（`classifySmtpError`）: server-only の `notification-email-server.ts` に閉じていた SMTPエラー分類を純粋モジュール `lib/email/smtp-error.ts`（SmtpError型・AUTH/NETWORK定数含む）へ抽出し、契約テスト7件追加（auth終端/network・server再送/unknown、認証優先、summaryにcode/responseCodeのみ）。server側は import に置換し未使用 `ErrorKind`/`EmailSendError` import も除去。ロジック不変・振る舞い保存。test 1134緑 | testability | S | low | done |
| R15 | Server Action 共通化（`requireUserId`/`BaseResult`）: 各 action に同一実装で重複していた `requireUserId()`（9ファイル）と `BaseResult` 型（10ファイル）を `app/actions/_helpers.ts` に集約。exact-block置換スクリプト（識別子regexではなく完全一致・R3の教訓）＋import入替、getCurrentUser は requireUserId 専用だった9ファイルで import 除去、suggestions は getCurrentUser 継続のため型import追加。※analytics は `BaseResult` が `details` を持たない狭い版（意図的）で共有版に寄せると型が広がるため据え置き。typecheck/lint/test1134/build 緑・振る舞い保存 | duplication | M | low〜med | done |
| R16 | `toIso`/`toIsoOrNull`（Date→ISO）集約: 非null版3ファイル（learning-sources/notifications/prompt-templates）＋nullable版1ファイル（news-items）のローカル定義を `lib/format.ts` の `toIso`/`toIsoOrNull` に一本化。news-items は呼び出しを `toIsoOrNull` へ改名。出力等価・振る舞い保存。※base-md には toIso 無し（sweep指摘は誤り）。test 1134緑 | duplication | S | low | done |
| R17 | Server Action の `{ ...toUserFacingError(x), status: "error" }` 定型を `_helpers.errorResult()` に集約: 15ファイル91箇所（`(error)`形＋`(new AppError("CODE"))`形の完全一致2種で置換・ネスト曖昧性なし）。返り型は `UserFacingError & { status:"error" }`（code:ErrorCode 維持で狭い返り型の呼び出し先にも適合）。api-keys の既存ローカル errorResult は共有へ統合、未使用化した toUserFacingError import を11ファイルで除去。※検証で判明した2問題（スクリプトによる api-keys 自己再帰化・返り型 widening）は typecheck が捕捉し修正。typecheck/lint/test1134/build 緑・返り値不変 | duplication | M | low〜med | done |
| R18 | quick win: 未使用 export `statusForErrorCode`（`http/api-response.ts`）のデッドコード削除（実地確認: 定義のみ・`apiError` は `HTTP_STATUS_FOR_ERROR` を直接参照）／`analytics.defaultCheckpoint` の `aggregatable(draft)`（ループ不変・純粋）をループ外 `const rows` へ巻き上げ（3回→1回・結果不変）。test 1134緑 | deadcode/perf | S | low | done |

## 要決定 / 除外（振る舞い変更のため今回の対象外）

- **成功アラートの緑色ドリフト**（emerald-900/800/700）や **resend-confirmation-form の transition 欠落**の統一は「見た目の変更＝振る舞い変更」。リファクタではなく別途 dev-loop で扱う（暫定: 現状維持）。
- **R9 の env 型（`ALWAYS_REQUIRED` を非optional化して `as string` を全廃）** は型変更が広範に波及するため中リスク。今回は「検証後に必須項目を非nullで返す型付きアクセサ」に留め、schema自体の非optional化は要決定として保留（暫定案: アクセサ方式）。
- **R13d の残り（タブ解決ヘルパー／muted空状態カード②③④／analytics日数セグメント／ai-purpose amberカード）** は見送り。(1) タブ解決は3画面で fallback 値・`?? default`・`as Tab` cast・items形状が微妙に異なり、共通化しても各1行削減で低価値。(2) muted空状態カード②③④は radius/bg/py/要素が異なる3バリアント×各2箇所で、variant化は複雑化（監査でも「低価値・中リスク」評価）＋UIクラスのドリフトを検証ゲートが捕捉できない。(3) セグメント/amberカードも同様に低価値。いずれも「価値×低リスク」の閾値に届かないため現状維持。着手する場合は TabNav 同様に純関数 `*ClassName` ＋クラス集合テストで守ること。
- **`readAt` センチネル `"read"`（notification-bell）** の是正（R9d で当初予定）は見送り。表示はローカル楽観更新の真偽値（既読ドットの有無）でしか使われず、`"read"` は「サーバ確定前のローカル目印」として機能している。型は `string | null`（ISO時刻）だが、偽のISO時刻（例 `new Date().toISOString()`）へ置換すると「本物の既読時刻」に見えてかえって誤解を招く。値は表示・送信されず上書きされるため、現状維持が安全（振る舞い保存の観点でも据え置きが妥当）。
- **X設定パス定数 `/app/settings?tab=api-keys` の一元化**（R8c で当初予定）は見送り。値が安定（滅多に変わらない）で価値が低い一方、13+箇所に散在し token-refresh の SQL文字列リテラルや execution-prereqs の Record 値・app-banners/route/actions 等の別領域に跨るため、集約すると分散した import を各領域に張ることになり費用対効果が低い。振る舞い保存は可能だが低価値・高分散のため今回対象外（現状維持）。

## 既知の不安定テスト（リファクタ起因ではない）

- `src/lib/jobs/news-digest.db.test.ts`「fans out digests...」は matchedUsers/notified の**グローバル集計下限**を検査するため、並行DBテストの news_config 一致ユーザー状態に依存し、フルスイート実行でごく稀に `matchedUsers=0` で落ちることがある（単体では安定して緑）。テスト自身のコメントも「並行テストを含みうるので下限のみ検査」と明記。リファクタ変更とは無関係。将来 dev-loop で per-window の分離（専用ユーザー限定集計）を検討。

## 進め方メモ

- R1・R2（quick win）→ R3（最大の重複解消）を先頭に。R3は広範だが機械的なので領域ごとに検証しながら進める。
- 各単位: テストが薄ければ特性テストを先に追加 → 実装 → `typecheck/lint/test`(+build) → `/doc-sync` → `refactor(<scope>): …` でコミット。
