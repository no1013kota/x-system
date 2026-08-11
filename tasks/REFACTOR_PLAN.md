# リファクタリング計画（REFACTOR_PLAN）

- 生成元: `/refactor` 監査（10領域並列, 2026-07-25）＝R1〜R18／**`/refactor` 監査（7領域並列, 2026-08-11）＝R19〜R38**。
- 方針: **外部の振る舞い・DB/API契約・画面仕様・プロンプト出力を変えない**。1単位=1コミット（WIP=1）、各単位で `typecheck→lint→test`（必要に応じ build）を通す。
- ステータス: `todo` / `doing` / `done` / `blocked`。上ほど高優先（価値×低リスク）。

## 現況（2026-08-11 時点）

R1〜R18 は完了済み（全緑維持・振る舞い保存）。その集約は実際に生きており、2026-08-11 の再監査でも
`any` 0件・postfix `!` 0件・`*-server.ts` の `server-only` 38/38・未使用依存0件（`react-dom` はNext実行時に必要・
`@types/nodemailer` の置き場所のみ低価値の指摘）を確認した。

**新しい狩場は、2026-07-25 以降に積み上がった分**（M8後始末 T-M8-51〜83／法務3ページの本番版化／サービス名の
改称／LPの全面刷新）に集中している。型は「同じ判断を経路ごとに別々に書いた」重複が中心。

**このパスで最も危険なのは重複ではなく「空振りしている機械検査」**（このリポジトリは人の注意力を検査へ移す
方針を採っているため、空振りは方針そのものの穴になる）。実地に確認した2件:

- `src/lib/security/server-boundary.test.ts:22` の検出器 `/getEncryptionKey\s*\(/` は**実名 `getAppEncryptionKey`
  と一致せず repo 全体で0件**。実験: `src/lib/stripe/billing-return-server.ts` の `import "server-only";` を外しても
  **17 passed のまま**（＝AES鍵を扱う経路のClientバンドル混入を、今この検査は見ていない）。件数ガード `>= 10` も
  他2本の検出器の当たりだけで満たされるため素通りする。→ R19
- `src/app/landing-page.test.ts:129` のグラデ検査は出現数 `=== 5` の固定だが、LPの上端3pxバーと生成中バーは
  **データ配列のフラグ**（`FEATURES.gradientTop` / `HOW_STEPS.bar`）でループ描画されるため、2枚目以降にフラグを
  足しても出現数は5のまま＝画面のグラデだけ黙って増える。検査対象がファイル名の手書き列挙である点も、
  `src/components/lp/` へのファイル追加で全検査がすり抜ける。→ R35

## 実行順（優先度順）

**R19〜R38 は 2026-08-11 監査で新規追加（すべて `todo`・未承認）。** 順序の考え方は
R19（検査の空振り）→ R20〜R24（課金・通知・上限の食い違い）→ R25〜R32（運営者が読む文字列と運営コマンド）
→ R33〜R38（法務検査・画面の判定の `.ts` 化）。
着手前に読むべき詳細は下の「R19〜R38 の詳細」。判断が要るものは `tasks/BACKLOG.md` の **D-21〜D-26**。

| ID | 単位 | 種別 | 規模 | リスク | 状態 |
|---|---|---|---|---|---|
| R19 | 死んだソース検査を生かす（server-boundary の getEncryptionKey 誤regex＋検出器ごとのガード）と、テストの実行環境依存を揃える。**検出器を `getAppEncryptionKey` へ是正し、合計件数 `>=10` のガードを「検出器ごとに1件以上」へ置換**（合計だと1本死んでも他2本で閾値を満たし素通りしていた）。cwd依存5本を `import.meta.url` 基準へ、resolve-account.db.test.ts の `SKIP_DB`/`return` 抜けを `beforeEach`+`ctx.skip()` へ。**3点を実地に実証**: ①`billing-return-server.ts` が新たに検査対象へ入り（16→17ファイル）、`server-only` を外すと落ちる（修正前は17 passedのまま）②検出器名を壊すと落ちる ③DB接続不可時に `4 passed` ではなく `4 skipped` になる。cwd=`src/` からの実行でも5本緑。test 1751（+3）| testability | S | low | done |
| R20 | 3モジュールに同一実装で重複している所有権・同時実行ガード（assertActiveAccount / assertJobBudget / MAX_ACTIVE_JOBS）を共有モジュールへ集約する。`src/lib/jobs/job-guards.ts`（`Queryable` を引数で受ける純粋層・server-onlyは付けない）へ移し、3ファイルは import＋`MAX_ACTIVE_JOBS` の re-export に。**移設前後で関数本体がコメント・空白正規化後にバイト等価であることをスクリプトで確認**（3実装とも一致）。`xa.status` はどこも読んでいないが判断材料を減らさないため select に残す。`REQUIRE_DB=1` で generation-jobs / suggestion-jobs.db / learning-sources.db / tenant-isolation.db の63件緑 | duplication | M | low | done |
| R21 | job失敗通知の文言を terminal.ts の FAILED_NOTICE に一本化し、通知INSERTも共有する。`src/lib/jobs/notifications.ts` を新設し `FAILED_NOTICE`／`DEFAULT_FAILED_NOTICE`／`resolveFailedNotice()`／`createFailedNotification()` を移設。worker側3ファイル（post-generation / learning-analysis / suggestion）のSQLリテラル直書きINSERTを共有関数呼び出しへ置換（リテラル→`$4/$5/$6` パラメータ化。生成される行は同一）。**移設前に3組の title/body/link が worker経路と stale経路で完全一致であることをスクリプトで確認**。`notifications.test.ts` を新規追加し、以後のドリフトを機械で止める。`FailedNotice.link` の引数は `{ draft_id }` の構造型にして `JobTerminalRow` への依存を切った | duplication | S | low | done |
| R22 | draft_created 通知の16行SQLを3ファイルから1つの共有関数へまとめる。R21で作った `jobs/notifications.ts` へ `createDraftCreatedNotification` を追加し、post-generation / image-generation / terminal のローカル定義を削除。terminal 版だけ positional 引数だったので object 引数へ揃えた（`PoolClient` は `Queryable` を構造的に満たす）。**集約後のSQLが変更前3実装すべてと正規化後に等価であることをスクリプトで確認** | duplication | XS | low | done |
| R23 | 失敗確定の3手順（error/usage保存 → 原価台帳 → error通知）を persistJobFailure に共通化する。**先に特性テストを別コミット**（`72715af`）で追加: suggestion の error JSON は `provider_raw_error` を持たない4キーで、共通化のとき揃えると保存JSONが変わるが止めるものが無かった。`provider_raw_error: null` を一時的に足すと落ちることを確認済み。本体は `notifications.ts` の `persistJobFailure` へ集約し、`"providerRawError" in error` でキーの有無を保つ。`notifyKind` 省略時は通知を出さない（image_generation 用）。前段の後始末（learning_sources 更新等）は呼び出し側に残す。**learning-analysis で通知が二重になっていたのを検出して修正**（R21の置換分と重複） | duplication | M | low | done |
| R24 | 投稿本文の最終形・URL判定・consume冪等keyを post-publish と reconcile-posting で共有する純関数へ抽出する。`src/lib/post/posting-text.ts`（`hasUrl` / `finalPostText` / `finalTextResolver` / `counterTypeFor` / `postConsumeKey`）を新設。`suggestion-input.hasUrl` は分析軸用の別判定なので統合しない。**一括置換で `recordDeleteConsume` の引数 `withUrl` を外側の `i` 参照に壊しかけたのを差分レビューで検出して戻した**（クロージャの外の変数を掴む形になっていた）。`posting-text.test.ts` を新規追加（課金区分と冪等keyは金額に直結するため） | duplication | S | low | done |
| R25 | 最新窓のニュース結果の分類と、運営者へ見せる1行の組み立てを news-outcome.ts へ集約する。T-M8-83 は「良性の除外」の**判定**だけを寄せたが、その判定を**どう組み合わせてどのバケツへ入れるか**は doctor（ループ）とサマリ（2つのfilter）で二重のままだった。`classifyNewsOutcome()` が `failed`／`mostly_dropped`／`all_dropped`／`no_match`／`healthy` の5分類を返す形へ集約。`all_dropped`（fetched=0）と `mostly_dropped`（fetched>0）が排他であることもテストで固定。**doctorとサマリが同じ入力から同じ結論を出すことを突き合わせテストで確認**（一時テストで実測・8件追加） | duplication | S | low | done |
| R26 | R15/R17 の取りこぼしを _helpers の正本へ寄せ、drafts.ts の bucket名直書きを env へ揃える。素の `getCurrentUser` ガード**8箇所**（api-keys×4 / news / analytics / persona-settings / suggestions）を `requireUserId()` へ。`ai-purpose-config.ts` は返り型のarmが `code` 必須で `BaseResult` が入らないため計画どおり対象外（spread のみ `errorResult` 化）。素の `toUserFacingError` spread は**実測4箇所**（計画の6は過大）。`settings.ts` の zod 先頭メッセージは `toUserFacingError` が `USER_MESSAGES[code]` を返すため計算されるだけで捨てられており、出力不変のまま削除（画面へ出すかは D-26）。**テストは1行も変えずに全緑**（等価性の証拠） | duplication | S | low | done |
| R27 | 実行前提エラーの組み立て（プロフィール不在時の代替値＋AppErrorへの詰め替え）を execution-prereqs へ集約する。`resolveExecutionPrereqError(input, check?)`／`prereqErrorToAppError()`／`assertPrereqsFromInput()` を追加し、4箇所（生成job・投稿job・学習ソース・本文生成worker）を置換。**`not_found` は `ErrorCode` だが `PrereqCode` ではない**ため返り型を `ResolvedPrereqError`（`PrereqCode \| "not_found"`）として分けた。post-generation は throw せず code だけ使うので `resolveExecutionPrereqError` の戻り値だけを使う。テストが無かった「input=null」経路に特性テスト5件を追加 | duplication | S | low | done |
| R28 | premium時の枠reserveを reserveIfPremium に集約し、type→上限のマッピングを1箇所にする。`src/lib/usage/reserve-if-premium.ts`（`RESERVE_LIMIT_BY_TYPE` ＋ `reserveIfPremium`・`runInTx` を引数で受ける純粋層）を新設し5箇所を置換。**共通関数は例外を握らない**（上限到達を失敗確定へ回すか画像なしで確定するかはjobごとに違うため）。`PREMIUM_GENERATION_LIMIT`／`PREMIUM_IMAGE_LIMIT`／各 `isPremium` と未使用になった `PLANS` import を削除。対応表そのものを検査するテストを追加（取り違えは「請求はされているのに生成が止まる」形で出るのに、テストが種別ごとに別ファイルで気付けなかった） | duplication | S | low | done |
| R29 | DB↔TSの値集合ドリフト検査を強化する。(1) `pg_type` を `public` へ絞る（Supabase は auth/storage/realtime/net にも enum を持ち、実測 public 23・その他13。絞らないと同名の内部型と比べうる）(2) 魔法数 `toHaveLength(23)` を撤去し「**DBにあって `DB_ENUMS` に無い型名を列挙して落とす**」逆方向検査へ (3) `schedule_slots_theme_valid` の CHECK 定義から値を取り出し `POST_THEME_IDS` と集合比較。**両方が実際に落ちることを実証**（`DB_ENUMS` から `plan_type` を消す→逆方向検査が落ちる／`POST_THEME_IDS` に架空値→theme検査が落ちる）。※実装・enum値・CHECK値は不変。作成時に自分の正規表現 `[a-z_]+` が `web3` の数字を拾えず偽の失敗を出したのを修正 | types | S | low | done |
| R30 | USD→円のレート150の二重持ちを1つにし、呼び出し元ゼロの dbSizeLimitBytes と存在しない環境変数を指すコメントを消す | duplication | XS | low | todo |
| R31 | doctor.mjs が写している「まとめ1行」を diagnostics 側と共有し、依存ゼロのモジュールへ切り出す | duplication | S | low | todo |
| R32 | scripts の argOf / envValue / base既定値の重複を scripts/lib へ集約する | duplication | S | low | todo |
| R33 | 法務ページの検査を「ソース文字列の toContain」から PROCESSORS の値そのものへ変える（委託先9社・移転国） | testability | XS | low | todo |
| R34 | 法務同意プロフィールの列リストを1つの正本にする | duplication | S | low | todo |
| R35 | landing-page.test.ts の空振りを塞ぐ（検査対象のディレクトリ走査化＋グラデ検査をデータ配列のフラグまで見る＋古いコメントの是正） | testability | S | low | todo |
| R36 | 曜日×時刻ドットの「状態→クラス」対応表と曜日ラベルを1箇所に集約する | duplication | S | low | todo |
| R37 | 下書きの警告ラベル表と要約生成を lib へ移し、警告コードの対応漏れを機械検査できる形にする | testability | S | low | todo |
| R38 | スケジュールのセル説明文・パターン名フォールバック・曜日+時刻表記と、保存前の入力検証を lib/schedule の純関数へ切り出す | testability | S | low | todo |
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

## R19〜R38 の詳細（2026-08-11 監査）

表だけでは着手できないため、各単位の *場所 / なぜ / どうする / 完了の判定* を残す。
**どれも未承認。着手前にユーザーの承認を得る。**

### R19 死んだソース検査を生かす（server-boundary の getEncryptionKey 誤regex＋検出器ごとのガード）と、テストの実行環境依存を揃える

- **種別/規模/リスク**: testability / S / low
- **場所**: src/lib/security/server-boundary.test.ts:16,22,40 / src/lib/ops/outbound-channels.test.ts:23 / src/lib/ops/env-secret-usage.test.ts:16 / src/app/app/tabs.test.ts:20 / src/ops/launchd.test.ts:19 / src/lib/smoke/resolve-account.db.test.ts:80,90,99,108
- **なぜ**: AES鍵を扱うモジュールがClientバンドルへ混入しないことを守っているのは server-boundary.test.ts だけだが、3本の検出器のうち `const ENCRYPTION_KEY = /getEncryptionKey\s*\(/`（:22）は repo 全体で1件も当たらない（実名は R6b で導入した `getAppEncryptionKey`。部分文字列にならないので不一致）。実測すると regex を直した時点で src/lib/stripe/billing-return-server.ts が新たに検出対象へ入る（同ファイルは env 秘密を直読せず `getAppEncryptionKey()` 経由なので、他2本の検出器には映らない）。つまり今このファイルの `import "server-only";` を消しても、it.each のケースが生成されず件数ガード（>=10、実際16）も通り、全テスト緑のままになる。あわせて resolve-account.db.test.ts だけがDB未起動時に skip ではなく `return` で抜けるため「何も検査せず passed」と数えられ、誰も設定していない `SKIP_DB`（repo内でこの4行のみ）という無効化スイッチも残っている。cwd依存も T-M8-51 で8本直したのに5本取り残されている。
- **どうする**: (1) `ENCRYPTION_KEY` を `/getAppEncryptionKey\s*\(/` に直す。(2) 件数ガード（:47 の `>=10`）を「SECRET_READ / ADMIN_CLIENT / ENCRYPTION_KEY それぞれが1件以上に当たる」検査へ置き換える（env名ごとの粒度にはしない。STRIPE_WEBHOOK_SECRET は src/lib 配下で0件＝実読取が走査範囲外の src/app/api/stripe/webhook/route.ts:34 にあるため、粒度を上げると落ちる）。(3) `LIB_ROOT`（:16）と `path.relative(process.cwd(), …)`（:40）を他8本と同じ `fileURLToPath(new URL(…, import.meta.url))` 基準へ。同じ直し方を outbound-channels.test.ts:23 の `join(process.cwd(),"src")`・env-secret-usage.test.ts:16 の相対 `"scripts"`・tabs.test.ts:20 の相対 `["src","e2e","scripts"]`・launchd.test.ts:19 にも適用する（`loadEnvConfig(process.cwd(), …)` を使う9本はNextのenv読み込みなので触らない）。(4) resolve-account.db.test.ts の `it.runIf(!process.env.SKIP_DB)` と `if (!available) return;` を、他65本と同じ `beforeEach((ctx) => { if (!available) ctx.skip(); })` へ揃え SKIP_DB を消す。
- **完了の判定**: server-boundary.test.ts が 17件→18件（billing-return-server.ts が追加され緑）になる。検証として billing-return-server.ts の `import "server-only";` を一時的に外すとテストが落ちること／戻すと緑になることを1度確認する。cwd をリポジトリ直下と src の両方にして（--root をリポジトリ直下指定で）5本を実行し、どちらでも同じ件数で緑。DB停止時に resolve-account.db.test.ts の4件が passed ではなく skipped と表示される。REQUIRE_DB=1 でも従来どおり全件緑。
- **依存**: なし

### R20 3モジュールに同一実装で重複している所有権・同時実行ガード（assertActiveAccount / assertJobBudget / MAX_ACTIVE_JOBS）を共有モジュールへ集約する

- **種別/規模/リスク**: duplication / M / low
- **場所**: src/lib/jobs/generation-jobs.ts:23,86-104,134-149 / src/lib/jobs/suggestion-jobs.ts:15,33-46,99-111 / src/lib/learning-sources.ts:21,112-125,137-149
- **なぜ**: 「表示中アカウントと実行対象が一致しているか」「同時実行が上限に達していないか」という拒否の判断が3箇所に同一のSQL・同一のAppError code・同一 details.reason で書かれている（実地に3ファイルを突き合わせて一致を確認済み）。`export const MAX_ACTIVE_JOBS = 5;` も3ファイルにそれぞれある。上限を5→3にするには3ファイルを直す必要があり、1つ忘れると「生成は3件で止まるが学習は5件通る」状態を機械検査が捕捉できない。
- **どうする**: 新規 `src/lib/jobs/job-guards.ts`（`Queryable` を引数で受ける純粋層。server-only は付けない）に `MAX_ACTIVE_JOBS`・`assertActiveAccount(tx, userId, xAccountId)`・`assertJobBudget(tx, userId)` を移す。SQL文字列・パラメータ順・`AppError("not_found")` / `AppError("job_conflict", { details: { reason: "x_account_mismatch" | "too_many_active_jobs" } })` は1文字も変えない。`MAX_ACTIVE_JOBS` は3ファイルから re-export して外部からの import 名を維持する（src/lib/ops/tenant-isolation.db.test.ts:178 が learning-sources から import している）。3箇所とも select している `xa.status` はどのファイルでも読んでいないが、判断材料を減らさないため据え置く。
- **完了の判定**: src/lib/jobs/generation-jobs.test.ts:115（x_account_mismatch）・:146（too_many_active_jobs）、src/lib/jobs/suggestion-jobs.db.test.ts:98,112,142、src/lib/learning-sources.db.test.ts:186,220,313、src/lib/ops/tenant-isolation.db.test.ts:178-194 が無変更で緑。3経路それぞれに既存テストがあるため特性テストの追加は不要。`npm run release:check`。
- **依存**: なし

### R21 job失敗通知の文言を terminal.ts の FAILED_NOTICE に一本化し、通知INSERTも共有する

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/lib/jobs/terminal.ts:71-92,215-242 / src/lib/jobs/post-generation.ts:245-263 / src/lib/jobs/learning-analysis.ts:222-240 / src/lib/jobs/suggestion.ts:134-152
- **なぜ**: 同じ失敗が worker経路（各handlerのpersistFailure内のSQLリテラル）と stale経路（terminal.ts の FAILED_NOTICE）で別々に文言を持っている。実地に突き合わせて3組が完全一致であることを確認した（post_generation: 『投稿の生成に失敗しました』『時間をおいて再度お試しください。設定や入力もご確認ください。』`/app/posts`、learning_analysis と suggestion も同様、dedupe_key も両側 `job:{jobId}:failed`）。terminal.ts:26-29 のコメント自身が「worker の失敗経路との完全共通化は D-5」と未完了を認めている。片方だけ直すと、同じ失敗が経路によって違う文面で通知され、運営者にはどちらが直った版か判別できない。
- **どうする**: terminal.ts:71-92 の `createFailedNotification` は既に title/body/link を $4/$5/$6 で受ける汎用形なので、これを共有関数として export（PoolClient は Queryable を構造的に満たすので3handlerからもそのまま渡せる）。3handler の persistFailure 内のINSERTを `createFailedNotification(db, { userId, jobId, ...FAILED_NOTICE[kind] })` に置換する。発行SQL・パラメータ値は現状と同一にする。**news-digest.ts:147-158 と ops/daily-summary.ts の通知INSERTは退会競合対策の `for key share of p` を持つ別形（T-M8-19）なので巻き込まない**（それは振る舞い変更）。
- **完了の判定**: src/lib/jobs/terminal.test.ts:13 の `NOTIF_ERROR = /insert into notifications[\s\S]*?'error', \$2/`（発行SQL文字列を照合）、terminal.db.test.ts、post-generation.db.test.ts、learning-analysis.test.ts が無変更で緑。加えて「3種の title/body/link が worker経路と stale経路で同一である」ことを直接検査するテストを1本足し（FAILED_NOTICE を参照する側が1つになったことの固定）、以後のドリフトを機械で止める。
- **依存**: なし

### R22 draft_created 通知の16行SQLを3ファイルから1つの共有関数へまとめる

- **種別/規模/リスク**: duplication / XS / low
- **場所**: src/lib/jobs/post-generation.ts:266-289 / src/lib/jobs/image-generation.ts:171-194 / src/lib/jobs/terminal.ts:95-119
- **なぜ**: 3ファイルの `createDraftCreatedNotification` を機械比較したところSQLは差分ゼロで、dedupe_key も3箇所すべて `draft:${draftId}:created`。違うのは第1引数の型（Queryable と PoolClient）と引数の渡し方（object と positional）だけ。「下書きができました」の文言・リンク・通知設定の見方・on conflict の重複防止条件を直すとき、3箇所のうち1つを直し忘れると成功経路とstale経路で通知が違うという一番気付きにくい食い違いになる。
- **どうする**: `src/lib/jobs/notifications.ts`（新規・`Queryable` を受ける純粋層）へ `createDraftCreatedNotification(db, { userId, draftId })` を1つだけ置き、3箇所を置換する。SQL文字列とパラメータは変えない。terminal.ts は PoolClient をそのまま渡す（Queryable の `query` を構造的に満たす）。R21 で作る共有先と同じファイルに置いてよい。
- **完了の判定**: src/lib/jobs/post-generation.db.test.ts:175、image-generation.test.ts:233/272、terminal.test.ts:14 の `NOTIF_DRAFT = /'draft_created', \$2/`（発行SQLの文字列照合＝文面を変えずに移せたことがそのまま検査される）が無変更で緑。
- **依存**: なし（R21と同じ置き場所に置くならR21の後が読みやすい）

### R23 失敗確定の3手順（error/usage保存 → 原価台帳 → error通知）を persistJobFailure に共通化する

- **種別/規模/リスク**: duplication / M / low
- **場所**: src/lib/jobs/post-generation.ts:212-264 / src/lib/jobs/learning-analysis.ts:183-241 / src/lib/jobs/suggestion.ts:115-153（＋部分的に src/lib/jobs/image-generation.ts:197-247）
- **なぜ**: 3ファイルの persistFailure が同じ3手順を同じ順序で繰り返している。(1) `update generation_jobs set error = $2::jsonb, usage = $3::jsonb where id = $1` は post-generation.ts:224 / learning-analysis.ts:202 / suggestion.ts:120 で完全同一。(2) `recordProviderCalls(…, { keyPrefix })` は keyPrefix が `gen:` / `lrn:` / `sug:` / `img:` と違うだけで、4箇所とも直前に同じコメント「失敗確定前に発生した provider call の原価も記録する（要件02 §3.17）」が付いている。新しいjob種別を足す人が(2)を落としても全テストが緑のまま通り、AI費用が過少計上される（費用が見えることはCLAUDE.md原則4）。
- **どうする**: `persistJobFailure(db, { jobId, userId, xAccountId, keyPrefix, error: { code, message, stage, providerRawError? }, usage })` を R21/R22 と同じ共有モジュールへ置き、3手順（error/usage の update → recordProviderCalls → createFailedNotification）をこの順で実行する。**suggestion.ts:123 の error JSON は `provider_raw_error` キーを持たない**（他2つは持つ）ので、未指定時はキー自体を出さない実装にする（`provider_raw_error: null` を足すと保存JSONが変わる＝振る舞い変更）。image-generation の前段（drafts.images 更新）と learning-analysis の前段（learning_sources 更新）、image-generation の通知が draft_created である点は各呼び出し側に残す。
- **完了の判定**: 着手前に「suggestion の失敗時に保存される error JSON のキー集合」を固定する特性テストを1本足す（現状ここが薄く、キーが増えても落ちない）。その上で post-generation.db.test.ts / learning-analysis.test.ts / image-generation.db.test.ts / suggestion.db.test.ts が無変更で緑。
- **依存**: R21（createFailedNotification の共有が前提）

### R24 投稿本文の最終形・URL判定・consume冪等keyを post-publish と reconcile-posting で共有する純関数へ抽出する

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/lib/jobs/post-publish.ts:37-40,338,475-476,639 / src/lib/reconcile-posting.ts:20-21,93-94,116
- **なぜ**: 必ず一致していなければならない3点がバイト単位で二重定義されている。(1) URL判定 `const URL_RE = /https?:\/\/\S+/;`（post-publish.ts:37 と reconcile-posting.ts:20）。(2) 引用URL合成 `i === 0 && draft.quote_url ? \`${thread[i].text}\n${draft.quote_url}\` : thread[i].text`（post-publish.ts:475-476 と reconcile-posting.ts:93-94 が同一式）。(3) consume冪等key `draft:{draftId}:tweet:{tweetId}:post:create|delete`（post-publish.ts:639/:338 と reconcile-posting.ts:116）。reconcile は post-publish が付けたのと同じ枠種別・同じ冪等keyで同じ合成本文を突き合わせるため、URL判定を1文字変えると「作成時は post_normal・照合時は post_url」という課金の食い違いが起き、冪等keyの形を変えると reconcile が二重計上する。
- **どうする**: `src/lib/post/posting-text.ts`（依存なしの純粋モジュール）に `hasUrl(text)`・`finalPostText(text, quoteUrl, index)`・`postSlotIdempotencyKey(draftId, tweetId, op)` を置き、両ファイルから使う。正規表現・合成式・key文字列は1文字も変えない。**src/lib/jobs/suggestion-input.ts:79 の `hasUrl` は `/https?:\/\//`（`\S+` なし・分析軸用で課金と無関係）で別物なので統合しない**（まとめると判定が変わる）。
- **完了の判定**: src/lib/jobs/post-publish.test.ts:145「classifies a post containing a URL as post_url」・:245「quote_url を合成した結果で超過する場合も止める」、post-publish.db.test.ts:251「rollback: create+delete of the same tweet consume the same slot twice」、src/lib/reconcile-posting.test.ts が無変更で緑。抽出した3関数の直接テストを追加し「2箇所が同じ答えを出す」ことを機械検査で固定する。
- **依存**: なし

### R25 最新窓のニュース結果の分類と、運営者へ見せる1行の組み立てを news-outcome.ts へ集約する

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/lib/ops/diagnostics.ts:127-166,185,200-205 / src/lib/ops/daily-summary.ts:130,138-143,277-290
- **なぜ**: T-M8-83 が集約したのは述語（onlyOutsideWindow / mostlyDropped）だけで、**述語を組み合わせる分類と表示文は二重のまま**。doctor は describeEmptyCategories（fetched>0 → mostlyDropped 判定 / fetched=0 かつ dropped>0 → onlyOutsideWindow なら該当なし、でなければ全件破棄）で振り分け、日次サマリは同じ窓のSQL結果に対し `.filter((r) => Number(r.fetched) === 0 && !onlyOutsideWindow(...))` と `.filter((r) => mostlyDropped(...))` で別々に同じ2バケットを作っている。表示文も `${category}（${reasons}）` と `${category}（${fetched}件取得 / ${dropped}件除外${ages ? "・"+ages+"の記事" : ""}）`、`formatDropReasons(...) || \`${dropped}件\`` の3組が完全一致。T-M8-83 の事故（同じ状況を doctor は「該当なし」・通知は「全件破棄」と正反対に伝える）が再発しうる構造が残っている。
- **どうする**: `src/lib/news-outcome.ts`（依存ゼロの正本）に `classifyNewsOutcomes(outcomes)`（failed / allDropped / noMatch / mostlyDropped を返す・現在の describeEmptyCategories をそのまま移す）と、表示用 `formatAllDroppedLine` / `formatMostlyDroppedLine` / `dropReasonsOrCount(reasons, dropped)` を置く。両呼び出し側をこれに寄せる。**SQLは変えない**（daily-summary の前置フィルタ `ok and dropped > 0` は共有分類器の入力を狭めるだけで結果は等価: fetched=0/dropped=0 は allDropped にならず、mostlyDropped は dropped>fetched>0 を要求するため dropped>0 が含意される）。要素の順序を保つ（detail の並びが変わると出力が変わる）。
- **完了の判定**: 着手前に diagnostics 側へ mostlyDropped の特性テストを追加する（diagnostics.test.ts に mostlyDropped の assertion が1件も無いことを確認済み）。その上で src/lib/ops/diagnostics.test.ts:106-183、daily-summary.test.ts:109-132（`ai（title:too_big×2）`・`ai（1件取得 / 3件除外・28時間〜40時間前の記事）` を文字列で固定している）、daily-summary.db.test.ts、news-outcome.test.ts が無変更で緑。cron 1回（news-fetch）を実際に叩いて保存件数と失敗分野まで確認する。
- **依存**: なし

### R26 R15/R17 の取りこぼし（素の getCurrentUser 9箇所・素の toUserFacingError spread 6箇所）を _helpers の正本へ寄せ、あわせて drafts.ts の bucket名直書きを env へ揃える

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/app/actions/api-keys.ts:40,66,94,132 / news.ts:32 / analytics.ts:32 / persona-settings.ts:31-32,34,36-37 / suggestions.ts:30 / ai-purpose-config.ts:27-30 / settings.ts:42-48 / generation-jobs.ts:88-92 / drafts.ts:29,161,188
- **なぜ**: R15 で `requireUserId()` に集約したはずのログインガードが `const user = await getCurrentUser(); if (!user) return errorResult(new AppError("unauthorized"));` の形で9箇所に残っている（grep で実確認）。入口へ条件が足された前例（`requireExecutionUserId()` の法務同意ゲート・T-M8-73 は「呼ばれていないガードがあった」ことが原因）があるため、素の入口が残っているとそういう追加が一部Actionに効かない。R17 の `{ ...toUserFacingError(...), status: "error" }` も書き方の違う6箇所が残り、`errorResult()` に手を入れても効かない。加えて Storage に触る他4箇所（signed-url-server.ts:23 / image-generation-server.ts:23 / post-publish-server.ts:30 / cron/scheduler-tick/route.ts:18）は `env.SUPABASE_STORAGE_BUCKET_IMAGES` を見るのに、下書きの画像複製と破棄だけが `const IMAGE_BUCKET = "generated-images"` を直書きしている（破棄は空振りしても画面が成功に見える＝黙って壊れる形）。
- **どうする**: (1) 9箇所を `const auth = await requireUserId(); if (!auth.ok) return auth.result;` に置換（返り型は各Actionの結果interfaceが `code?: string; message: string; status` を満たすため BaseResult が代入可能）。**src/app/actions/ai-purpose-config.ts:32 は返り型のarmが `UserFacingError & {status}`（code必須）で BaseResult が入らないため対象外**。suggestions.ts は `requireActive()` の中身だけ差し替える。(2) 6箇所を `errorResult(new AppError(...))` に置換（いずれも validation_error / unauthorized / not_found で internal_error にならないため Sentry 記録分岐は発火せず返り値は完全一致）。generation-jobs.ts:88 は `{ ...errorResult(err), message: "先にXアカウントを連携してください。" }` の形にする。settings.ts:42 の `first`（zod先頭メッセージ）は `toUserFacingError` が `USER_MESSAGES[code]` を返すため計算されるだけで捨てられている＝出力に影響しないので削除する（本来の意図＝画面に出す方は振る舞い変更なので要決定へ）。(3) drafts.ts:29 を `const IMAGE_BUCKET = env.SUPABASE_STORAGE_BUCKET_IMAGES;` にする（env-schema.ts:128 で `.default("generated-images")` なので現構成では文字列同一）。
- **完了の判定**: src/app/actions/actions.db.test.ts:160-180,236-245、src/app/actions/auth.test.ts、src/lib/drafts-clone.test.ts、src/lib/db/storage-bucket.db.test.ts が**無変更で**緑（テスト書き換えが必要になったら等価でない証拠として扱い、差分を戻す）。`npm run release:check`。
- **依存**: なし

### R27 実行前提エラーの組み立て（プロフィール不在時の代替値＋AppErrorへの詰め替え）を execution-prereqs へ集約する

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/lib/jobs/generation-jobs.ts:106-120,122-132 / src/lib/learning-sources.ts:127-135 / src/lib/jobs/post-generation.ts:362-364 / src/lib/execution-prereqs.ts:141-148
- **なぜ**: `const error = input ? checkExecutionPrerequisites(input) : { code: "not_found" as const, missing: [], settingsPath: "/app" };` と、その後の `throw new AppError(error.code, { details: { missing, settingsPath } })` が4箇所に同じ形で書かれている（詰め替え側は execution-prereqs.ts:141 の `assertExecutionPrerequisites` が既に持っているが、null フォールバックを持たないため呼べていない）。「前提が読めなかったとき運営者へ何を返すか」が4箇所にコピーされており、1箇所だけ直すと画面によって説明が変わる。
- **どうする**: execution-prereqs.ts に `resolveExecutionPrereqError(input | null)`（null なら `{ code: "not_found", missing: [], settingsPath: "/app" }`）を足し、`assertExecutionPrerequisites` をその上に組み直す。generation-jobs の2箇所（生成用・投稿用）と learning-sources は assert 版を呼ぶ形へ、post-generation.ts:362 は throw せず `prereqError.code` を PostGenerationTerminalError へ渡すので算出だけを使う（戻り値の形 `{code, missing, settingsPath}` を維持する）。
- **完了の判定**: 共通関数側に「input=null → not_found / missing空 / settingsPath="/app"」の特性テストを1件追加（この経路のテストが薄い）。src/lib/jobs/generation-jobs.test.ts・execution-prereqs.test.ts・learning-sources.db.test.ts・post-generation 系テストが無変更で緑。
- **依存**: なし

### R28 premium時の枠reserveを reserveIfPremium に集約し、type→上限のマッピングを1箇所にする

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/lib/jobs/post-generation.ts:330-341 / src/lib/jobs/image-generation.ts:286-300 / src/lib/jobs/learning-analysis.ts:260-272 / src/lib/jobs/suggestion.ts:173-184 / src/lib/jobs/md-merge-server.ts:47-59
- **なぜ**: `const isPremium = job.plan === "premium"; if (isPremium) { await runInTx((tx) => reserveUsage(tx, { userId, xAccountId, jobId, type, limit })) }` が5箇所で繰り返され、suggestion.ts:180-181 と learning-analysis.ts:268-269 と md-merge-server.ts:55-56 は限度式まで同一文字列（実地に5箇所を確認）。つまり「typeとlimitの正しい組み合わせ」が5回手書きされており、新しいjob種別で plan判定を忘れる／type と limit を取り違えて別の枠の上限で判定する事故が起きる。どのjobがどの枠を消費するかが1箇所で読めない。
- **どうする**: `src/lib/usage/reserve-if-premium.ts`（`runInTx` を引数で受ける純粋層）に `RESERVE_LIMIT_BY_TYPE`（generation → `PLANS.premium.usageLimits?.generations`、image → `…?.images`）と `reserveIfPremium(runInTx, { plan, userId, xAccountId, jobId, type })` を置き、5箇所を置換する。post-generation.ts:342-353 は reserve を try/catch して usage_limit_exceeded を persistFailure へ回すので、**共通関数は例外を握らずそのまま透過させる**。md-merge-server.ts は server-only 側なので共通関数は純粋層に置く。
- **完了の判定**: type→limit の対応表そのものを検査するテストを1本足す（取り違えを機械検査に載せる）。post-generation.db.test.ts / image-generation.db.test.ts / suggestion.db.test.ts / md-merge.db.test.ts の reserve有無・usage_counters 加算の検査が無変更で緑。
- **依存**: なし

### R29 DB↔TSの値集合ドリフト検査を強化する（enumの逆方向・pg_type の namespace 絞り込み・schedule_slots.theme の CHECK）

- **種別/規模/リスク**: types / S / low
- **場所**: src/lib/db/enums.db.test.ts:24-29,39-52 / supabase/migrations/20260803000002_schedule_slot_theme_required.sql:18-21 と src/lib/post/post-theme.ts:22
- **なぜ**: (1) enums.db.test.ts は DB_ENUMS→pg_type の一方向しか見ておらず、migrationで新しいenum型を作って `src/lib/db/enums.ts` へ足し忘れても緑のまま＝`(typeof DB_ENUMS.x)[number]` から導出しているTSユニオンだけが古くなる。件数も `expect(names).toHaveLength(23)` の魔法数で縛っている。(2) 同テストのクエリに namespace 条件が無く、Supabase の auth/storage/realtime にも enum があるため同名enumができると値がマージされ誤検知・見逃しになる。(3) `schedule_slots.theme` の許可値はCHECK制約に7値がリテラルで、TS側は `POST_THEME_IDS`。migrationのコメントは「値は POST_THEME_IDS」と宣言しているのに一致を確かめる検査が無く、テーマを1つ足すと画面には選択肢が出て保存時にCHECK違反で落ちる。
- **どうする**: enums.db.test.ts のクエリに `join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'` を足し、DB側にあって DB_ENUMS に無い型名を列挙して落とす逆方向の検査を追加する（落ちたときに欠けているenum名が出るようにし、魔法数 23 を撤去）。theme は core-tables.db.test.ts の CHECK制約検査と同じ置き場所に、CHECK定義から値を取り出して `POST_THEME_IDS` と集合比較するテストを追加する。**実装・enum値・CHECK値は一切変えない**（差分が出たらそれが本物のドリフト）。Supabase未起動時は既存の作法どおり skip へ落ちること。
- **完了の判定**: REQUIRE_DB=1 で enums.db.test.ts / core-tables.db.test.ts / schedule-slots.db.test.ts が緑。検証として `src/lib/db/enums.ts` から1つenum名を一時的に消すと逆方向検査が落ちること、`POST_THEME_IDS` に架空の値を足すとtheme検査が落ちることを確認する（検査が空振りしていないことの確認）。
- **依存**: なし

### R30 USD→円のレート150の二重持ちを1つにし、呼び出し元ゼロの dbSizeLimitBytes と存在しない環境変数を指すコメントを消す

- **種別/規模/リスク**: duplication / XS / low
- **場所**: src/lib/ops/diagnostics.ts:443,454-457,501-510,646 / src/lib/ops/daily-summary.ts:163,253
- **なぜ**: (1) 同じ当月費用を運営者へ見せる2経路が換算レートを別々に持つ（diagnostics.ts:443 `Math.round(input.monthUsd * 150)` と daily-summary.ts:163 の同式。src内で150を為替に使うのはこの2箇所のみ）。片方だけ直すと doctor と日次サマリが同じ月の費用を違う円額で伝える（原則4の可視化が食い違う）。(2) `dbSizeLimitBytes?: number`（:505）を渡す呼び出し元は存在しない（唯一の呼び出し元 src/app/api/cron/doctor/route.ts は渡していない）。しかも :455 のコメントが指す `SUPABASE_DB_SIZE_LIMIT_MB` は repo 全体（src/scripts/docs/.env.example）に1件も存在せず、Pro移行時に env を設定して無反応になる嘘の案内になっている。
- **どうする**: `approxYen(usd)`（`Math.round(usd * 150)` をそのまま関数化。丸めの適用位置を変えない）を diagnostics/daily-summary の両方が参照できる場所（news-outcome.ts と同様に依存を持たないモジュール、または R31 で作る check.ts）へ置き2箇所を置換する。`dbSizeLimitBytes` を `DiagnosticsOptions` から削り、:646 は `FREE_DB_SIZE_LIMIT_BYTES` を直に使う。:455 のコメントから存在しない環境変数の記述を削る（上限をenvで上書きできるようにするのは機能追加なので別タスク）。
- **完了の判定**: 円額そのものを固定するテストが無いので、`approxYen` の直接テストを1件足す。src/lib/ops/diagnostics.test.ts:301-313（`円` を含む検査）・:320-360（judgeDatabaseSize は limitBytes を直接受けるので影響なし）、daily-summary.test.ts の費用行が無変更で緑。シグネチャ変更は typecheck が担保。
- **依存**: なし

### R31 doctor.mjs が写している「まとめ1行」を diagnostics 側と共有し、依存ゼロのモジュールへ切り出す

- **種別/規模/リスク**: duplication / S / low
- **場所**: scripts/doctor.mjs:167-177 と src/lib/ops/diagnostics.ts:44-57
- **なぜ**: `summarize()` の3分岐（`対応が必要な問題が N 件あります（注意 M 件）` / `すぐ困る問題はありませんが、注意が M 件あります` / `N 項目すべて正常です`）が doctor.mjs:167-176 に同じ文字列で再実装されている。doctor.mjs:8 のヘッダは「判定と文言は src/lib/ops/diagnostics.ts に集約されている（この script は表示だけ）」と書いているが、運営者が最も見る入口の1行だけ集約されていない。diagnostics.ts の文言を直すと doctor の表示だけ古いまま残る。
- **どうする**: `Level` / `Check` / `worstLevel` / `summarize` を **import を1つも持たないモジュール**（例 `src/lib/ops/check.ts`）へ移し、diagnostics.ts は re-export するだけにする。doctor.mjs は既に `await import("../src/lib/ops/release-gate.ts")` で .ts を読めているので同じ形で import し、:167-177 を `summarize(checks)` に置換する。**diagnostics.ts:1 は `import "server-only";` なので直接 import はできない**。移設先に `server-only` も `@/` エイリアス（nodeが解決できない）も持ち込まないことが条件。文字列は移すだけで変えない。
- **完了の判定**: src/lib/ops/diagnostics.test.ts:26-39（worstLevel / summarize）が無変更で緑。doctor.mjs 自体のテストは無いので、切り出し後に `npm run doctor` を実際に1回実行し、正常時・アプリ停止時の両分岐で表示が変わっていないことを目視確認する（1行まとめと exit code）。
- **依存**: なし

### R32 scripts の argOf / envValue / base既定値の重複を scripts/lib へ集約する

- **種別/規模/リスク**: duplication / S / low
- **場所**: scripts/doctor.mjs:14-32 / scripts/smoke-live.mjs:13-32 / scripts/check-turnstile.mjs:16-21
- **なぜ**: `argOf(name)` が3ファイルに同一、`envValue(name)`（process.env → .env.local → .env を正規表現で読む12行）が doctor.mjs:19-30 と smoke-live.mjs:19-30 でコメント以外まったく同一、`const base = (argOf("base") ?? "http://127.0.0.1:3000").replace(/\/$/, "")` が3ファイルに同一（実地に3ファイルを読んで確認）。鍵の読み取り規則を直すとき `npm run doctor` だけ直して `npm run smoke:live` が古い規則のまま、という食い違いが起こりうる（どちらも「デプロイ先を覗く2コマンド」で同じ鍵を読む）。
- **どうする**: `scripts/lib/cli.mjs`（plain JS）に `argOf` / `envValue` / `baseUrl()` を移し3ファイルから import する。**探索順（process.env が最優先）・既定URL・末尾スラッシュ処理を1文字も変えない**。副産物として smoke-live.mjs:18 のコメント（「.env.local → .env → 環境変数 の順」）が実装と逆である点を1箇所で正す（コメントのみ）。
- **完了の判定**: scripts に自動テストは無いため、`npm run doctor`（ローカル／`--base` 指定）と `npm run smoke:live`（`--account` 無し・鍵未設定の分岐）を実際に実行し、出力と exit code が集約前と同じであることを確認する。src/lib/ops/next-action-commands.test.ts が scripts/ 配下の .mjs を再帰走査するので新規ファイルも検査対象に入る（案内文を持たないので影響なし）。
- **依存**: なし

### R33 法務ページの検査を「ソース文字列の toContain」から PROCESSORS の値そのものへ変える（委託先9社・移転国）

- **種別/規模/リスク**: testability / XS / low
- **場所**: src/app/legal-pages.test.ts:26,171-190 / 対象データは src/lib/legal-entity.ts:71-144
- **なぜ**: `const ENTITY = read("src/lib/legal-entity.ts")` の**ファイル本文**に対する toContain で検査しているため、委託先を1件足して `country` を書き忘れても他8件の「米国」が拾われてテストは緑になる（PROCESSORS は9件すべて `country: "米国"`）。委託先追加はまさにこの検査が想定している場面（:172 のコメント「増やしたらここへも足す」）なのに、そのときの抜けを検出できない。委託先名の検査も本文の toContain なので、PROCESSORS から外して別の const や説明文へ移しても通る。法28条の情報提供に関わる箇所で、漏れると告知義務違反になる。
- **どうする**: legal-pages.test.ts に `PROCESSORS` を import し（同ファイルは既に legal 系定数を import している）、(a) 9社が `PROCESSORS.map((p) => p.provider)` に含まれること、(b) 全要素の `country` が空でないこと（現状の値は全件「米国」）、(c) `provider` / `service` / `purpose` / `use` / `data` が全要素で非空であることを検査する形へ置き換える。**必須語の検査は緩めない**（法務3ページ側の必須項目検査はコメント除去後にも全語が存在することを確認済みなので触らない）。
- **完了の判定**: src/app/legal-pages.test.ts の「プライバシーポリシー…」describe が緑。検証として PROCESSORS に `country: ""` の要素を一時的に足すとテストが落ちること（現状の検査では通ってしまうこと）を1度確認する。
- **依存**: なし

### R34 法務同意プロフィールの列リストを1つの正本にする

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/app/app/consent/page.tsx:19-25 / src/app/actions/legal-consent.ts:19-26 / src/lib/auth/legal-consent-server.ts:31-41
- **なぜ**: 同じ4列を同じ条件で3箇所が別々に読んでいる（`"terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at"` が page と Action で文字列まで同一、pooled版は `::text` cast 付きで同じ4列を手書き）。行の型は src/lib/auth/legal-consent.ts:7-10 に `LegalConsentProfile` として既にあるのに、列リストは3箇所にある。同意対象が増えたとき実行ガード（legal-consent-server.ts）だけ古いと「画面では同意済みなのに生成が止まる」あるいは逆に「同意していないのに生成できる」になり、規約本文が約束している挙動から外れる（T-M8-73 のコメントが指摘している問題そのもの）。
- **どうする**: `src/lib/auth/legal-consent.ts`（純粋層）に列名の正本 `LEGAL_CONSENT_COLUMNS = ["terms_version", "terms_accepted_at", "privacy_version", "privacy_acknowledged_at"] as const` を置き、admin client を使う2箇所は `.select(LEGAL_CONSENT_COLUMNS.join(", "))`、pooled版は同配列から `::text` cast 付きのselect句を組む形にする。**失敗時の扱いは呼び出し側に残す**（page は `throw new Error("Legal profile could not be loaded.")`、Action は catch して定型文＋Sentry記録）。pooled版（接続方式が違い、env検証を持ち込まない理由がコメントに明記）は統合しない。
- **完了の判定**: src/lib/auth/legal-consent.test.ts（requiredLegalConsents の判定式）・src/app/actions/auth.test.ts が無変更で緑。同意画面と acceptLegalUpdates の失敗経路（行が読めないケース）のテストが薄いので特性テストを1件添える。`/verify-integration` の同意ゲート経路を1度通す。
- **依存**: なし

### R35 landing-page.test.ts の空振りを塞ぐ（検査対象のディレクトリ走査化＋グラデ検査をデータ配列のフラグまで見る＋古いコメントの是正）

- **種別/規模/リスク**: testability / S / low
- **場所**: src/app/landing-page.test.ts:21-29,129-134 / src/app/page.tsx:98-116,153-176
- **なぜ**: (1) 検査対象がファイル名の手書き列挙（`const LP_SOURCES = [PAGE, PRICING, HERO_MOCK, FIGURES, FAQ].join("\n")`）なので、src/components/lp/ に新しいコンポーネントを足すと禁止表現・価格直書き・opacity-0・use client の検査が全部すり抜ける（列挙への追記が人の記憶に依存）。(2) グラデ検査は `LP_SOURCES.match(/var\(--brand-gradient\)/g)` の出現数 `=== 5` だが、page.tsx の上端3pxバーと生成中バーはどちらも**データ配列のフラグ**（FEATURES の `gradientTop`、HOW_STEPS の `bar`）で1行のJSXをループで描くため、2枚目以降へフラグを足しても出現数は5のまま＝画面上のグラデだけ黙って増える。(3) :130-131 のコメントが指す場所が現状と不一致（グラデが付くのは「03 しくみ」の *02 作る*、「02 できること」側は eyebrow「投稿・画像の自動作成」の1枚）。
- **どうする**: `LP_SOURCES` を `src/components/lp/` のディレクトリ走査（`.tsx` を再帰収集）＋ `page.tsx` に置き換える（cwd依存にしない＝`fileURLToPath(new URL(…, import.meta.url))` 基準）。グラデ検査に「FEATURES 内 `gradientTop: true` の数」「HOW_STEPS 内 `gradientTop: true` / `bar: true` の数」を数える assertion を追加し、現在の値（各1）で緑になることを確認して入れる。コメントを現状のセクション名・カード名に直す。**PAGE 限定の検査（signup/loginの導線・アンカーid・カード登録注記の2回・ヒーローの固定コピー）はそのまま PAGE に対して行う**（LP_SOURCES へ移すと空振りする）。
- **完了の判定**: landing-page.test.ts の全ケースが無変更の期待値で緑（対象は現行の4ファイル＋page.tsx と同一なので5という期待値も通る）。検証として FEATURES の別カードへ一時的に `gradientTop: true` を足すと新しい assertion が落ちること、src/components/lp/ にダミーの .tsx を置くと禁止表現検査の対象に入ることを1度確認する。実装コードは不変なのでE2Eは不要。
- **依存**: なし

### R36 曜日×時刻ドットの「状態→クラス」対応表と曜日ラベルを1箇所に集約する

- **種別/規模/リスク**: duplication / S / low
- **場所**: src/components/lp/figures.tsx:78-82,90 / src/components/lp/hero-mock.tsx:34,63-67,77
- **なぜ**: 同じクラス文字列が3つのマップに、しかも別々のキー名で書かれている（figures.tsx:78 `{ filled: "bg-brand", ring: "border-[1.5px] border-brand", off: "border border-hairline" }`、hero-mock.tsx:63 `{ on, draft, off }`、hero-mock.tsx:34 `{ draft, scheduled }`。値は完全一致で、hero-mock.tsx:33 のコメントも「ドットの意味は④のスケジュール表と同じ（○=下書きまで ●=そのまま投稿）」と書いている）。曜日ラベル配列 `["月","火","水","木","金","土","日"]` も figures.tsx:90 と hero-mock.tsx:77 に重複。色や太さを直すと3箇所を直す必要があり、1つ忘れるとヒーローのモックと「できること」の図版で同じドットが違う意味に見える（どのテストにも映らない）。
- **どうする**: `src/components/lp/dots.ts`（または既存の figures.tsx 先頭）に `SLOT_DOT_CLASS = { post: "bg-brand", draft: "border-[1.5px] border-brand", none: "border border-hairline" } as const` と `WEEKDAY_LABELS_LP` を1つだけ置き、3つのマップと2つの配列を参照に置き換える（キー名の統一は内部識別子のみ）。**ドットの寸法（size-2.5 と size-2）とグリッド幅（44px / 34px）は意図的に違うので呼び出し側に残す**——ここまで共通化すると見た目が変わる。
- **完了の判定**: クラス集合を直接見るテストが無いため、R13c（tab-nav.test.ts）の前例どおり「3箇所が同じクラス文字列を使う」ことを固定する等価テストを1本足す。連結結果がバイト同一であることを確認し、e2e/landing.spec.ts と e2e/mobile-layout.spec.ts を通し、`/ui-polish` の実ブラウザ確認（ヒーロー・02の図版のドットの前後比較）を行う。type-scale.test.ts の ALLOW_11PX はファイル名キーなので、11pxの極小テキストは figures.tsx / hero-mock.tsx から動かさないこと。
- **依存**: なし

### R37 下書きの警告ラベル表と要約生成を lib へ移し、警告コードの対応漏れを機械検査できる形にする

- **種別/規模/リスク**: testability / S / low
- **場所**: src/app/app/posts/drafts-list.tsx:34-61 / src/lib/post/generation-validation.ts:19-29
- **なぜ**: drafts-list.tsx:34-50 に `WARNING_LABEL` / `WARNING_DETAIL` が手書きされ、:57 で `WARNING_DETAIL[code] ?? WARNING_LABEL[code] ?? code` とフォールバックしている。コードの正本は generation-validation.ts:19-29 の `WARNING`（7コード）だが、画面の表は5コード＋画面固有の `image_failed` のみで、`length_over_target` と `post_count_trimmed` が抜けている（＝その警告が付いた下書きではバッジに生の英語コードが出る）。`.tsx` は単体テストの網（environment: node・include `src/**/*.test.ts`）に入らないため、この抜けはどのゲートでも検出できない。
- **どうする**: `src/lib/post/warning-labels.ts` に `WARNING_LABEL` / `WARNING_DETAIL` / `warningSummary(thread)` をそのまま移し、drafts-list.tsx は import に置き換える（表示は完全に不変）。テストは「現在の対応表を固定する特性テスト」＋「`WARNING` の全値を列挙し、ラベル未定義のコードは明示的な allowlist（`length_over_target` / `post_count_trimmed`、要決定へ回した旨のコメント付き）にのみ許す」検査にする。これで**新しい警告コードを増やしたときは必ずどちらかへ足す**ことになり、以後の抜けを機械が止める。**現状の抜け2件の文言をこのタスクで埋めてはいけない**（画面文言が変わる＝振る舞い変更。要決定へ回す）。
- **完了の判定**: 新規 src/lib/post/warning-labels.test.ts（各コードのラベル・DETAIL優先・未知コードは素通し・`warningSummary` が「2ポスト目: …」形式）が緑。既存 generation-validation.test.ts・draft-actions.test.ts は無変更。検証として `WARNING` に架空のコードを一時的に足すと完全性検査が落ちることを確認する。e2e/publish.spec.ts（警告付き投稿確認）を通す。
- **依存**: なし

### R38 スケジュールのセル説明文・パターン名フォールバック・曜日+時刻表記と、保存前の入力検証を lib/schedule の純関数へ切り出す

- **種別/規模/リスク**: testability / S / low
- **場所**: src/app/app/schedule/schedule-manager.tsx:323,325,437,491,617-635,793-797 / src/lib/schedule-slots.ts:26-42
- **なぜ**: (1) aria-label（:323）と title（:325）に**完全に同一のテンプレート**が2度書かれている（`${PATTERN_LABEL[s.pattern] ?? s.pattern}${…テーマ…}・${s.mode === "auto" ? "自動投稿" : "下書きのみ"}${s.enabled ? "" : "・停止中"}`）。支援技術向けの名前と視覚的な補足がズレても typecheck・lint・E2Eのどれも落ちない。`PATTERN_LABEL[x] ?? x` は7箇所、`weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")` ＋ `time_jst.slice(0,5)` は :437 / :491 に散在（:793-797 はソート付きで同じ整形を再実装）。(2) 保存前の検証（曜日0件→テーマ未選択→auto かつ未同意）が `.tsx` の中にあり、サーバー側の正本（schedule-slots.ts:26-29 の `.min(1)`、:42 の `z.enum(POST_THEME_IDS)`）を画面が手で写している。この分岐を壊しても、E2Eで踏んだ経路以外は全部緑のまま通る（draft-actions.ts を `.ts` へ出した理由とまったく同じ構図で、T-M8-37 の「どの項目が悪いか分からないエラーを出さない」要求が機械検査に載っていない）。
- **どうする**: `src/lib/schedule/slot-labels.ts` に `patternLabel(pattern)`・`slotDescription(slot)`・`slotScheduleLabel(weekdays, formattedTime)` を、`src/lib/schedule/slot-form.ts` に `validateSlotForm(values, { consented })`（`{ error: string | null; needsConsent: boolean }` を返す）を置く。aria-label と title は同じ関数を通す。**出力文字列を1文字も変えない**（:793-797 のソート付き版は `v.time_jst`（秒なし）を `slice(0,5)` せず使っているので、共通関数は「整形済み時刻を受け取る」形にして現在の出力を維持する）。検証は判定結果を返すだけにして state 更新（setValidationError / setShowConsent）は呼び出し側に残し、分岐の順序（曜日→テーマ→同意）を変えない。
- **完了の判定**: 新規 src/lib/schedule/slot-labels.test.ts（停止中・auto・theme=other・未知patternの4分岐で現在の文字列を固定）と slot-form.test.ts（曜日0件／テーマ未選択／auto かつ未同意／auto かつ同意済み／draft 正常の5ケース）が緑。既存 src/lib/schedule-slots.test.ts・next-run.test.ts は無変更。e2e/schedule.spec.ts（週間プレビュー・行の表示・保存ゲート）を通し、`/ui-polish` で aria-label と title が同一であることをブラウザで確認する。
- **依存**: なし

## 除外（2026-08-11 監査で検証のうえ却下）

挙がったが着手しないもの。**同じ候補を再提案しないための記録**。

- LPの page.tsx（564行）の分割 — セクションを画面の並び順に上から書いた構造が失われ、landing-page.test.ts が `PAGE` 限定で見ている項目（導線・アンカーid・注記2回・ヒーローの固定コピー）が空振りする。行数だけを理由にした分割は価値がない
- ヒーローと最終CTAに残る注記 `<p>` の共通化・上端3pxグラデの共通コンポーネント化 — どちらも `{CARD_REGISTRATION_NOTE}` の出現数／`var(--brand-gradient)` の出現数=5 を数えている機械検査を弱める。4行の重複より検査の強度を優先する（代わりに R35 で検査を強くする）
- 価格・上限の一元化／CTA定数・SectionMark の集約／LP用CSSクラスの棚卸し — 実地に確認したところ pricing.tsx は数値を1つも直書きせず PLANS/yen()/usageLimits 由来で、CTA_SIZE・CARD_REGISTRATION_NOTE・CONTAINER 等も既に定数化済み。figures/FaqList/HeroMock/PricingCards と .lp-anim-* の4クラスも全て使用中で未使用は無い
- pooledQueryable / defaultRecordStage / STALE_TIMEOUT_* / handleCronRoute / errorResult / requireUserId 本体・toIso・yen・formatJst・POST_PATTERN_LABELS の集約 — 2026-07-25 の監査（R3/R8/R12/R15/R16/R17）で完了済み。今回挙げるのは取りこぼしのみ（R26）
- executePostPublish（post-publish.ts:433-754）の「検証」と「投稿・確定」への分割 — 8つの事前ゲートの順序と境界が振る舞いそのもの（長さ超過はmode非依存で同意確認より前、premium残量はtoken取得より前でX APIを1回も呼ばない）。抽出しても機械検査は1つも増えず、既存テストが唯一の担保のまま。価値÷リスクが低い
- generation-jobs.ts の `select id from generation_jobs where request_key = $1`（8箇所）のヘルパ化 — 同一SQLだが利得は1行×8で低く、戻り型を `string | null` にすると呼び出し側に null 分岐が生まれ、現状の到達不能パス（`rows[0]` が undefined なら TypeError）の扱いを変える誘因になる
- DBテストの起動ボイラープレート（3フック20ファイル・sql()/DB_URL 9ファイル）と auth.users/x_accounts seed（56ファイル・約60箇所）の fixture 化 — 守る対象は「新しいDBテストで skip ガードや closePool、seed列を忘れる」だが、忘れれば REQUIRE_DB=1 の release:check で即座に落ちる（黙って緑にならない）。テスト30〜56ファイルを書き換える差分量に対して価値が閾値に届かない
- ソース走査テストの再帰walker 11コピーの統合 — 除外規則が11通りに違う（.tsxのみ／定義元と自ファイル除外／*.db.test.ts除外／.mjs含む／e2e・scriptsも歩く）ため「walker＋オプション」にしても規則は各所に残り、共有ファイル自身が走査対象に入って偽の offender になる恐れもある（低価値・中リスク）。cwd依存の是正だけを R19 で拾う
- 確認ダイアログ外枠（Backdrop/Popup/Description/フッタ）の ConfirmDialog 化（6箇所） — クラス文字列の一致は実地に確認したが、UIクラスのドリフトは typecheck/lint/build/単体で捕捉できず（R13d の見送り理由と同じ）、drafts-list.tsx:607-620 だけ警告 Notice が Title と Description の間に入るため読み上げ順を壊す危険がある。着手するなら純関数 `confirmDialogPopupClassName(size)` ＋クラス集合テストが前提で、今回の20単位より価値÷リスクが低い
- 下書き画面の job ポーリング useEffect（2本）の共有フック化 — 骨格は同型だが、フックへ出すと依存配列とクリーンアップの所有者が移り、書き方を誤ると多重 setInterval やリーク（＝振る舞い変更）になる。`.tsx` は単体テストの網外でE2Eが唯一のゲート。TERMINAL 定数（3箇所同一）の集約だけなら低リスクだが単独では価値が小さい
- 未使用 export 約280箇所（値80・型200）から export を剥がす／既存コメントの日英統一／@types/nodemailer の devDependencies 移動 — いずれも「次に触る人が間違える」構造を1つも直さない。前2者は多くが *.test.ts のソース検査や docs から名前で参照されている
- estimated_cost_usd_total の `calls.reduce(...)` 4箇所（ai/pipeline.ts:112・image-generation.ts:155,222・post-generation.ts:528） — 同値で、誤ってもAI費用の見え方が変わるだけ（判定に使われない）
- suggestion-input.ts:79 の `hasUrl`（`/https?:\/\//`）を post-publish の `URL_RE`（`\S+` 付き）と統合 — 前者は分析軸用・後者は課金用で判定が変わる（R24では2箇所に限定する）
- news-digest.ts:147-158 と ops/daily-summary.ts の通知INSERTを R21/R22 の共有関数へ巻き込む — 退会競合対策の `for key share of p` を持つ別形（T-M8-19）で、揃えると振る舞いが変わる
- generation-jobs.ts の「未解決投稿」判定2種（regenerateDraft:293-299 と hasUnresolvedPosting:447-455）の統合 — 意図的に別物で、共通化すると許可される操作が変わる
- persona-settings-form.tsx の入れ子スプレッド（6回）の解消 — `PersonaSettings` が全フィールド必須のためスプレッドを落とすと typecheck が落ちる＝既に機械が守っている
- 成功アラートの緑色ドリフト・transition 欠落の統一／ドットの寸法・グリッド幅の統一 — 見た目の変更＝振る舞い変更（前回監査でも同じ理由で除外）
- drafts-list の警告ラベル欠落2件の補完・api-key-settings:453 の文言修正・settings.ts の zod メッセージを実際に画面へ出す — いずれも画面文言が変わるためリファクタ対象外（要決定へ回す）

## 要決定 / 除外（2026-07-25 監査・振る舞い変更のため対象外）

2026-08-11 監査で出た要決定6件は `tasks/BACKLOG.md` の **D-21〜D-26** に集約した（画面文言の変更・
`.dark` パレットの削除・docs記載のServer Action削除など、いずれも振る舞いか正本が変わるためリファクタでは扱わない）。

- **成功アラートの緑色ドリフト**（emerald-900/800/700）や **resend-confirmation-form の transition 欠落**の統一は「見た目の変更＝振る舞い変更」。リファクタではなく別途 dev-loop で扱う（暫定: 現状維持）。
- **R9 の env 型（`ALWAYS_REQUIRED` を非optional化して `as string` を全廃）** は型変更が広範に波及するため中リスク。今回は「検証後に必須項目を非nullで返す型付きアクセサ」に留め、schema自体の非optional化は要決定として保留（暫定案: アクセサ方式）。
- **R13d の残り（タブ解決ヘルパー／muted空状態カード②③④／analytics日数セグメント／ai-purpose amberカード）** は見送り。(1) タブ解決は3画面で fallback 値・`?? default`・`as Tab` cast・items形状が微妙に異なり、共通化しても各1行削減で低価値。(2) muted空状態カード②③④は radius/bg/py/要素が異なる3バリアント×各2箇所で、variant化は複雑化（監査でも「低価値・中リスク」評価）＋UIクラスのドリフトを検証ゲートが捕捉できない。(3) セグメント/amberカードも同様に低価値。いずれも「価値×低リスク」の閾値に届かないため現状維持。着手する場合は TabNav 同様に純関数 `*ClassName` ＋クラス集合テストで守ること。
- **`readAt` センチネル `"read"`（notification-bell）** の是正（R9d で当初予定）は見送り。表示はローカル楽観更新の真偽値（既読ドットの有無）でしか使われず、`"read"` は「サーバ確定前のローカル目印」として機能している。型は `string | null`（ISO時刻）だが、偽のISO時刻（例 `new Date().toISOString()`）へ置換すると「本物の既読時刻」に見えてかえって誤解を招く。値は表示・送信されず上書きされるため、現状維持が安全（振る舞い保存の観点でも据え置きが妥当）。
- **X設定パス定数 `/app/settings?tab=api-keys` の一元化**（R8c で当初予定）は見送り。値が安定（滅多に変わらない）で価値が低い一方、13+箇所に散在し token-refresh の SQL文字列リテラルや execution-prereqs の Record 値・app-banners/route/actions 等の別領域に跨るため、集約すると分散した import を各領域に張ることになり費用対効果が低い。振る舞い保存は可能だが低価値・高分散のため今回対象外（現状維持）。

## 既知の不安定テスト（リファクタ起因ではない）

- **`src/lib/x/oauth.test.ts`「encrypts access/refresh as envelopes recoverable by decrypt」は約1%の確率で落ちる**（2026-08-11・R21実施中にフルスイートで1度遭遇し、原因を特定）。
  原因は `expect(sealed.accessTokenCiphertext).not.toContain("AT")`。平文が `"AT"` の2文字で、暗号文は
  base64（`envelope.ts` が nonce/ciphertext/tag を base64 化してJSONに詰める）なので、**乱数鍵しだいで
  base64文字列の中にたまたま `AT` という並びが現れる**。実測 **185/20000 = 0.92%**。
  暗号化されていることの検査としては平文が短すぎるのが問題で、`"AT"` を十分長い平文（例
  `"ACCESS_TOKEN_PLAINTEXT_MARKER"`）に変えれば偶然一致は事実上消える。**振る舞い保存の対象外
  （テスト側の欠陥）なので R19〜R32 では触っていない。** 直すなら1行。

- `src/lib/jobs/news-digest.db.test.ts`「fans out digests...」は matchedUsers/notified の**グローバル集計下限**を検査するため、並行DBテストの news_config 一致ユーザー状態に依存し、フルスイート実行でごく稀に `matchedUsers=0` で落ちることがある（単体では安定して緑）。テスト自身のコメントも「並行テストを含みうるので下限のみ検査」と明記。リファクタ変更とは無関係。将来 dev-loop で per-window の分離（専用ユーザー限定集計）を検討。

## 進め方メモ

- **2026-08-11 パス（R19〜R38）**: R19 を最初に置くのは、これが「検査が空振りしている」＝以後どの単位を
  やっても安全網が効かない状態を直すため。R19 は実地に検証済み（`billing-return-server.ts` の
  `import "server-only";` を外しても **17 passed のまま**だった）。以降は R21→R22→R23 の順に依存があり、
  それ以外は独立して着手できる。
- R1・R2（quick win）→ R3（最大の重複解消）を先頭に。R3は広範だが機械的なので領域ごとに検証しながら進める。
- 各単位: テストが薄ければ特性テストを先に追加 → 実装 → `typecheck/lint/test`(+build) → `/doc-sync` → `refactor(<scope>): …` でコミット。
