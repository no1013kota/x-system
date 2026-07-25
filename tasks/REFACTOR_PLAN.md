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
| R6c | `canBrowseApp(status)` 述語（route-guard/actions の `viewScope!=='app'` 重複）＋ 未使用 `SubscriptionAccess.action`/`canBrowseApp` フィールド削除（R2繰越・テスト期待値更新） | duplication/deadcode | S | low | todo |
| R7 | 認証フォームUI共通化: `inputClassName` 共有定数化（同一文字列の4フォーム）＋ `FieldError` を `components/auth` へ切り出し全フォーム再利用 | duplication | M | low | todo |
| R8 | フォーマッタ/定数の集約: `formatJst()`（ja-JP/Asia/Tokyo）＋ `yen()` 通貨＋ JST当月式 `MONTH_EXPR` ＋ 投稿パターンlabel p1〜p6（badge用の一致5箇所）＋ X設定パス定数 | duplication | M | low | todo |
| R9 | 型の狭め: `api_provider` enum化（`recordExternalApiUsage`）／`ProviderCall`↔`providerCallSchema` 単一化／x_account `status`・`auth_type` union化／`readAt` センチネル是正／非null断定の除去（notification-bell 等） | types | M | low〜med | todo |
| R10 | 複雑度の分割: `subscription-sync.applyPreparedStripeEvent`（支払失敗通知INSERT抽出）／`jobs/terminal.finalizeFailedJob`（コピーテーブル化）／`update-session` のprofiles取得抽出 | complexity | M | low | todo |
| R11 | AI/プロンプト重複集約: 引用dedup（3アダプタ＋anthropic継続ループ）／`resolveByokKey`／`textModelFor`／テンプレート三段解決／画像encodeのmetadata再取得回避 | duplication/perf | M | low〜med | todo |
| R12 | ジョブ重複集約: `defaultRecordStage`／`STALE_ERROR` 基底定数／毎時cron受付枠 `handleClaimedCronRoute`／`stale.terminalHandler` をグローバル可変→引数注入 | duplication/testability | M | low | todo |
| R13 | UIコンポーネント重複集約: `XAccountRequiredNotice`／focus-ring ユーティリティ定数／`page-state` の scaffold共通化（a11y維持）／`app-navigation` 状態クラス一元化／タブナビ | duplication | M | low〜med | todo |
| R14 | テスト容易性: SMTPエラー分類 `classifySmtpError` を純粋モジュールへ抽出しユニットテスト追加 | testability | S | low | todo |

## 要決定 / 除外（振る舞い変更のため今回の対象外）

- **成功アラートの緑色ドリフト**（emerald-900/800/700）や **resend-confirmation-form の transition 欠落**の統一は「見た目の変更＝振る舞い変更」。リファクタではなく別途 dev-loop で扱う（暫定: 現状維持）。
- **R9 の env 型（`ALWAYS_REQUIRED` を非optional化して `as string` を全廃）** は型変更が広範に波及するため中リスク。今回は「検証後に必須項目を非nullで返す型付きアクセサ」に留め、schema自体の非optional化は要決定として保留（暫定案: アクセサ方式）。

## 進め方メモ

- R1・R2（quick win）→ R3（最大の重複解消）を先頭に。R3は広範だが機械的なので領域ごとに検証しながら進める。
- 各単位: テストが薄ければ特性テストを先に追加 → 実装 → `typecheck/lint/test`(+build) → `/doc-sync` → `refactor(<scope>): …` でコミット。
