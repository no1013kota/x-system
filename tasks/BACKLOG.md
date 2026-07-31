# 開発バックログ

Space AI MVPの作業キュー。エージェントループ（/dev-loop）はこのファイルを読んでタスクを選択する。

## 運用ルール

- ステータス: `todo` → `doing` → `done`。外部要因で進められないものは `blocked`（理由を明記）
- WIP = 1（`doing` は常に1件以下）。1タスク = 1コミット
- 優先順: 上のマイルストーン・上のタスクほど優先。「依存」のタスクが `done` でないタスクには着手しない（`M0` のような依存はそのマイルストーンの全タスク完了を意味する）
- タスクの追加・分割・並べ替えは自由（参照の要件IDは保持する）。完了タスクは消さず `done` にし、後続に影響する判断があれば「メモ:」へ追記する
- ユーザーに判断・準備してほしいことは「要決定・外部準備」に追記する
- 書式: `### <ID>: <タスク名> \`<status>\`` ＋ 参照/依存/サイズ行 ＋ 完了条件

## 現在の状況と次の一手（2026-07-30 更新）

M0〜M6は`done`。M7（UX改善の後続＋検証基盤の強化）は T-M7-25 まで完了。**機能実装は出揃っており、残りは「検証カバレッジ・運用の可視化」と「要決定」「外部準備（人間側）」**。

| 区分 | 残り | 場所 |
|---|---|---|
| 開発タスク（着手可） | 4件（T-M7-27・28・30・32。T-M7-29は日次サマリ・T-M7-35は手順の畳み込みで別枠） | 下記M7セクション |
| 開発タスク（blocked） | 1件（T-M7-17 Gemini画像。ユーザー判断で一旦不要） | 同 |
| 要決定 | **0件**（D-14は2026-07-31に「いまは現状のまま」で保留。本番公開前に再判断） | 「要決定・外部準備」 |
| 外部準備（人間側） | **重複排除後12項目**（アカウント・実キー・法務・単価確認）。[リリース前チェックリスト §3](../docs/operations/release-checklist.md) が正本 | 同（下記の未チェックは49行だがマイルストーンごとの重複を含む） |

**次の一手（推奨順）**

1. **`main` へ反映する前にCIの緑を必ず確認する**（D-14は現状維持で保留＝仕組みで止まらないため。本番公開の前にD-14を再判断する）
2. **`stg` を push → CI を通す → staging の器を整える**（Vercel Domains で `x-system-stg` を `stg` ブランチへ割当・Preview の `APP_BASE_URL` を一致・X App の callback URL 登録）→ **staging Supabase へ `supabase db push`**（未適用のままだとX連携が `internal_error` で失敗する）→ [デプロイ手順 §5](../docs/operations/deployment.md) の検証＋`npm run smoke:live -- --base <stgURL>`
3. **`stg` → `main` のPRを作ってマージ**（staging検証後）。`main` 保護後は直pushできない。マージで production ビルドが走る
4. **発信の質に効く改善は完了**（T-M7-37 プロンプトの不利の除去・T-M7-41 字数とポスト数の担保・T-M7-38 分析軸の拡張・T-M7-39/40 の不具合） → 検証カバレッジの残り（T-M7-27・28）→ **運営のしやすさ（T-M7-34 状態確認・T-M7-35 手順の畳み込み・T-M7-29 日次サマリ・T-M7-30 週次メンテ）** → 決定に伴う後始末（T-M7-32 sharp upgrade。T-M7-31 通知の掃除は完了）

> **`CLAUDE.md`「前提：運営者は個人」の5原則に対する現状**: ①黙って壊れない=T-M7-29で残り／②原因が辿れる=**T-M7-34で対応済み**／③手順を記憶に依存させない=**T-M7-35で未対応**／④費用が見える=**T-M7-34で対応済み**／⑤判断をまとめて求める=「要決定」で運用中。

**リポジトリの状態**: 単体+DB 1,350件緑（185ファイル・skip 6）/ E2E 29件緑（14ファイル）/ `check:providers` 5件緑 / `smoke:live` 3シナリオ緑。CI（GitHub Actions）稼働中。作業ブランチは `stg`、`main` へは**PR経由**で反映する運用（D-8 案A。GitHub側の保護設定は未実施）。**未pushのコミットがあるので `git branch -vv` で確認する**。

> 開発の進め方とテストの層ごとの役割は [開発とテストの進め方](../docs/operations/development-and-testing.md) を読む。

---

### T-M7-07: D-5 案A — runJob中央finalizer（retry分類・backoff差し戻し） `done`
- 参照: 要決定D-5、要件04 §4・§5、プロンプト設計書 §5.2 / 依存: T-M7-02 / サイズ: M
- 完了条件:
  - handlerが投げた retryable(429/5xx/network) が上限まで backoff 付きで queued へ戻り、即 failed にならない
  - auth/invalid/不明な例外と上限到達は従来どおり failed で確定する
  - 再試行時に post_generation の Web検索 maxUses が縮退する
- 実装結果: 純関数 `jobs/job-error.ts`（`classifyJobError`＝明示kind→retryable宣言→HTTP status→network code(`cause`も)→名前の順、材料が無ければ`unknown`／`decideJobOutcome`＝`shouldRetry`＋`backoffMs`で retry/fail を決める）を追加し、`runJob` の catch から呼ぶ。retry時は `requeueJob`（`status='running'` の行だけを queued へ戻し、lock・stage・error をクリアして `available_at = now()+backoff`）→ backoff 分 sleep → 同jobを再dispatch（tickを待つと最大5分の空白になるため。dispatch失敗はqueuedのままtickが回収）。`RunResult.result` に `"retry"` を追加。`post_generation` は `loadJob` に `gj.attempt` を足し、`webSearchForPattern(..., attempt)` が `reduceWebSearchMaxUses` で1段階ずつ縮小する。併せて失敗通知の dedupe key を `job:{id}:error` → **`job:{id}:failed`** に統一（要件04 §14・stale経路と一致）。テスト+10（分類/判断8・requeue DB 2）、全1183件緑・build通過。
- 後続への注意: **D-5の残件はreserveのrefundのみ**。worker失敗経路で `finalizeFailedJob` は呼ばない（handlerが既にdraft確定・通知を自前で行うため二重実行になる）。reserve作成が実装されるM6で、refundだけをworker経路にも通す設計を再検討する。`runJob` の retry sleep は最大4.5秒（attempt2で2〜3秒）で maxDuration 200秒に対し十分小さい。retryはhandlerが `persistFailure` を呼ぶ前に throw する経路（provider transport error・PauseTurnIncomplete）でのみ起きるため、再試行される失敗でerror通知が出ることはない。

### T-M7-08: D-6 案B — 生成ごと/スロットごとの画像provider選択を廃止 `done`
- 参照: 要決定D-6、要件02 §3.10・§4.7、要件05 §5・§7、要件06 §4.2 / 依存: なし / サイズ: M
- 完了条件:
  - 画像providerはAI設定「AI用途」の`image`だけを正とし、投稿作成・スケジュールの選択UIと引数が無くなる
  - 画像ONのスロット・生成jobがprovider未指定で作成できる（旧CHECKに阻まれない）
- 実装結果: 選んでも反映されない不整合（`executeImageGeneration` は常に `resolveImageProvider` でアカウント設定から解決）を解消。UI: 作成フォームとスロットフォームからprovider選択を削除し、「画像を作るAIはAI設定の『AI用途』で選んだものを使う」旨の説明に置き換え（キー未登録時は画像なしで作成される旨）。引数: `createGenerationJob`／`regenerateDraft`／`createDraftFromNews`／`createScheduleSlot`／`updateScheduleSlot` の `image_provider` と、`generation_jobs.input.image_provider` への書き込みを削除。DB: migration `20260726000001_drop_slot_image_provider.sql` で `schedule_slots.image_provider` と CHECK `schedule_slots_image_provider_valid` を削除（ローカルへ `supabase migration up` 適用済み）。docs: 要件02 §3.10・§4.7、要件05 §5/§7/検証表、要件06 §4.2。テスト: 3件を新仕様へ更新（slot schema・schema CHECK・enqueue）、全1183件緑・build通過・E2E 4件緑。ブラウザ実確認: 両フォームにprovider選択が無いこと、画像ONのスロットがprovider無しで作成できること。
- 後続への注意: 画像providerの唯一の設定点は SC-10「AI用途」。**生成ごとに使い分けたい要望が出たら D-6 案A（`resolveImageProvider` に preferred 引数）へ戻す判断が要る**。`availableImageProviders`（posts/page.tsx・schedule/page.tsx）は選択肢の提供ではなく「画像AIが使えるか」の判定にだけ使っている。

### T-M7-09: D-4 案A — 例外で終わったprovider callを原価台帳へ記録 `done`
- 参照: 要決定D-4、要件04 §10、要件02 §3.17、プロンプト設計書 §5.6 / 依存: なし / サイズ: M
- 完了条件:
  - provider callが例外throwしても `external_api_usage_events` に status=failed のcallが残る
  - 例外の型を変えない（retry分類が status/kind を見るため）
  - 保存内容にprovider応答本文・token値の捏造を含めない
- 実装結果: `ai/normalize.ts` に `failedProviderCall`（token 0・原価null・安全なerror codeのみ）、`ai/pipeline.ts` の `callOnce` を try/catch して失敗callを `calls` へ積み、蓄積usageを**例外オブジェクトへ載せて**再throw（型を変えないので `classifyJobError` の分類が壊れない）。取り出しは `usageFromError`。error code は HTTP status→`http_<status>`／SDKの`code`・`name`（`^[A-Za-z][A-Za-z0-9_.-]{0,62}$` のみ採用）／既定 `unknown_error`。`RunTextGenerationOptions` に `providerId` を必須追加し、6箇所の呼び出し（post_generation×2・learning_analysis・suggestion・image_generation・news_research）と news-fetch route の配線を更新。記帳側は post_generation の catch に「記帳だけ行いthrow」経路を追加（error/通知はrunJobの判断に委ねる）、news_research の catch に `recordNewsUsage`、learning_analysis と suggestion は既存の usage 抽出を `usageFromError` に置き換えて自動的に失敗callを含めるようにした。テスト+2（例外時の失敗call・修復callで例外の混在）、全1185件緑・build通過。
- 後續への注意: **画像生成（`ai/image.ts`）の例外callは対象外**（text pipelineのみ）。同じ扱いにするなら別タスク。**副次修正**: `news-digest.db.test.ts` の `matchedUsers >= 2` はDB全体の集計に依存し他のDBテストと並行すると0になり得たため、対象ユーザーの行数不変で dedupe を検査する形へ変更（既知のflakyを解消）。

### T-M7-10: next を 16.2.12 へ更新（D-7 の一部解消） `done`
- 参照: 要決定D-7、要件01 §8 / 依存: なし / サイズ: S
- 完了条件:
  - `next` の high 4件・moderate 5件（`>=16.0.0 <16.2.11` 対象）が解消し、audit allowlist から `next` を外せる
  - typecheck / lint / 全テスト / build / E2E が緑
- 実装結果: `next` と `eslint-config-next` を 16.2.10 → **16.2.12**（exact pin を維持）。当初 D-7 は「minor upgrade が必要」としていたが、再調査の結果**パッチで解消**することが分かったため先行実施した。解消した high は SSRF in Server Actions on custom servers（GHSA-89xv-2m56-2m9x）／middleware・proxy bypass with Turbopack + single locale（GHSA-6gpp-xcg3-4w24）／DoS in App Router Server Actions（GHSA-m99w-x7hq-7vfj。**本アプリに該当**）／SSRF in rewrites（GHSA-p9j2-gv94-2wf4）。`scripts/audit-check.mjs` の HIGH_ALLOWLIST から `next` を削除（残りは sharp / postcss に理由付きで限定）。typecheck・lint・全1185件緑・build通過・E2E 4件緑。
- 後續への注意: **残る high は2つ**。(1) `sharp 0.34.5`（`<0.35.0` 対象・libvips CVE-2026-33327/33328/35590/35591）。`image-normalize.ts` が **AI生成画像という外部由来バイナリ**を処理するため実害が最も大きい。0.35 系は breaking のため保守枠で対応（2026-07-26 に据え置き判断）。(2) `postcss 8.4.31` は **next が pin する nested 依存**（hoisted の 8.5.20 は無害）で、`next@16.2.12` も 8.4.31 を pin するため **next を上げても解消しない**。自分のCSSのみをビルド時に処理するため実害は低いと判断し、next 側の修正待ちで追跡（overrides での強制上げは未検証の組み合わせになるため見送り）。

### T-M7-11: 利用枠のrefundを失敗確定時のみに寄せる（T-M7-07の回帰修正） `done`
- 参照: 要件03 §7.1・§7.3、要件04 §4 / 依存: T-M7-07 / サイズ: S
- 完了条件:
  - retryで差し戻される失敗では枠を返還せず、次のattemptが予約を保持したまま実行できる
  - 失敗が確定したときだけ返還される（worker終端・stale終端の両方）
- メモ: T-M7-07 でretry差し戻しを入れた結果、handlerのcatch-allが「まだ失敗が確定していない失敗」でも返還してしまい、reserve冪等keyがjob単位のため次のattemptが再予約できず、**retryで成功したjobの枠が0のまま**になっていた。ローカルDBで実測して確認（attempt1 reserve=true → refund → attempt2 reserve=false → counter 0）。
- 実装結果: `refundUsage` の呼び出しを4つのhandler（post_generation／image_generation／learning_analysis／suggestion）のcatchから削除し、`worker.ts` の `failJob` へ集約（status更新と同一transaction）。kind→枠種別の対応は `terminal.ts` の `RESERVE_TYPE_BY_KIND` に置き、stale経路の `finalizeFailedJob` と同じ表を使う。**md_merge は元々handlerが返還しておらずstale経路頼みだったため、この集約で worker 失敗経路でも返還されるようになった**（副次的な修正）。BYOK・reserve未実施は `refundUsage` 側で no-op。テスト: 責務移動に合わせて5件を更新（handlerは返還しない→failJobで返還される、を両方assert）＋回帰テスト1件追加、全1186件緑・build通過・E2E 4件緑。docs: 要件03 §7.1、要件04 §4。
- 後続への注意: **D-5 の残件はこれで解消**。要件04 §4 の「reserve作成はM6のためrefundは実質no-op」という記述も古かったため更新した（reserveは5 kindで実装済み）。handlerが自己終端（canceled）してから例外を投げる経路では `failJob` の `where status='running'` が効かず status は変わらないが、refund は無条件に呼ぶため予約は解放される。

### T-M7-13: 依存監査ゲートを本番依存基準にし、フォールバックを持たせる `done`
- 参照: 要件01 §8、要決定D-7 / 依存: T-M7-10 / サイズ: M
- 完了条件:
  - registry から監査結果を取得できないときにゲートが素通りしない（取得できなければ止まる）
  - 判定対象が本番依存になり、devDependenciesだけの脆弱性でリリースが止まらない
  - `npm run release:check` が通る
- メモ: 調査で判明した点。(1) `npm audit --json` は registry エラー時も valid JSON（`{message,error}`）を返すため、旧実装は「脆弱性0件」と誤読して `OK` を出していた（critical があっても素通り）。(2) その registry エラーは **Content-Encoding を付けずに gzip 本文が返る**ことが原因で、npm/Node のバージョンとは無関係（Node 22・npm 10/11 でも同様、curl+gunzip では取得可能）。**間欠的**で、後に復旧した。
- 実装結果: `scripts/audit-check.mjs` を作り直した。(a) 監査レポートの体裁（`auditReportVersion` と `metadata.vulnerabilities.total`）を確認し、満たさなければ **bulk advisory endpoint へ直接問い合わせるフォールバック**（package-lock の本番パッケージを250件ずつPOST・gzip magicを見て自前展開）へ切り替え、それも失敗すれば exit 2。(b) 判定を `npm audit --omit=dev` の**本番依存**に変更し、dev込みの件数は参考表示に留めた（dev-onlyの脆弱性は配布されないため）。(c) allowlist を Map にして各エントリへ据え置き理由を必須化。(d) **`shadcn` を dependencies → devDependencies へ移動**（CLIツールで `src` から一切importしておらず、本番ツリーに ts-morph 等を持ち込んでいた）。結果、本番依存の high は sharp / postcss / next（postcss由来）/ brace-expansion（ビルド時のみ）の4件で、いずれも理由付きで allowlist 済み。`npm run release:check` が exit 0。テスト全1186件緑・build通過・E2E 4件緑。
- 後続への注意: フォールバック経路は npm と違い**依存元への伝播を行わない**（advisory を実際に持つパッケージだけを報告する）ため、npm 経路より件数が少なく出る。ゲート判定には十分だが、件数を突き合わせるときは注意。`brace-expansion` の到達経路は `@sentry/nextjs`→bundler-plugin と lint ツールチェーンで、実行時コードには入らない。

### T-M7-14: リリース判定ゲートをCI（GitHub Actions）で強制する `done`
- 参照: 要件01 §8、[CI](../docs/operations/ci.md) / 依存: T-M7-13 / サイズ: M
- 完了条件:
  - push / PR で `npm run release:check` 相当が自動実行される
  - CI用の環境変数を GitHub Secrets を使わずに用意できる
  - CIで防げない範囲がドキュメントに明記されている
- メモ: ゲート（REQUIRE_DB・E2E込みの release:check）は T-M6-20／T-M7-13 で整ったが、**実行するのが人間**である限り「流し忘れ」で穴が残る。2026-07-26 のX連携不具合（service_role の GRANT 漏れ）も、当時ゲートが存在していても手元で回さなければ検出されなかった。
- 実装結果: `.github/workflows/ci.yml`（job 2本）。`static`＝typecheck+lint（数十秒で失敗を返す）、`verify`＝`supabase start` → `.env.local` 生成 → service_role 権限テスト単独実行 → Playwright chromium 取得 → **`npm run release:check` をそのまま呼ぶ**（CI側に手順を書き写すと release:check への追加が反映されず穴が開くため分解しない）。`scripts/ci-env.mjs` が `.env.example` を土台に env を組み立て、Supabase接続情報は `supabase status -o env`（`SUPABASE_STATUS_ENV` でファイル指定）、`APP_ENCRYPTION_KEY`/`CRON_SECRET` は実行ごとに `randomBytes(32)` で生成、Turnstile は Cloudflare 公開テストキー、Stripe/X/AI/SMTP はダミー、Sentry DSN は**出力しない**（空文字だと `optional` ではなく「短すぎる」で env 検証に落ちる）。したがって **GitHub Secrets は不要**。`supabase start` が migration をクリーン適用するため migration 自体の適用可否も毎回検証される。併せて `playwright.config.ts` の待ち時間を `process.env.CI` で拡大（test 150s／expect 30s／webServer 240s）。2コアランナーでの初回route compile がアプリ不具合と混ざるのを防ぐ目的で、`retries` は 0 のまま。
- 後続への注意: **CIは本番デプロイをブロックしない**（`main` への push でCIとVercelのproductionビルドが並行する）。止めるには GitHub branch protection で `main` を保護し `static`/`verify` を required status check にしてPR経由マージへ切り替える必要がある（ユーザー作業。要決定へ記載）。CIは Node 26（ローカルと同じ）で走るが Vercel は自身のLTS既定でビルドするため、Nodeバージョン依存のビルド差は検出できない。ワークフロー自体は GitHub 上で未実行（push 後の初回実行で確認が必要）。

### T-M7-15: Web検索を使う生成パターンが全滅していた不具合を修正 `done`
- 参照: プロンプト設計書 §5.2、PRD P-1/P-3/P-4/P-6 / 依存: なし / サイズ: S
- 完了条件:
  - Web検索を使うパターン（P-1/P-3/P-4/P-6・URL付きP-2）の生成がproviderの400で失敗しない
  - 同じ取り違えが再発したらテストで気付ける
- メモ: 2026-07-27 に「週次まとめ（P-6）で下書き作成 → 『時間をおいて再度お試しください。設定や入力もご確認ください。』」として報告された。`generation_jobs.error` は `code=job_failed`（分類不能）で、**原因はT-M7直前に入れた `recordUnexpectedError` のログにだけ残っていた**（`[unexpected] job Error: 400 ...`）。ログを埋めていなければ画面の汎用文とDBの `job_failed` しか手掛かりが無く、追跡できなかった。
- 実装結果: `buildAnthropicParams` が組む Web Search tool に `allowed_callers: ["direct"]` を明示。`web_search_20260209` は省略時に **programmatic tool calling（コード実行からのtool呼び出し）を要求する既定**になり、非対応モデルが `invalid_request_error` で400を返す。ローカルの `ANTHROPIC_TEXT_MODEL=claude-haiku-4-5` が非対応で、**Web検索を使う全パターンが常に失敗**していた（検索を使わないP-2/P-5は無影響のため気付きにくかった）。実APIで同一リクエストを比較し `allowed_callers` なし=400／`["direct"]`=200 を確認。回帰テストは `anthropic.test.ts` に2件（tool形状の完全一致＋maxUses 1〜4で常に `direct` が付くこと）。
- 後続への注意: **この型の不具合はCI・E2E・DBテストのどれでも検出できない**（外部APIの契約違反であり、テストは全てモックしている）。同種の再発防止には実APIへ最小リクエストを投げるprovider契約テストが必要で、費用と実キーが要るためCIには入れられない。リリース前チェックリスト §1 #10（外部API「実装時に要確認」）の運用でカバーする想定。tool version を上げるときは `allowed_callers` の既定が変わり得るため実APIで再確認する。

### T-M7-16: provider契約テスト（実APIへ最小リクエスト）を追加 `done`
- 参照: プロンプト設計書 §5.1〜§5.5、[CI](../docs/operations/ci.md) §4 / 依存: T-M7-15 / サイズ: M
- 完了条件:
  - 各AI providerへ実際にリクエストを投げ、受理されることを確認できるコマンドがある
  - 既定では実行されない（CI・`npm test`・`release:check` を汚さない）
  - 本番と同じペイロード組み立てを通る
- メモ: T-M7-15（Web検索の `allowed_callers` 欠落で P-1/P-3/P-4/P-6・NEWS が常に400）は、単体1,237件・E2E 5件・CI のいずれでも検出できなかった。テストが外部APIを全てモックするため、**「送っているリクエストがAPIに受理されるか」を見る層が存在しなかった**。
- 実装結果: `src/lib/ai/provider-contract.live.test.ts` ＋ `npm run check:providers`（`PROVIDER_CHECK=1 vitest run <file>`）。**本番のファクトリ**（`createAnthropicTextGen`／`createOpenAITextGen`／`createGeminiTextGen`／`createOpenAIImageGen`／`createGeminiImageGen`）をそのまま呼び、独自にペイロードを組まない（組むと検証対象が本番の形でなくなる）。検証は「受理されること」＋requestId・usageが取れること（原価台帳の前提）に限り、モデル出力の内容は見ない。費用最小化のため max_tokens 最小・検索を誘発しない指示・画像1枚。`PROVIDER_CHECK` 未設定時は8件をskipし、代わりに「未実行」を示す1件だけが通る（0 testsで静かに緑になるのを防ぐ）。キーが無い provider は個別にskip。
- 初回実行結果（2026-07-27）: **6 passed / 2 failed**。Anthropic（Web検索・構造化出力）とOpenAI（Web検索・構造化出力・画像）は受理。**Google は2件とも失敗し、下記2件の実問題を検出した**（T-M7-17へ）。
- 後続への注意: CI・`release:check` には**入れない**（実キーをCIへ置かない方針を崩すため。ci.md §4 に明記）。provider・モデル名・tool versionを変えたときは手で実行する。テキスト6件で数円、画像2件を含めて数十円程度。

### T-M7-17: Gemini画像生成が predict エンドポイントで404になる `blocked`
- 参照: プロンプト設計書 §5.4、要件01 §3（`GEMINI_IMAGE_MODEL`） / 依存: T-M7-16 / サイズ: M
- ブロック理由: **2026-07-27 ユーザー判断「一旦Googleは不要」**。加えて運営Gemini APIキーのquotaが枯渇している（テキスト側も `429 RESOURCE_EXHAUSTED`）。修正しても実APIで検証できないため、quota回復（ユーザー作業）まで着手しない。T-M7-15と同じ「未検証のまま外部API連携を書く」ことを繰り返さないための保留。
- 完了条件:
  - 画像provider=Google の生成が404にならず、画像バイト列が取得できる
  - `npm run check:providers` のGemini画像1件が通る
- 内容: `createGeminiImageGen`（`image-client.ts:43`）が `ai.models.generateImages`（`:predict`）を呼んでいる。公式ドキュメント（2026-07-27確認）によれば **`:predict` は Imagen 専用**で、設定値の `gemini-3.1-flash-lite-image`（Nano Banana系）は **Interactions API または `generateContent`** で使う。実APIの応答は `models/gemini-3.1-flash-lite-image is not found for API version v1beta, or is not supported for predict`。プロンプト設計書 §5.4 は既に「新規実装はInteractions APIを第一候補とし、未対応の場合だけ `generateContent` へフォールバック」と定めており、**実装が正本から外れている**（docs側の修正は不要）。
- 影響: 画像providerにGoogleを選んだ場合の画像生成が常に失敗する（BYOK・プレミアム共通）。OpenAI（`gpt-image-1-mini`）は正常。既定の解決は `resolveImageProvider`（アカウント設定 `ai_purpose_config.image`）なので、Googleを選んでいる利用者だけが影響を受ける。
- 対応: `npm run check:providers` はGoogleを既定で対象外にした（`PROVIDER_CHECK_GOOGLE=1` で復帰）。常に赤いチェックは読まれなくなり他providerの退行を隠すため。
- 選択肢: (案A)`generateImages`をやめ Interactions API（未対応時 `generateContent`）へ寄せる＝§5.4どおり。推奨 / (案B)`GEMINI_IMAGE_MODEL` を Imagen系モデルに変え `generateImages` を維持（コード変更なし。ただし§5.4の方針と、Nano Banana推奨という公式の案内から外れる）。

### T-M7-18: E2Eシナリオの拡充（5→13件） `done`
- 参照: 要件06 全般、[CI](../docs/operations/ci.md) §4 / 依存: T-M7-05 / サイズ: L
- 完了条件:
  - 未カバーだった主要フローにE2Eがあり、全件緑
  - AI・X・課金の実通信をE2Eで起こさない（費用と不確定性を持ち込まない）
  - 実行後に作成データが残らない
- メモ: T-M7-05 で基盤は入ったが4ファイル5件どまりで、**画面のサインアップとメール確認は一度も通っていなかった**（既存fixtureはSupabase Admin APIで確認済みユーザーを直接作るため）。ニュース・分析・投稿生成の表示契約も未検証だった。
- 実装結果: 4ファイル8件を追加し 13件（8ファイル）へ。
  - `auth.spec.ts` 2件: 画面のサインアップ→**Mailpitで確認メールを受信**→`/auth/confirm` を踏む→`email_confirmed_at` と同意バージョンの記録→cookie破棄→ログインフォームで再入場→**未契約は `/plans` で止まる**（`/app` 直打ちも戻される）。未登録メールでのログイン失敗時にアカウントの存在を教えないこと（列挙対策）も確認。
  - `news.spec.ts` 2件: `news_items` をseedし、SC-06一覧が既定（全分野・high+mid）で絞られること・分野トグル＋「この条件で表示して保存」で追従し `news_config` に保存されること、ホームの重要ニュースが**high固定・新しい順・最大3件**であること（4件目とmidが出ない）。
  - `analytics.spec.ts` 2件: 直近3件が1日のみ・古い1件が30日まで持つ状態で**既定が「投稿後1日」**になること（T-M7-04の仕様。「取得済みの最長」だと直近が空表に見える退行）、本文冒頭で対象を識別できること、実績なしの空状態。
  - `generation.spec.ts` 2件: `generation_jobs` をseedして進行中は「生成中…」でdisabled、失敗時に**保存された理由が汎用文の代わりに出る**こと（T-M7-02）、前提不足コードでは「再試行する」を出さず解決先へ送ること、分類不能な失敗では再試行を出すこと。
  - 共通: `fixtures/test.ts` に `alertIn(page)` を追加（Next.js の route announcer も `role="alert"` を持つため素の `getByRole("alert")` は必ず strict mode 違反になる）。`fixtures/account.ts` に `destroyUserByEmail`（画面のサインアップで作られた利用者は `accounts` fixture の後片付け対象外）。
- 実行結果: 13件緑（47.9s）。実行後の残データ0件（e2eユーザー0・news_items 0・e2e x_accounts 0）。実アカウント（no.1013kota@gmail.com）とその失敗job 3件は対象外として保持。
- 後続への注意: **「生成する」ボタンは押さない**方針にした（実AI呼び出しで費用・不確定性・1分待ちが入るため）。生成のリクエスト形状は `npm run check:providers`（T-M7-16）が担当し、E2Eは表示契約だけを見る。未カバーは**課金（Stripe）・学習ソース・ベースmd編集・パスワード再設定**。課金はcheckout/portalが外部サービスへ実際にセッションを作るため、E2Eに入れるなら `maxRedirects: 0` で遷移先だけを見る形（`x-oauth.spec.ts` と同じ）にする。

### T-M7-19: ログアウトのUIが存在しない（PRD A-2 Must） `done`
- 参照: PRD A-2、要件03 §1（「ログアウト＝Supabase sessionを破棄し `/login` へ遷移」） / 依存: なし / サイズ: S
- 完了条件:
  - 画面からログアウトでき、session破棄後に `/login` へ遷移する
  - E2Eでログアウトを検証する（`auth.spec.ts` は現在 cookie破棄で代用している）
- メモ: 2026-07-27 のE2E拡充中に発見。Server Action `signOut`（`src/app/actions/auth.ts:318`）は実装済みだが、**呼び出す UI が1つも無い**（`rg signOut src/` の結果が actions とそのテストだけ）。ナビゲーション（`navigation-items.ts`）はホーム/ニュース/投稿/スケジュール/分析/AI設定のみで、設定画面にもログアウトが無い。PRDで Must の機能が画面から到達できない状態。
- 実装結果: `src/components/app-shell/sign-out-button.tsx`（client・`useTransition` で押下中は disabled）を **App Shell のヘッダー**（全 `/app` 画面共通）と **`/plans`** の2箇所に置いた。`/plans` にも置いたのは、未契約の利用者が `routeGuardDestination` で `/plans` に留められ、`isLimitedSettingsRoute`（`?tab=billing|support`）以外の App 画面へ入れないため。ここにログアウトが無いと**サインアップ直後の利用者が抜け出せない**（実際にE2Eで確認）。遷移先の判断は持たず、`signOut` の `redirect("/login")` に委ねる。
- 検証: E2E +2件（`/plans` からのログアウトで `/login` へ抜け、以後 `/app` に戻れない／アプリ内の任意画面のヘッダーから抜けられる）。`auth.spec.ts` の cookie 破棄による代用を実操作へ置換。実ブラウザで 1440/768/390 を確認（横あふれ0・focus outline 2px・コンソールエラー0）。
- 副次修正: ログアウト追加でヘッダーが 390px 幅を 23px あふれた。Xアカウント切替チップのハンドル表示幅を `max-w-36` → `max-w-20 sm:max-w-36` に変更して解消（**長いハンドルなら追加前からあふれ得た潜在的な問題**）。併せてアイコンのみ表示時の操作領域を 36px→40px にした（要件06 §2「最低40px」。隣接する「アカウント設定」も同じ36pxだったので揃えた）。

### T-M7-20: Web検索を使う生成のJSON検証が前置き文で落ちる／引用タグが本文に混入する `done`
- 参照: プロンプト設計書 §7.1・§7.2、§2 原則5 / 依存: T-M7-15 / サイズ: M
- 完了条件:
  - Web検索を使うパターン（P-1/P-3/P-4/P-6）が下書き作成まで通る
  - 生成された本文にproviderのマークアップが残らない
  - 実測した応答形をそのまま回帰テストにする
- メモ: T-M7-15（`allowed_callers`）でAPIには届くようになったが、今度は**全パターンが「生成結果を検証できませんでした」で失敗**した。一時デバッグログで実際の応答を捕まえたところ、**JSON自体は正しく、前置き文が付いているだけ**だった。
  - 1回目: `news_digestが空のため、Web検索で…（前置き）` ＋ ` ```json {...} ``` ` → フェンスが文字列全体を包まないため `stripCodeFence` が効かない
  - 2回目（修復指示付き）: `Web検索で直近7日間の…調査します。` ＋ 素の `{...}` → フェンスは消えたが前置きが残る
  Web検索（server tool）を使うとproviderは検索の前置きを必ず付ける。プロンプトの指示（`REPAIR_INSTRUCTION`）では消えないため、コード側の抽出で吸収する判断にした（§2 原則5「出力形式は仕組みで保証する」）。
- 実装結果: (1) `parse.ts` の候補を「生テキスト → 全体フェンス除去 → テキスト中のフェンスブロック → 釣り合った括弧の切り出し」へ拡張。括弧の深さは**文字列リテラルとエスケープの外だけ**で数えるので、本文に `{` `}` `"` が含まれても壊れない。配列トップレベルにも対応。(2) `gen-output.ts` に `stripProviderMarkup` を追加し `genOutputSchema` の検証時点で適用。Anthropicが `<cite index="8-1">…</cite>` を**JSON文字列の中に**書いて返し（実測で4組混入）、そのままだとXへタグが投稿され `weighted_length` もタグ込みで狂うため。落とすのは引用タグだけ（本文中の `<` は残す）。
- 検証: 実APIでP-6を生成し **succeeded（provider call 1回・7ポストの下書き作成・修復callなし）** を確認。テスト+14（実測した2つの応答形・括弧入り本文・後書き・配列・誤検出しないこと・cite除去と文字数の整合）。全1,249件緑。
- 後続への注意: 修正前に生成された下書き `757b996e`（P-6・7ポスト）は **`<cite>` タグが本文に残ったまま**DBにある。表示・投稿する前に再生成するか手で消すこと。今回のような「実APIは通るがアプリの後段で落ちる」型は `npm run check:providers`（T-M7-16）では検出できない。契約テストは受理可否だけを見て、応答の形は見ないため。**Web検索を使う生成の実行確認は手動で1回通す**必要がある。

### T-M7-21: 画像生成が structured output のschema不備で必ず失敗する `done`
- 参照: プロンプト設計書 §5.1・§6.8、要件06 §3 / 依存: T-M7-16 / サイズ: S
- 完了条件:
  - 「画像を生成する」で下書きに画像が付く
  - 同じschema不備を契約テストで検出できる
- メモ: 「画像なし（生成失敗）」の報告。`generation_jobs.error.provider_raw_error` に原因がそのまま残っていた（T-M7-09 の失敗call記録が効いた）: `400 invalid_request_error: output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false`。画像そのものではなく **前段のPT-IMG（画像プロンプト生成・structured output）** が落ちていた。
- 実装結果: `image-generation.ts` のインラインJSON Schemaを `IMAGE_PROMPT_JSON_SCHEMA` として切り出し、`additionalProperties: false` を明示。あわせて `aspect` も `required` に入れた（OpenAIのstrictモードは全プロパティのrequiredを要求するため。想定外の値は `toAspectRatio` が 16:9 へ倒すので実害なし）。実APIで修正前=400／修正後=200 を確認。
- 検証: 実APIで P-2＋画像ありを実行し、子 image job が **succeeded**・`drafts.images[0].status=ready`（openai / image/png / 2.6MB / Storage保存済み）を確認。
- 後続への注意: **契約テスト（T-M7-16）がこれを見逃した**。テスト側が独自の最小schema（`TINY_SCHEMA`。たまたま `additionalProperties: false` を持っていた）を使っており、「本番のペイロードを送る」という自分で決めた原則を schema について破っていた。`PRODUCTION_SCHEMAS` として **本番が実際に送るschemaを import して回す**形へ変更済み。今後 structured output を使う実行を足したら、このマップへ追加すること。

### T-M7-22: 生成画像プレビューがCSPで表示できない（ローカル） `done`
- 参照: 要件01 §8（CSP）、要件06 §6 / 依存: なし / サイズ: S
- 完了条件: 下書き画面で生成画像が表示され、コンソールエラーが出ない
- メモ: 署名URL自体は正常（sign API 200・画像GET 200・2.6MB）で、**ブラウザのCSPが弾いていた**。`img-src 'self' data: blob: https:` に対しローカルSupabaseは `http://127.0.0.1:54321` で **http かつ別オリジン**のため不一致。本番は `https://<ref>.supabase.co` で `https:` に含まれるため表示される＝**ローカルでだけ必ず壊れる**種類の不具合で、テストもE2Eも画像描画を見ていなかった。
- 実装結果: `security-headers.ts` に `supabaseOrigin()` を追加し、`NEXT_PUBLIC_SUPABASE_URL` のオリジンを `img-src` へ明示（本番では `https:` と重複するが害はなく、将来 `https:` を外す下地にもなる）。不正・未設定のURLではCSPへ何も足さない。テスト+4。
- 検証: 実ブラウザで修正前=`naturalWidth 0`／CSP違反エラー4件、修正後=`1536x1024` が `287x192` で描画・エラー0・横あふれ0（1440/390）。

### T-M7-23: development から実SMTPへ通知メールが送信される `done`
- 参照: 要件04 §14、要件01 §8 / 依存: なし / サイズ: S
- 完了条件: production 以外の環境から外部SMTPへ実送信しない
- メモ: **2026-07-27、動作確認で `scheduler_tick` を実行したところ、溜まっていた queued 通知98通が実際にGmailから送信された**（宛先は本人 `no.1013kota@gmail.com` のみ。第三者への送信なし）。`.env.local` に実Gmailの App Password が入っており、コード側に環境ガードが無かった。`local-development.md` には「SMTP_USER/SMTP_APP_PASSWORD を空にする」という**手動の**回避策しか無く、忘れれば必ず再発する。
- 実装結果: 純粋関数 `canSendViaSmtp({appEnv, host})` を `notification-email.ts` に追加し、`buildTransport` が false なら transport を作らず警告して skip する。`production` は従来どおり、それ以外は**ループバック宛（Mailpit等）だけ**を許す。テスト+3。
- 検証: 同じ tick を再実行し `emailsRecovered: {processed:49, sent:0}`＋警告ログを確認（送信済みは98件のまま増えない）。
- 後続への注意: **queued が49件残っている**。production で初めて tick が回ると一括送信されるため、本番移行前に古い通知を `not_requested` にするか掃除するか決めること（要決定 D-9）。ローカルで中身を見たい場合は `[local_smtp]` の `smtp_port` を有効化して Mailpit へ向ける（手順は local-development.md）。

### T-M7-24: web3分野のニュースが常に0件（item検証で応答全体を破棄していた） `done`
- 参照: プロンプト設計書 §6.10・§7.2、要件04 §6 / 依存: T-M7-20 / サイズ: M
- 完了条件: 6分野すべてが `ok` で完了し、規定外のitemがあっても分野ごと落ちない
- メモ: 2026-07-27 の実行で web3 だけ `ok:false`（`InvalidProviderOutputError`）。web3分野だけを実APIで再現して応答を捕まえたところ、**JSONは妥当で、英語ソース由来の長さが上限に抵触**していた: `title` 38/47/56/54字（上限30）・`summary` 293/253/269/210字（上限120）で**4件すべてがzodで弾かれ、配列全体＝応答全体が破棄**。続く修復callは `{"items":[]}` を返すため、**その分野は常に0件**になっていた（0件と失敗が区別できず、長期間気付けない形）。
- 実装結果: (1) 検証を**器と要素で分離**。`runTextGeneration` へ渡すのは `newsEnvelopeSchema`（配列であることと最大件数のみ）にし、要素は `pickValidItems` が1件ずつ `newsItemSchema` で選別する。落とした件数は `console.warn` に残す（「0件」と「全部落とした」を区別するため）。JSONとして壊れている場合は従来どおり修復call→例外。(2) 根本側として SYS-NEWS に「titleとsummaryは必ず日本語で書く（英語記事も日本語へ要約する）／字数に必ず収める」を明示。プロンプトは設計書 §6.10 が正本なので同時更新し、ドリフト検知スナップショットも更新した。
- 検証: 実APIで6分野を再実行し **全分野 ok・6件保存**（investment 3・business 2・business_ops 1）。ai分野で規定外4件を除外した警告が出たが分野は成功。保存されたtitleは15〜28字・summaryは43〜109字で全て規定内。テスト+5（選別4・壊れたJSONの従来挙動1）、既存の「1件でも規定外なら例外」テストは新しい契約へ書き換え。
- 後続への注意: 除外は `console.warn` だけなので、恒常的に落ち続けても運用で気付きにくい。件数を `cron_runs` か原価台帳に残すかは別途検討（要決定には上げていない小さな改善）。

### T-M7-25: 実物スモーク（`smoke:live` ＋ 手動カナリア）を追加 `done`
- 参照: CLAUDE.md「変更影響 → 必須の検証」、要決定D-10/D-11 / 依存: T-M7-16 / サイズ: M
- 完了条件:
  - 実APIで生成・画像・ニュースを1周し、**成果物**（下書き・画像・item）まで検証できる
  - 開発時（ローカル）とデプロイ先で**同じ判定**を使える
  - 2026-07-28 に手動でしか見つからなかった不具合が、この層で検出されることを実証する
- メモ: 単体・E2Eは外部境界をモックするため「送ったものが受理されるか／返ったものを扱えるか」を見ない。`check:providers` は前者だけを見る。**後者を見る層が無かった**ため、T-M7-20（前置き文でJSON検証が落ちる）とT-M7-24（字数上限で全件破棄され0件）は利用者の手動操作でしか見つからなかった。
- 実装結果: 判定を `src/lib/smoke/scenarios.ts` に集約し、トリガーを2つ用意した。(1) `npm run smoke:live`（`scripts/smoke-live.mjs` が起動中アプリの route を叩く。`--account` で生成系を含める・`--base` でデプロイ先も検査） (2) `GET /api/cron/canary`（CRON_SECRET認証。**cronへは登録しない＝手動起動のみ**）。同じ route を使うので、ローカルとデプロイ先で判定がずれない。シナリオは3つ: **生成（Web検索あり・P-6）**＝下書き到達＋`findProviderMarkup` で `<cite>`・コードフェンスの混入を検出、**生成＋画像（P-2）**＝子jobを待ち合わせて `images[0].status=ready` とバイト数、**ニュース（ai分野）**＝`newsOutcome` で「0件かつ除外あり＝全滅」を失敗、「0件で除外も0＝該当なし」を成功として区別。作成したjob・draftはシナリオ側で必ず削除する。あわせて `researchNews` が `dropped` と `dropReasons` を返すようにし（`formatDropReasons`）、0件の理由を説明できるようにした。
- 検証: **意図的に T-M7-15（`allowed_callers`除去）と T-M7-21（`additionalProperties`除去）を再現したところ、3シナリオすべてが失敗を検出**（400は課金されないため合計$0.0114・10秒）。復元後は生成・画像が成功。テスト+6（`findProviderMarkup` 3・`newsOutcome` 3）。
- 実測コスト: 1周 約$0.30（検索あり生成$0.13／画像$0.008／ニュース$0.16）、40〜90秒。
- **未解決の実検出**: `ai` 分野のニュースが2回連続で全滅した（5件すべて `summary:too_big`＝120字超）。タイトルは規定内なのでT-M7-24のプロンプト修正は効いているが、**要約の120字上限をモデルが安定して守れない**。要決定 D-12。
- 後続への注意: 生成枠を消費する（1周で生成2回）。カナリアを定期実行に変えるときは `vercel.json` に crons を足し、**専用の検証用Xアカウント**を対象にすること（実利用者のアカウントで回すと下書きと枠を汚す）。


### T-M7-26: E2Eの未カバー領域を埋める（課金・学習ソース・ベースmd編集・パスワード再設定） `done`
- 参照: 要件06 SC-10/SC-11、[CI](../docs/operations/ci.md) §4 / 依存: T-M7-18 / サイズ: L
- 完了条件:
  - 課金（プラン選択→checkout導線）・学習ソース追加削除・ベースmd編集・パスワード再設定の主要フローにE2Eがある
  - ~~**生成画像プレビューを実データで描画するspecがある**（`naturalWidth > 0` を確認する）~~ → **2026-07-31 完了**（`e2e/draft-image.spec.ts` 2件）
  - 外部サービスへ実際のセッションを作らずに検証する（遷移先の検査で足りる範囲に留める）
- 実装結果（2026-07-31・完了）: 4領域すべてを実装し、**E2Eは13ファイル27件**になった。ベースmd編集と学習ソースは `e2e/ai-settings.spec.ts` 3件（保存でversionが上がり履歴に残る／見出し構造が壊れた内容は保存されず何を直すか分かる／学習ソースを追加すると分析待ちで並び削除できる。LRNの分析は実APIを叩くためpendingまでに留める）。課金は `e2e/plans.spec.ts` 3件（未契約はプラン選択と申込前の確認が見える／契約中は `/plans` に留まらず設定で契約状態が読める／`canceled` は**閲覧はできるが実行できない**）。**決済ボタンは押さない**（Stripeへ実セッションを作るため。ボタンの先は `route.db.test.ts` 7本43件がSDKモックで検証済み）。
  **この過程で2件目の本物の不具合を発見・修正した**（T-M7-36。スマホ幅で `/plans` がページ全体を183px横スクロールさせていた）。あわせて主要13画面の横あふれを見張る `e2e/mobile-layout.spec.ts` 2件を追加した。
- 進捗（2026-07-31）: パスワード再設定を実装（`e2e/password-reset.spec.ts` 3件）。申請→Mailpitのリンク→新パスワード設定→新パスワードでログイン→**旧パスワードでは入れない**まで通す。未登録メールでも「受け付けた」表示になり利用者が作られないこと（列挙対策）も固定。Mailpitヘルパー（`waitForMail`／`confirmUrlFromMail`）は `auth.spec.ts` から `fixtures/test.ts` へ移して共有した。
  **この過程で本物の不具合を発見・修正した**（下記メモ）。
- 進捗（2026-07-31）: **画像描画を先に実装した**（`e2e/draft-image.spec.ts`・E2Eは9ファイル16件へ）。`uploadTestImage`／`deleteTestImage` を fixture に追加し、**sharpで実物の16:9 PNGを作ってprivate Storageへ置き**、署名URL経由でブラウザが読み込めたこと（`naturalWidth > 0`・横あふれ0・コンソールエラー0）をdesktop/mobileの両幅で検証する。画像生成失敗時に「画像なし（生成失敗）」がバッジとプレースホルダの2箇所へ出て本文は読めることも固定した。**検出力を実測**: CSPから `supabaseOrigin()` を外すと `naturalWidth=0` で落ちることを確認（T-M7-22 の再現）。残りは課金・学習ソース・ベースmd編集・パスワード再設定。
- メモ: 当初のE2Eは8ファイル14件で、認証・ホーム・投稿・スケジュール・ニュース・分析・X連携入口を覆う。上記4領域が未カバー（`ci.md` §4 に明記済み）。課金は checkout/portal が Stripe へ実際にセッションを作るため、`x-oauth.spec.ts` と同じ `maxRedirects: 0` で**遷移先だけを見る**形にする。パスワード再設定はMailpitからリンクを取る（`auth.spec.ts` と同じ方式が使える）。

### T-M7-37: 日本のXで不利になっているプロンプト仕様を直す `done`
- 参照: プロンプト設計書 §6.1〜6.7、要件06 §9 / 依存: なし / サイズ: M
- 完了条件:
  - **本文にURLを必須で入れる構成をやめる**（P1・P4・P6の「最終ポスト＝まとめ＋出典URL」）。出典は独立した最終ポストへ分け、本文側は完結させる
  - SYS-GEN に**改行の指示**を入れる（1行20〜26字・2〜4行で1塊・塊の間に空行）。現状は文字数上限しか無くベタ打ちが出る
  - **スレッドを短くする**（P1: 4〜6→2〜4／P4: 3〜5→1〜2／P6: 5〜7→1ポスト目に3件凝縮）
  - **ハッシュタグ規定**を明記（使わない、多くても1個）
  - **フックの型を列挙**して1つ選ばせる（意外な数字／常識の否定／自分の失敗／損失回避／対比／読者の名指し）
  - P2に「賛否が分かれる立場を明示」、P3に「手順3〜5個で完結」を追加
  - 正本（プロンプト設計書 §6）とコード定数・スナップショットを同時に更新する
  - `npm run smoke:live` で実物を1周させ、生成物を目で確認する（約45円）
- 実装結果（2026-08-01）:
  - **共通ルール（SYS-GEN）**: URLは本文へ書かない（出典は `sources` 配列へ）／各ポスト60〜120字／1行20〜26字・2〜4行で1塊・塊の間は空行／ハッシュタグは使わない／1ポスト目は単独で読まれる前提＋**フックの型6つから1つ選ぶ**。
  - **型プロンプト**: P-1「全体2〜4ポスト・1ポスト目で要点が伝わる」／P-4「全体1〜2ポスト・速さが価値」／P-6「1ポスト目に重要3件を箇条書きで凝縮・全体3〜5ポスト」／P-2「賛否が分かれ得る立場をはっきり取る」／P-3「手順は3〜5個で完結」。**「最終ポスト=まとめ＋出典URL」を全廃**。
  - **出典の扱いを実装に合わせて訂正した**: アプリは出典を本文ではなく `sources`（`generation-validation.ts` が SSRF 検証して最終ポストの構造化フィールドへ保存）で持ち、投稿本文には付けない。当初「出典: URL だけのポストを置く」と書いたが、それでは本文にURLが入り逆効果になるため、`sources` へ入れる指示に直した。
  - **正本の同期を機械化**: プロンプト設計書 §6 のコードブロックをコード定数から再生成する（手で写さないので乖離しない）。
- 併せて直した2件:
  - **プロンプトを直しても反映されない状態**（原則3違反）: 解決順は「account上書き → system default行 → コード定数」で、DB行が古いままだとコード変更が効かない。`seedSystemPromptTemplates` は**テストからしか呼ばれていなかった**。差分があるときだけ更新する形にして `scheduler_tick` から毎回呼ぶようにした（実測: 行を古い内容へ戻して tick を叩くと `promptsSynced=1` で復旧）。
  - **スモークで生成物が見えない**: シナリオは作った下書きを削除するため、`npm run smoke:live` の報告に**先頭2ポストの本文と形の計測**（字数／改行塊／タグ／URL）を出すようにした。これが無いと「実物を1周させて成果物を目で確認する」が実行できない（実際、最初の確認で古いデータを見てしまった）。
- 検証（2026-08-01）: 単体+11件（規約6・スモークの計測3・seedの差分同期2）。`check:providers` 5件緑。**`npm run smoke:live` を実物で3回**（合計 $1.01）。最終の実測: 全シナリオ成功・87秒・$0.34。1ポスト目は「【重要3件】①…②…③…」の箇条書き凝縮＋**改行塊2〜3**、URL0・ハッシュタグ0。release:check 完全通過。
- 後続への注意: **字数（60〜120字）とポスト数は指示では守られない**（実測140字・P-6が6ポスト）。仕組みでの保証は T-M7-41 へ分離した。
- メモ: 2026-07-31 の分析で判明。**Xは外部リンクを含む投稿の露出を抑える傾向があるのに、現行プロンプトはURLを必須にしている**（自分から不利を選んでいる）。文言の磨き込み（禁止表現リスト・「〜と見られます」の多用制限・文字数の目標帯・出力前の自己チェック）は効果が読みにくいため別タスクに分ける。

### T-M7-41: 字数の目標帯とポスト数の上限を仕組みで保証する `done`
- 参照: プロンプト設計書 §2 原則5・§6・§7、要件04 §10 / 依存: T-M7-37 / サイズ: M
- 完了条件:
  - 1ポストの字数が目標帯（60〜120字）を大きく超えたときに、加重280以内であっても短縮または再生成が働く
  - パターン別のポスト数上限（P-1: 4／P-4: 2／P-6: 5）を検証し、超過は修復callまたは切り詰めで収める
  - どちらも「指示」ではなく検証で担保する（プロンプト文言の変更だけで済ませない）
- 実装結果（2026-08-01）:
  - **字数の目標帯**: `TARGET_WEIGHTED_LENGTH = 240`（加重＝約120字）を追加し、280以内でも目標を超えたポストは**PT-FIXで1回だけ**縮める。短縮結果が加重100未満まで削られたら**元の本文を採る**（意味が壊れる方が害が大きい）。目標を超えたままなら警告 `length_over_target` を付けるが**自動投稿は止めない**（品質目標であって契約ではない）。目標内のポストには短縮を呼ばない（無駄な費用を出さない）。
  - **ポスト数の上限**: `GENERATION_MAX_POSTS`（P-1=4／P-2=1／P-3=6／P-4=2／P-5=3／P-6=5）を追加し、`finalizeThread` で収める。超過分は**先頭 max-1 件＋最後の1件**を残す（スレッドの締めが消えると読み手が宙ぶらりんになる）。落としたことは警告 `post_count_trimmed` で示す。こちらも自動投稿は止めない。
  - **既存の `PATTERN_MAX_POSTS` とは別概念**にした。あちらは「編集で許す上限」と「日次枠の見積り」で、下げると既存の下書きが編集不能になり枠の見積りも小さくなる。生成時の上限は常にそれ以下であることをテストで固定した。
  - **スモークの計測に加重文字数を追加**（字数だけでは上限との関係が読めない）。
- 検証（2026-08-01）: 単体+14件（上限8・目標帯6）。release:check 完全通過（1,344件・E2E 28件）。**実物1周**（$0.30・117秒・全シナリオ成功）で 1ポスト目が90字（前回は139〜140字）・P-6が5ポスト（前回は6）になった。P-2の費用が $0.0105 → $0.0133 に増えたのは短縮callが1回入ったため。
- 後続への注意: プロンプト§6の分量指示を変えたら、プロンプト設計書 §7-5 と `GENERATION_MAX_POSTS` も合わせる（片方だけ変えると乖離する）。
- メモ: T-M7-37 で規約をプロンプトへ入れたが、**2026-07-31の実測（`npm run smoke:live` 2回）で字数とポスト数は守られなかった**（1ポスト目が139〜140字・P-6が6ポスト。目標は60〜120字・3〜5ポスト）。URL・ハッシュタグ・改行・箇条書きの凝縮は守られた。`PT-FIX` は加重280超過のときだけ短縮するため、140字は素通りする。「出力形式は指示ではなく仕組みで保証する」（§2 原則5）に従って埋める。切り詰めは意味を壊すので、まず修復call、それでも駄目なら編集必須マークで下書き化する案を推奨。

### T-M7-38: 改善提案の分析軸に文字数・改行・画像・URLを加える `done`
- 参照: プロンプト設計書 §6.15（PT-SUGGEST）、要件02（分析データ）/ 依存: なし / サイズ: M
- 完了条件:
  - `<stats>` に「文字数帯・改行数・画像の有無・URLの有無」別の実績集計が入る（現状は**型×時間帯だけ**）
  - 集計はコード側で行い、プロンプトへは集計済みで渡す（現行設計を踏襲）
  - 提案の `evidence` にどの軸で差が出たかが残る
- 実装結果（2026-08-01）:
  - `buildSuggestionInput` に軸別集計を追加（`axes.length` / `line_blocks` / `image` / `url`）。**軸ごとに独立集計**する（多次元セルにすると最大50件では大半がcount=1になり判断材料にならない）。従来の型×時間帯（`stats`）はそのまま残す。
  - 文字数の帯は **加重240（生成時の目標・T-M7-41）を境界**にした（短〜160／中161〜240／長241〜）。これで「目標内に収めた投稿は伸びたか」を実績で確認できる。
  - 形の計測は**本文全体**で行う（`posts[].body` は表示用に100字で切るため、切り詰め後を測ると誤る）。画像は下書き単位に付くのでその下書きの全ポストを「画像あり」として数える。
  - PT-SUGGEST に軸の説明と `evidence.axis` を追加し、出力schemaで `axis` を必須にした（どの軸を根拠にしたか後から辿れる）。
  - 画面（SC-09）に軸を**日本語表記**で出す（型と時間帯／投稿の長さ／改行の入れ方／画像の有無／本文のURL）。内部キーは出さない（要件06 §8）。古い提案は軸が無いので省略する。
- 検証（2026-08-01）: 単体+6件（軸の集計・境界・全文計測）＋**E2E 1件を新設**（`e2e/suggestions.spec.ts`。提案をseedして画面に日本語の軸が出て内部キーが出ないことを確認）。`check:providers` 5件緑。release:check 完全通過（1,350件・E2E 29件）。
- 後続への注意: 効果の確認には**実績データが必要**（同一計測時点で3件以上・差20%以上）。運営者の投稿が溜まってから `/app/analytics` の「提案を更新」で確かめる。生成時の目標（加重240）を変えたら `lengthBucket` の境界も合わせる。
- メモ: 伸びを左右する主要な変数が分析対象に入っていないため、T-M7-37 の変更が効いたかを**実績で検証できない**。プロンプト文言の推測を減らす意味でこちらの方が確実。

### T-M7-39: 学習ソース分析が失敗したまま原因が追えず、30日間再実行もできない `done`
- 参照: 要件05 §8、要件04 §14、CLAUDE.md 原則1・2 / 依存: なし / サイズ: M
- 完了条件:
  - 失敗時に**何が起きたかが `generation_jobs.error` に残る**（provider の生応答か、どの段でどう落ちたか）
  - **失敗した取り込みは30日ゲートの対象外**にする（成功した取り込みだけを数える）
  - 画面から再実行でき、行き止まりにならない
- 実装結果（2026-07-31）:
  - **原因を残す**: `persistFailure` に `stage`（`research`=X読取・素材組み立て／`writing`=分析call以降）と `provider_raw_error`（生の文面・2,000字で切る）を追加。生成job・画像jobと同じ扱いに揃えた（画面には出さない）。
  - **30日ゲートを成功だけで数える**: `ownPostsReimportEligibility` と `reimportOwnPosts` のゲートに `status = 'succeeded'` を追加。既に `refreshSuggestions` が「失敗ジョブは再試行を許す」規則（要件04 §12）なので、それに揃えた形。
  - **二重送信の穴を塞ぐ**: ゲートが偶然防いでいた二重送信を `assertNotBusy(includeQueuedJobs: true)` で止める（`job_conflict`。待てば解消するので行き止まりにならない）。
  - **画面**: 失敗表示に「上の『再取り込み』からやり直せます」を出し、30日制御の説明を「成功した取り込みから」と明記。
- 検証（2026-07-31）: 単体3件（stage=writing／research／2,000字で切る）＋DB統合2件（成功直後は拒否／失敗直後は許可）＋E2E1件（失敗状態でボタンが押せて案内が出る）を追加。**修正前に落ちることを実測**（DB統合の「失敗した取り込みの直後はすぐやり直せる」が1件失敗）。運営者の実データでも判定が **2026-08-25まで不可 → 今すぐ可能** に変わることを確認した。
- 未検証（理由）: 実際に分析jobを1周させて `provider_raw_error` が実データで入るところまでは**未確認**。実行には運営者のログイン操作（AI設定→再取り込み）が必要で、エージェントから権限チェックを迂回してjobを差し込むことは避けた。修正により画面から実行できる状態になっている。
- メモ: 2026-07-31 に確認。運営者の `own_posts` 学習ソースが **2026-07-26 から failed のまま**で、`analysis_summary` が無い（この機能は一度も成功していない）。`error` は `{code: analysis_failed, stage: writing}` だけで `provider_raw_error` が無く**原因が辿れない**。さらに30日ゲート（`src/lib/learning-sources.ts` の `too_soon`）は job の status を問わず `created_at` を数えるため、**失敗しても2026-08-25まで再実行できない**。原因調査には再実行が必要なので、ゲートの修正が先。

### T-M7-40: ニュース取得の「0件」の意味と、期間外記事の混入を直す `done`
- 参照: 要件04 §6、プロンプト設計書 §6.10、CLAUDE.md 原則1 / 依存: なし / サイズ: S
- 完了条件:
  - cronの応答と運営者向けサマリで「**該当なし**（0件・除外0）」と「**全件破棄**（0件・除外あり）」が区別できる（`dropped`・`dropReasons` を応答へ載せる）
  - 指定期間より古い記事を**コード側で落とす**（プロンプトの「直近{{hours}}時間」という指示だけに頼らない）
  - **未来の日時を弾く（またはfetched_atへ寄せる）**。ホームの重要ニュースは `coalesce(published_at, fetched_at)` の降順で上位3件しか出さないため、未来日時の記事が入ると**そこに居座り続ける**
- 実装結果（2026-07-31）:
  - **結果を残す表を追加**（migration `20260731000001_news_fetch_outcomes`・要件02 §3.19）。分野ごとに ok/fetched/saved/dropped/future_adjusted/drop_reasons を `unique (window_key, category)` で記録し、同じ窓の再実行は上書きする。`cron_runs` は受付専用なので責務を分けた（ADR-0003）。service_roleのみ（既定権限で自動付与・実測確認済み）。`ran_at` から40日で `scheduler_tick` が掃除する。
  - **応答で区別できる**: `categories[].dropped`／`dropReasons` と、0件分野の内訳 `emptyCategories`（`no_match`／`all_dropped`／`failed`）を返す。判定は純関数 `emptyReasonOf`。
  - **doctor で区別できる**: 「全件破棄された分野: ai（title:too_big×2, published_at:too_old×2）／該当ニュースが無かった分野: web3・business_ops・sns」と出す。全件破棄は取得件数があっても注意として上げる（分野が永久に0件になるのを見逃さないため）。
  - **新しさをコードで検証**（`applyRecencyPolicy`）: 未来日時（時計ずれ5分は許容）は `published_at` を落として item は残し並び順を `fetched_at` へ寄せる／取得窓＋24時間より古い item は捨てて `published_at:too_old` を残す。24時間の余裕は日付だけの記事・更新記事を落とさないため。
- 検証（2026-07-31）: 単体+17件（新しさの選別7・0件の区別4・診断5・cleanup形1）。**実物のcronを1回実行**（実費 $0.97・6分野）し、`ai` で `title:too_big×2 + published_at:too_old×2`＝全件破棄、`web3`/`business_ops`/`sns` は該当なし、`investment` 3件保存を記録できることを確認。`doctor` の表示も実データで確認した。release:check 完全通過（単体+DB 1,320件・E2E 28件・終了コード0）。
- 後続への注意: 今回の実行で **`title:too_big` がまだ2件を落としている**（30字上限）。タイトル長はプロンプト側の課題で T-M7-37 の範囲。`smoke:live` は生成・画像へ差分が及ばないため未実行（ニュース経路は実cronで1周させた）。
- メモ: 2026-07-31 の実行（10件保存）で web3・sns が0件だったが、**応答からは該当なしか全件破棄か分からない**（除外理由は `console.warn` にしか出ない＝T-M7-24 と同じ型の見えなさ）。また3時間窓の指示に対し `business_ops` に **2026-04-01**、`ai` に 07-27 の記事が入った。さらに **1時間先の日時（2026-07-31 15:30、実行時刻は14:30）** の記事が保存され、ホームの重要ニュースの最上位に居座った。これは T-M7-39 の作業中に `news.spec.ts` が落ちたことで発覚した（テスト側は既存の全行より新しい時刻でseedするよう修正済み）。「プロンプトで頼んだことは守られない前提で組む」（開発とテストの進め方 §12）に反している。

### T-M7-36: スマホ幅でプラン選択画面が横スクロールする不具合を修正 `done`
- 参照: 要件06 SC-04 / 依存: なし / サイズ: S
- 完了条件:
  - 390px幅で `/plans` のページ全体が横に伸びない（比較表の中だけが横スクロールする）
  - 同じ崩れが他の主要画面で起きていないことを機械で確認できる
- メモ: T-M7-26 のE2Eを書いていて発見。契約前の利用者が**最初に見る画面**が、スマホ幅でページごと183px横に動いていた（`documentElement.scrollWidth` 573 / 幅390。`window.scrollX` が実際に183まで動くことも実測）。比較表は `overflow-x-auto` の中にあり一見正しく、**要素を1つずつ見ても全て画面内に収まっている**ため気づけない。原因はセルの `sr-only`（`position: absolute`）で、位置指定された先祖が無いと包含ブロックが初期包含ブロックになり、**スクロール容器にクリップされずページ自体を伸ばす**こと。
- 実装結果: 比較表の `section` に `relative` を追加（`sr-only` の包含ブロックをスクロール容器にする）。理由をコード側のコメントに残した（見た目の調整と誤解されて消されると再発するため）。他の横スクロール容器3箇所（分析の実績表・スケジュール表・AI設定のタブ）は同種の絶対配置要素を含まず、実測でも0pxで問題なし。
- 検証: 修正前後を実測（573 → 390）。回帰は `plans.spec.ts` の1件目と、新設の `e2e/mobile-layout.spec.ts`（ログイン後7画面＋未ログイン6画面を390pxで確認）で固定した。**単体テストでは原理的に検出できない**（レイアウトはブラウザでしか計算されない）。

### T-M7-33: パスワード再設定の人間確認が表示されず申請できない不具合を修正 `done`
- 参照: PRD A-2、要件06 SC-02 / 依存: なし / サイズ: S
- 完了条件:
  - ログイン画面から即座に「パスワードを忘れた方」へ遷移しても人間確認（Turnstile）が表示され、申請できる
  - 読み込めなかった場合に黙って空欄にせず、利用者に次の操作を示す
- メモ: T-M7-26 のE2Eを書いていて発見。**ログイン画面のTurnstile初期化が終わる前にリンクを押すと、再設定フォームのウィジェットが永久に描画されない**（iframe・トークン・コンソールエラーのすべてが無く、30秒待っても復帰しない＝申請不能）。原因は `next/script` が同じ `id` のスクリプトを内部でキャッシュするため、**読み込み中にunmountされると次のマウントで `onReady` が発火しない**こと。`scriptReady` が永久にfalseのままで `turnstile.render()` が呼ばれなかった。
- 実装結果: `turnstile-widget.tsx` で `onReady` だけに依存せず、`window.turnstile` の存在自体も準備完了の合図として扱う（100msごとに確認）。あわせて15秒で諦めて「ページを再読み込みしてください」を表示し、**原因不明の行き止まりにしない**（要件04 §14 と同じ「空と失敗を区別する」方針）。effect本文での同期setStateはlintで禁じられているためコールバック側で呼ぶ。
- 検証: 修正前は30秒でトークン0・iframe0を実測。修正後は3秒でトークンが入る。回帰テストを `password-reset.spec.ts` に「ログイン画面から即座に遷移しても人間確認が表示される」として固定した。**単体テストは追加していない**（Reactコンポーネントのテスト環境が未導入〈vitestは`environment: node`・testing-library未導入〉で、かつ `next/script` のキャッシュ挙動はjsdomでは再現しないため、実ブラウザのE2Eが唯一有効な回帰テスト）。

### T-M7-34: 運営者が「いま何が壊れているか」を1コマンドで見られるようにする `done`
- 参照: CLAUDE.md「前提：運営者は個人」原則2・4 / 依存: なし / サイズ: M
- 完了条件:
  - `npm run doctor` で、開発知識なしに読める形の状態一覧が出る（環境・DB・job・cron・費用）
  - 異常があれば**次にやること**が1行で示される（ログを読ませない）
  - 本番/staging に対しても実行できる（デプロイ先の状態確認）
- 実装結果: `npm run doctor`（`scripts/doctor.mjs`）＋ `GET /api/cron/doctor`（CRON_SECRET認証・cron未登録）。判定と文言は `src/lib/ops/diagnostics.ts` の1か所に集約し、ローカルとデプロイ先で同じものを使う（SQLを二重に持たない）。**運営者にログを読ませない**方針で、内部用語を出さず、異常には「次にやること」を1行添える。見る項目: データの保存先の起動／未適用migration／アプリの応答／直近24hのjob成否／ニュース取得／お知らせメールの滞留／Xトークン期限／止まっている処理／**当月の従量課金実績（円換算・provider別内訳）**。読み取りのみで費用は発生しない。`-- --base <URL>` でデプロイ先も見られる。ローカル基盤（DB接続・未適用migration）だけはアプリを介さず直接見るので、**アプリが落ちていても「アプリが起動していません → npm run dev」と出せる**。
- 実装中の判断: **定時実行は本番でしか動かないため、それ以外の環境で「ニュースが止まっている」を赤にしない**（初回実行では73時間前で ❌ が出た）。常に赤いチェックは読まれなくなり本物の異常を隠すため、`schedulerExpected` で切り替える（`check:providers` のGoogle既定skipと同じ判断）。
- 検証: 実行して実在の指摘2件を検出（お知らせメール53件の滞留＝D-9/T-M7-31、Xトークンの期限切れ＝次の操作で自動更新）。**当月の費用 $14.34（約2151円・anthropic $13.15 / x $1.19）が初めて見えるようになった**。判定の単体テスト+21件。
- メモ: 実装前は状態を知る手段が「DBを直接引く」「dev サーバーの標準エラー出力を読む」「Sentryを開く」しかない。**非エンジニアの運営者には辿れない**（原則2違反）。出す内容の候補: ローカルスタックの起動状況／未適用migration／直近24hのjob成功失敗内訳／失敗中のcron分野／`email_status='queued'` の滞留件数／当月の従量課金実績（`external_api_usage_events`）と想定比／X token の期限。原則4のコスト可視化もここに寄せる。表示は日本語で、内部用語（`service_role`・`checkpoint` 等）を出さない。

### T-M7-35: 忘れると壊れる手順を1コマンドへ畳む `todo`
- 参照: CLAUDE.md「前提：運営者は個人」原則3、[デプロイ手順](../docs/operations/deployment.md) / 依存: なし / サイズ: M
- 完了条件:
  - staging への反映が1コマンドで完了する（CI待ち→migration適用→デプロイ後検証まで）
  - **migration の適用を忘れたら止まる**（忘れても進める形にしない）
  - 本番反映も同様に、順番を守らないと進めない
- メモ: `deployment.md` の番号付き手順は24ステップあり、**migration適用（`supabase db push`）を飛ばすとX連携が `internal_error` で壊れる**。この「忘れたら壊れる」を人間の記憶に依存させているのが原則3違反。案: `npm run release:staging` が (1)CIの結果をGitHub APIで確認 (2)未適用migrationの有無を検査 (3)適用 (4)`smoke:live --base` (5)結果を日本語で要約、を順に行い、どこで止まったかを明示する。CIが赤い/未完了なら止める。


### T-M7-27: Server Actionの本番実装テストを主要actionへ広げる `todo`
- 参照: [開発とテストの進め方](../docs/operations/development-and-testing.md) §4 / 依存: なし / サイズ: L
- 完了条件:
  - 利用者が触る主要 Server Action が、DBとSupabaseクライアントをモックせずに1本以上のテストで通っている
  - 少なくとも happy path が `internal_error` にならないことを assert する
- メモ: API route 側は `dac6dfc`＋`a35870d` で `*.db.test.ts` 7本（43件）まで整備したが、**Server Action 側は `auth.test.ts` の1本だけ**（しかも本番実装を通していない）。`src/app/actions` はテストを除いて19ファイルあり、`x-accounts`・`drafts`・`generation-jobs`・`schedule`・`api-keys`・`settings`・`persona-settings` が優先。2026-07-26 の `service_role` GRANT漏れは「純粋関数のテストが充実しているほどテスト済みに見える」型の穴で、同じ構造が actions 側に残っている。

### T-M7-28: 外向き副作用チャネルのガード網羅テスト `todo`
- 参照: 要件01 §8、要件04 §14 / 依存: なし / サイズ: S
- 完了条件:
  - 外向きチャネル（X投稿・SMTP・Stripe・Storage削除・外部HTTP）を列挙し、各々に非productionガードがあることを1本のテストで検査する
  - 新しいチャネルを足したらそのテストが落ちる
- メモ: 2026-07-27、X投稿は `X_POSTING_MODE` で守られていたのにSMTPは素通りで、動作確認の `scheduler_tick` が実際に98通送信した（T-M7-23）。個別にガードを足すだけでは「次に増えたチャネル」を守れない。**どのチャネルにガードが要るかの一覧をテストとして持つ**のが目的。

### T-M7-29: ジョブ結果の構造化記録と日次サマリ（静かな劣化の可視化） `done`
- 参照: 要件04 §6・§14、[開発とテストの進め方](../docs/operations/development-and-testing.md) §5 / 依存: なし / サイズ: M
- 完了条件:
  - 各jobの結果（保存件数・除外件数・失敗分野・コスト）が構造化して残り、後から追える
  - 1日1通のサマリで「web3が3日連続0件」のような劣化に気付ける
- 実装結果（2026-08-01）:
  - **構造化記録は T-M7-40 で実現済み**（`news_fetch_outcomes` に分野ごとの保存・除外・理由・費用が残る）。生成jobは `generation_jobs.status`／`error`（code・stage・provider_raw_error）／`usage` が既に構造化されているため、新たな記録先は作らず**推移を見る側**を実装した。
  - **日次サマリ**（`src/lib/ops/daily-summary.ts`）: 通知種別 `summary` を追加し、`scheduler_tick` がJST8時以降の最初のtickで1通だけ作る（冪等keyは `summary:{JSTの日付}`）。内容は生成・投稿の成否／**分野ごとの連続0件日数**（3日以上を強調）／全件破棄された分野と理由／止まっている処理／送信待ちメール／当月費用。
  - **連続0件日数は「実行のあった日」だけを数える**（実行していない日を0件に数えると、定時実行が動かない環境で全分野が警告になる）。同じ日に複数回実行していれば合算する。
  - 対象は**Xアカウント連携済み**の利用者のみ（連携前は運用が始まっていない）。1人分の作成が失敗しても他の利用者のまとめは作る。
  - 既定はアプリ内・メールともON（見に行かなくても気付ける形にするのが目的）。**コード側の既定とprofile作成triggerの既定を両方揃えた**（片方だけだと新規利用者にだけ届かない。`enums.db.test.ts` と `auth.local.test.ts` が食い違いを検出した）。
- 検証（2026-08-01）: 単体11件＋DB統合5件（1日1通・8時前は作らない・メールOFF・両方OFF・未連携）。release:check 完全通過（1,366件）。**実DBで実物を確認**: 運営者宛に「2026-08-01 のまとめ: 気になる点が 1 件あります／…／直近の取得で全件破棄された分野: ai（title:too_big×2, published_at:too_old×2）／今月かかった費用: $18.63（約2795円）」が作られた。
- 後続への注意: ローカルでtickを回すとサマリのメールが `queued` に溜まる（非productionでは送信しない仕様のため）。`npm run db:clean-test-data -- --apply` で掃除できる。通知種別を増やすときは enum・コード既定・trigger既定・`enums.ts` の4か所を揃える。
- メモ: 現状 除外件数は `console.warn` だけで運用では拾えない。2026-07-28 の web3 は `ok:true fetched:0` を返し続け、**成功として記録される失敗**だった。ダッシュボードは1人運用では見なくなるので、push（通知/メール）で1日1通にまとめる方針。閾値超過時だけ強調する。

### T-M7-30: 週次メンテナンス枠（`/maintenance` スキル） `todo`
- 参照: [開発とテストの進め方](../docs/operations/development-and-testing.md)、要件01 §7 / 依存: T-M7-25 / サイズ: S
- 完了条件:
  - 週次で `check:providers` ＋ `smoke:live` ＋ 依存監査 ＋ 外部API変更の確認を回す手順がスキルとして存在する
  - 月次でコスト実績・queued/staleの掃除・バックアップ復元テストを回す手順がある
- メモ: 外部APIは予告なく変わる（`allowed_callers` の件）。変更起点の検査（CI）だけでは時間経過による破綻を捕まえられない。`/loop` かクラウドスケジュールで回せる形にする。


### T-M7-31: ローカル由来の古い queued 通知を掃除できるようにする（D-9 案A） `done`
- 参照: 要件04 §14、要決定D-9 / 依存: なし / サイズ: S
- 完了条件:
  - `npm run db:clean-test-data` が「一定期間より古い `email_status='queued'` の通知」を掃除対象に含める（既定はdry-runで件数を表示し、`-- --apply` で実行）
  - **ローカルDB以外へは接続しない**既存のガードが効いたままである
  - 実メールのアカウント（`no.1013kota@gmail.com` 等）宛の通知も対象になるが、`in_app` の表示は壊さない（`email_status` を `not_requested` に落とすだけで行は消さない、が既定）
- 実装結果（2026-07-31）: `scripts/clean-test-data.mjs` に掃除対象(2)として追加した。`email_status='queued'` を `not_requested` に落とし、`email_available_at` を消す（**行は消さない**ので画面の通知履歴182件はそのまま）。既定はdry-runで「件数・人数・最古の経過時間」を出し、`-- --apply` で反映。`-- --older-than <日数>` で絞れる。
  **既定を「7日より古い」から「送信待ちすべて」へ変更した**。ローカルDBの `queued` はすべてローカル検証で作られたもので（本番は別DB）、スクリプトはローカル以外へ接続しないため期間で絞る意味がない。実際、暫定案の7日だと**53件のうち0件しか掃除されなかった**（最古が148時間＝6.2日前）。「掃除したつもりで残る」形は原則1に反するため既定を変えた。
- 実行結果（2026-07-31）: 送信待ち53件（news 45・draft_created 5・error 3、すべて `no.1013kota@gmail.com` 宛）を送信対象から外した。あわせて滞留していたテストユーザー693件も削除（実アカウント1件は温存）。`npm run doctor` の「お知らせメール」が ⚠️ → ✅ になった。`failed` の1件は残るが、**送信されるのは `queued` だけ**で `failed` は利用者の明示的な再送要求でしか送られないため一斉送信の risk は無い（`notification-email.ts` の抽出条件で確認）。
- メモ: ローカル検証で作られた通知が `queued` のまま49件残っている。T-M7-23 で development からの実送信は止めたが、**このDBを本番へ持ち込むと初回の `scheduler_tick` で一括送信される**。行を消すと画面の通知履歴が欠けるため、`email_status` を落とす方式を既定にする（削除は別オプション）。しきい値の既定は「7日より古い」を暫定とし、実装時に `db:clean-test-data` の既存オプション設計へ合わせる。

### T-M7-32: sharp を 0.35系へ upgrade し依存の high を減らす（D-7 案A） `todo`
- 参照: 要件01 §8、要決定D-7 / 依存: なし / サイズ: M
- 完了条件:
  - `sharp` が 0.35系で動き、画像正規化（JPG/PNG/WEBP・5MB以下・16:9）の挙動が変わっていない（`image-normalize` のテストと `smoke:live` の画像シナリオが緑）
  - `scripts/audit-check.mjs` の `HIGH_ALLOWLIST` から `sharp` を外す
  - `postcss` については `overrides` で 8.4.31 を上書きできるか検証し、可否と理由を allowlist の理由文へ反映する
- メモ: libvips の CVE群（CVE-2026-33327/33328/35590/35591・GHSA-f88m-g3jw-g9cj）が `sharp<0.35.0` 対象。現在 `^0.34.5`。breaking upgrade なので API 差分を確認してから上げる。`postcss` は next が nested で pin しており upgrade では解消しないため、`overrides` が唯一の手段だが next のビルドを壊す恐れがある（壊れるなら allowlist に残す判断を理由付きで記録する）。`next` は T-M7-10 で 16.2.12 済み、`brace-expansion` はビルド時のみの到達経路で allowlist 継続。


## 要決定・外部準備(ユーザー作業)

開発はモック・dry_run・ローカルSupabaseで先行できるが、以下が済むまで該当タスクは実環境検証ができず `blocked` になり得る。

**D-2: ローカルDBランタイム(Docker)の方針（解決済み 2026-07-20: colima導入）** — この開発マシンにDocker/Supabase CLIが未導入。T-M0-03〜07（DBマイグレーション群）とDB統合検証を含む後続タスクの検証に必須。選択肢: (a)colima+docker CLIをbrewで導入（GUI・ライセンス不要のヘッドレス実行。推奨。ただし初回はSupabaseの各種Dockerイメージ数GBをpull） / (b)Docker Desktopを人間が導入（GUI・ライセンス確認あり） / (c)当面ローカルDB検証をスキップしSQLの記述のみ進める。**未決の間はDB群がblockedで先へ進めないため、ここが連続開発の律速。**

**D-5: runJob汎用finalizerの中央化（解決済み 2026-07-26: 案A・T-M7-02/T-M7-07で実装。refundの共通化のみM6へ残す）** — `runJob`（worker.ts）はhandlerを`withTransaction`で包み、throw時はhandler txをロールバックして`status='failed'`（`finished_at`のみ）に更新する。error jsonb・usage・retry/backoff差し戻し・失敗通知を一切書かない。T-M3-05のpost_generation handlerは暫定対応として、失敗系のerror/usage/通知をpool（handler txとは別）で確定保存してからthrowしている。しかし「retryable(429/5xx/timeout)のbackoff付きqueued差し戻し」「pause_turn <30秒でのretryable差し戻し＋reduceWebSearchMaxUses適用」は**runJob側にretry分類（retry.ts `shouldRetry`/`backoffMs`は現状未配線）と差し戻し（stale.ts §84-93が参照実装）を中央実装しないと成立しない**。要決定: (案A)runJobを拡張し、handlerが構造化結果（succeeded/failed(error,usage)/retry(delay)）を返せるようにして中央でstatus/error/usage/backoff/通知を処理する（全handler共通化・推奨） / (案B)各handlerが個別にpoolで失敗確定＋差し戻しを行う（重複増）。M3のimage_generation/post_publish handler着手前に決めると重複実装を避けられる。

**D-6: 生成ごとの画像provider指定の扱い（解決済み 2026-07-26: 案B・T-M7-08で実装）** — `createGenerationJob`/`createDraftFromNews`は`image_provider`を受け取り（要件05 §5・作成フォームでも選択）、`regenerateImage`も当初は`provider`引数を想定していた。しかし画像job（`executeImageGeneration`）は`resolveImageProvider`（T-M0）でアカウント設定`ai_purpose_config.image`からproviderを解決し、**per-jobのimage_provider選択を使っていない**。premiumでユーザーが生成ごとにopenai/googleを選んでも、保存済み設定と異なると選択が反映されない。要決定: (案A)per-jobの`image_provider`を`resolveImageProvider`へ渡して尊重する（作成フォームの選択を活かす。`resolve-provider`にpreferred引数追加が必要） / (案B)providerは常にアカウント設定を正とし、作成フォーム/actionのper-job provider選択・引数を廃止する（UI簡素化）。暫定: 現状はアカウント設定解決（案B寄り）で動作。T-M3-16では`regenerateImage`引数を`(request_key, draft_id)`に確定し要件05 §5を更新済み。作成フォームの`image_provider`選択を活かすなら案Aで別途対応。

**D-4: 失敗provider callのusage/原価記録の責務（解決済み 2026-07-26: 案A・T-M7-09で実装）** — `runTextGeneration`（pipeline.ts）は`generate()`が成功returnした後にのみ`usage.calls`へ積むため、provider callが例外throw（`PauseTurnIncompleteError`・timeout・5xx等）した場合、`status:"failed"`/`error_code`付きの`ProviderCall`が記録されない。一方プロンプト設計書 §5.6は「全provider callを保存」、要件04 §10は「成功・失敗を問わず原価台帳へ記録」とする。M0では原価台帳（external_api_usage_events）連携自体が後続MS送りのため実害は潜在。要決定: 失敗callの記録を(案A)pipelineがtry/catchで`ProviderCall(status=failed)`を積む／(案B)worker/台帳MSが失敗時にexternal_api_usage_eventsへ直接記録する、のどちらにするか。※throw時はSDKがusageを返さないことが多く、記録できるのはrequest ID・error_code・発生事実に限られる点も考慮。`ProviderCallMeta`は既に`status`/`errorCode`を受け取れる（normalize.ts）。**T-M6-09時点の状態（2026-07-25）**: 原価台帳への記録は全AI job（GEN/LRN/SUGGEST/MD-MERGE/GEN-IMG）＋NEWSへ配線済み。ただし記録対象は`usage.calls`に現れるcall（`generate()`が返却した成功call＋status=failed返却call）に限られ、**provider例外throwのcallは依然として`calls`へ積まれず未記録**（pipeline.ts `callOnce`はgenerate成功後にのみpush）。案A（pipelineがtry/catchで`ProviderCall(status=failed)`を積む）か案Bかは未決のまま。

**D-14: `main` 保護（CIが緑でないと本番を更新しない）をどう実現するか（保留・現状維持 2026-07-31）** — **2026-07-31 ユーザー判断: いまは現状のまま**（GitHub Proへの課金もpublic化も実施せず、リポジトリ内の個人メールもそのまま）。したがって当面は**案E相当（運用で担保）**＝`main` へ反映する前に人／エージェントがCIの緑を確認する。**本番公開の前に再判断する**（それまでは赤いまま反映することが技術的に可能な状態が残る）。以下は判明した経緯と選択肢。 D-8で案A（ブランチ保護）を決めたが、**private × GitHub Free ではブランチ保護もRulesetも使えない**ことが判明した（APIが403で `Upgrade to GitHub Pro or make this repository public` を返す）。目的は「CIが赤いあいだ本番が更新されないこと」。要決定: (案A)**GitHub Pro へ課金**（個人 $4/月）。決定どおりのブランチ保護が即使える。実装作業ゼロ。**推奨**（リリース時にはVercel Proも契約する前提なので、月$4は許容範囲。外部準備7と同時に判断できる） / (案B)リポジトリを public にする（無料で保護が使えるが、事業内容・プロンプト設計・要件が公開される。**非推奨**） / (案C)Vercelの Ignored Build Step でCIの結果を見てビルドをスキップする（無料。ただしVercelのビルドはpush直後に始まりCIより早いため、緑になった後に**手動で Redeploy** する運用になる。GitHubトークンをVercelの環境変数へ置く必要もある） / (案D)Vercelの Git 自動デプロイ（production）を止め、**CIが緑になった後にGitHub Actionsから `vercel deploy --prod`** する（保証は最も固い。ただしVercelトークンをGitHub Secretsへ置くことになり、「秘密情報をCIに置かない」現方針の変更を伴う。実装もそれなり） / (案E)当面は運用で担保（`main` へ push する前にCIの結果を人／エージェントが確認する。`.githooks/pre-push` で機械化も可能だがローカル設定なので回避できる）。
**時期**: production はまだ公開していない（独自ドメイン・Vercel Pro が未契約）ため、**この決定は本番公開の直前まで先送りできる**。それまでは案Eで足りる。

**D-7: 依存の脆弱性の解消方針（解決済み 2026-07-30: 案A）** — `npm audit` に high 3件（`sharp`＝libvips CVEでsharp<0.35.0、`next`／`postcss`＝next同梱）とmoderate 4件がある。いずれも修正には breaking upgrade（`sharp@0.35.x`・`next` minor）が必要で、画像正規化（image-normalize）とApp全体の再検証を伴う。T-M6-20 の release ゲート（`scripts/audit-check.mjs`）はこの3 high を **package名 allowlist（next/postcss/sharp）** で通し、critical と allowlist外 high は失敗させる暫定運用。要決定: (案A)次の保守枠で `sharp`/`next` を計画的に upgrade しフルスイート＋build＋画像テストで検証してから allowlist を外す（推奨） / (案B)現状維持しリリース後に対応。リリース前チェックリスト（T-M6-21）で判断する。**2026-07-26 決定: sharp/postcss は据え置き（案B）・next は先行upgrade（T-M7-10）**。ただし同日の再調査で前提が変わった: (1) `next` は 16.2.10→**16.2.12 のパッチ**で high 4件・moderate 5件が解消する（`>=16.0.0 <16.2.11` が対象。当初想定した minor upgrade は不要）。(2) `sharp` は依然 `<0.35.0` が対象で 0.35 系への breaking upgrade が必要（libvips CVE-2026-33327/33328/35590/35591・GHSA-f88m-g3jw-g9cj）。(3) high の `postcss` は **next が pin する nested の 8.4.31**（hoisted の 8.5.20 は無害）で、`next@16.2.12` も 8.4.31 を pin するため **next を上げても解消しない**。sharp/postcss の扱いは保守枠で再判断する。**2026-07-30 決定: 案A**。`sharp` を 0.35系へ計画的に upgrade し、画像正規化を再検証してから allowlist から外す（T-M7-32）。`postcss` は next が nested で 8.4.31 を pin しているため upgrade では解消せず、`overrides` の可否検証も同タスクに含める。`next` は T-M7-10 で 16.2.12 済み。

**D-10: dev-loopが実AI APIを自動で叩いてよいか・1周あたりの上限額（解決済み 2026-07-28: 案A）** — CLAUDE.md「変更影響 → 必須の検証」で、AI provider・プロンプト・出力schemaに触れた変更は「実物を1周」させることを必須にした。これは**実費が発生する**（P-6のWeb検索付き生成が約$0.10〜0.21、画像1枚が約$0.05）。`/loop /dev-loop` で自動連続実行するとタスクごとに積み上がる。要決定: (案A)差分が `src/lib/ai/**`・`src/lib/jobs/**`・`src/lib/prompts/**` に触れたときだけ自動実行し、1周あたり上限$0.50・超過時は停止して報告（推奨。検証の実効性と費用制御を両立） / (案B)常にユーザー確認を挟む（安全だが自動ループが止まる） / (案C)自動実行しない（今日と同じ見落としが再発する）。**2026-07-28 決定: 案A**。差分が `src/lib/ai/**`・`src/lib/jobs/**`・`src/lib/prompts/**` に触れたときだけ `npm run smoke:live` を実行し、1周あたり上限$0.50・超過時は停止して報告する。実測は1周 約$0.30（検索あり生成$0.13＋画像$0.008＋ニュース$0.16）。上限は provider 側でかけられないため**事後測定・超過したら停止**になる。パス判定は取りこぼしうるので「表に無くても provider へ送る内容・受け取る内容に影響しうるなら実行」を併用する。

**D-11: 実物検証をどこまで自動化するか（解決済み 2026-07-28: 手動のみ実装）** — 「実物を1周」は現状**手動**（jobを1件作って `/api/jobs/run` を叩き、DBの成果物を確認）。自動化すると開発時のゲートと運用時の劣化検知の両方に使える。要決定: (1)`npm run smoke:live` を作るか（各job種別を実APIで1周し、成果物＝ポスト数・providerマークアップ非混入・画像ready・ニュース0件の理由まで検証） (2)同じ判定を staging の日次カナリア（`/api/cron/canary`）として常設するか（AI費用が継続発生。月$3程度の想定） (3)CIに実キーを置いて自動化するか（現在の「秘密情報をCIに置かない」方針を崩す。**非推奨**。代わりにstagingカナリアで代替する案を推す）。背景: 2026-07-28 の4件は、いずれも実物を1周させれば検出できたが、手動である限り忘れられる。**2026-07-28 決定: (1)を実装し、(2)は route だけ用意して cron へ登録しない（手動起動のみ・叩いたときだけ課金）、(3)はCIへ実キーを置かない方針を維持して不採用**。定期実行へ切り替えたくなったら `vercel.json` に crons を1行足すだけで済む形にしてある（T-M7-25）。


**D-12: ニュース要約の120字上限をどう守らせるか（解決済み 2026-07-28: 案B＋published_atの正規化）** — `smoke:live` が `ai` 分野の全滅を2回連続で検出した（5件すべて `summary:too_big`）。T-M7-24 のプロンプト修正でタイトル（30字）は守られるようになったが、**要約（120字）は守られない**。プロンプトで頼む方式の限界で、放置すると分野単位でニュースが0件になり続ける。要決定: (案A)検証時に120字へ丸める（`stripProviderMarkup` と同じく「指示ではなく仕組みで保証する」。文末（。）優先で切り、無ければ末尾に…。itemを失わない。推奨） / (案B)上限を緩める（例200字。UIは`line-clamp-2`なので表示は破綻しないが、プロンプト設計書 §6.10 の仕様変更） / (案C)現状維持（分野が空になる頻度を許容し、smokeの警告で気付く）。**2026-07-28 決定: 案B**（`summary` 200字へ緩和。プロンプト設計書 v1.9）。実APIで確認したところ `summary:too_big` は解消したが、**それに隠れていた別の原因が2つ露出した**: `published_at:invalid_format`×5 と `title:too_big`×4。前者は「**任意項目なのに形式違いでitem全体を捨てていた**」設計の誤りだったため同時に修正（`normalizePublishedAt` で日付のみ・タイムゾーン無しを正規化し、解釈できなければフィールドだけ落としてitemは残す）。結果、実APIで **3件取得（除外1件）** となり全滅から回復した。**残件: `title` 30字はまだ時々超える**（1/4件）。全滅にはならず取りこぼしに留まるため、緩和するかは D-13 で別途判断する。

**D-13: ニュースtitleの30字上限を緩めるか（解決済み 2026-07-30: 案A・現状維持）** — `summary` を200字へ緩め `published_at` を正規化した結果、ニュースは全滅しなくなった（実測3件取得）が、**`title:too_big` で毎回1件前後を取りこぼす**。titleはSC-06一覧とホームの重要ニュースカードで1行表示され、30字はUI都合の制約。要決定: (案A)現状維持（取りこぼしは1件程度で全滅はしない。まずはこれで運用し、smokeの警告で頻度を見る。推奨） / (案B)45字程度へ緩める（プロンプト設計書 §6.10 の変更。英語の固有名詞が入るとすぐ超えるため） / (案C)検証時に丸める（一覧の見た目は安定するが、途中で切れたタイトルが出る）。**2026-07-30 決定: 案A（現状維持）**。全滅はせず取りこぼしが1件程度に留まるため変更しない。`smoke:live` の警告（`title:too_big×N`）で頻度を観測し、恒常的に増えるなら案Bを再検討する。コード変更なし。

**D-9: 溜まった queued 通知メールの扱い（解決済み 2026-07-30: 案A）** — ローカル検証で作られた通知が `email_status='queued'` のまま49件残っている。T-M7-23 で development からの実送信は止めたが、**production で初めて `scheduler_tick` が回ると宛先に一括送信される**（本人宛だが、古い内容が大量に届く）。要決定: (案A)本番移行前にローカル由来の古い通知を `not_requested` へ落とす／削除する（`npm run db:clean-test-data` の対象へ加える。推奨） / (案B)そのまま送る（内容は本人の下書き作成・投稿完了通知なので実害は小さい） / (案C)一定期間より古い queued は tick 側で送らず落とす仕様にする（要件04 §14 の変更を伴う）。なお本番DBはローカルとは別なので、影響するのは「このローカルDBを本番へ持ち込む場合」に限る。**2026-07-30 決定: 案A**。`npm run db:clean-test-data` の対象へ「ローカル由来の古い queued 通知」を加えて掃除できるようにする（T-M7-31）。

**D-8: CIを本番デプロイのブロック条件にするか（解決済み 2026-07-30: 案A）** — `.github/workflows/ci.yml` は push / PR で `npm run release:check` を実行するが、**`main` への push ではCIとVercelのproductionビルドが並行して走るため、CIが赤でもデプロイは進む**。CIは「壊れたことを事後に知る」までしか担保しない。要決定: (案A)GitHub の branch protection で `main` を保護し `static`/`verify` を required status check にして、直push禁止・PR経由マージのみにする（緑でないと `main` に入らない＝productionビルドも始まらない。推奨。ただし1人開発でもPRを切る手間が増える） / (案B)現状維持（CIは通知用。デプロイ後に赤に気付いたら revert して再デプロイ）。**2026-07-30 決定: 案A**。`main` を branch protection で保護し、`型・lint` と `release:check（DB・build・E2E）` を required status check にして、`main` への直pushを禁止・PR経由マージのみにする。これにより **CIが緑でないと `main` に入らない＝productionビルドも始まらない**。リリースの流れは「`stg` へ push → CI緑 → `stg` → `main` のPRを作る → 緑を確認してマージ」に変わる（[デプロイ手順](../docs/operations/deployment.md)・[開発とテストの進め方](../docs/operations/development-and-testing.md) §7 を更新済み）。**2026-07-30 追記: 現プランでは設定できない。** GitHub APIで確認した結果、`branches/main/protection` と `rulesets` の両方が `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` を返す（リポジトリは private・アカウントは Free プラン）。**private × Free ではブランチ保護もRulesetも使えない。** 案Aの目的（CIが緑でないと本番が更新されない）をどう実現するかは D-14 で決める。

**D-3: news_fetchの時間窓欠落対策（解決済み 2026-07-21: 案I・3時間ラップ取得）** — 「時間窓の欠落を許容しない」要件を、案I（§2維持）で解決。`news_fetch`は各回が直近3時間分を重ねて取得し、1時間ごと起動の窓の重なりで「3回に1回成功すれば取得漏れなし」の回復性を持たせる。稼働は9:00〜20:00・12回/日を維持（コスト現状維持）、前日18:00以降の夜間・稼働終了間際分は当日9:00/10:00/11:00の起動が延長ルックバック15/16/17時間で補完（20:00始点だと19時台発行分が1回しか取得機会を得ず欠落し得るため18:00始点）。重複は`source_url` canonical unique＋`<known_urls>`で排除。`cron_runs`受付は並行/重複起動の抑止のみ、欠落回復はラップ取得側が担う。NEWSを永続job化する案II（§2改定）は不採用。反映先: PRD N-1/N-2・§8.3、プロンプト設計書 §6.10（`{{hours}}`=12-20時3／9-11時15-17）、要件04 §6、要件06 SC-06（既定7日表示）、ADR-0003。受け入れ条件はT-M4-10/11へ反映済み。

**リリース運用（2026-07-30 決定・D-8 案A）**
- [ ] **まず D-14 を決める**（private × GitHub Free ではブランチ保護が使えないため）。GitHub Pro へ課金するなら、Settings → Branches → Add branch ruleset で `main` を対象に **Require a pull request before merging** と **Require status checks to pass** を有効化し、必須チェックに **`型・lint`** と **`release:check（DB・build・E2E）`**（2026-07-30 に GitHub が記録している実際のチェック名）を指定。**Do not allow bypassing the above settings** も入れる（1人開発でも自分の直pushを止めるため）

**M0関連**
- [ ] Supabaseプロジェクトの作成とキー発行（NEXT_PUBLIC_SUPABASE_URL／ANON_KEY／SERVICE_ROLE_KEY／DATABASE_URLのpooler接続文字列）。M0のローカル検証はSupabase CLIで代替できるが、Docker実行環境の用意も人間側の準備事項
- [ ] Vercelアカウント・Proプラン契約とプロジェクト作成（商用productionはPro必須。M0のローカル検証には不要だがpreview環境の疎通確認に必要）
- [ ] 運営用生成AI APIキーの発行（ANTHROPIC_API_KEY必須、OPENAI_API_KEY／GEMINI_API_KEYはプレミアム画像・代替provider用）と採用モデル名の決定（ANTHROPIC_TEXT_MODEL等はβ計測前提の暫定値でよいか）。M0はモックで検証するが実疎通確認に必要
- [ ] X Developerアカウント登録と運営Developer Appの作成（X_MANAGED_CLIENT_ID/SECRET、callback URL登録、credit/予算設定）。dry_run検証には不要だがOAuth実疎通に必要
- [ ] X Developer ConsoleでのPay-Per-Use実単価確認（X_COST_CONTENT_CREATE_USD等の設定値。公開価格0.015/0.200/0.010はConsole表示が優先）
- [ ] SentryプロジェクトのDSN発行（SENTRY_DSN／NEXT_PUBLIC_SENTRY_DSN。dev未設定でも動作するが実収集確認に必要）
- [ ] Stripeアカウント作成・同一Product配下の3価格（Price ID）・Customer Portal configurationの設定（M0の.env.exampleにはプレースホルダのみ。課金マイルストーン開始前までに必要）
- [ ] Cloudflare Turnstileのsite key／secret key発行（認証マイルストーンで必須）
- [ ] Gmailの2段階認証有効化とApp Password発行（SMTP_APP_PASSWORD。preview/prodのメール送信用）
- [ ] 常時稼働Mac（Asia/Tokyo固定・スリープ無効・LaunchDaemon）の用意（定時トリガーの実運用時に必要。M0のcron骨格はローカルcurlで検証可能）
- [ ] production用APP_ENCRYPTION_KEY・CRON_SECRETの生成値の保管場所・受け渡し方針（生成自体は開発側で可能だが、Vercel/1Password等どこで管理するかの決定）

**M1関連**
- [ ] Stripeアカウント（test/本番）の作成と、同一Product配下の3つの月額Price（JPY税込 500円/1,000円/2,980円）の作成、STRIPE_SECRET_KEY・STRIPE_WEBHOOK_SECRET・3つのPrice IDの発行とenv設定。これが揃うまで実StripeでのCheckout〜webhook E2E（stripe listen/trigger、4242テストカード決済、trial 1回制御の実機確認）は実施できない（各タスクはSDKモック＋ローカル署名生成で検証可能）
- [ ] Stripe Customer Portalの設定確定: setupスクリプト実行によるPortal Configuration作成（プラン変更・期間末解約・値下げ予約・continue_trial）と、STRIPE_PORTAL_CONFIGURATION_IDのenv設定、Stripe APIバージョンの確認（実行結果はADRまたは実装メモへ記録する運用。要件03 §9）
- [ ] Cloudflare Turnstileの本番site key/secret keyの発行（開発中はCloudflare公開テストキーで進行可能）
- [ ] Supabaseのpreview/productionプロジェクト作成と、Auth rate limit設定・Auth CAPTCHA（Turnstile）有効化・Gmail 2段階認証によるApp Password発行とcustom SMTP設定（ローカル開発はsupabase CLI＋Inbucketで代替。漏洩パスワード保護はPro移行後のため今回不要）
- [ ] 利用規約・プライバシーポリシー・特定商取引法に基づく表記の文面確定と法務確認（signup同意で保存する現行terms/privacy versionの確定に必要。開発中は暫定version・プレースホルダ文面で進める）
- [ ] 本番APP_BASE_URL（独自ドメイン）とVercel Proの契約・環境変数設定（Checkoutのsuccess/cancel URL・メールリンクの基準URLに必要。開発はlocalhostで進行可能）

**M2関連**
- [ ] 検証用のBYOK X Developer Appの作成（開発者登録・App作成・callback URL登録・クレジット/予算設定・Client ID/Secret発行）。モック/dry_runで開発は進められるが、OAuth実機検証とリリース判定に必須
- [ ] premium用の運営X Developer Appの作成と、X_MANAGED_CLIENT_ID/X_MANAGED_CLIENT_SECRETの発行・preview/prod環境変数への設定
- [ ] AI各社（Anthropic/OpenAI/Gemini）の検証用APIキーの発行（verifyApiKeyの実機疎通確認、およびpremium運用キーの用意。どのproviderの運営キーを提供するかで画像provider選択肢が変わる）
- [ ] APP_ENCRYPTION_KEY（32 bytes相当）の生成とdev/preview/prod各環境変数への設定（漏洩時のローテーション方針は将来ADR）
- [ ] X APIキー取得手順ガイドに掲載するDeveloper Consoleのスクリーンショット素材の準備（PRD §10。用意されるまではテキスト手順のみで実装）
- [x] テーマ選択肢マスタ（L-5）の選択肢リストとnews_category対応 → **確定済み（2026-07-20）**: AI・Web3・投資・ビジネス・業務改善・SNS運用の6種。**ニュース分野も同6分野へ拡張し、テーマ↔分野を1対1対応**（`src/lib/themes.ts`・PRD v1.3）
- [ ] X Developer Console上でdev/preview用callback URL（localhost・vercel preview URL）を登録できるかの確認（不可の場合、OAuthの実機検証はprod相当URLに限定される）

**M3関連**
- [ ] 生成AI APIキーの発行と.env設定（Anthropic／OpenAI／Gemini）：開発・CIはモックで進められるが、実プロバイダでの生成品質・プロンプト・Web検索挙動の確認には最低1つの文章系キー、画像生成の実確認にはOpenAIまたはGeminiのキーが必要
- [ ] 採用モデル名の決定と環境変数設定（ANTHROPIC_TEXT_MODEL／OPENAI_TEXT_MODEL／GEMINI_TEXT_MODEL／OPENAI_IMAGE_MODEL／GEMINI_IMAGE_MODEL）：Web検索・構造化出力・prompt caching・pause_turnの対応可否はモデル依存のため、決定後に実キーで起動時検証が必要
- [ ] X Developer Appの作成（callback URL登録・scope設定・クレジット/予算設定）と検証用Xアカウントの準備：X_POSTING_MODE=liveでの実投稿・reply連投・ロールバック削除・結果不明照合の最終確認に必要（開発中はdry_runで代替可能）
- [ ] X APIのpay-per-use単価のDeveloper Console確認と原価集計env（X_COST_CONTENT_CREATE_USD／X_COST_CONTENT_CREATE_WITH_URL_USD／X_COST_INTERACTION_DELETE_USD）の設定
- [ ] 実X投稿検証時の安全策の合意：検証用アカウントで少数ポストのthread投稿→ロールバック削除まで通す受け入れテストをリリース前に1回実施するか（X API費用が発生するため実施タイミングはユーザー判断）

**M4関連**
- [ ] 常時稼働Macの用意（timezone Asia/Tokyo固定・スリープ無効・電源/回線の常時確保）と、LaunchDaemonの実機配置（launchctl bootstrap）・初回24時間監視は人間の作業。M4はplist・スクリプトのローカル検証まで（運用メモ §1〜2）
- [ ] CRON_SECRET本番値の生成と、Vercel環境変数およびMac側Keychain（または所有者限定秘密ファイル）への配置
- [ ] Gmailアカウント（matsubuz.10@gmail.com）の2段階認証有効化とApp Password発行、SMTP_APP_PASSWORD等のVercel/.env設定、実メールの受信確認（開発検証はSMTPモックで完結）
- [ ] 運営Claude APIキー（ANTHROPIC_API_KEY）の発行・課金/レート設定。news_fetchの実運用とWeb Search tool実測に必須（開発検証はproviderモックで完結）。あわせてWeb search toolの対応モデル・単価を公式ドキュメントで実装時に再確認
- [ ] Sentryプロジェクト作成とSENTRY_DSN発行（cleanup失敗記録・queuedメール滞留警告の実配信確認用）
- [ ] 自動投稿のlive E2E（実X投稿・自動rollback削除）確認にはX Developer App・実Xアカウント・クレジット設定が必要。M4のacceptanceはX_POSTING_MODE=dry_run＋モックで完結させ、live確認はリリース前作業とする
- [ ] 自動投稿同意説明文（consent_version付き文面）と通知メール文面の最終確認。特に同意文はX Automation Rules準拠の観点でリリース前に専門家確認（PRD §7）
> 注記（準備作業ではない）: Vercel Cronへの切り替えは移行条件（運用メモ §3）到達後の運用判断であり、M4ではvercel.json追加・切替作業を行わない（実施タイミングはユーザー判断）

**M5関連**
> 注記（準備作業ではない）: 他マイルストーンコードの前提: 本リストは M0=スカフォールド＋DBスキーマ/seed、M1=認証・課金・プラン判定、M2=X連携・APIキー・発信設定（ベースmd初版）、M3=ジョブ基盤（generation_jobs・worker lease・dispatch・cron認証・AIアダプタ・利用枠helper）、M4=投稿生成/実行（drafts・tweet_ids） と仮定して depends_on を記載した。実際のマイルストーン割当と異なる場合は読み替えが必要
- [ ] X Developer Appとクレジット設定（人間作業）: 学習読取（20/100件）・metrics batch lookup・user lookupの実機E2E検証には、読取scope付きDeveloper App、credit/予算設定、投稿済みポストを持つテスト用Xアカウントが必要（開発中の検証はモックで代替可能）。non-public metrics（profile_clicks等）はuser contextの所有ポストでのみ取得可能なため、実機検証は自アカウントの実投稿が前提
- [ ] X読取endpointの単価確認（人間作業）: timeline・tweets lookup・users lookupのpay-per-use単価はDeveloper Consoleでの契約表示が優先されるため、原価集計（external_api_usage_events のunit_cost_usd）に使う環境変数値の確定はリリース前に人間がConsoleで確認する必要がある（PRD 6.1「X読み取りは別途実測」）
- [ ] 生成AI APIキーの発行（人間作業）: LRN/MD-MERGE/SUGGESTの実機検証には運営Claudeキー（ANTHROPIC_API_KEY）、BYOK経路の検証には各provider（Anthropic/OpenAI/Gemini）のテスト用キー発行が必要。採用モデル（ANTHROPIC_TEXT_MODEL等）の決定と構造化出力対応の最終確認も運用判断を含む
- [ ] 常時稼働Macの準備（人間作業）: metrics_collector（毎時00分）・follower_snapshot（毎時10分）の初期定時実行にはJST固定・スリープ無効のMacとLaunchDaemon設定・CRON_SECRETの秘密管理（Keychain等）が必要。開発中はcron routeの手動curl起動で代替検証する

**M6関連**
> 注記（準備作業ではない）: 他マイルストーンのコードは次の想定で記載した（要照合・必要なら読み替え）：M0=スカフォールド・DBスキーマ・環境変数基盤、M1=認証・Stripe課金・プラン変更同期、M2=X連携（BYOK OAuth）・キー管理・設定画面、M3=AI生成パイプライン・ジョブ基盤（worker/dispatch/scheduler_tick）、M4=投稿実行・スケジュール・下書き、M5=ニュース・通知・分析
- [ ] 運営側AI APIキーの発行と課金設定（premium文章生成用Anthropic必須、画像用OpenAI/Geminiのいずれか1つ以上）。どのproviderを画像用に用意するかの決定を含む
- [ ] X運営Developer Appの作成（X_MANAGED_CLIENT_ID/SECRET発行、callback URL登録、必要scope設定、credit/予算設定）。preview/prod環境変数への設定
- [ ] X API単価のDeveloper Console確認とX_COST_CONTENT_CREATE_USD等の環境変数設定、およびPRD §6.1原価前提の更新（運営者のXアカウントが必要）
- [ ] 利用規約・プライバシーポリシー・特定商取引法表記の文面のリリース前専門家（法務）確認
- [ ] Stripe本番アカウントでの3価格（同一Product配下）とCustomer Portal configuration（値下げ期間末予約・trial中continue_trial等）の作成・設定（M1側の外部作業と重複する場合は統合）
- [ ] 常時稼働Macの準備（スリープ無効・JST固定・LaunchDaemon登録・Keychainへの秘密値登録）と、週次backup・launchd監視の運用体制
- [ ] backupの暗号化保存先（Supabase外のストレージ）の選定と用意
- [ ] 本番リリースに必要な各種アカウント・キーの発行と環境変数設定：Vercel Pro契約、Supabase本番プロジェクト、CRON_SECRET・APP_ENCRYPTION_KEYの生成、Sentry DSN、Cloudflare Turnstileキー、Gmail 2段階認証とApp Password（SMTP）
- [ ] X_POSTING_MODEをliveへ切り替える最終判断と、本番Xアカウントでの実投稿スモークテスト（実クレジット消費を伴うため運営者の実施・承認が必要）
- [ ] premium原価のβ実測に基づく上限値・単価前提・価格の見直し判断（リリース後運用。external_api_usage_eventsの月次SQL集計を翌月10日までに実施する運用担当の確定）

## M0: リポジトリ・実行基盤

### T-M0-01: Next.jsスカフォールドと開発ツールチェーン整備 `done`
- 参照: 要件01 §2、要件01 §6、要件定義書 §3 / 依存: なし / サイズ: M
- 完了条件:
  - lint・typecheck・test（サンプルテスト1件以上）の各npmスクリプトがexit 0で完走する
  - ローカルdev起動で`/`にshadcn/uiコンポーネントを使ったプレースホルダページが表示される
  - Next.js 15.1以上・App Router・TypeScript strictで構成されている
- メモ: リポジトリ直下にスカフォールド（CLAUDEの方針どおり）。実装結果: Next.js 16.2.10（`next lint`廃止のためlintは`eslint .`）／React 19.2／Tailwind v4／shadcn/ui（@base-ui版・`src/components/ui/`）／Vitest 4（`vitest.config.ts`で`@`エイリアス解決）。Node 22.23.1をbrew（node@22）で導入しPATHは`/opt/homebrew/opt/node@22/bin`。srcディレクトリ構成を採用。

### T-M0-02: 環境変数一式の.env.exampleと起動時検証モジュール `done`
- 参照: 要件01 §3.1、要件01 §3.2、要件01 §3.3、要件01 §3.4、要件01 §3.5、要件01 §3.6、O-5、P-5 / 依存: T-M0-01 / サイズ: M
- 完了条件:
  - .env.exampleに要件01 §3.1〜3.6の全環境変数が用途コメント付きで列挙されている
  - env検証テスト: CRON_SECRET未設定で読み込みが失敗し認証スキップのフォールバックが存在しない。APP_ENVがdevelopment/previewのときX_POSTING_MODE=liveを拒否する
  - FEATURE_QUOTE_POST_ENABLEDが未設定時にfalseへ解決され、Server onlyモジュールからのみ参照できる（Client Componentからのimportはビルドエラー）
- メモ: zodでサーバー起動時に検証するserver-only envモジュール。X_DAILY_POST_LIMIT既定50、SUPABASE_STORAGE_BUCKET_IMAGES既定generated-images等の既定値もここで定義。P-5はflag OFF時の判定基盤（server-only・既定false）のみをM0で持ち、拒否・非表示の各実装は該当機能のマイルストーンで行う。
  実装結果: `src/lib/env-schema.ts`（zod・純粋関数`buildServerEnv`でテスト可能）＋`src/lib/env.ts`（`server-only`付き・module load時に`process.env`検証）に分離。必須区分は§3の表どおりALWAYS_REQUIRED（全環境）とPREVIEW_PROD_REQUIRED（preview/prod）で管理。env.tsは現状どこからもimportされないためbuild/lint/typecheckでは実行されない（M1以降で利用開始）。cost系・SMTP_PORTはz.coerce.numberのため`present()`は数値も受理する必要がある点に注意。zodは4.4.3。

### T-M0-03: Supabaseマイグレーション基盤とenum定義 `done`
- 参照: 要件02 §2、要件01 §2 / 依存: T-M0-01 / サイズ: S
- 完了条件:
  - supabase db resetがローカルで成功し、マイグレーションの追加・再適用フローがREADMEまたはスクリプトで再現できる
  - 要件02 §2の全enumが正しい値リストでpg_typeに存在することをテストで確認する（**正本の実数は23種**。バックログ初版の「21種」は数え違いのため訂正）
- メモ: Supabase CLIプロジェクト初期化とmigrationsディレクトリ整備。ローカルはSupabase CLI（Docker）で検証し、リモートSupabaseプロジェクトがなくても完結する。
  実装結果: `supabase init`＋`supabase/migrations/20260720000001_enums.sql`（23 enum）。enum値の正本は`src/lib/db/enums.ts`（TS定数）、SQLとDBテストの両方がこれと一致。`src/lib/db/enums.db.test.ts`はpg経由で実DBのpg_enumを検証し、ローカルスタック未起動時はskip（`connectLocalDb`で接続失敗を検知）。`supabase/README.md`にワークフローを記載。**Docker=colimaで起動（D-2解決）**。`config.toml`は`[analytics] enabled=false`（colimaでvectorがdocker.sock bind不可のため）。`supabase db reset`成功を確認。DB接続: postgres@127.0.0.1:54322。

### T-M0-04: コア7テーブルのマイグレーション（profiles〜news_items） `done`
- 参照: 要件02 §1、要件02 §3.1、要件02 §3.2、要件02 §3.3、要件02 §3.4、要件02 §3.5、要件02 §3.6、要件02 §3.7 / 依存: T-M0-03 / サイズ: M
- 完了条件:
  - profiles / user_api_keys / x_accounts / base_md_versions / prompt_templates / learning_sources / news_itemsが定義どおりのカラム・FK・indexで作成される
  - 制約テスト: unique(user_id, provider)、unique(x_account_id, version)、prompt_templatesのpartial unique index、news_items.source_url unique、base_md_version >= 0、automation_consent同時null制約の違反insertが拒否される
- メモ: 共通ルール（uuid PK・created_at/updated_at・updated_at自動更新trigger）もここで実装。RLSは後続タスクへ分離。
  実装結果: `supabase/migrations/20260720000002_core_tables.sql`。共通`set_updated_at()`トリガ関数＋updated_atを持つ5テーブルにトリガ。profiles↔x_accountsの循環FK（`active_x_account_id`は後付けALTER・on delete set null）。FK削除方針は§1準拠でbase_md_versions（履歴）のみon delete restrict、他はcascade。change_source/kindにCHECK制約も付与（正本の列挙値。任意の追加ガード）。DBテスト`core-tables.db.test.ts`（11件）はSAVEPOINTで各制約違反を隔離検証（同一tx内で複数違反を試すため）。`supabase db reset`成功。RLS有効化・ポリシーはT-M0-06。
### T-M0-05: ジョブ・下書き・台帳系10テーブルのマイグレーション `done`
- 参照: 要件02 §1、要件02 §3.8、要件02 §3.9、要件02 §3.10、要件02 §3.11、要件02 §3.12、要件02 §3.13、要件02 §3.14、要件02 §3.15、要件02 §3.16、要件02 §3.17 / 依存: T-M0-04 / サイズ: M
- 完了条件:
  - generation_jobs / drafts / schedule_slots / follower_snapshots / improvement_suggestions / usage_events / usage_counters / notifications / stripe_events / external_api_usage_eventsが定義どおり作成される
  - generation_jobsのpartial unique index（post_publish・image_generation・suggestion・learning_analysis/md_merge）とschedule_run_key/request_key uniqueが重複insertを拒否する
  - usage_eventsのdelta±1・refundのref_event_id必須・reason整合、usage_countersのpremium上限、schedule_slotsの時刻/曜日/p5不可のCHECK制約が違反insertを拒否する
- メモ: JSONBカラム（input/usage/thread/tweet_metrics等）のzodスキーマ定義（要件02 §4）は共有型モジュールとして同時に作成し、書き込み側の検証で再利用できるようにする。
  実装結果: `supabase/migrations/20260720000003_jobs_drafts_ledger.sql`（10テーブル）。generation_jobs↔draftsの循環FK（draft_idは後付けALTER）、4つのpartial unique index、schedule_run_key/request_key unique、drafts.source_job_id unique、usage_events整合CHECK（delta±1・reason整合・refund ref必須・post_op・month形式・idempotency unique）、usage_counters premium上限CHECK、schedule_slots CHECK（p5不可・時刻09:00-22:00/00・30分・曜日0-6・画像ON時provider必須）、外部原価台帳CHECKを実装。DBテスト`jobs-ledger.db.test.ts`（12件）。**知見: NULL可能列を含む`col in (...)`はNULL時に結果がNULLとなりCHECKを素通りするため`is not null`を明示する**（schedule_slots image_providerで検出・修正。後続の制約追加時も注意）。
  **zodスキーマ（§4）は本タスクでは未作成**。書き込みパスを持つ各機能タスク（M1〜）で、そのカラムを実際に書く実装と同じ作業単位で定義する方針に変更（M0では消費先がなく、先に作るとスキーマだけ孤立するため）。共有型は`src/lib/db/`配下に置く。

### T-M0-06: 全17テーブルのRLSポリシーと整合trigger `done`
- 参照: 要件02 §5、要件02 §3.3、要件02 §1 / 依存: T-M0-05 / サイズ: M
- 完了条件:
  - 全17テーブルでRLSが有効化され、テストで別ユーザーのrowをselectできない・本人rowはselectできることを確認する（x_account経由所有のテーブルを含む）
  - news_itemsは認証済み全員select可、stripe_events / external_api_usage_eventsはanon/authenticatedからselect不可、認証クライアントからの直接insert/update/deleteが主要テーブルで拒否される
  - profiles.active_x_account_idへ他ユーザー所有のx_accountを設定するDB triggerの拒否をテストで確認する
- メモ: ローカルSupabaseで2ユーザーを作成しanon keyクライアントで検証するRLSテストを整備する（リリース判定要件のRLS policy testの土台。要件01 §8）。
  実装結果: `supabase/migrations/20260720000004_rls_policies.sql`。全17テーブルRLS有効化＋authenticated向けselectポリシー（x_account所有判定は`auth_owns_x_account()` security definer関数）。書き込みポリシーは作らずservice_role(BYPASSRLS)に委ねる＝ブラウザ直書き不可。§3.3のactive_x_account_id所有者検証triggerも実装。DBテスト`rls.db.test.ts`（5件）はpostgres接続から`set_config('role','authenticated')`＋`request.jwt.claims`のsub切替で検証（直接psqlのjwt claims方式）。
  **重要な知見**: (1) RLSポリシーは**テーブルレベルGRANTが無いと評価前に権限拒否される**。ローカルSupabaseはmigration作成テーブルにauthenticatedのデフォルト権限を自動付与しないため、読み取り可15テーブルへ`grant select ... to authenticated`を明示（stripe_events/external_api_usage_eventsは付与せず完全拒否＝§5「不可」）。(2) `col in (...)`のNULL素通り（T-M0-05と同種）。**後続でテーブルを追加する場合、RLS有効化・selectポリシー・authenticatedへのgrant selectをセットで行うこと。**

### T-M0-07: seed（システム既定プロンプト・Storage bucket・コード定数マスタ） `done`
- 参照: 要件02 §6、要件02 §4.4、プロンプト設計書 §6.1、プロンプト設計書 §6.2、プロンプト設計書 §6.8、プロンプト設計書 §6.9、L-5 / 依存: T-M0-04 / サイズ: M
- 完了条件:
  - seed適用後、prompt_templatesにsystem default 7件（p1〜p6・image、x_account_id=null）がプロンプト設計書§6の本文で存在する
  - private Storage bucket generated-imagesが作成されている
  - プラン定義（価格・Xアカウント上限・利用枠）・テーマ選択肢マスタ（news_category対応付き）・ニュースカテゴリのコード定数がユニットテストで検証される
- メモ: SYS-GEN/SYS-NEWS/PT-FIX/PT-MD-MERGE等のコード管理プロンプト定数もこのタスクで配置する（DB seedはPT-P1〜P6とimageのみ）。通知初期値・news_config初期値の定数も定義（要件06 §3.4）。
  実装結果: `supabase/seed.sql`（system default prompt 7件・PT-P1〜P6/PT-IMG本文はプロンプト設計書§6.2-6.8の正本・dollar quote・on conflict do nothing）。config.tomlに`[storage.buckets.generated-images]`（private/5MiB/png・jpeg・webp）。コード定数: `src/lib/plans.ts`（PLANS。plan_type enumから型導出）、`src/lib/themes.ts`（THEME_OPTIONS＋themesToNewsCategories）、`src/lib/news.ts`（NEWS_CATEGORIESはenum由来）、`src/lib/config-defaults.ts`（通知/news/ai_purpose既定）。テスト: `seed.db.test.ts`（prompt7件・bucket private）＋`constants.test.ts`（プラン価格/上限/枠・テーマ対応・既定値）。SYS-GEN等のコード管理プロンプト定数（PT-FIX/MD-MERGE/L*/SUGGEST/SYS-NEWS）は**未配置**——実際に呼び出す実行パイプライン（M3/M5）で配置する方針（M0-05のzod同様、消費先と同じ作業単位で）。
  **テーマ選択肢マスタ確定（2026-07-20）**: AI・Web3・投資・ビジネス・業務改善・SNS運用の6種。**ニュース分野（news_category）も同6分野へ拡張し、テーマ↔分野を1対1対応**（PRD v1.3・要件02 §2/§4.4）。news_fetchは6分野取得（コスト約2倍・§6.1更新済み）。関連: M0-03 enumマイグレーション（0001）とenums.tsのnews_categoryを6値へ更新済み。

### T-M0-08: AES-256-GCM暗号化ユーティリティ `done`
- 参照: 要件01 §2、要件01 §8、要件02 §1、PRD §7 / 依存: T-M0-02 / サイズ: S
- 完了条件:
  - 暗号化→復号のroundtripが成功し、envelopeがversion・nonce・ciphertext・auth tagを含むJSON文字列である
  - ciphertextまたはauth tagを改ざんした復号が失敗する。nonceが呼び出しごとに異なる
  - server-onlyモジュールとしてClient Componentからimportするとビルドが失敗する
- メモ: APP_ENCRYPTION_KEY（32 bytes相当）を使用。envelopeにversionフィールドを持たせ将来のローテーションADRに備える。
  実装結果: `src/lib/crypto/envelope.ts`（純粋関数・テスト可能。envelopeは`{v,n,c,t}`のJSON文字列）＋`src/lib/crypto/index.ts`（`server-only`・envのAPP_ENCRYPTION_KEYをbind、`encrypt`/`decrypt`をexport）。鍵はutf8 32文字/hex 64文字/base64を受理し32バイト以外は例外。テスト13件（roundtrip・nonce毎回異なる・ciphertext/tag改ざん・別鍵・version不一致・非JSON）。*_ciphertextカラムへの保存にこの`encrypt()`出力を使う。

### T-M0-09: DATABASE_URL（pooler）接続とtransaction/advisory lockヘルパ `done`
- 参照: 要件01 §3.2、要件01 §6、要件04 §4、要件04 §6、ADR-0002 / 依存: T-M0-02、T-M0-03 / サイズ: M
- 完了条件:
  - withTransactionヘルパが接続を都度取得・即解放し、テスト完走後に接続リークがない（pool統計で確認）
  - pg_advisory_xact_lockヘルパのintegrationテスト: 同一キーの並行2 transactionが直列化され、transaction終了でlockが自動解放される
  - x_account単位・user+post_publish・cron時間窓（job名+対象時刻窓）の3種のlockキー導出が決定的であることをユニットテストで確認する
- メモ: Supavisor transaction mode想定でprepared statementに依存しないpg client設定にする。FOR UPDATE SKIP LOCKEDを使うクエリヘルパもここに置く。supabase-js/PostgRESTでは複文transactionを実行しない方針をコードコメントで明示。
  実装結果: `src/lib/db/pool.ts`（getPool/withTransaction/poolStats/closePool。接続文字列はprocess.env.DATABASE_URL、未設定時はローカル既定。named prepared statement不使用）＋`src/lib/db/locks.ts`（LOCK_CLASS・hash32〔FNV-1a→signed int32〕・xAccount/postPublish/cronWindowのキー導出・acquireXactLockは2-int形pg_advisory_xact_lock）。テスト: `locks.test.ts`（決定性・名前空間分離）＋`pool.db.test.ts`（commit/rollback・接続リークなし・同一キー直列化とtx終了で自動解放・別キーは非ブロック）。`pg`をdependenciesへ移動（本番worker使用）、`@types/pg`はdev。全73件通過。
  注: pool.tsはenv.ts（server-only・全必須検証）をimportするとテストで読み込み時例外になるため、DATABASE_URLはprocess.envから直接読む（本番はVercelで検証済みの値が入る）。server-onlyマーカーは付けずsrc/lib/db配下のサーバー専用コードとして扱う。

### T-M0-10: twitter-text互換の加重文字数ユーティリティ `done`
- 参照: PRD §8.1、要件05 §12、プロンプト設計書 §7、要件02 §4.7 / 依存: T-M0-01 / サイズ: S
- 完了条件:
  - 半角280字はOK・281字はNG、日本語140字（加重280）はOK・141字はNGと判定される
  - URLが長さにかかわらずt.co固定長で計算され、絵文字・CJKが重み付きで数えられるテストが通る
  - cashtag（$TICKER形式）の件数を返し、2件以上を検出できる
- メモ: 公式twitter-textライブラリ（またはその設定準拠実装）を利用しweighted_length算出を共通化。drafts.thread各要素のweighted_length算出とPT-FIX判定（280超過検出）の両方から使う前提のAPIにする。
  実装結果: `src/lib/text/weighted-length.ts`（公式`twitter-text`ラッパー: weightedLength / exceedsWeightedLimit / isWithinWeightedLimit / countCashtags、MAX_WEIGHTED_LENGTH=280、limit引数でPT-FIXの任意上限に対応）。`twitter-text`はdependencies、`@types/twitter-text`はdev。テスト7件（半角280/281・日本語140/141=加重x2・URLはt.co固定長・空文字・custom limit・cashtag2件検出）。要件01 §2技術スタックに追記。全80件通過。

### T-M0-11: Sentry導入とログredaction `done`
- 参照: 要件01 §2、要件01 §8、要件01 §9 / 依存: T-M0-02 / サイズ: S
- 完了条件:
  - SENTRY_DSN未設定のdev環境でもアプリが正常起動・動作する
  - beforeSend相当のredactionユニットテスト: Authorizationヘッダ・cookie・APIキー・token・prompt全文を含むイベントから該当値が除去される
  - サーバー側の例外がSentry送信経路（モックtransport）へ渡ることをテストで確認する
- メモ: server/client両configを用意。ユーザー向けエラーへprovider本文・stack traceを出さないエラー変換ヘルパの雛形も併設する。
  実装結果: `@sentry/nextjs` v10.66（Next16対応）。`src/lib/observability/redact.ts`（純粋なbeforeSend: Authorization/Cookie/token/secret/credential/api_key/prompt/base_md/instructions/user_opinion/contentを再帰マスク）、`sentry.ts`（initServerSentry/initClientSentry: DSN未設定でno-op・beforeSendにredact・captureServerException）、`errors.ts`（AppError＋toUserFacingError: 未知errは`internal_error`へ潰しstack/provider本文/causeを出さない）。計装: `src/instrumentation.ts`（register＋onRequestError）・`src/instrumentation-client.ts`（onRouterTransitionStart）。テスト10件（redaction・エラー変換・mock transportで捕捉→送信＋秘密のend-to-end除去）。dev（DSN空）でトップ表示を実機確認。全90件通過。
  注: `withSentryConfig`（source map upload等）は未導入。ソースマップ・トンネリングが必要になった段階で next.config を包む（M6リリース準備の候補）。`@sentry/nextjs`はdependencies。

### T-M0-12: POST /api/jobs/run worker骨格（CRON_SECRET認証・202+after()・lease） `done`
- 参照: 要件04 §1、要件04 §4、要件05 §3、ADR-0002、要件01 §6、要件02 §3.8 / 依存: T-M0-09、T-M0-05 / サイズ: M
- 完了条件:
  - Bearerなし・不一致は401、一致時はjob_id受領後202を即時返却し本処理がafter()で実行される（maxDuration=200設定済み）
  - ローカルDBテスト: queued jobがadvisory lock＋FOR UPDATE SKIP LOCKEDのlease transactionでrunning・attempt+1・locked_at/locked_by設定へ遷移する
  - 同一x_accountに別のrunning jobがある場合／同一userにrunning post_publishがある場合、何もせずcommitして202で終了しjobはqueuedのまま残る
- メモ: kind別handlerはレジストリ化しM0ではプレースホルダ実装（即succeeded化するテスト用handler）。available_at <= now()検証、schedule起点post_generationのscheduled_for+10分超過チェック（canceled化）もlease内に実装する。
  実装結果: `src/lib/jobs/auth.ts`（isValidCronAuth・定数時間比較・secret未設定は常に拒否）、`handlers.ts`（kind→handlerレジストリ・M0はno-opプレースホルダ）、`worker.ts`（`leaseJob`: 対象x_account/user取得→advisory lock〔x_account、post_publishはuser追加〕→FOR UPDATE SKIP LOCKED→schedule超過cancel/queued・due判定→同一account/同一user post_publishのrunning競合チェック→running/attempt+1/locked遷移。`runJob`: lease→handler→succeeded/failed）、`src/app/api/jobs/run/route.ts`（401/400/202+after()・runtime nodejs・maxDuration 200）。テスト: auth 3件＋route 3件（401/400/202・dispatch）＋worker DB 7件（lease遷移・not_found・account競合skip・post_publish競合skip・not_queued・schedule cancel・runJob成功）。全103件・lint/typecheck通過。
  後続への注意: schedule_missed通知の作成はscheduler_tick（M4）。heartbeat/stale/retryはT-M0-13。stale確定時の終端処理（refund・kind別後始末）はT-M0-13で§4末尾に従い実装。

### T-M0-13: workerのheartbeat・stale判定・retry/backoff制御 `done`
- 参照: 要件04 §4、要件04 §5、要件02 §4.10、ADR-0002 / 依存: T-M0-12 / サイズ: M
- 完了条件:
  - 外部処理中のheartbeatでlocked_atが30秒間隔相当・stage変更時に更新される
  - stale回収テスト: locked_atが10分超のrunning jobがattempt<3ならlock解除しqueuedへ（backoff付きavailable_at設定）、attempt>=3ならfailedへ確定し§4.10形式の構造化errorが保存される
  - deadlineヘルパ: Function開始180秒のdeadlineと「残り30秒未満なら追加provider callを開始せずretryable queuedへ戻す」判定、per-call timeout（90秒とdeadline残の短い方）がユニットテストで検証される
- メモ: 429/5xx/networkの指数backoff+jitter（最大2回retry、初回含め最大3 attempt）の共通retryポリシーもここで実装。stale failed確定時のkind別終端処理（refund・通知）はインターフェースだけ用意し、実装は各機能マイルストーンで行う。
  実装結果: `retry.ts`（MAX_ATTEMPTS=3・isRetryable〔429/5xx/network〕・backoffMs〔指数base1s・cap30s・加算jitter最大0.5・rng注入可〕・shouldRetry）、`deadline.ts`（createDeadline: 180s deadline・canStartCall〔残30s未満で不可〕・callTimeoutMs〔min(90s,残)〕・now注入可）、`stale.ts`（heartbeat〔running行のlocked_at/stage更新〕・recoverStaleJobs〔stale=locked_at<now-10min。attempt<3→queued+backoff付available_at、>=3→failed+§4.10 error+終端フック〕・setStaleTerminalHandlerでkind別終端処理を差替可能=M0はno-op）。テスト: retry6+deadline… 実際はretry/deadline計8＋stale DB 2。全113件通過。
  後続への注意: recoverStaleJobsはscheduler_tick（M4）が呼ぶ。stale failed時の終端処理（premium枠refund・kind別draft後始末・error通知）はsetStaleTerminalHandlerでM4/M6が注入する。heartbeatの30秒間隔スケジューリングは各handler実行側（M3+）の責務。

### T-M0-14: job dispatchヘルパ（1 job = 1 Function呼び出し） `done`
- 参照: 要件04 §1、要件04 §3、ADR-0002 / 依存: T-M0-12 / サイズ: S
- 完了条件:
  - dispatchJob(jobId)がCRON_SECRET Bearer付きでPOST /api/jobs/runを呼び、202受領で返りworkerの本処理完了を待たない（モックfetchで検証）
  - transport失敗・非2xxでも例外を伝播させずjobはqueuedのまま残る（scheduler_tick回収前提の設計をテストで確認）
  - 子job用の決定的冪等key（parent:{parent_job_id}:{kind}:{draft_id}）とユーザー操作用request_key（ユーザーIDprefix付き）の生成ヘルパがユニットテストを通る
- メモ: Server Action/API Routeのafter()から呼ぶ手動dispatch、親workerからの連鎖dispatch、tickからの一括dispatchの3経路すべてが同一ヘルパを使う。未管理のfire-and-forget Promiseを作らない実装にする。
  実装結果: `src/lib/jobs/dispatch.ts`（dispatchJob: `${APP_BASE_URL}/api/jobs/run`へBearer付きPOST。202受領で`{ok:true}`、非2xx/transport失敗/設定不足は例外を投げず`{ok:false}`。ジョブ行に触れないのでqueuedのまま残りscheduler_tickが回収）、`src/lib/jobs/keys.ts`（childJobKey=`parent:{parent}:{kind}:{draft}`、requestKey=`{userId}:{token}`）。テスト: dispatch 5件（fetch mock: URL/method/header/body・202・非2xx・transport失敗・設定不足）＋keys 4件。全122件通過。3経路（手動after()/連鎖/tick一括）はこのdispatchJobを呼ぶ。
  是正（2026-07-22, review-cron-claim-followup）: `requestKey(userId, token)`の既定値`= randomUUID()`を撤去し`token`を必須化。request_keyは画面（クライアント）生成UUIDで再送時も同値を使う仕様（要件04 §3・要件05 §12）のため、サーバ側で毎回新規UUIDを生成する既定値は冪等性を壊すfootgun（レビュー指摘）。実利用元は無くテストのみ（keysの「no-arg時に毎回別key」テストを削除）。

### T-M0-15: cron 4 route骨格（時間窓advisory lockとtick回収dispatch） `done`
- 参照: 要件04 §6、要件04 §1、要件05 §3、運用メモ launchd-to-vercel-cron §2、ADR-0002 / 依存: T-M0-09、T-M0-13、T-M0-14 / サイズ: M
- 完了条件:
  - GET /api/cron/{news-fetch,scheduler-tick,metrics-collector,follower-snapshot}の4本がCRON_SECRET Bearerを検証（不一致401）し、force-dynamicで2xxを返す
  - 同一時間窓の二重起動テスト: 後発がjob名+時間窓のadvisory lock/leaseを取得できず、処理済み相当の2xxを返して本処理を実行しない
  - scheduler-tickの回収骨格: dispatchされずqueuedのまま残ったjobをscheduled_for昇順→created_at昇順で最大50件dispatchし、stale判定処理を呼び出す（ローカルDB＋モックdispatchで検証）
- メモ: news取得・slot enqueue・metrics収集・follower保存の本処理は各機能マイルストーンで実装し、M0では認証・lock・処理順（cancel→enqueue→dispatch→回収）の骨格と各ステップのフックのみ。ローカルcurlで4本の疎通を確認できるようにする。
  実装結果: `src/app/api/cron/{news-fetch,scheduler-tick,metrics-collector,follower-snapshot}/route.ts`（GET・CRON_SECRET Bearer検証・force-dynamic・runtime nodejs）。`src/lib/jobs/cron.ts`（hourWindowKey/fiveMinWindowKey・withCronWindowLock〔セッションpg_try_advisory_lockで時間窓の二重起動防止・finallyでunlock〕・runSchedulerTick〔queued残をscheduled_for asc nulls last→created_at ascで最大50件dispatch＋recoverStaleJobs〕）。`locks.ts`にtryAdvisoryLock/advisoryUnlock追加。cancel/enqueueはM4フック（TODO）。各分野の本処理はM4(news)/M4(tick enqueue)/M5(metrics・follower)。テスト: cron unit 2＋cron DB 2（二重起動skip・tick順序/stale回収）＋route auth 4。実機curlで4本の401/2xx・scheduler-tickのdispatched/recovered出力を確認。全130件通過。
  是正（2026-07-21, review-m0-12-to-20）: 独立レビューで、セッションscope `pg_try_advisory_lock`をハンドラ全体で保持する設計がSupavisor transaction modeプーラ（要件01 §3.2/§6）で保持されず、lockリーク／二重起動を招く問題（ローカル直結DBでは露見せず本番のみ顕在化）を確認。`withCronWindowLock`を`cron_runs`テーブル（`unique (job_name, window_key)`）への`insert ... on conflict do nothing` lease方式へ置換（ADR-0003・新マイグレーション`20260721000001_cron_runs.sql`）。`fn`は接続を受け取らず自前で`withTransaction`する。一度確保した窓は完了後も再実行しない（HTTP再試行・重複Cron起動の二重実行防止）。`locks.ts`から誤用しやすいセッションlockヘルパ（tryAdvisoryLock/advisoryUnlock/cronWindowLockKey/LOCK_CLASS.cron）を撤去。あわせてADR-0002不整合の`maxDuration=200`をnews-fetch/follower-snapshotへ追加（4本すべてに設定）。cron DBテストをlease意味論（同一窓は生涯1回・並行時は1回のみ・finished_at記録）へ更新。docs同期: 要件02 §3.18/§5・要件04 §6・要件定義書（18テーブル・変更履歴v1.3）・各README・ADR-0003。全202件・lint/typecheck通過。
  フォローアップ（2026-07-21, 同レビュー・別コミット）: cron_runsを「重複受付防止（window claim / dedup marker）」として整理。`withCronWindowLock`→`withCronWindowClaim`、`CronLockResult`→`CronClaimResult`へ改名。**cron_runs.finished_atを廃止**（完了状態は持たない。完了正本は永続ジョブ=`generation_jobs.status`/`finished_at`、状態ベースcron=業務データの現在状態）。`started_at`→`claimed_at`改名。実行保証（トリガー=at-most-once／generation_jobs=retry付きat-least-once相当／状態ベースcronは次窓catch-up／exactly-once非保証）をADR-0003・要件04 §6へ明記。ADRを`0003-cron-window-claim.md`へ改名。保持を要件01 §9へ登録（暫定40日・scheduler_tick cleanupはT-M4-09）。マイグレーションは案A（未push・ローカルのみ適用のため既存migを修正）で`20260721000001_cron_runs.sql`から`finished_at`除去・`claimed_at`化。cron DBテストを更新（受付は高々一度・並行時1回・fn失敗後もclaim残存し再受付されない・完了列を持たない・tick次窓catch-up）。全202件・lint/typecheck通過。news_fetchの窓欠落対策は§2（NEWSはgeneration_jobs不使用）と衝突するため本コミットでは実装せず「要決定」＋T-M4-10/11へ記載。

### T-M0-16: LLM共通アダプタ契約とAnthropicアダプタ（pause_turn規則） `done`
- 参照: プロンプト設計書 §5.1、プロンプト設計書 §5.2、プロンプト設計書 §5.6、要件04 §5、A-5 / 依存: T-M0-02 / サイズ: M
- 完了条件:
  - TextGen IF（system[]/user/webSearch/jsonSchema/timeoutMs → provider/requestId/text/citations/usage/stopReason）に対し、モック応答から共通形式が返る
  - pause_turn: 同一実行内でのみ最大2回まで継続し中断応答を永続化しない。deadline残り30秒未満では継続を開始せずretryable扱いになる。retry時のwebSearch.maxUses 1段階縮小ロジックがテストで検証される
  - systemの固定ブロック（SYS＋base_md）にprompt cachingを適用し、可変値がsystemに混入しない組み立てになっている
- メモ: モデル名・検索ツールversionは環境変数/アダプタ設定とし業務ロジックへ直書きしない。実装時にAnthropic公式ドキュメント（Web search tool・stop reasons）で最新仕様を確認する。temperature等の生成パラメータは対応モデルのみ送信。
  実装結果: `src/lib/ai/types.ts`（TextGen契約・ProviderUsage・Citation。system[]/user/webSearch/jsonSchema/timeoutMs → provider/requestId/text/citations/usage/stopReason）、`src/lib/ai/anthropic.ts`（SDK非依存の中核: `AnthropicTextGen`・`buildAnthropicParams`〔system=SYS+base_mdをそのまま・最後の固定ブロックにcache_control ephemeral・可変値はmessagesのみ・webSearch時tools/なければjsonSchema→output_config〕・`extractCitations`・usage正規化・pause_turnループ〔同一generate内で最大2回・残30秒未満または上限超で`PauseTurnIncompleteError`(retryable)〕・`reduceWebSearchMaxUses`〔半減・下限1、4→2〕・注入可能な`RawCreateMessage`）、`src/lib/ai/anthropic-client.ts`（server-only、実`@anthropic-ai/sdk`配線、model/keyはenv、stateless）。`@anthropic-ai/sdk@^0.112.3`追加。検索ツールversionは`DEFAULT_WEB_SEARCH_TOOL_TYPE="web_search_20260209"`（アダプタ設定＝§5.1許容）。claude-apiスキルで`thinking:{type:"adaptive"}`/web_search_20260209/pause_turn継続法/prompt cachingを確認。テスト: モックcreateMessageで9件（正規化・pause_turn継続2回・上限超retryable・deadline<30s retryable・buildParams・maxUses縮小・citation重複排除）。全139件通過。
  後続への注意: OpenAI/Geminiアダプタ(T-M0-17)は同じTextGen契約・ProviderUsageを満たす。runGenerationパイプライン（parse→修復1回→charLimit→NG）とresolveProviderは後続（T-M0-18/19）。JSON修復callも「残30秒未満なら開始しない」deadline制御を`createDeadline`で共有する。生成パラメータ(temperature)・thinking設定はM1/M3のGEN実装でreq側から渡す設計余地を残した（現状buildParamsは未送信）。

### T-M0-17: OpenAI/Geminiアダプタとusage正規化の統一 `done`
- 参照: プロンプト設計書 §5.3、プロンプト設計書 §5.4、プロンプト設計書 §5.6、要件02 §4.6 / 依存: T-M0-16 / サイズ: M
- 完了条件:
  - OpenAIアダプタ: store:false・Responses APIのoutput itemsからtext・Web検索引用元・usage・request IDを抽出する（モックレスポンスで検証。output_textだけを保存せず引用を捨てない）
  - Geminiアダプタ: store=falseで各呼び出しが独立し、groundingメタデータからcitationsを抽出、generateContentフォールバックへの切替が設定で制御できる（モックで検証）
  - 3 providerのusageが要件02 §4.6のcalls要素（provider/model/request_id/stop_reason/token/検索回数/estimated_cost_usd等）へ同一の正規化型で変換される
- メモ: 検索と構造化出力の併用可否はモデルごとに起動時検証するチェック関数を用意（要件01 §7）。SDK引数名は実装時点の公式型定義を正とする。
  実装結果: `src/lib/ai/openai.ts`（`OpenAITextGen`中核: Responses API・store:false・instructions=SYS+base_md・output itemsからtext〔output_text優先〕/url_citation引用/web_search_call数/usage〔input/output/cached〕/id抽出）、`src/lib/ai/gemini.ts`（`GeminiTextGen`中核: contents+systemInstruction・groundingChunks[].web.{uri,title}引用・usageMetadata・responseId・finishReason。`useInteractions`＋`interactions`注入でInteractions/generateContentフォールバックを設定制御）、`src/lib/ai/normalize.ts`（`ProviderCall`=§4.6 calls要素・`toProviderCall`〔3provider共通のTextGenResult→ProviderCall。cache_hit=cacheRead>0, web_search_count=usage〕・`canCombineSearchAndStructuredOutput`〔既定false＝JSON指示+zod検証へ〕・`verifyTextProvider`〔key/model無なら`ProviderConfigError`, 暗黙切替なし〕）、server-only配線 `openai-client.ts`（openai@6.48.0）/`gemini-client.ts`（@google/genai@2.12.0 generateContent）。SDK型定義で形状確認、Geminiはai.google.dev対応。テスト: openai 5＋gemini 6＋normalize 6。全154件通過。
  後続への注意: 3アダプタは同一TextGen契約＋`toProviderCall`で§4.6 calls配列へ正規化。estimated_cost_usdはモデル別価格表を持つ後続で算出（現状0）。Gemini Interactions APIの実配線は対応確認後に`interactions`へ追加。resolveProvider(T-M0-19)は`verifyTextProvider`と各`create*TextGen`を束ねる。JSON修復パイプライン(T-M0-18)は3アダプタ共通の`generate`を呼ぶ。

### T-M0-18: JSON修復付き生成パイプライン骨格 `done`
- 参照: プロンプト設計書 §5.1、プロンプト設計書 §7、要件04 §5、要件02 §4.6 / 依存: T-M0-16 / サイズ: M
- 完了条件:
  - 正常JSONでは修復callが呼ばれず、不正JSONではコードフェンス除去→再パース→修復指示付きprovider call 1回のみが実行される（モックproviderで呼び出し回数を検証）
  - 修復後もparse失敗の場合にInvalidProviderOutputError相当で失敗し、job retry回数（attempt）には含めない扱いになる
  - 全provider callの記録がusage.callsへ蓄積され、要件02 §4.6スキーマのzod検証を通る
- メモ: runGeneration骨格（resolveProvider→assembleContext→generate→parseAndValidate→修復→文字数/NG検証フック→logUsage）を実装。文字数超過のGEN-FIX実行・NG照合・出典検証の本実装は生成機能マイルストーンで行い、M0はフックとIFまで。
  実装結果: `src/lib/ai/parse.ts`（`stripCodeFence`・`parseAndValidate`〔生→フェンス除去の順にJSON.parse+zod検証〕）、`src/lib/ai/usage-schema.ts`（要件02 §4.6の`providerCallSchema`/`generationUsageSchema`）、`src/lib/ai/pipeline.ts`（`runTextGeneration`: generate→parseAndValidate→失敗時のみ`withRepairInstruction`付き修復call **1回のみ**→なお失敗で`InvalidProviderOutputError`〔retryable=false・蓄積usage同梱〕。全callを`toProviderCall`でusage.callsへ蓄積。`PostValidationHooks`〔enforceCharLimit/ngCheck〕はIFのみ・成功時に呼ぶ。latencyは注入可能なnow）。テスト: parse 7＋pipeline 5（正常=修復なし・フェンス=修復なし・不正→修復1回で成功・修復も失敗→非retryable例外・§4.6 zod検証・フック呼出）。全166件通過。
  後続への注意: resolveProvider(T-M0-19)と`assembleContext`（context組み立て）を束ねてrunGenerationを完成させる。GEN-FIX短縮・NG照合・出典(sources)検証・下書き化はhooks本実装として生成機能(M1/M3)で。修復callはjob attemptに含めない（§5.6）— workerは`InvalidProviderOutputError`(retryable=false)を非再試行failedとして扱う。JSON修復のdeadline制御（残30秒未満なら修復callを開始しない）はrunGenerationへdeadline連携する際に追加。

### T-M0-19: resolveProvider（プラン→provider/キー解決） `done`
- 参照: PRD §8.2、プロンプト設計書 §1、プロンプト設計書 §5.1、要件01 §3.5、要件01 §7、要件02 §4.1、A-5 / 依存: T-M0-08、T-M0-17、T-M0-04 / サイズ: M
- 完了条件:
  - standard/md: ai_purpose_config.textのproviderについてuser_api_keysのvalidなキーを復号して解決し、未登録・invalidはapi_key_required相当のエラーを返す（ローカルDB＋テストデータで検証）
  - premium: textがPREMIUM_TEXT_PROVIDER（既定anthropic）の運営キーへ固定解決され、ユーザー設定値に依存しない
  - NEWS: NEWS_TEXT_PROVIDERの運営キーで解決し、無効・未設定時はエラーで失敗して別providerへ自動切替しない。画像providerはopenai/googleのみ解決できる
- メモ: job（trigger/kind/plan）を入力にTextGen実装インスタンスとキー種別（BYOK/運営）を返す。運営キー・復号済みユーザーキーはserver-only境界内に閉じる。
  実装結果: `src/lib/ai/resolve-provider.ts`（純粋・注入可能コア＝DBテスト可: `resolveTextKey`〔premium=運営PREMIUM_TEXT_PROVIDER固定・DB非参照／standard・md=BYOK: profiles.ai_purpose_config.textのvalidキーを復号〕、`resolveNewsKey`〔運営NEWS_TEXT_PROVIDER固定・sync・別provider自動切替なし〕、`resolveImageKey`〔openai/googleのみ・anthropic拒否／premiumは運営で利用可能なopenai/google〕、`isTextProvider`/`isImageProvider`/`isTextKind`、`ApiKeyRequiredError`〔code=api_key_required・reason=no_provider_selected/key_missing/key_invalid/unsupported_provider〕、運営鍵/モデル未設定は`ProviderConfigError`）、`src/lib/ai/resolve-provider-server.ts`（server-only: env/crypto(decrypt)/pool束ね→`resolveTextProvider`/`resolveNewsProvider`/`resolveImageProvider`と`buildTextGen`で実TextGen構築）。3クライアントfactoryを`{apiKey,model}`上書き対応へ拡張（BYOK鍵注入）。DBスキーマ: ai_purpose_configはprofilesのJSONB列、user_api_keysはcredentials_ciphertext+status。テスト: unit 12＋DB 8（standard/md=BYOK復号・premium=運営固定・news無切替・image openai/google・anthropic拒否・未登録/invalid/未選択/未サポート値=api_key_required）。全186件通過。
  ultracode検証: 敵対的レビュー（セキュリティ/仕様整合/エッジケース3レンズ＋各指摘の独立検証）を実施。security・spec-correctnessは指摘なし。confirmed 1件（BYOK textのprovider未検証→'x'等が`ProviderConfigError`(500相当)へ誤分類）を修正: `isTextProvider`ガード追加＋JSONB読取をtypeof厳格化、image側と対称に`unsupported_provider`のapi_key_requiredへ。
  是正（2026-07-22, review-m0-12-to-20指摘）: premium画像の解決がユーザー選択（`ai_purpose_config.image`）を無視しopenai優先固定になっていた仕様不一致を修正。要件02 §4.1・要件06どおり、premiumも**ユーザー選択(openai/google)を運営キーで解決**するよう`resolveImageKey`のpremium分岐を変更（選択が有効かつ運営キー/モデルがあればそれを使用、選択済みだが運営側未設定なら`ProviderConfigError`、未選択・無効値は利用可能な運営provider〔openai優先〕へフォールバック）。premium画像はDB（profiles.ai_purpose_config）を参照するようになった（textは従来どおり運営固定・DB非参照）。unitテストをprofile返却モックで6ケースへ拡充。仕様側は既にユーザー選択可の記述のため変更なし（コードを仕様へ一致）。
  後続への注意: runGeneration（T-M0-18のrunTextGeneration）へ`resolveTextProvider`/`resolveNewsProvider`と`assembleContext`を束ねて完成させる。画像アダプタ（GEN-IMG, M3）は`resolveImageProvider`が返す`ResolvedKey`から構築する。`ApiKeyRequiredError`のtoUserFacingError連携（.code/instanceofで400マッピング）はAPI層実装時に配線（現状は素のErrorへ collapse）。

### T-M0-20: X OAuth 2.0 PKCEクライアント基盤 `done`
- 参照: A-3、A-4、PRD §8.1、要件05 §4.3、要件05 §11、要件01 §3.4 / 依存: T-M0-02、T-M0-08 / サイズ: M
- 完了条件:
  - code_verifier/code_challenge（S256）の生成がRFC準拠であることをテストで確認する
  - authorize URL構築にtweet.read tweet.write users.read media.write offline.accessの5 scope・state・PKCEパラメータが含まれ、BYOK（ユーザーClient ID）/managed（運営App）の切替が入力で決まる
  - モックtokenエンドポイントでauthorization code交換が成功し、access/refresh tokenがAES envelope形式で保存できる。state（user ID・client種別・return path結び付け）の署名検証ヘルパがテストを通る
- メモ: M0はクライアントライブラリ層のみ（/api/x/oauth/start・callbackのroute実装とscope検証・/2/users/me確認フローはX連携マイルストーン）。state保存は署名・暗号化・HttpOnly・短TTL cookie形式のヘルパとして用意。
  実装結果: `src/lib/x/oauth.ts`（純粋・注入可能: PKCE〔generateCodeVerifier=32B→base64url 43文字・computeCodeChallenge=base64url(sha256)・S256・createPkce〕、`buildAuthorizeUrl`〔5 scope space→%20・S256・clientIdでBYOK/managed切替〕、`hasRequiredScopes`、OAuth transaction state〔newOAuthTransaction/sealOAuthTransaction=AES-256-GCM envelope〔暗号化＋auth tag=署名〕/verifyOAuthCallback〔改ざん・TTL・state不一致〔timingSafe比較〕を拒否〕、`exchangeCodeForToken`〔public=client_id in body/confidential=Basic auth・XTokenErrorはerror codeのみでtoken非漏洩〕、`sealTokenResponse`〔access/refreshをenvelope化・expiry・scope分割〕）、`src/lib/x/oauth-server.ts`（server-only: xRedirectUri・managedOAuthClient・sealState/verifyState・sealTokens・cookie属性〔HttpOnly/Secure(prod)/SameSite=Lax/maxAge 600s〕）。
  公式仕様確認（docs.x.com, CLAUDE.md規約）: authorize=`https://x.com/i/oauth2/authorize`、token=`https://api.x.com/2/oauth2/token`、confidential=Basic/public=body、offline.accessでrefresh発行。PKCEはRFC 7636 Appendix Bのテストベクタで検証。テスト: oauth 15件。全201件・lint/typecheck通過。
  ultracode検証: 理解ワークフロー（公式docs WebFetch含む3並列）→敵対的レビュー（暗号/PKCE・state&CSRF・API整合3レンズ＋検証）。confirmed 0件。1件のstate CSRF指摘は「session-userId検証はroute層の義務でこの純粋層の範囲外」として棄却されたが、cookie-forcing対策の重要性からverifyOAuthCallbackのdocstringに「callback routeはtx.userIdをsession userIdと一致検証必須」を明記（doc補強）。
  後続への注意: routes（/api/x/oauth/start・callback, X連携M）実装時は必ず tx.userId===session.userId を検証（cookie-forcing/session-fixation防御）。BYOKユーザーApp資格情報（user_api_keys provider='x'のclient_id/secret）の解決はroute層で追加。X_MANAGED_CLIENT_SECRET有無でconfidential/publicが切り替わる。state TTLは技術判断で600s（`X_OAUTH_STATE_MAX_AGE_SEC`）。token refresh単一flight（lease）はT-M0-21で`exchangeCodeForToken`と同じrequest primitiveを再利用。

### T-M0-21: X token refreshのsingle-flight制御 `done`
- 参照: 要件05 §4.3、要件02 §3.3、PRD §8.1 / 依存: T-M0-20、T-M0-09 / サイズ: M
- 完了条件:
  - 並行2実行でもrefresh HTTP callが1回だけ実行され（モック）、待機側は最大10秒待って更新済みtokenを再読込する
  - token_refresh_lock_id/locked_atの条件付き更新でleaseが取得され、1分超のstale leaseは回収されて別実行がrefreshできる
  - rotated refresh tokenと期限がlock ID一致を条件に同一transactionで更新され、invalid_grant・必要scope不足時はstatus=expiredへ更新してleaseが解除される
- メモ: 「access tokenが5分以内に失効するならrefresh」の判定を含むgetValidAccessTokenヘルパとして実装。expired化に伴う再連携通知の作成はフックのみ用意し通知機能マイルストーンで接続する。
  実装結果: `src/lib/x/oauth.ts`に`exchangeRefreshToken`（`grant_type=refresh_token`。code交換と同じ`postToken`プリミティブ再利用）を追加。`src/lib/x/token-refresh.ts`（純粋・注入可能: `getValidAccessToken`。失効5分前判定→`token_refresh_lock_id/locked_at`の条件付きUPDATEでlease取得〔`locked_at < now()-1min`でstale回収〕→取得後に再鮮度確認→`exchangeRefreshToken`→lock ID一致を条件に同一UPDATEで access/refresh/expiry/scope反映＋lease解除。lease未取得側は最大10秒poll〔`sleep`注入可〕して更新済みtokenを再読込、超過で`XTokenRefreshTimeoutError`(retryable)。`invalid_grant`→`status=expired`＋`onExpired`フック＋`XTokenExpiredError`。必要scope不足も同様。rotated refresh未返却時は既存を維持。定数`TOKEN_REFRESH_THRESHOLD_MS`/`WAIT_MAX_MS`/`WAIT_POLL_MS`）。`token-refresh-server.ts`（server-only: pool.query〔都度取得・即解放〕・crypto・managed clientを束ねる`getValidXAccessToken`。BYOKユーザーApp資格情報の解決はX連携MSへ委譲＝明示エラー、T-M0-20後続注記どおり）。
  設計判断: leaseは「行の値」（advisory/session lockでない）＝Supavisor transaction modeプーラ安全。refresh HTTP中はDB接続を保持しない（各操作をpool.queryで実行、要件01 §3.2/§6）。lock ID一致条件でstale回収と衝突しても他実行の更新を破壊しない。invalid_grantのみexpired扱い（401/5xxは再連携化せずlease解除＋retryable伝播）。テスト: unit 11（鮮度/1回refresh/rotated維持/invalid_grant→expired/scope不足/transient解除/no_refresh/既expired/未接続/待機再読込/待機timeout）＋DB 4（並行1回・stale回収・鮮度skip・invalid_grant→expired）。全222件・lint/typecheck通過。doc: 要件05 §4.3が既に本設計を規定・実装は準拠のためdocs変更なし。
  後続への注意: worker/Server Actionは投稿前に`getValidXAccessToken(xAccountId)`で有効tokenを取得（T-M0-22のX投稿クライアントが使用）。BYOK client資格情報解決とexpired時の再連携通知の実配線はX連携/通知MSで追加。`onExpired`は現状フックのみ。

### T-M0-22: X投稿・読取クライアントとX_POSTING_MODE=dry_run動作 `done`
- 参照: PRD §8.1、要件04 §5、要件04 §10、要件01 §3.1、K-1 / 依存: T-M0-21 / サイズ: M
- 完了条件:
  - X_POSTING_MODE=dry_runでは投稿・削除のHTTP呼び出しが一切発生せず、dry-runであることを明示した擬似結果（擬似tweet_id）が返り、実tweet_id・利用枠を作らない
  - 429/5xx/networkで指数backoff+jitterの最大2回retry後に失敗し、401/403はretryせず失効エラーへ正規化される（モックで検証）
  - POST /2/tweets（reply連結in_reply_to・media_ids指定）・DELETE・GET /2/users/me・tweet読取（public/non-public metrics fields指定）の各リクエスト構築と応答の正規化がテストを通る
- メモ: media uploadはIF定義とdry_run挙動まで（実装詳細は投稿実行マイルストーン）。X API呼び出しのexternal_api_usage_events記録は台帳機能実装時に接続するため、request ID・数量を返す共通レスポンス型だけ整えておく。実装時にX API公式ドキュメントで最新仕様を確認する。
  実装結果: `src/lib/x/client.ts`（純粋・注入可能: `createPost`〔text/reply.in_reply_to_tweet_id/media.media_ids/quote_tweet_id〕・`deletePost`・`getMe`・`getTweetMetrics`〔ids＋tweet.fields=public_metrics,non_public_metrics〕・`uploadMedia`〔IF＋dry_run擬似media id、live未実装=投稿実行MS〕。共通メタ`XApiMeta`〔requestId・quantity・dryRun〕を全応答で返す。`callX`がretry込みHTTP: `../jobs/retry`の`isRetryable`/`backoffMs`/`shouldRetry`/`MAX_ATTEMPTS`を再利用し429/5xx/networkを最大2回backoff+jitter retry、401/403は`XApiError`(kind='auth')＝失効エラーへ正規化しretryしない。`X_API_BASE_URL=https://api.x.com/2`）。`client-server.ts`（server-only: global fetch→`XHttp`〔request IDをx-transaction-id/x-request-idヘッダから取得〕・`xPostingMode`=env.X_POSTING_MODE・`xClientDeps`）。公式仕様確認: docs.x.comでPOST /2/tweets body形状（text/reply/media/quote_tweet_id・応答data.id）を確認（2026-07-22）。
  仕様判断（doc反映済み）: §10の「dry_runではX APIを呼ばず」を「投稿・削除・media upload（書き込み）を抑止、読取（users/me・tweet metrics）はtweet/枠を作らないためmodeに依らず実行」と明確化（要件04 §10更新）。
  テスト: client unit 12（dry_run write抑止3・request構築/正規化5〔create body・省略・delete・me・metrics〕・retry 4〔5xx回復・network回復・429上限失敗・401非retry正規化〕）。全234件・lint/typecheck通過。
  後続への注意: 投稿worker（post_publish, M4）は`getValidXAccessToken`(T-M0-21)で有効tokenを取得→`createPost`/`deletePost`をxClientDepsで呼ぶ。media upload liveと`external_api_usage_events`記録（返却request ID・quantityを使用）は投稿実行/台帳MSで接続。tweet読取のmetricsはmetrics_collector（M5）が使用。

## M1: 認証・課金

### T-M1-01: 認証基盤: Supabase SSRクライアントとセッション検証・signOut `done`
- 参照: A-2、要件03 §1、要件01 §2、要件01 §8、要件05 §4.0 / 依存: M0 / サイズ: S
- 完了条件:
  - ローカルSupabase（supabase start）で、Server Components／Server Actions／API Routeから共通ヘルパーでセッション有無を判定できる
  - signOutでSupabase sessionが破棄され/loginへ遷移する
  - service role・暗号鍵を参照するモジュールがserver-only化され、Client Componentからのimportがビルドエラーになる
- メモ: @supabase/ssrを使用。cookieはSecure/HttpOnly/SameSite=Laxを既定（要件01 §8）。以降の全タスクの土台。
  実装結果: `@supabase/ssr` v0.10.3＋`@supabase/supabase-js` v2.110.8。リクエスト単位client、`getUser()`共通session helper、refresh専用`proxy.ts`、service-role管理client、`signOut` Server Actionを追加。認証cookieはHttpOnly/SameSite=Lax、productionのみSecureで、refresh応答へcache禁止headerも伝播する。認証フローはServer側に限定しbrowser clientは持たない。
  検証: ローカルSupabase Authでユーザー作成→password login→session検証→signOut後の無効化を確認。全255テスト・lint・typecheck・Next production buildが成功。service-role clientをClient Componentへimportする検証用routeは期待どおり`server-only`ビルドエラーになり、検証後に削除済み。T-M1-08は既存のrefresh専用proxyへ認証・契約リダイレクトguardを追加する。

### T-M1-02: profiles自動作成hookとログイン後の冪等upsert `done`
- 参照: A-1、要件03 §1、要件02 §3.1、要件06 §3.4 / 依存: M0、T-M1-01 / サイズ: S
- 完了条件:
  - ローカルSupabaseでauth.usersへのinsert時にprofiles rowが自動作成され、email・plan=standard・subscription_status=incomplete・notification_config/news_configの初期値（要件06 §3.4）が入る
  - hook失敗を模したユーザー（profiles row欠落）でもログイン後初回アクセスの冪等upsertで補完され、2回実行しても1行のまま既存値を壊さない
- メモ: 17テーブルのmigration・RLSはM0成果物を前提。初期値はコード定数（要件02 §6）から投入する。
  実装結果: `auth.users`のAFTER INSERT trigger（`security definer`・空`search_path`）で、email・standard/incomplete・AI目的／ニュース／通知の初期設定を持つprofileを自動作成するmigrationを追加。認証済みユーザーのprofile欠損は共通session helperからservice-role clientで`id`競合時DO NOTHINGのinsert-only upsertを行い、既存の設定・契約値を変更せず補完する。
  検証: ローカルSupabase Authでtrigger作成値、profile削除後の補完、2回目の補完でも1行かつカスタマイズ済み値を保持することを確認。全261テスト・lint・typecheck・Next production buildが成功。shadow DBで全migrationを再適用し、schema diffなしを確認。Supabase公式のuser data trigger推奨構成も確認し、要件01／02／03へ反映した。

### T-M1-03: signUp Server ActionとSC-02会員登録画面（規約同意version保存） `done`
- 参照: A-1、SC-02、要件03 §1、要件05 §4.0、要件05 §12、要件06 §11 / 依存: T-M1-01、T-M1-02 / サイズ: M
- 完了条件:
  - ローカルSupabase＋Inbucketで登録するとpending userが作成され確認メールが届く。画面に確認メール再送導線が表示される
  - 利用規約同意とプライバシーポリシー確認の2つのcheckboxが別々に必須で、現行version不一致は拒否。成功時にterms_version/terms_accepted_at/privacy_version/privacy_acknowledged_atがprofilesへ保存される
  - password 12〜64文字・UTF-8 72bytes以下・確認用一致のzod検証が通り、エラー文言からメール存在有無・秘密値が漏れない
- メモ: captcha_tokenの受け口だけ設け、Turnstile検証は後続タスクで有効化。規約・プライバシーの正式文面は法務ページ担当マイルストーンの成果物待ちのため、リンク先は/terms・/privacyの暫定ページ、versionはコード定数で管理。password managerの生成・貼り付けを妨げないこと。
  実装結果: `signUp` Server Action、SC-02会員登録フォーム、確認メール再送Action、暫定`/terms`・`/privacy`を追加。現行versionは両文書とも`2026-07-22-draft`で、別々の明示checkboxとversion一致をzod検証後、profileへ同意時刻とともに保存する。passwordは12〜64文字・UTF-8 72 bytes以下・確認一致を検証し、Auth/provider詳細やメール存在有無は共通文言へ隠す。`captcha_token`は受け口とSupabaseへの伝播まで実装し、必須化はT-M1-07で行う。
  検証: 実ブラウザ＋ローカルSupabaseでpending user作成、profile同意4項目保存、Mailpitへの確認メール到着（redirect先`/auth/confirm`）、成功画面と再送導線を確認。全268テスト・lint・typecheck・Next production buildが成功。Supabase Authはメール確認必須・最小password 12文字・localhostの`/auth/confirm`許可へ同期した。

### T-M1-04: GET /auth/confirm（メールtoken_hash検証と遷移制御） `done`
- 参照: 要件01 §4、要件03 §1、要件05 §3、SC-02、SC-03 / 依存: T-M1-03 / サイズ: S
- 完了条件:
  - signup確認メールのリンクからServer側verifyOtpが成功し/plansへ、recovery typeは/reset-passwordへ遷移する（ローカルSupabaseで確認）
  - 期限切れ・使用済み・不正tokenはすべて同一の汎用エラーにまとまり、signupは再送導線・recoveryは再申請導線を表示する
  - nextは許可済みのアプリ内相対パスのみ反映され、遷移前にURLからtoken_hashとtypeが除去される
  実装結果: Supabaseのconfirmation／recoveryメールを`RedirectTo`＋`TokenHash`のカスタムテンプレートへ変更し、`GET /auth/confirm`が`type=signup|recovery`だけをServer側`verifyOtp`する。成功先はsignup=`/plans`、recovery=`/reset-password`で、任意`next`は`/plans`・`/reset-password`・`/app`配下のみ許可し、token_hash/type/next/fragmentを除去する。失敗はprovider詳細を含まない`/auth/error?flow=...`へ統一し、signup再送フォームとrecovery再申請導線を出す。
  検証: 実ブラウザ＋ローカルSupabase/Mailpitでsignup token_hash検証→確認済みuser→`/plans`、recovery token_hash検証→`/reset-password`、両リンク再利用時の共通エラー導線を確認。全289テスト・lint・typecheck・Next production buildが成功。Supabase公式のNext.js SSR token_hash方式を2026-07-22に確認し要件01／03／05／06へ反映した。

### T-M1-05: signIn Server ActionとSC-03ログイン画面 `done`
- 参照: A-2、SC-03、要件03 §1、要件05 §4.0、要件01 §5 / 依存: T-M1-01、T-M1-04 / サイズ: M
- 完了条件:
  - 確認済みユーザーがログインでき、safeな相対nextがあればそこへ、なければ/app（プラン未選択なら/plans）へ遷移する。外部URLのnextは無視される
  - メール未確認ユーザーはアプリ本体へ入れず、確認メール再送導線が表示される
  - 認証失敗はメール存在有無・失敗理由で文言が変わらない汎用エラーで、連続失敗時は同じ文言で待機を促す
  実装結果: `signIn` Server ActionとSC-03 `/login`を追加。成功時に欠損profileを補完し、`incomplete|incomplete_expired`は`/plans`、それ以外は許可済み`next`（`/plans`・`/reset-password`・`/app`配下）または`/app`へ遷移する。外部URLは破棄する。Supabaseの安定した`email_not_confirmed`コードだけを再送状態へ分岐し、invalid credentials・rate limit・provider障害は同じ汎用文言へ正規化する。`captcha_token`の受け口・伝播は実装済みで必須化はT-M1-07。
  検証: 実ブラウザ＋ローカルSupabaseでactiveユーザーのsafe next、未契約ユーザーの`/plans`、未確認ユーザーの再送UI・再送受理を確認。全296テスト・lint・typecheck・Next production buildが成功。Supabase公式の`signInWithPassword`と未確認email設定を2026-07-22に確認し、要件03／05／06へ反映した。

### T-M1-06: パスワード再設定フロー（requestPasswordReset／updatePassword／/reset-password画面） `done`
- 参照: A-2、SC-03、要件03 §1、要件05 §4.0、要件05 §12 / 依存: T-M1-04、T-M1-05 / サイズ: M
- 完了条件:
  - 登録済み・未登録どちらのメールでも同一の受理応答を返し、登録済みにのみrecoveryメールが届く（Inbucketで確認）
  - recoveryリンク→/auth/confirm→/reset-passwordで新passwordを設定し、新passwordでログインできる
  - 有効なrecovery sessionがないupdatePassword呼び出し、password制約違反・確認不一致は拒否される
  実装結果: `requestPasswordReset`／`updatePassword` Server Actions、`/login?mode=forgot-password`、`/reset-password`を追加。申請は登録有無・provider結果を隠す同一受理応答とし、recoveryの`verifyOtp`成功時だけuser_idと発行時刻を`APP_ENCRYPTION_KEY`で封緘したHttpOnly／SameSite=Lax／15分TTL marker cookieを発行する。更新時はSupabase sessionのuser_idとmarkerを照合し、成功後はlocal sessionとmarkerを破棄して完了通知付きloginへ戻す。password 12〜64文字・UTF-8 72 bytes以下・確認一致を共通zod schemaで検証する。
  検証: 実ブラウザ＋ローカルSupabase/Mailpitで登録済み／未登録の同一受理表示、登録済みだけのrecoveryメール到着、リンク検証→password更新→新passwordログイン、marker消費後の通常sessionによる更新拒否を確認。全308テスト（243成功・DB条件なし65 skip）・lint・typecheck・Next production buildが成功。Supabase公式の`resetPasswordForEmail`／password更新仕様を2026-07-22に確認し、要件03／05／06へ反映した。

### T-M1-07: Turnstile統合（signup／login／password reset） `done`
- 参照: 要件01 §2、要件01 §8、要件03 §1、要件05 §12、SC-02、SC-03 / 依存: T-M1-03、T-M1-05、T-M1-06 / サイズ: S
- 完了条件:
  - Cloudflare公開テストキー（常に成功／常に失敗）で、signup/login/resetの成否が切り替わることをローカルで確認できる（Supabase CLIのconfig.tomlでAuth CAPTCHAを有効化）
  - captcha_token欠落・再利用のリクエストはServer側で拒否される
- メモ: 本番のsite/secret key発行とSupabase Dashboard側のCAPTCHA有効化はユーザー作業（open_questions参照）。
  実装結果: 依存ライブラリを追加せずCloudflare公式scriptを明示renderする共通`TurnstileWidget`を実装し、signup／確認メール再送／login／password reset申請へ配置した。Action完了・期限切れ・widget失敗時にtokenを破棄してwidgetをresetする。3 Actionのzod schemaでtoken欠落をprovider呼び出し前に拒否し、Supabase Authへ`captchaToken`を必ず渡して、不正・期限切れ・再利用の安定コード`captcha_failed`をprovider詳細なしの共通エラーへ正規化した。ローカル`config.toml`もTurnstile有効＋`env(TURNSTILE_SECRET_KEY)`参照へ変更した。
  検証: 実ブラウザ＋ローカルSupabaseでCloudflare公式の常時成功site/secretによりsignup・login・password reset申請が成功し、常時失敗secretへ切り替えると3フォームとも共通CAPTCHAエラーで拒否されることを確認。欠落・`captcha_failed`（再利用相当）はActionテストでもprovider未呼出し／安全な拒否を確認した。全311テスト（246成功・DB条件なし65 skip）・lint・typecheck・Next production buildが成功。Cloudflare Turnstile（5分TTL・single-use・最大2,048文字）とSupabase Auth CAPTCHA／`captcha_failed`を2026-07-22に公式資料で確認し、要件01／05／06とローカル運用手順へ反映した。

### T-M1-08: 認証ガードmiddleware（未ログイン・プラン未選択・incompleteのリダイレクト） `done`
- 参照: 要件01 §5、要件03 §5、SC-04 / 依存: T-M1-05 / サイズ: M
- 完了条件:
  - 未ログインで/app/*へアクセスすると/login?next=...へリダイレクトされ、nextはアプリ内相対パスのみ許可（外部URLは破棄）
  - ログイン済みでプラン未選択またはincomplete/incomplete_expiredは/plansへリダイレクトされ、/app/settingsの課金・問い合わせタブへのパスだけ許可される
  - trialing/active/past_due等のユーザーは/app配下へリダイレクトされず閲覧できる
- メモ: 生成・投稿系mutationの契約状態別拒否は後続の「契約状態別アクセス制御」タスクで実装。/app/settings課金タブの実体はPortalタスクで作るため、ここではパス許可のみ先行。
  実装結果: Next.js 16の`proxy`内でSupabase session refreshとroute guardを一体化し、`getUser()`で本人性を検証する。未ログインの`/plans`・`/app`配下はrequestのpathname＋queryだけから組み立てた`/login?next=...`へ、本人profileをRLSで取得できない場合または`incomplete|incomplete_expired`は`/plans`へfail closedする。未契約者の例外URLは`/app/settings?tab=billing|support`へ固定し、`trialing|active|past_due|unpaid|paused|canceled`は閲覧を許可する。session refreshで更新されたcookieとcache禁止headerはredirect応答へ引き継ぐ。
  検証: CookieなしHTTPで`/app/posts?tab=drafts`→`/login?next=%2Fapp%2Fposts%3Ftab%3Ddrafts`、実ブラウザ＋ローカルSupabaseでincompleteの通常`/app`→`/plans`・billing/support通過、activeの`/app`通過を確認。全340テスト（275成功・DB条件なし65 skip）・lint・typecheckが成功。production buildは同じ依存・設定のT-M1-07直後に成功済みだが、この差分後の再実行はGoogle Fonts取得にネットワーク許可が必要で、ワークスペースの承認クレジット不足により再検証できなかった（TypeScript工程は独立のtypecheckで成功）。要件01／03／06へ正確なguard規則とcanonical tab URLを反映した。

### T-M1-09: POST /api/stripe/checkout（Price ID対応表・Customer冪等作成・trial 1回制御） `done`
- 参照: O-1、要件03 §2、要件03 §2.1、要件05 §3、要件05 §11、要件01 §3.3 / 依存: T-M1-02、T-M1-05 / サイズ: M
- 完了条件:
  - planはstandard/md/premiumのみ受け付け、Price IDはサーバー側の環境変数対応表から解決される。クライアントからのPrice ID・任意の外部return URLは受け取らない（success/cancelはAPP_BASE_URL基準で組み立て）
  - trial_used_at is nullの場合だけ7日trialが設定され、非nullでは付与されない（Stripe SDKをモックした単体テストで検証）
  - 既存stripe_customer_idを再利用し、未作成時はuser_id metadata＋冪等keyでCustomerを1件だけ作成する。未ログイン・Origin不一致は拒否
- メモ: Stripe SDK初期化・Price ID対応表・プラン定義コード定数（要件02 §6）はここで整備し、webhook・Portalタスクと共有する。実Stripe（test mode）でのE2Eはアカウント準備待ち（open_questions）。
  実装結果: `stripe@22.3.2`（API version `2026-06-24.dahlia`固定）のserver-only client、3プラン共通定義とenv Price ID対応表、同一Origin検証、`POST /api/stripe/checkout`を追加。入力はstrictな`plan`だけで、Price ID・user/customer ID・外部return URL・未知フィールドを拒否する。本人profileの既存Customerを再利用し、未作成時はemail＋`user_id` metadataと`space-ai:customer:{user_id}`冪等keyで作成後、NULL条件付きで保存する。Sessionはsubscription mode／カード登録必須／server固定Price・success/cancel URL／user_id・plan metadataとし、`trial_used_at IS NULL`時だけ7日trialを付与する。API応答は共通JSON形式＋no-store、Stripe詳細は`provider_error`へ秘匿する。
  検証: Stripe SDK注入モックでOrigin・未認証・plan/未知フィールド拒否、3 Price対応、既存Customer再利用、Customer冪等作成と保存、trial初回のみ、固定return URL、provider/DBエラー秘匿を19テストで確認。全359件（294成功・DB条件なし65 skip）・lint・typecheck・Next production buildが成功。実Stripe test mode E2Eは資格情報待ちのため未実施。Stripe Checkout Session／Customer／idempotency公式仕様を2026-07-22に確認し、要件03／05へ反映した。

### T-M1-10: SC-04プラン選択画面（3プラン比較・法定表示・Checkout開始） `done`
- 参照: SC-04、O-1、要件03 §2、要件03 §2.1、要件06 §11、要件01 §4 / 依存: T-M1-09 / サイズ: M
- 完了条件:
  - 3プランの税込月額・Xアカウント上限・BYOK要否・premium月間利用枠が比較表示され、BYOKプランの別途API費用（X・生成AI）が明示される
  - Checkout開始前に税込月額・7日trial・trial後の自動更新・支払時期・解約方法・提供開始時期が表示され、特定商取引法表記へ到達できる
  - プラン選択で/api/stripe/checkoutが呼ばれ、モック環境でCheckout URLへのリダイレクトまで到達する
- メモ: 特商法ページ本体は法務ページ担当マイルストーンの成果物。未完成の間は暫定ページへリンク。
  実装結果: 認証必須のSC-04 `/plans`を追加し、共通`PLANS`定数からStandard／MD／Premiumの税込月額・Xアカウント上限、BYOK要否、Premium月間4枠をカード表示する。Standard／MDのX・生成AI API利用料が別途かかることをカード内と画面末尾へ明示した。ボタンより前に初回7日trial、カード登録、月次自動更新、初回／毎月の支払時期、Customer Portalでの期間末解約、提供開始を再掲する。選択時はplanだけをCheckout APIへPOSTし、HTTPSの`data.url`だけへ遷移、送信中disableと安全な再試行エラーを備える。success/canceled帰還表示と、T-M6-14まで暫定版と明示した`/legal/commercial-transactions`も追加した。
  検証: fetch／navigationモックでplanだけのPOST→Checkout URL遷移、API失敗・不正shape・非HTTPS URL・network失敗時の遷移抑止を確認。実ブラウザ＋ローカルSupabaseで認証→`/plans`、申込条件、全3カード、特商法リンク／暫定ページを確認し、1440px／390pxとも横overflowなし。全364件（299成功・DB条件なし65 skip）・lint・typecheck・Next production buildが成功。外部通信許可下で既存Auth統合テストを同時実行するとCAPTCHA tokenなしの1件が失敗するため、通常の条件付きskip環境で全テストを実行し、buildは分離した。要件06 §1.1へ画面仕様を同期した。

### T-M1-11: POST /api/stripe/webhook受信基盤（署名検証・stripe_events冪等記録） `done`
- 参照: O-1、要件03 §4.1、要件03 §4.2、要件02 §3.16、要件05 §11、要件04 §5 / 依存: T-M1-09 / サイズ: M
- 完了条件:
  - raw bodyの署名検証に失敗すると4xx、正しい署名（Stripe SDKのgenerateTestHeaderStringでローカル生成）なら2xxを返す
  - 同一event_idの再送はstripe_events.event_idのinsert競合により処理済みとして2xx（副作用なし）
  - 未知Price IDのイベントはprofiles未更新・stripe_events未記録のまま非2xxを返してStripe再送で復旧可能にし、Sentry（モック）へ記録される
- メモ: アプリ内retryは実装せず、非2xxによるStripe再送へ委ねる（要件04 §5）。イベント種別ごとの処理は次タスク以降。
  実装結果: Node runtimeの`POST /api/stripe/webhook`と注入可能な検証／処理coreを追加。request bodyを1回だけraw textで読み、`Stripe-Signature`＋環境別secretをSDK `constructEvent`（既定5分tolerance）で検証する。対象6 eventだけを処理し、対象外は記録なしで200。subscription eventの単一Priceをserver対応表でinsert前に検証し、未知・欠落・複数PriceはSentryへevent ID/type/Price IDだけを記録して500とする。既知eventは短いtransactionで`stripe_events`へ`ON CONFLICT DO NOTHING RETURNING`でclaimし、重複時は副作用なしで200、claim後のevent別処理callbackも同transaction内で実行するため後続タスクのprofile更新失敗時はevent記録ごとrollbackできる。署名／provider詳細は応答へ出さず全応答no-store。
  検証: Stripe SDK `generateTestHeaderString`でraw body署名成功、header欠落／不正400、初回processed、同一event再送duplicate＋副作用1回、未知Priceの未記録／未更新／Sentry mock／500、対象外ignoredを5 unit testで確認。ローカルPostgresで同じevent IDを2回処理し、PK競合で1 row・副作用1回になるDB統合テストも成功。全370件（304成功・DB条件なし66 skip）・lint・typecheck・Next production buildが成功。Stripe公式のraw body署名、5分tolerance、非2xx再送、順序非保証、重複成功応答を2026-07-22に確認し、要件03／05へ反映した。

### T-M1-12: webhook subscription同期（checkout完了・subscription作成/更新/削除・順序逆転防止） `done`
- 参照: O-1、要件03 §3、要件03 §4.1、要件03 §4.2、要件02 §3.1 / 依存: T-M1-11 / サイズ: M
- 完了条件:
  - checkout.session.completed／customer.subscription.created・updatedはsubscriptionをStripe APIから再取得（deletedのみevent最終状態でcanceled化）し、plan・subscription_status・current_period_end・cancel_at_period_end・trial_ends_at・stripe_customer_id・stripe_subscription_id・subscription_event_created_atがprofilesへ同期される（SDKモックの単体テスト）
  - event.createdがprofiles.subscription_event_created_atより古いイベントはprofile更新をskipし、順序逆転で古い契約状態へ戻らないことをテストで確認
  - trialingを初めて確認した時だけtrial_used_atを設定し、解約・再契約でもnullへ戻らない。profile更新とstripe_events記録が同一transactionでcommit/rollbackされる
  実装結果: `checkout.session.completed`／subscription created・updatedは署名検証後かつDB transaction前にSubscriptionを再取得し、deletedだけはevent内の最終objectを`canceled`として使用するprepare/apply分離をWebhook基盤へ接続した。単一Subscription ItemのPriceをserver対応表へ変換し、現行Stripe APIのitem `current_period_end`、status、trial、解約予定、Customer／Subscription ID、metadata user_idをprojection化する。transaction内でprofile候補をrow lockし、Customer IDまたはCustomer未保存時のUUID user_idが一意に一致する場合だけ9契約項目を更新する。保存済みevent時刻より古いeventはprofile更新をskip、同時実行もlock後に再判定する。初回trialingだけ`trial_used_at=trial_start`（欠落時event.created）をcoalesce保存し、以後保持する。profile更新とevent claimは同transactionで、mapping／更新失敗時は両方rollbackする。
  検証: Stripe SDK retrieveモックでcheckout／created／updatedがsubscription IDを再取得し、deletedだけ再取得しないこと、単一itemのPrice／期間／status／trial変換、未知・複数Price拒否を6 unit testで確認。ローカルPostgresで全同期値、初回trial保持、古いeventの逆転防止、失敗時の`stripe_events` rollbackを1統合シナリオで確認。全377件（310成功・DB条件なし67 skip）・lint・typecheck・Next production buildが成功。Stripe公式のSubscription retrieve／Item current_period_end／契約webhookライフサイクルを2026-07-22に確認し、要件03へ反映した。

### T-M1-13: invoice.payment_failed／invoice.paid処理と課金通知作成 `done`
- 参照: O-1、要件03 §4.1、要件03 §8、要件02 §3.15 / 依存: T-M1-12 / サイズ: S
- 完了条件:
  - invoice.payment_failedでsubscriptionを再取得して現在statusを同期し、billing種別のnotifications rowがdedupe_key付き・設定snapshot付きで作成される（モックテスト）
  - invoice.paidで支払い復旧（status回復）が同期される
- メモ: 通知メール送信job・通知一覧UIは別マイルストーン。ここではrow作成まで。決済失敗の常設バナーは「契約状態別アクセス制御」タスクで表示する。
- 実装メモ:
  実装結果: 現行Invoiceの`parent.subscription_details.subscription`からSubscription IDを解決し、payment_failed／paidとも署名検証後かつDB transaction前に現在のSubscriptionを再取得して既存の契約projectionへ統合した。一回払いinvoiceはeventだけを処理済みにする。payment_failedはprofile同期と同transaction内でbilling通知を作り、`billing:invoice:{invoice_id}:payment_failed`でinvoice単位に重複排除する。通知設定のin-app／emailを配信列へ反映し、attempt count・invoice／subscription ID・同期status・設定snapshotをpayloadへ保存する。両channel OFF時は通知を作らず、paidは現在statusへ復旧同期して新規通知を作らない。
  検証: Stripe SDK retrieveモックでfailed／paidがinvoice parentのSubscriptionを再取得すること、一回払いをskipすることを3 unit testで確認。ローカルPostgresで失敗status、同一invoice再送時の通知1件維持、設定snapshot／email queue、paid後のactive復旧、両channel OFF時の非作成を1統合シナリオで確認。全380件（313成功・DB条件なし67 skip）・lint・typecheck・Next production buildが成功。Stripe公式のInvoice object／Subscription webhookを2026-07-22に確認し、要件02・03へ反映した。

### T-M1-14: Customer Portal SessionとSC-11課金タブ最小実装 `done`
- 参照: O-1、要件03 §6、要件05 §3、要件05 §11、要件01 §3.3、SC-11 / 依存: T-M1-12 / サイズ: M
- 完了条件:
  - ログイン済み＋Origin一致でPortal Session URLが返り、stripe_customer_id未保有・未ログイン・Origin不一致は拒否される（モックテスト）
  - SC-11課金タブに現在プラン・subscription_status・期間終了日・解約予定（cancel_at_period_end）とPortalボタン、問い合わせ先（SUPPORT_EMAILのメールリンク）が表示される
  - Portal configuration（値下げはdecreasing_item_amountで期間末予約・解約は期間末・trial中変更はcontinue_trial・値上げは即時日割り）を作成するsetupスクリプトがあり、dry-runで設定内容を出力できる
- メモ: SC-11の他タブ（APIキー・Xアカウント・通知）は他マイルストーン。incompleteユーザーにも課金・問い合わせタブを許可し、認証ガードmiddlewareの許可パスと整合させる。STRIPE_PORTAL_CONFIGURATION_IDの実発行は実Stripeアカウント準備後。
- 実装メモ:
  実装結果: `POST /api/stripe/portal`を追加し、Origin完全一致→Supabase session→本人profileのCustomer IDの順に検証して、サーバー固定のConfiguration ID／`/app/settings?tab=billing&portal=return`で短寿命Sessionを作成する。Customer未作成は`subscription_required`、Stripeエラーはprovider詳細を伏せた`provider_error`に統一した。SC-11最小画面は課金・問い合わせタブを実装し、プラン、契約status、JST期間終了日、解約予定、Portalボタン、プラン導線、`SUPPORT_EMAIL`のメールリンク、Portal復帰表示をprofileから表示する。setupスクリプトは3 Priceの同一Product所属を検証し、値下げ期間末・解約期間末・trial継続・値上げ即時日割り・支払方法更新・請求履歴を固定したConfigurationを作る。実IDの発行は実Stripeアカウント準備後。
  検証: Portal APIの正常系、development設定省略、未ログイン、Origin不一致、Customer欠損、provider失敗、クライアントのHTTPS制約、Configurationの4方針／同一Product制約を12 testで確認。ローカルブラウザで認証後の課金値、問い合わせメール、Portal復帰表示を確認し、一時ユーザーを削除した。dry-run出力、全392件（325成功・DB条件なし67 skip）・lint・typecheck・Next production buildが成功。Stripe公式のPortal Session／Configuration／期間末ダウングレード仕様を2026-07-22に確認し、要件03・05・06へ反映した。

### T-M1-15: Checkout／Portal復帰時の未反映subscription同期 `done`
- 参照: 要件03 §3、SC-04、SC-11 / 依存: T-M1-12、T-M1-10、T-M1-14 / サイズ: S
- 完了条件:
  - Checkout success URL・Portal returnからの復帰時、profilesが未反映（webhook未着）ならsubscriptionを1回だけ再取得して同期し、反映済みならStripe APIを呼ばない（モックで呼び出し回数を検証）
  - 通常の画面表示ではStripe APIを呼ばないことをテストで確認
- メモ: 同期ロジックはwebhookの同期処理を共通化して再利用し、順序逆転防止（subscription_event_created_at比較）も同じ規則を適用する。
- 実装メモ:
  実装結果: Checkout／Portal Session作成成功時にuser ID・source・開始時刻をAES-256-GCMで封緘した30分TTLの`HttpOnly`／`SameSite=Lax`復帰cookieを発行し、戻り先を`GET /api/stripe/return`へ統一した。復帰handlerはsessionとmarkerのuser／sourceを照合し、開始後の`subscription_event_created_at`がprofileへ反映済みならStripeを呼ばない。未反映時だけ、CheckoutはSessionの`client_reference_id`／Customerを本人profileと照合してSubscription IDを解決し、Portalは保存済みSubscription IDを使い、現在Subscriptionを1回取得する。webhook共通のPrice検証・profile mapping・row lock・順序逆転防止・trial保持projectionをtransaction適用し、markerを削除して正規画面へ戻す。同期失敗は`sync=pending`としてwebhook再送へ委ねる。
  検証: Checkout／Portalの未反映時にSubscription retrieveが各1回だけで共通projectionを適用すること、反映済み2経路とmarkerのない通常表示で外部APIを一切呼ばないこと、別userのCheckout Sessionを拒否すること、markerの往復・TTL・改ざん検知・cookie属性を9 testで確認。既存Checkout／Portal契約を含む全401件（334成功・DB条件なし67 skip）・lint・typecheck・Portal dry-run・Next production buildが成功。Stripe公式のCheckout Session／Subscription retrieveを2026-07-22に確認し、要件03・05・06へ反映した。

### T-M1-16: 契約状態別アクセス制御（閲覧/実行マッピング・mutationガード・課金バナー） `done`
- 参照: 要件03 §5、要件01 §5、要件05 §2.2、要件06 §2、SC-05 / 依存: T-M1-12、T-M1-14、T-M1-08 / サイズ: M
- 完了条件:
  - 8つのsubscription_statusすべてについて「閲覧可否・生成/投稿/自動実行可否・主導線」のマッピングを単体テストで検証（trialing/activeのみ実行可、incomplete系は設定・プランのみ）
  - past_due/unpaid/paused/canceledは既存データ閲覧が可能なまま、生成・投稿系mutationの共通ガードがsubscription_required（details に不足項目と設定画面パス）を返す
  - 決済失敗・契約停止時はnotification_configにかかわらずヘッダー直下に常設バナーが表示され、支払い更新（Portal）または新規Checkoutへの導線を出す。trialingはtrial終了日を表示する
- メモ: ガードは共通ヘルパーとして実装し、M3以降の生成・投稿Server Actionから呼び出す前提。課金停止を理由にデータを自動削除しない。
- 実装メモ:
  実装結果: 8つの`subscription_status`について閲覧範囲、生成／投稿／自動実行可否、主導線を型付き共通マッピングへ集約し、route guardとlogin後遷移も同じ定義へ統合した。`trialing|active`だけを許可する共通mutationガードは、それ以外を`subscription_required`として`missing=[subscription]`、現在status、`settingsPath`付きで拒否する。共通App Layout／最小ホームを追加し、通知設定を読まずに`past_due|unpaid|paused`へPortal、Customer欠損と`canceled`へCheckoutの常設バナーをヘッダー直下へ表示する。`trialing`はJST終了日、`active`はバナーなしとし、停止statusでも子画面を覆わず既存データ閲覧を維持する。Portalボタンは設定画面と共通component化した。
  検証: 全8 statusの閲覧範囲・実行可否・主導線、許可2 status、停止4 statusの安定error details、trial／停止／解約バナーを19 unit testで確認。通知設定billing両OFFのローカルユーザーで`past_due`のPortal常設表示、`canceled`のCheckout切替、`trialing`の2026年7月30日JST表示をブラウザ確認し、一時ユーザーを削除した。関連route／loginを含む全420件（353成功・DB条件なし67 skip）・lint・typecheck・Next production buildが成功。要件03・05・06へ反映した。

### T-M1-17: プラン変更同期処理（Xアカウント無効化・AI用途設定の再検証） `done`
- 参照: 要件03 §6、要件02 §3.3、要件02 §4.1、A-6 / 依存: T-M1-12 / サイズ: M
- 完了条件:
  - md/premium→standardの同期でactive_x_account_idの1件だけactiveを維持し残りをdisabled化（active未設定ならcreated_at最古のactiveを維持）。token・ベースmd・下書き・実績データは削除されない（seedデータの単体テスト）
  - standard/md→premiumの同期でauth_type=byokのXアカウントがexpired化され（BYOKキーは削除しない）、premium→standard/mdの同期でauth_type=managedがexpired化される。いずれもwebhook同期後の同一処理として実行される
  - premium→BYOKの同期でai_purpose_configのtext/imageが登録済みvalidキーで再検証され、無効なら未設定へ戻る
- メモ: M2依存部分: OAuth再連携（BYOK/運営Appでの再認可）・enableXAccountによる再有効化・キー疎通検証の実処理はM2（X連携・APIキー）で実装する。本タスクはwebhook同期transaction内のstatus/設定更新とテストまでとし、expired化に伴う再連携要求バナーの接続もM2で行う。x_accounts・user_api_keysテーブル自体はM0のmigrationで存在する前提。
- 実装メモ:
  実装結果: Subscription profile更新後の同一transactionで旧plan→新planを判定し、standard／md→premiumはBYOK、premium→standard／mdはmanaged Xアカウントを`expired`化する。Standard適用は互換性失効後、選択中がactiveならその1件、そうでなければ`created_at,id`順の最古active 1件を維持し、他を`disabled`、候補なしは選択解除する。premium→BYOKは`ai_purpose_config.text|image`を登録済み`valid`キーと照合し、対応providerだけを維持して無効用途をnullへ戻す。plan不変／stale eventでは副作用を実行しない。status／選択／用途設定以外のtoken、scope、同意、BYOK ciphertext、ベースmd・履歴、学習source、下書き、tweet ID、実績、台帳は更新・削除しない。
  検証: ローカルPostgresの1 transactionシナリオで、MD→Standardの選択中1件維持、未選択時の最古1件fallback、他2件disabled、Standard→PremiumのBYOK 3件expired、Premium→MDのmanaged expired／選択解除、valid Anthropic text維持／invalid OpenAI image解除を確認した。同じseedでtoken 4件、BYOKキー2件、ベースmd 3件・履歴、下書き本文、tweet ID、実績JSONが不変であることを確認。DB統合2件、全421件（353成功・DB条件なし68 skip）・lint・typecheck・Next production buildが成功。要件02・03へ反映した。

### T-M1-18: 利用規約の再同意ガード（重大改定時） `done`
- 参照: 要件03 §1、要件02 §3.1、SC-02 / 依存: T-M1-16、T-M1-03 / サイズ: S
- 完了条件:
  - profiles.terms_versionが現行versionより古いユーザーは、既存データの閲覧を許可されたまま、生成・投稿系の実行前に再同意画面が表示される（共通ガードの単体テストで検証）
  - 再同意でterms_version/terms_accepted_at（必要ならprivacy側も）が更新され、以後ブロックされない
- メモ: 契約状態ガードと同じ実行前チェック機構に組み込み、M3以降の生成・投稿Actionが自動的に対象になるようにする。
  実装結果: 共通実行ガードを「契約状態→法務version」の順に拡張し、利用規約またはprivacyが現行versionでない場合は`legal_consent_required`と不足文書・現行version・`/app/consent`を返す。通常のroute guardでは法務versionを判定せず既存データ閲覧を維持する。再同意画面は古い文書だけを表示し、Server Actionで本人profileを再読込して明示checkboxと現行versionを検証後、該当version／同意時刻だけを更新する。既に現行の文書は上書きせず、両方現行ならno-opとして`/app`へ戻す。
  検証: 共通ガードの優先順位・閲覧継続・再同意後の解除、文書別更新、stale client version拒否、冪等no-opを単体7件で確認した。ブラウザで旧versionユーザーの`/app`閲覧、`/app/consent`の2文書表示、未選択エラー、同意後のversion／時刻更新、`/app`への復帰と再訪時redirectを確認。全428件（360成功・DB条件なし68 skip）・lint・typecheck・Next production buildが成功。要件02・03・05・06へ反映した。

## M2: X連携・キー・初期設定

### T-M2-01: AES-256-GCM暗号化エンベロープユーティリティ `done`
- 参照: 要件01 §2、要件01 §3.1、要件02 §1、PRD §7 / 依存: M0 / サイズ: S
- 完了条件:
  - encrypt→decryptのラウンドトリップ、nonceの毎回変化、auth tag改竄時の復号失敗をユニットテストで確認できる
  - 暗号文がversion・nonce・ciphertext・auth tagを含むJSON文字列のenvelope形式でtextカラムへ保存できる
  - Server onlyモジュールとして実装され、Client Componentからのimportがビルド時に検出・拒否される
- メモ: APP_ENCRYPTION_KEY（32 bytes相当）を使用。user_api_keysとx_accountsのtoken暗号化の共通基盤。鍵ローテーションは将来ADLのため対象外。
  実装結果: M0で先行実装したAES-256-GCM共通基盤を本タスクの完了条件に照らして再監査した。32-byteの`APP_ENCRYPTION_KEY`をUTF-8／hex／base64から厳密に解決し、12-byte random nonceで暗号化して`v/n/c/t`（version／nonce／ciphertext／auth tag）のJSON envelopeを返す。実行時入口`src/lib/crypto/index.ts`は`server-only`を先頭でimportして検証済み環境鍵を束縛し、Client ComponentからのimportをNext buildで拒否する。
  検証: 多バイト平文のencrypt→decrypt、JSON envelope 4要素、同一平文2回のnonce／ciphertext差異、ciphertext・auth tag改竄、異なる鍵、未知version、非JSON、鍵長を単体11件で確認した。server-only境界テスト4件とNext production buildも成功。要件01 §2／§3.1と要件02 §1は実装と一致しており文書変更なし。

### T-M2-02: App Shell骨格（6項目ナビ・ヘッダ・レイアウト） `done`
- 参照: 要件06 §2、要件01 §4、SC-05〜11 / 依存: M1 / サイズ: M
- 完了条件:
  - /app配下でPCは左ナビ・モバイルは下部ナビ/ドロワーに6項目（ホーム・ニュース・投稿・スケジュール・分析・AI設定）が表示され、SC-05〜10の各ルートへ遷移できる（各画面はプレースホルダで可）
  - ヘッダにアクティブXアカウント表示枠・通知ベル・アカウント設定（SC-11）導線が配置される
  - ナビ・ヘッダがキーボードのみで操作でき、focus表示が消えない
- メモ: 認証ガード（M1）配下に置く。読み込み中・空・失敗の共通状態コンポーネントの雛形もここで用意する。
  実装結果: `/app`認証ガード配下へPC固定左ナビ／モバイル固定下部ナビを実装し、ホーム・ニュース・投稿・スケジュール・分析・AI設定の6 routeと後続実装用プレースホルダを追加した。ヘッダーにはactive Xアカウント表示枠、通知ベル、SC-11導線を配置し、M1の契約バナーを維持した。共通のloading／empty／error（再試行）状態を部品化し、ナビ・ヘッダーの全操作へ明示的な`focus-visible`と40px以上の操作領域を設定した。
  検証: ナビ定義の順序・route・重複なしを単体2件で確認。実ブラウザでPC左ナビとヘッダー、X未選択表示、6リンクから各route／見出しへの遷移、共通空状態を確認した。全430件（362成功・DB条件なし68 skip）・lint・typecheck・Next production buildが成功。要件06 §2をv1.9へ同期した。

### T-M2-03: 発信設定スキーマ・テーマ選択肢マスタ・ベースmd生成ロジック `done`
- 参照: L-4、L-5、L-6、L-7、要件02 §4.4、要件02 §6、要件06 §3.3、要件06 §3.4、プロンプト §3.1〜3.4 / 依存: M0 / サイズ: M
- 完了条件:
  - x_accounts.settingsのzodスキーマが必須項目（persona3項目・主テーマ1件以上・tone5項目・NGは空可）を検証し、不正入力を拒否する
  - テーマ選択肢マスタがコード定数として定義され、各選択肢がnews_category対応（ai/web3/investment/対応なし）を持つ
  - settingsからテンプレート初版（セクション5〜6空欄）生成と、セクション1〜4のみ再構築（5〜6保持）を行うpure functionが、6見出しの順序・各1回の構造検証を含めユニットテストで確認できる
- メモ: tone初期値（です・ます調／絵文字1個まで／ハッシュタグ0件／スレッド番号あり）もここで定数化する。テンプレート全文はプロンプト設計書§3.2を正とする。
  実装結果: `x_accounts.settings`のstrictなzodスキーマを追加し、persona 3項目、主テーマ1件以上、6テーマの安定ID、tone、空を許可するNG設定を検証する。テーママスタはID／表示名／6つの`news_category`を1対1対応させ、tone初期値を定数化した。pure functionでテンプレート初版を機械生成し、`## 1.`〜`## 6.`の順序・一意性を検証する。設定再保存はセクション1〜4だけを再構築し、学習対象の5〜6をbyte-for-byteで保持する。NGワード原文はmdへ展開しない。
  検証: 必須persona、主テーマ、未知／重複テーマ、tone初期値、6見出し、初版5〜6空欄、1〜4再構築と5〜6保持、欠落／重複／順序違反を単体13件で確認した。既存テーマ定数9件を含む全443件（375成功・DB条件なし68 skip）・lint・typecheck・Next production buildが成功。要件02 §4.4をv1.8へ同期し、プロンプト設計書§3.1〜3.2と一致を確認した。

### T-M2-04: updatePersonaSettings Server Action（ベースmd初版生成・版管理） `done`
- 参照: L-4〜L-8、要件05 §8、要件05 §9、要件02 §3.3、要件02 §3.4、要件06 §3.1 / 依存: T-M2-03、M1 / サイズ: M
- 完了条件:
  - base_md_version=0の初回保存でテンプレート全体から初版（version 1・change_source='settings'）が作られ、x_accounts.settings/base_md/base_md_versionとbase_md_versionsが同一トランザクションで更新される
  - 2回目以降の保存はセクション1〜4のみ再構築しセクション5〜6を保持する。expected_base_md_version不一致は0件更新としてjob_conflictを返す
  - 対象XアカウントにrunningのLearning_analysis/md_mergeがある場合job_conflictを返す（generation_jobsへのfixture挿入で検証。LLM非呼出・生成枠非消費）
- メモ: x_account_id明示送信と所有権・status=active・active_x_account_id一致の検証（要件05 §1）もここで実装する。
  実装結果: `updatePersonaSettings` Actionを追加し、入力zod検証と本人認証後、Postgres transaction内で対象Xアカウントの所有権・active status・profileの選択一致をrow lock付きで再検証する。runningの`learning_analysis|md_merge`とexpected version不一致を`job_conflict`で拒否し、初回は全テンプレートのversion 1、2回目以降はセクション1〜4再構築／5〜6保持の新versionを生成する。`x_accounts.settings/base_md/base_md_version`更新と`base_md_versions(change_source=settings)`追加を同一transactionで行い、LLM・generation job・利用枠処理を呼ばない。
  検証: ローカルPostgres fixtureで初回version 1と履歴、学習後version 2の5〜6を保持した設定version 3、expected version不一致、running学習競合、競合後の現行md／履歴数／利用枠0件を確認した。DB統合1件、全444件（375成功・DB条件なし69 skip）・lint・typecheck・Next production buildが成功。要件05 §8のAction入力へ明示`x_account_id`を同期した。

### T-M2-05: SC-10 発信設定フォームUI（L-4〜L-7） `done`
- 参照: L-4〜L-7、SC-10、要件06 §3.1、要件06 §3.3、要件06 §3.4、要件06 §9 / 依存: T-M2-04、T-M2-02 / サイズ: M
- 完了条件:
  - ペルソナ・テーマ（マスタからの選択＋自由入力）・トーン（初期値プリセット）・NGの4フォームが保存・再表示でき、必須項目のバリデーションエラーがフィールド単位でlabelと関連付けて表示される
  - 現行base_mdのセクション1〜4がフォーム値から再構築した内容と異なる場合、保存前に上書き差分警告が表示される
  - 保存成功後にbase_md_versionの更新が画面へ反映される
- メモ: SC-10の学習ソース・ベースmdエディタ・プロンプト編集タブは別マイルストーン。タブ枠だけ用意する。
  実装結果: SC-10へ発信設定／AI用途／学習ソース／ベースmd／プロンプトのタブ枠を追加し、active Xアカウント単位のL-4〜L-7フォームを実装した。ペルソナ3項目、主／副テーマと自由入力、tone初期値6項目、改行区切りのNG 3分類を保存・再表示できる。zodエラーを各labelと`aria-describedby`で関連付け、`base_md_version>=1`の現行1〜4差分またはフォーム編集時に5〜6保持を含む上書き警告を表示する。保存成功時は返却versionを即時更新してServer Componentも再取得する。表示用DB読取はcookie session付きRLS clientへ統一した。
  検証: 差分判定を含む発信設定単体14件、全445件（376成功・DB条件なし69 skip）・lint・typecheck・Next production buildが成功。実ブラウザでversion 0の初期値、未入力のフィールド別エラー、主テーマ／自由テーマ、初回保存、version 1表示、再読込後の値、編集時の上書き警告、AI用途タブの空状態を確認した。要件06 §3.6を追加して同期した。

### T-M2-06: BYOK APIキー保存Action（saveXApiKey/saveAiApiKey） `done`
- 参照: A-4、A-5、要件05 §4.2、要件02 §3.2 / 依存: T-M2-01、M1 / サイズ: M
- 完了条件:
  - saveXApiKeyはstandard/mdのみ許可（premiumはforbidden）、client_idの形式検証とconfidential client時のsecret必須検証を行い、保存値は暗号化envelopeで保存され平文がDB・ログ・レスポンスへ現れない
  - saveAiApiKey（anthropic/openai/google）を含めunique(user_id, provider)でupsertされ、display_hintへ末尾4文字だけが保存される
  - X client ID変更時にauth_type=byokの既存Xアカウントがexpired化される（fixtureで検証。既存tokenを新Appで使い回さない）
- メモ: 保存直後のstatusはunchecked。Secretは受信後すぐ暗号化しログへ出さない。
  実装結果: `saveXApiKey`／`saveAiApiKey` ActionとServer-only保存層を追加した。standard/mdだけを許可し、Xは明示`public|confidential`、Client ID文字種、confidentialのSecret必須／publicのSecret拒否を検証する。X資格情報はJSON、AIキーは文字列をAES-256-GCM envelopeへ即時暗号化し、unique(user_id, provider)へupsertして`unchecked`／`verified_at=null`へ戻す。レスポンスと`display_hint`はClient ID／APIキーの末尾4文字等だけを返す。X Client IDが既存値から変わった場合だけ全BYOK Xアカウントを`expired`化し、token自体は保持する。Sentry redactionへsnake/camelのClient IDを追加した。
  検証: X入力と3 AI provider、資格情報serialize、末尾4文字、redactionを単体14件で確認。ローカルPostgres統合3件で暗号文の非平文／復号内容、3 provider upsert、hint、status reset、Premium拒否、同一Client IDでactive維持、変更時expiredとtoken保持を確認した。全458件（386成功・DB条件なし72 skip）・lint・typecheck・Next production buildが成功。要件02 §3.2をv1.9、要件05 §4.2をv1.12へ同期した。

### T-M2-07: verifyApiKey Action（疎通確認・ai_purpose_config自動設定） `done`
- 参照: A-4、A-5、要件05 §4.2、要件02 §2、要件02 §4.1 / 依存: T-M2-06 / サイズ: M
- 完了条件:
  - AI各provider（anthropic/openai/google）への軽量疎通呼び出しをアダプタ経由で行い、成功でstatus=valid・verified_at更新、失敗でstatus=invalidになる（providerアダプタのモックで検証）
  - Xキーは形式検証まで（疎通確認はOAuth完了時）というA-4の規則どおりに動作する
  - 疎通成功時にai_purpose_config.textが未設定なら当該providerを自動設定し、openai/googleでimage未設定の場合も同様に設定する
- メモ: 疎通結果のエラーはprovider本文を出さずコード化した文言へ変換する（要件01 §8）。
  実装結果: Anthropic／OpenAI／Googleのmodel一覧を1ページだけ取得する軽量アダプタ（10秒timeout・再試行なし）と`verifyApiKey` Actionを追加した。AIは成功時に`valid`／`verified_at`を保存し、失敗時はprovider本文を返さず`invalid`／`provider_error`へ変換する。XはOAuth完了まで`unchecked`のままとした。成功時は未設定のtext用途を補完し、OpenAI／Googleでは未設定のimage用途も補完するが、既存値は上書きしない。疎通中に暗号文が差し替わった場合は結果を破棄する競合ガードも追加した。
  検証: providerアダプタの単体5件で3社成功、共通化した失敗応答、Xの疎通非実行を確認。ローカルPostgres統合2件でstatus／verified_at、用途の自動補完と既存値保持、失敗時の用途非変更、暗号文差し替え競合、未登録、Premium拒否を確認した。全467件（393成功・DB条件なし74 skip）・lint・typecheck・Next production buildが成功。2026-07-23時点の各社公式model一覧仕様を確認し、要件05 §4.2をv1.13へ同期した。

### T-M2-08: deleteApiKey Action（用途解除・BYOK X連携失効処理） `done`
- 参照: A-4、A-5、要件05 §4.2、要件02 §4.1、PRD §10 / 依存: T-M2-07 / サイズ: S
- 完了条件:
  - AIキー削除でuser_api_keys行が削除され、ai_purpose_configの該当用途（text/image）が解除される
  - Xキー削除でtoken revokeをbest effort実行後（HTTPモックで検証）、auth_type=byokのXアカウントがexpired化され投稿・読取・自動実行の対象外になる
- メモ: 即時削除導線（キー漏洩対策）の要件。revoke失敗でも削除は完了させる。
  実装結果: `deleteApiKey` Actionと削除調停・DB保存層を追加した。AIキーは対象行を物理削除し、同providerを参照する`ai_purpose_config.text|image`だけを同一transactionで`null`へ戻す。Xキーは保存済みBYOK access／refresh tokenを復号・重複排除し、公式`POST /2/oauth2/revoke`へ順次送った後にApp資格情報を物理削除して全BYOKアカウントを`expired`化する。復号・revoke失敗は削除を妨げず、外部本文も返さない。revoke準備中にX資格情報が差し替わった場合は新しいキーを削除しない競合ガードを設け、OAuth token ciphertextは保持する。
  検証: 純粋調停3件とX OAuth HTTPモック2件でAI分岐、access／refresh revoke順序・重複排除、form body／endpoint、復号・HTTP失敗時の削除継続を確認。ローカルPostgres統合3件でAIキー削除と用途の選択的解除、Xキー削除とBYOKのみのexpired化・token保持、差し替え競合を確認した。全476件（399成功・DB条件なし77 skip）・lint・typecheck・Next production buildが成功。2026-07-23時点のX公式revoke仕様を確認し、要件02 §3.2をv1.10、要件05 §4.2をv1.14へ同期した。

### T-M2-09: updateAiPurposeConfig Action（プラン別ライフサイクル） `done`
- 参照: A-5、要件05 §4.1、要件02 §4.1、PRD §8.2 / 依存: T-M2-07、M1 / サイズ: M
- 完了条件:
  - standard/mdでは登録済みかつvalidなproviderだけをtextへ設定でき、imageはopenai/googleに限定される（違反はvalidation_error）
  - premiumのtext変更は拒否され、実行時にanthropicへ解決するヘルパを提供する（DBへは保存しない）。imageは運営キー設定済みproviderのみ選択可
  - premium→BYOKプラン変更同期時にtext/imageを登録済みvalidキーで再検証し、無効なら未設定へ戻す関数がユニットテストで検証される
- メモ: 再検証関数はM1のwebhookプラン変更同期から呼ばれる想定でexportする。
  実装結果: `updateAiPurposeConfig` Action、Server-only配線、DB保存層を追加した。部分更新と`null`解除に対応し、standard／mdでは選択した文章providerとOpenAI／Google画像providerに登録済み`valid`キーがあることをprofile lock下で検証する。Premiumは`text`入力を拒否してDBへ保存せず、画像は運営APIキーが設定済みのOpenAI／Googleだけを許可し、応答上の文章providerはユーザー設定非依存で解決する。既定`anthropic`の`resolvePremiumTextPurpose`と、Premium→BYOK時にvalidキーだけを残す`revalidateByokAiPurposeConfig`を純粋関数として追加し、既存Stripeプラン変更同期から再利用した。
  検証: 純粋関数4件でPremium既定Anthropic、valid用途維持、invalid／画像非対応provider解除、部分入力schemaを確認。ローカルPostgres統合12件（用途更新2、実行時provider解決9、プラン変更同期1）でBYOK valid制約、Premium文章拒否・運営画像制約・DB文章値非変更、Premium→BYOK再検証を確認した。全483件（404成功・DB条件なし79 skip）・lint・typecheck・Next production buildが成功。要件02 §4.1をv1.11、要件05 §4.1をv1.15へ同期した。

### T-M2-10: SC-11 APIキータブUI（マスク表示・X取得手順ガイド） `done`
- 参照: A-4、A-5、SC-11、要件06 §3.2、PRD §8.1、PRD §10 / 依存: T-M2-08、T-M2-09、T-M2-02 / サイズ: M
- 完了条件:
  - X/AIキーの登録・差し替え・検証・削除が操作でき、保存後は末尾4文字のみ表示され秘密値は再表示されない
  - Xキー欄にDeveloper Consoleで登録するcallback URL（APP_BASE_URLから組み立て）、必要scope 5種、クレジット・予算設定の確認先を含む取得手順ガイドが表示される
  - premiumではキー入力フォームを表示せず「キー登録不要」の案内になる
- メモ: スクリーンショット素材は未確定のためテキスト手順＋差し替え可能な画像枠で実装（open_questions参照）。
  実装結果: `/app/settings?tab=api-keys`へX／Anthropic／OpenAI／Googleの登録・差し替え・確認・削除UIと、暗号文を取得しない安全な表示専用queryを追加した。保存後はpassword入力を消去し、Client ID／APIキーの末尾4文字、client種別、検証状態、最終確認時刻だけを表示する。X Developer Consoleのcallback URL、scope 5種、credits・自動チャージ・spending limitの手順と差し替え用画像枠を実装し、Premiumでは入力フォームを出さずキー登録不要を案内する。ブラウザ検証でNext.js開発サーバーがServer Function引数を記録することを確認したため、`logging.serverFunctions=false`で秘密入力のterminal出力も無効化した。
  検証: マスク表示2件とNext.js秘密値ログ設定1件を追加し、全487件（408成功・DB条件なし79 skip）、lint、typecheck、Next production build、`git diff --check`が成功。ブラウザでStandardのX／AI保存後の末尾4文字表示・入力消去・形式確認・削除、Premiumのフォーム非表示、幅390pxで横overflowなしを確認した。X Developer App、OAuth callback、料金・予算設定は2026-07-23にX公式仕様を確認した。要件01 §8をv1.5、要件06 §3.2をv1.11へ同期し、PRD・要件02／05・プロンプト設計は既存仕様内のため変更なしと確認した。

### T-M2-11: SC-10 AI用途設定UI（text/image provider選択） `done`
- 参照: A-5、SC-10、要件05 §4.1、要件02 §4.1、要件06 §3.2 / 依存: T-M2-09、T-M2-02 / サイズ: S
- 完了条件:
  - BYOKでは登録済みvalidキーのproviderだけがtext選択肢に表示され、imageはopenai/googleかつvalidキーのあるものに限定される
  - premiumではtextが運営Claudeとしてread-only表示され、imageは運営キーが利用可能なproviderからのみ選択できる（未設定providerは選択不可）
- メモ: OpenAI/Geminiとも未登録の場合の画像生成非活性の判定材料をここで表示に反映する。
  実装結果: `/app/ai-settings?tab=purposes`をprofile単位の設定画面として実装し、Xアカウント未連携でも利用可能にした。standard／mdは登録済み`valid`キーから文章providerを列挙し、画像providerをOpenAI／Googleへ限定する。Premiumは文章を「運営Claude（変更不可）」としてread-only表示し、画像は運営環境にキーがあるproviderだけを列挙する。選択肢がない場合は画像生成OFFと理由を表示し、BYOKにはAPIキー設定への導線を出す。既存`updateAiPurposeConfig` Actionへplan別の安全なpatchを送信し、成功・エラーを画面内で通知する。
  検証: provider選択肢の純粋関数3件を追加し、全490件（411成功・DB条件なし79 skip）、lint、typecheck、Next production build、`git diff --check`が成功。ブラウザでX未連携のStandardにvalidなAnthropic／Googleだけ（画像はGoogleだけ）が表示されて保存できること、Premiumの文章read-onlyと運営OpenAI／Google画像選択、BYOK providerなし案内、幅390pxで横overflowなしを確認した。要件06 §3.6をv1.12へ同期し、PRD・要件02 §4.1・要件05 §4.1・プロンプト設計は既存仕様内のため変更なしと確認した。

### T-M2-12: X OAuthクライアントアダプタ＋startルート（state/PKCE） `done`
- 参照: A-3、要件05 §3、要件05 §4.3、要件05 §11、要件01 §3.4、要件01 §8、PRD §8.1 / 依存: T-M2-06、M1 / サイズ: M
- 完了条件:
  - GET /api/x/oauth/startが契約状態・plan上限・期待auth_type（standard/md=byok、premium=managed）を検証し、不足時はエラーと設定導線へ戻す
  - 認可URLに`tweet.read tweet.write users.read media.write offline.access`とS256 PKCEが付与され、state（user ID・client種別・return path紐付け）とcode_verifierが署名/暗号化済み・HttpOnly・SameSite=Lax・短TTLのcookieへ保存される（URL生成・state生成のユニットテスト）
  - BYOKは保存済みXキー、premiumはX_MANAGED_CLIENT_ID/SECRETをOAuth clientとして使い分ける
- メモ: 実装時にX公式のOAuth 2.0 Authorization Code with PKCE仕様を再確認する（要件01 §7の注記）。
  実装結果: `src/lib/x/oauth-start.ts`（純粋・注入可能 `buildXOAuthStart`: getProfile→`requireExecutableSubscription`で契約状態検証→`expectedAuthTypeForPlan`〔premium=managed/他=byok〕→active連携数が`PLANS[plan].xAccountLimit`以上なら`forbidden`〔reason=x_account_limit_reached・settingsPath付〕→OAuth client解決〔byok=保存Xキー無しは`api_key_required`／managed=`managedOAuthClient`〕→`createPkce`＋`newOAuthTransaction`〔userId/authType/returnPath/code_verifier〕＋`buildAuthorizeUrl`〔5 scope・S256〕→`sealState`）。`src/app/api/x/oauth/start/route.ts`（GET・`requireCurrentUser`→admin profile/active x_account count→BYOK資格情報→X認可URLへredirect＋stateをHttpOnly/SameSite=Lax/短TTL cookie〔`xOAuthStateCookieOptions`〕にset。AppErrorは`toUserFacingError`のsettingsPathへ`?x_oauth_error=code`付redirect。`return`はopen redirect防止で`/app`配下のみ許可）。BYOK資格情報readerを`api-key-store.ts`の`readXAppCredentialsRecord`＋`api-key-store-server.ts`の`getXAppCredentialsForUser`として追加。公式仕様確認（docs.x.com, T-M0-20で確認済み: authorize=x.com/i/oauth2/authorize・S256・offline.accessでrefresh）。テスト: oauth-start unit 7（byok/premium・契約不可・キー無し・上限到達・secret非漏洩・auth_type写像）。全497件・lint・typecheck・Next build通過。docは要件05 §3/§4.3に既出のため変更なし。
  後続への注意: callback（T-M2-13）は`verifyState`で state cookie検証→tx.userIdをsession userIdと一致検証（cookie-forcing防御・T-M0-20注）→`exchangeCodeForToken`→scope 5種確認→/2/users/me→token暗号化保存→x_accounts作成。confidential/publicのtoken交換分岐は`exchangeCodeForToken`が担う。x_account上限のre-auth（既存expired再連携）許可はcallbackで要検討。

### T-M2-13: X OAuth callback（token交換・新規連携ハッピーパス） `done`
- 参照: A-3、A-4、要件05 §3、要件05 §4.3、要件02 §3.3 / 依存: T-M2-12 / サイズ: L
- 完了条件:
  - モックX API（token endpoint・/2/users/me）に対し、code交換→scope 5種の付与確認→/2/users/me確認→access/refresh tokenの暗号化保存→x_accounts作成（x_user_id/handle/auth_type/oauth_scopes/status=active）までの統合テストがローカルで通る
  - scope不足・/2/users/me失敗時はtokenを保存せずエラー表示へ戻り、tokenの平文と外部レスポンス本文をブラウザへ返さない
  - callbackは自動投稿への同意（automation_consent_*）を一切記録しない
- メモ: 初回連携成功時はprofiles.active_x_account_idが未設定なら当該アカウントを設定する。BYOKはこの疎通成功でXキーのstatus=valid化（A-4のOAuth完了時疎通確認）。
  実装結果: `src/lib/x/oauth-callback.ts`（純粋core `handleXOAuthCallback`: verifyState→**tx.userId===session一致検証**〔cookie-forcing防御・T-M0-20注、不一致=forbidden〕→resolveClient→exchangeCodeForToken→`hasRequiredScopes`でscope5種確認〔不足=forbidden・保存前〕→fetchMe(/2/users/me)〔失敗=throw・保存しない〕→sealTokens→persist。＋`linkXAccountRecord`〔x_accountsをupsert on (user_id,x_user_id): token/scope/auth_type/status=active置換・base_md/settings/automation_consent_*は保持。BYOKは`user_api_keys`をvalid化。`active_x_account_id`未設定なら当該連携を設定〕）。`src/app/api/x/oauth/callback/route.ts`（GET・requireCurrentUser→verifyState/exchange/getMe/sealTokens/withTransaction配線→成功はreturnPathへ`?x_connected=1`、失敗はsettingsPathへ`?x_oauth_error=code`redirect＋state cookie削除。token平文・外部本文は返さない）。統合はモックexchange/getMe＋実DB persist。テスト: unit 5（session不一致・scope不足・/me失敗・state不正で非保存／ハッピーパス）＋DB 2（x_accounts作成/token暗号化/BYOK valid/active設定・re-link upsertでbase_md保持）。全504件・lint・typecheck・Next build通過。docは要件05 §3/§4.3・§02 §3.3に既出のため変更なし。
  設計判断: persistはinsertではなく`on conflict (user_id,x_user_id) do update`のupsertとし、ハッピーパスで再連携が来ても壊れずtokenのみ置換（既存データ保持）。再連携の詳細な受け入れ条件（別x_user_idの上限検証・拒否系・state不一致メッセージ）はT-M2-14で拡張する。
  後続への注意: T-M2-14は本経路に「別x_user_id新規時のplan上限検証」「Xの拒否（?error=access_denied）・state不一致・cookie/code欠落の明示拒否」「BYOK⇔premiumプラン変更後のauth_type置換」を追加する。上限のre-auth許容（既存active数が上限でも同一x_user_id再連携は許可）も要検討。

### T-M2-14: X OAuth callback（再連携・複数アカウント上限・拒否系） `done`
- 参照: A-3、A-6、要件05 §4.3、要件05 §11、要件03 §6 / 依存: T-M2-13 / サイズ: M
- 完了条件:
  - 同一x_user_idの再連携で既存rowのtoken・auth_type・scope・statusが置き換わり、ベースmd・settings・下書き等のデータが維持される（fixtureで検証）
  - 別x_user_idは新規アカウントとしてプラン上限（standard=1、md/premium=3）を検証し、超過時は保存せずエラー表示へ戻す
  - state不一致・別sessionからのcallback・cookie欠落・code欠落を拒否し、エラーに秘密値やproviderレスポンス本文を含まない
- メモ: BYOK⇔premiumのプラン変更後の再連携（auth_type置き換え）もこの経路で成立させる。
- 実装メモ: `assertCanLinkXAccount`（oauth-callback.ts）を`linkXAccountRecord`冒頭で呼び、`profiles`をFOR UPDATEで読んで契約状態（requireExecutableSubscription再利用）＋plan上限を**同一transactionで再確認**（start〜callback間のplan変更・並行連携での上限超過を防止）。同一x_user_idは`select 1 from x_accounts`で再連携判定→上限対象外（既存rowをupsert）。超過はforbidden(reason=x_account_limit_reached)、非実行契約はsubscription_requiredで、いずれも保存前にthrow→未保存。期待auth_typeはsealed stateで束縛済みのため一致検証は不要（プラン変更後の再連携でauth_typeは`excluded`で置換）。条件1(再連携保持)/3(state・session拒否)はT-M2-13の既存テストで担保、code欠落はroute層(validation_error)。DBテスト4件追加(標準1件超過・md 3→4件目・at-limit再連携許可・非実行契約拒否)。docは05 §4.3/03 §6が既に本挙動を記述済みで乖離なし。
- 後続への注意: T-M2-16(disconnect/enable)で`disconnectXAccount`後にactive枠が空くこと、`enableXAccount`が同じ上限・auth_type・token/`/users/me`検証を通すこと（要件05 §4.3）を本認可と整合させる。

### T-M2-15: Xトークンrefreshヘルパ（single-flight lease） `done`
- 参照: A-3、要件05 §4.3、要件02 §3.3 / 依存: T-M2-13 / サイズ: M
- 完了条件:
  - 期限5分以内のtokenでrefreshが1回だけ実行され、並行呼び出しはtoken_refresh_lock_id/token_refresh_locked_atの条件付き更新で直列化される（他実行は最大10秒待って再読込、1分超leaseのstale回収を含めテスト）
  - rotatedされたrefresh tokenと期限がlock ID一致条件で同一トランザクション更新され、成功・失敗のどちらでもleaseが解除される
  - invalid_grantまたは必要scope不足でstatus=expired化し、再連携を促すnotifications行を作成する
- メモ: DATABASE_URL（pooler）経由の複文トランザクションで実装。後続マイルストーンのworker（投稿・読取）からも共用する。
- 実装メモ: 条件1・2はT-M0-21（`token-refresh.ts` getValidAccessToken）で実装済み＝重複実装せず。**残タスクの条件3「notifications行作成」のみ追加**。(1)`markExpired`を「active→expired遷移したか(rowCount>0)」を返す形に変更し、`onExpired`を遷移時のみ呼ぶよう厳密化（stale-lease奪取時の二重通知を防止、ユニットで検証）。(2)テスト可能なコア関数`createXRelinkNotification(db, xAccountId, reason)`を追加（`notifications` type='error'、link=/app/settings?tab=api-keys、payload={x_account_id,reason}、`notification_config.error`のin_app/email両OFFなら作成せず、dedupe_key=null＝1エピソード1件で再失効も再作成可）。(3)server層`getValidXAccessToken`の既定onExpiredに結線（呼び出し側指定があれば優先）。テスト+3（ユニット1・DB2）、全511 green。docは02 §3.15にX再連携通知の仕様を追記(v1.12)、05 §4.3 L151は既述で整合。
- 後続への注意: 通知のメール送信（email_status=queued→送信）とin_app表示は通知配信/画面タスクで担う（本タスクは行作成まで）。BYOK(auth_type='byok')のclient解決はserver層で未実装（明示error）＝T-M2-16以降で結線。

### T-M2-16: Xアカウント管理Action（list/refresh/enable/disconnect） `done`
- 参照: A-6、要件05 §4.3、要件06 §9、要件03 §6 / 依存: T-M2-15、T-M2-14 / サイズ: M
- 完了条件:
  - listXAccountsが本人のアカウントのみ返し、refreshXAccountStatusがモック/2/users/meの結果でstatusを更新する
  - enableXAccountはplan上限の空き・planに対応するauth_type・refresh＋/2/users/me成功をすべて検証してactive化し、失敗時は再連携誘導エラーを返す
  - disconnectXAccountはbest effortのtoken revoke→保存tokenのnull化→status=disabled→自動投稿同意停止と当該アカウント全auto slotの無効化を行い、下書き・履歴データは削除しない（schedule_slots fixtureで検証）
- メモ: recordXAutomationConsent/disableXAutomationはスケジュール（SC-08）マイルストーンで実装。
- 実装メモ: コア`account-actions.ts`（deps注入）＋server結線`account-actions-server.ts`＋Action`app/actions/x-accounts.ts`（4本）。list/refresh/enable/disconnectとも`readOwnedAccount`で本人所有を検証（他人/不在はnot_found＝列挙防止）。refresh: getAccessToken失敗→token-refreshが設定済みstatusを返す／tokenは有効だが/me失敗→status=error／成功→active＋handle等更新。enable: auth_type一致（expectedAuthTypeForPlan）→refresh＋/me成功→上限確認を`profiles` FOR UPDATEの同一tx内で行いactive化（並行enable直列化）。disconnect: revokeはbest effort（失敗握りつぶし）→tx内でtoken null化・status=disabled・automation同意停止(disabled_at設定)・auto slotのみenabled=false・**active_x_account_id=自分ならnull化**（フォールバック再選択はT-M2-17）。**T-M2-15で先送りしていたBYOK client解決をtoken-refresh-serverに結線**（x_account所有者のuser_api_keys='x'からclient_id/secret、confidentialのみsecret付与）。テスト+14（ユニット11・DB3: list本人分離／disconnectでauto無効化・draft維持・データ非削除／enable上限拒否）。全525 green。doc: 05 §4.3 disconnect行にactive解除・データ非削除を追記(v1.16)。
- 後続への注意: T-M2-17（setActiveXAccount＋フォールバック）は、disconnectでactive_x_account_idがnull化された後の再選択規則（要件03 §6 L151・要件01 §5：最古のactive 1件等）を担う。UI（SC-11・要件06 §9）はT-M2-18以降。

### T-M2-17: setActiveXAccount＋フォールバック選択規則 `done`
- 参照: A-6、要件05 §4.1、要件01 §5、要件02 §3.3 / 依存: T-M2-13 / サイズ: M
- 完了条件:
  - setActiveXAccountが所有権とstatus=activeを検証し、他人所有・非activeの指定を拒否する。DB trigger側でも同一profile所有以外のactive_x_account_id設定が拒否される
  - active未選択、またはactiveが指すアカウントのexpired/disabled化時にcreated_at最古のstatus=activeを自動選択してprofiles.active_x_account_idへ永続化し、候補ゼロならnullとなる（フォールバック関数のユニットテスト）
- メモ: フォールバックは/app系レイアウトの読み込み時に適用し、候補ゼロは初期設定ガイド表示条件へつなぐ。
- 実装メモ: `account-actions.ts`に`setActiveXAccount`（所有権＋active検証。他人所有=not_found／非active=validation_error）と`resolveActiveXAccount`（有効なら維持し書き込みなし／未選択・expired・disabled・不在なら`created_at, id`最古のactiveを選び永続化／候補ゼロでnull。選択が変わるときだけUPDATE）を追加。server結線＋`setActiveXAccountAction`。**DBトリガー`enforce_active_x_account_owner`はT-M0-06で既存＝重複作成せずDBテストで検証**。フォールバックは`/app`レイアウト（`src/app/app/layout.tsx`）の読込時に`resolveActiveXAccountForUser`で適用（従来のactive解決を置換）。テスト+10（ユニット7・DB3: trigger他人所有拒否／最古選択→失効で再選択→ゼロでnull永続化／setActive所有権・status）。全535 green・build通過。doc: 05 §4.1・01 §5・02 §3.3が既述で整合＝影響なし。
- 後続への注意: 候補ゼロ（active_x_account_id=null）は`/app`初期設定ガイド表示条件（要件01 §5）。T-M2-18ヘッダ切替UIは`listXAccounts`＋`setActiveXAccountAction`を使う。

### T-M2-18: ヘッダXアカウント切替UI `done`
- 参照: A-6、要件06 §2 / 依存: T-M2-17、T-M2-16、T-M2-02 / サイズ: S
- 完了条件:
  - ヘッダの切替メニューにactiveなXアカウント一覧（handle・プロフィール画像）と現在の選択が表示され、選択でsetActiveXAccountが呼ばれる
  - 切替後に表示中画面の一覧・集計が再取得される（router refresh等の再取得動作を確認）
- メモ: mutation系Actionのx_account_id明示送信＋サーバー側一致検証（job_conflict）の前提となる「表示中アカウント」の受け渡しを確立する。
- 実装メモ: クライアントコンポーネント`components/app-shell/x-account-switcher.tsx`（Base UI `Menu`＝既存の`@base-ui/react`を利用、新規依存なし）。handle＋プロフィール画像を一覧し現在選択にCheck。選択で`setActiveXAccountAction`→成功後`router.refresh()`で表示中画面のサーバーコンポーネント（一覧・集計）を再取得。0件は静的「未選択」表示（初期設定ガイドは/app側=T-M2-17フォールバックがnull化）。`/app`レイアウトが`listXAccounts`でactiveのみ抽出＋`resolveActiveXAccountForUser`のactiveIdを渡す。従来の静的チップを置換。プロフィール画像は素の`<img>`（next/image remotePatterns設定回避、eslint-disable明記）。**このリポジトリはコンポーネントテスト基盤（testing-library/jsdom）が無いためUIはtypecheck＋lint＋build＋手検証**（setActive/resolve/listのロジックはT-M2-16/17でテスト済み）。全535 green・build通過。doc: 要件06 §2が既述で整合＝影響なし。
- 後続への注意: mutation系Action（生成・下書き・スロット・学習・提案）は表示中`x_account_id`を明示送信し、サーバーで`profiles.active_x_account_id`一致を検証してjob_conflictを返す（要件05 §4.1）。切替UIが送る「表示中アカウント」はこの整合検証の入力になる。

### T-M2-19: SC-11 XアカウントタブUI `done`
- 参照: A-3、A-6、SC-11、要件06 §9、要件06 §3.2 / 依存: T-M2-16、T-M2-02 / サイズ: M
- 完了条件:
  - 連携済み一覧（status・auth_type・handle）、追加（上限内のみ・OAuth startへ遷移）、再連携、切断、disabledの再有効化が操作できる
  - 切断の確認ダイアログで投稿・自動実行が停止すること、データは削除されないことが説明される
  - プラン上限到達時は追加ボタンが無効化され、上限数が表示される
- メモ: expired/errorアカウントには再連携導線を出す。X_POSTING_MODE=dry_run環境＋モックでE2E確認。
- 実装メモ: 設定ページに`x-accounts`タブを追加（SETTINGS_TABS先頭）。クライアント`app/settings/x-accounts-settings.tsx`（Base UI `AlertDialog`＝確認ダイアログ、新規依存なし）が一覧（handle・表示名・status/auth_typeバッジ・操作中の目印）＋操作を描画。追加/再連携は`GET /api/x/oauth/start?return=/app/settings?tab=x-accounts`へ遷移（BASE UI Buttonの`render`で`<a>`化）。有効数≥上限で追加ボタン無効化＋`有効 N/上限`表示。disabled→有効化（enableXAccountAction）、expired/error/disabled→再連携、全statusで状態更新（refreshXAccountStatusAction）、active/expired/error→切断（disconnectXAccountAction）。切断はAlertDialogで投稿・自動実行停止／同意取消／データ非削除を説明。成功後`router.refresh()`。OAuth復帰の`x_connected`/`x_oauth_error`をバナー表示。ページは`listXAccounts`で一覧取得。全535 green・build通過（testing-library未導入のためUIはtypecheck/lint/buildで検証）。doc: 要件06 §1.2.1（SC-11 Xアカウントタブ）を新設（v1.13）。
- 後続への注意: 切断/再連携のエラーredirect先はstart/callbackがSETTINGS_PATH=`?tab=api-keys`固定のため、エラー時はapi-keysタブへ着地する（x-accountsタブにも復帰バナーは用意済み）。統一するならstart/callbackのSETTINGS_PATHをreturn連動にする改修が必要（別タスク候補）。X_POSTING_MODE=dry_runでの実ブラウザE2Eは未実施（自動テスト基盤外）。

### T-M2-20: 通知ベル・通知一覧（App Shell） `done`
- 参照: O-2、要件05 §10、要件02 §3.15、要件06 §2 / 依存: T-M2-02、M0 / サイズ: M
- 完了条件:
  - ヘッダのベルに未読件数が表示され、一覧はin_app_enabled=trueの通知のみをcursorページング（listNotifications）で表示する
  - markNotificationRead/markAllNotificationsReadで既読化され未読数が即時更新される
  - 通知のlink（アプリ内相対パス）から対象画面へ遷移できる（fixture通知で検証）
- メモ: 通知rowの作成・メール送信はジョブ系マイルストーン。ここは閲覧・既読化のみ。retryNotificationEmailはメール送信実装後に追加する。
- 実装メモ: コア`lib/notifications.ts`（Queryable注入）＝`listNotifications`（in_app_enabled=trueのみ・本人スコープ・created_at desc, id descのkeyset cursor、limit+1でnextCursor）、`countUnreadNotifications`、`markNotificationRead`（coalesceで冪等・本人のみ・不在/他人はnot_found）、`markAllNotificationsRead`（更新件数返却）。server結線＋Action `app/actions/notifications.ts`（list/markRead/markAllRead、既読系は最新unreadCountを返しバッジ即時更新）。UI `components/app-shell/notification-bell.tsx`（Base UI Popover、新規依存なし）＝未読バッジ＋一覧、項目クリックで既読化＋link遷移、すべて既読、もっと見る。ヘッダ（layout）が初期unread数＋先頭ページを渡し従来のBell Linkを置換。テスト+13（ユニット10・DB3: 本人分離/in_appのみ/cursorページング・冪等既読・他人不可・link保持・一括既読）。全548 green・build通過。doc: 要件04 §247・05 §10・06 §2・02 §3.15が既述で整合＝影響なし。
- 後続への注意: retryNotificationEmail（email_status=failed→queued化）はメール送信実装（ジョブ系MS）後に追加。通知rowの作成はX再連携（T-M2-15）以外は各ジョブが担う。バッジ初期値はレイアウト読込時点のため、他タブでの既読はページ遷移/refreshで反映。

### T-M2-21: 常設バナー（課金停止・X失効・キー無効・再連携要求） `done`
- 参照: 要件06 §2、要件03 §5、要件03 §8、要件01 §5 / 依存: T-M2-16、T-M2-07、M1 / サイズ: M
- 完了条件:
  - subscription_statusがpast_due/unpaid/paused/canceledのとき課金バナーが通知設定にかかわらずヘッダ直下に表示され、解決画面へリンクする
  - x_accounts.status=expired/error、またはBYOK必須キーのstatus=invalidで対応バナーが表示され、SC-11の該当タブへ遷移できる
  - プラン変更でauth_typeがプランと不一致になったXアカウントがある場合「Xの再連携が必要」バナーが表示される（fixtureで3系統すべて検証）
- メモ: 再連携までの生成閲覧・編集許可／投稿・自動実行停止の制御自体は投稿系マイルストーンの実行前提検証で担保。ここは表示と導線。
- 実装メモ: 課金バナー（条件1）は既存M1 `subscriptionBannerFor` で充足済み＝流用。新規はXバナー3系統をpure関数`lib/app-banners.ts` `computeXAccountBanners`で算出（`x_authtype`=auth_type≠expectedAuthTypeForPlan(plan)かつ非disabled→プラン変更後の再連携／`x_status`=expired/errorかつauth_type一致→失効・エラー／`x_key`=standard・mdでX APIキーstatus=invalid）。プラン変更で不一致accountはexpired化されるため、`x_authtype`を優先し`x_status`はauth_type一致のexpired/errorのみに絞って重複回避。server `app-banners-server.ts`でX APIキーstatus取得。layoutが既存listXAccountsを流用＋plan＋keyStatusで算出し、課金バナー直下に描画（SC-11該当タブ/APIキータブへリンク）。ユニット7（3系統個別・同時・premiumでキーバナー非表示・disabled除外・健全時ゼロ）。全555 green・build通過。doc: 要件06 §2が既述で整合＝影響なし。
- 後続への注意: 再連携までの投稿・自動実行停止と生成閲覧許可の“制御”は投稿系MSの実行前提検証（要件03 §5 route guard／Server Action側）で担保。本タスクは表示と導線のみ。

### T-M2-22: プロフィール・通知・ニュース設定Action＋SC-11設定タブ `done`
- 参照: 要件05 §4.1、要件02 §4.2、要件02 §4.3、要件06 §3.4、要件06 §9、O-2、O-3 / 依存: T-M2-02、M1 / サイズ: M
- 完了条件:
  - updateProfile/updateNotificationConfig/updateNewsConfigがzodスキーマ（通知は種別×channel、newsはcategories/impact_filter各1件以上・max_items 1〜100）で検証・保存される
  - SC-11の通知タブで種別ごとにアプリ内/メールのON/OFFを変更でき、ニュース通知欄に時間単位ダイジェスト仕様（JST9〜20時・該当0件は届かない）の説明が表示される
  - 問い合わせ導線（SUPPORT_EMAILへのメールリンク）がSC-11に表示される
- メモ: notification_config/news_configの初期値投入はM1のprofile作成hook側。未設定時は§3.4の既定値へフォールバックする読み出しヘルパを含める。
- 実装メモ: コア`lib/settings.ts`＝zodスキーマ（`notificationConfigSchema`=6種別×{in_app,email}のstrict／`newsConfigSchema`=categories・impact_filterがDB_ENUM値・各≥1・重複不可、max_items 1-100／`profileUpdateSchema`=display_name≤50）＋**フォールバック読出ヘルパ**（`resolveNotificationConfig`は種別ごと、`resolveNewsConfig`は全体を§3.4既定へ）＋`readSettings`/save群。server結線＋Action `app/actions/settings.ts`（update3本）。UI `settings-preferences.tsx`（プロフィール名／通知トグル表／ニュース分野・インパクト・件数＋ダイジェスト説明）を設定タブ`notifications`（"通知・プロフィール"）に追加。問い合わせ導線は既存supportタブで充足。enum値は`DB_ENUMS`をSSOTに再利用。テスト+17（ユニット15: スキーマ各種＋フォールバック／DB2: 未設定→既定・保存round-trip）。全572 green・build通過。doc: 要件06 §1.2.2を新設（v1.14）。
- 後続への注意: news_config編集はSC-06ニュース画面（後続）でも参照/再利用可。ニュースの実際のダイジェスト送信・時間窓適用はニュースジョブ系MS。updateAiPurposeConfigは別タスク（T-M2-07系）で対応済み。

### T-M2-23: 実行前提検証ヘルパ＋設定導線エラー表示 `done`
- 参照: 要件06 §3.1、要件06 §3.2、要件05 §2.2、PRD §4 / 依存: T-M2-04、T-M2-07、T-M2-17 / サイズ: M
- 完了条件:
  - プラン（BYOK/premium）×不足状態（契約・X APIキー・X連携・文章AIキー・画像AIキー・発信設定）の組み合わせごとに、subscription_required/api_key_required/x_account_required/persona_requiredのコードと不足項目一覧・設定画面パス入りdetailsを返すことをユニットテストで網羅する
  - premiumではX/AIキーが前提から除外され、画像AIキーは画像ON時のみ要求される。発信設定はbase_md_version>=1で充足と判定される
  - エラーを受けた画面がメッセージと「設定へ」ボタンを表示する共通コンポーネントを提供し、Storybookまたはテストページで各エラーコードの表示を確認できる
- メモ: 後続マイルストーンの生成・投稿・スケジュール・学習Actionが共用するサーバーヘルパとして切り出す。画面遷移は制限しない（実行時検証のみ）。
- 実装メモ: pure `lib/execution-prereqs.ts` `checkExecutionPrerequisites`（優先順: 契約→Xキー→X連携→文章AIキー→画像AIキー→発信設定。premiumはX/AIキー除外、画像AIキーは`imageRequested`時のみ、発信設定は`base_md_version>=1`）→`{code, missing[], settingsPath}`または null。`assertExecutionPrerequisites`はAppErrorをthrow。契約可否は`subscriptionAccessFor().canExecute`再利用。server `execution-prereqs-server.ts` `gatherExecutionPrereqInputs`（profiles/ai_purpose_config/user_api_keys/選択中x_accountから入力を収集、AIキー有効性は割当providerのstatus='valid'、発信設定は選択中accountのbase_md_version）。共通表示`components/app-shell/execution-prereq-notice.tsx`（message＋不足項目＋「設定へ」ボタン、コードに依存せずmessage/settingsPath/missingを描画）。X APIキーはvalid/unchecked（登録・形式検証済み）で充足、null/invalidで不足。テスト+16（ユニット14: BYOK各不足個別・全不足の優先順・premium除外・assert／DB2: 未設定は全不足・充足でnull）。全588 green・build通過。doc: 要件06 §3.1/§3.2・05 §2.2が既述で整合＝影響なし。
- 後続への注意: Storybookはスタック未導入のため「各エラーコード表示」はcheckExecutionPrerequisitesの網羅ユニット＋汎用コンポーネント（T-M2-24ガイドカードで実使用）で担保。生成・投稿・スケジュール・学習の各Action実装時に`gatherExecutionPrereqInputs`＋`assertExecutionPrerequisites`を実行前提ガードとして呼ぶ（imageRequestedは操作依存）。

### T-M2-24: ホーム初期設定ガイドカード（SC-05） `done`
- 参照: 要件06 §3.1、要件01 §5、PRD §4、PRD §9 / 依存: T-M2-23、T-M2-02 / サイズ: S
- 完了条件:
  - 前提不足時に/appへチェックリスト（X APIキー・X連携・文章AIキー・発信設定。premiumはキー項目を除外）が充足/未充足の状態付きで表示され、各項目から該当設定画面へ遷移できる
  - 全条件充足でカードが自動的に非表示になり、activeなXアカウント候補ゼロの場合もガイドが表示される（fixtureで両状態を検証）
- メモ: 充足判定は実行前提検証ヘルパを再利用し、判定ロジックを二重実装しない。
- 実装メモ: `execution-prereqs.ts`に`buildSetupChecklist`を追加し**`checkExecutionPrerequisites`を再利用**（判定二重実装なし）。ガイド対象=x_api_key/x_account/text_ai_key/persona（契約はバナー・画像AIキーは任意で除外）、premiumはX/AIキー除外→x_account/personaのみ。`components/app-shell/setup-guide-card.tsx`（server component）が充足/未充足＋設定導線を描画。`/app/page.tsx`を非同期化し`gatherExecutionPrereqInputs`→`buildSetupChecklist`、未充足があればカード表示・全充足で非表示。activeアカウント候補ゼロ→x_account未充足→表示。ユニット+5（BYOK4項目全充足／未充足＋パス／候補ゼロ表示／premium除外／画像無視）。全593 green・build通過。doc: 要件06 §3.1が既述で整合＝影響なし。**M2（Web基盤・X連携・設定）完了**。

## M3: 生成・投稿コア（手動運用の完成）

### T-M3-01: 投稿検証ユーティリティ（加重文字数・cashtag・X URL・出典URL・NG照合） `done`
- 参照: PRD §8.1、要件05 §12、要件06 §4.3、プロンプト設計書 §7.2、プロンプト設計書 §7.3、プロンプト設計書 §7.5、L-7 / 依存: M0 / サイズ: M
- 完了条件:
  - 公式twitter-text互換の加重文字数計測がユニットテストで検証できる（CJK重み2・URLのt.co固定長換算・絵文字・280境界ケース、cashtag件数カウント含む）
  - X投稿URL検証（hostはx.com/twitter.com、pathは/{handle}/status/{数値ID}のみ許可）がテストで確認できる
  - 出典URL検証（https必須・DNS解決後のprivate/loopback/link-local拒否・redirect先再検証・timeout 10秒）とNGワードのコード文字列照合がモックDNSでテストできる
- メモ: 生成検証・下書き編集・投稿実行の全段で共用する純粋関数群。NG照合はLLMを使わずコードで行う（プロンプト設計書 §1）。
- 実装メモ: `src/lib/post/`に4純粋モジュール。text-metrics.ts=**公式`twitter-text` v3の`parseTweet`/`extractCashtags`**を使い加重文字数（CJK重み2・URL 23固定・280境界）＋cashtag件数、`measurePostText`（withinLimit≤280・cashtagOk≤1・empty）。x-url.ts=`parseXPostUrl`（host x.com/twitter.com＋www可、path `/{handle}/status/{数値}`、handle≤15、http/httpsのみ）。source-url.ts=`validateSourceUrl`（https必須／DNS解決の**全アドレス**をisBlockedIpで検査＝rebinding対策／redirect手動追跡で各hop再検証／HEAD・本文取得なし／AbortControllerで10秒timeout、DNS・fetch注入）＋`isBlockedIp`（IPv4 private/loopback/link-local/CGNAT/reserved、IPv6 ::1/fe80/fc00/ff・IPv4-mapped）。ng-words.ts=`matchNgWords`（コード部分一致・大小無視・重複排除、LLM不使用）。テスト+33（加重/CJK/URL/境界/cashtag・X URL各種・NG・出典URL: 公開200/http拒否/private拒否/rebinding/redirect先private拒否/公開redirect通過/location無/DNS失敗/redirect過多/timeout）。全626 green。doc: 要件05 §12・プロンプト設計書 §7が既述で整合＝影響なし。
- 後続への注意: 生成パイプライン検証（T-M3-03系）・下書き編集・投稿実行がこれらを呼ぶ。source-urlのserver配線（node dns.lookup {all:true}＋global fetch）は利用側で注入。P-5引用検証（quote_url host/ID一致）はparseXPostUrlを再利用可。

### T-M3-02: プロンプト定数とprompt_templatesのsystem default seed `done`
- 参照: プロンプト設計書 §6.1〜6.9、要件02 §3.5、要件02 §6、GEN-P1〜P6、GEN-IMG、GEN-FIX / 依存: M0 / サイズ: S
- 完了条件:
  - SYS-GEN・PT-P1〜P6・PT-IMG・PT-FIXが設計書§6の全文と一致するコード定数として定義され、スナップショットテストで乖離を検出できる
  - seedで`prompt_templates`のsystem default 7件（x_account_id=null、kind=p1〜p6/image）が冪等に作成される
  - テンプレート解決関数がaccountオーバーライドを優先し、なければsystem defaultを返すことをテストで確認できる
- メモ: SYS-GEN・PT-FIXはコード管理のみで編集対象外（要件06 §9）。md/premium向けプロンプト編集UIは別マイルストーンで、本タスクは解決ロジックまで。
- 実装メモ: `src/lib/prompts/gen-prompts.ts`にSYS-GEN・PT-P1〜P6・PT-IMG・PT-FIXを設計書§6.1〜6.9の全文どおり定数化＋`SYSTEM_DEFAULT_TEMPLATES`（p1〜p6/image＝seed対象。SYS-GEN/PT-FIXは含めずコード専用）。`prompt-templates.ts`＝`seedSystemPromptTemplates`（`on conflict (kind) where x_account_id is null do update`でコード定数へ冪等同期＝7件、既存partial unique index活用）＋`resolvePromptTemplate`（account上書き→system default→コード定数フォールバック）。テスト+11（スナップショット1＝§6乖離検出／構造・placeholder・7種／解決優先順・null時override非照会・コードfallback＝ユニット／DB: seed二度実行で7件一致・実override>system>null）。全637 green。doc: プロンプト設計書 §6が正本で一致・要件02 §3.5整合＝影響なし。
- 後続への注意: 生成パイプライン（T-M3-03/04）はSYS-GEN＋`resolvePromptTemplate(kind)`で本文を組み立て、短縮はPT-FIX（{{limit}}）、画像はPT-IMG（{{post_text}}/{{tone_section}}）を使う。プロンプト全文を変更したら定数を更新しスナップショット更新＋doc同期。seedはデプロイ/初期化時に実行（実行配線は利用側）。

### T-M3-03: 文章生成アダプタのGEN対応（3プロバイダ・Web検索・JSON・usage正規化） `done`
- 参照: プロンプト設計書 §5.1〜5.4、プロンプト設計書 §5.6、A-5、要件02 §4.6、要件02 §3.17、要件04 §5 / 依存: M2 / サイズ: L
- 完了条件:
  - TextGen共通インターフェース（system[]／user／webSearch／jsonSchema／timeoutMs）でanthropic/openai/googleの3アダプタが動作し、モックHTTPで本文・citations・usage・request_id・stop_reasonが共通形式へ正規化される
  - Anthropicの`pause_turn`継続が同一Function実行内のみ・残り30秒以上・最大2回で行われ、超過時はretryable（次attemptはmaxUses縮小の新規リクエスト）となることをモックで確認できる
  - 各callのtoken・検索回数・実行時単価・推定原価が`generation_jobs.usage`形式へ保存され、`external_api_usage_events`へ冪等記録される
- メモ: M2のNEWS実装で作るClaudeアダプタ・原価台帳を土台に、OpenAI（Responses API・store:false）とGemini（Interactions API・store=false、generateContentフォールバック）、Web検索＋JSON出力併用、prompt cachingを追加する。モデル名・検索toolのversionは環境変数。実装時に§5.7の公式ドキュメントで最新仕様を要確認。
- 実装メモ: ギャップ分析（Exploreエージェント）の結果、**条件1（共通契約`types.ts`＋anthropic/openai/gemini 3アダプタ＋normalize＋モックHTTPテスト）と条件2（pause_turn: `deadline.canStartCall()`のMIN_CALL_HEADROOM_MS=30s／MAX=2／`PauseTurnIncompleteError`retryable／`reduceWebSearchMaxUses`）はM0（T-M0-16〜19）で実装済み**＝重複せず流用。真の追加は**条件3（推定原価＋台帳）**のみ。(a)`ai/pricing.ts`＝provider別レート（USD/MTok＋検索単価、目安・要定期更新）＋`estimateProviderCost(provider,usage)`（6桁丸め・未知provider0）。(b)`pipeline.ts` callOnceで`estimateProviderCost`を`meta.estimatedCostUsd`へ注入→`usage.calls[].estimated_cost_usd`と`estimated_cost_usd_total`が非0に。(c)`db/api-usage-ledger.ts`＝`recordExternalApiUsage`（`on conflict (idempotency_key) do nothing`、成功/失敗とも記録＝要件04 §10）＋`providerCallToUsageEvent`マッパ。テスト+8（pricing 6・台帳DB 2冪等/失敗記録、pipeline cost検証1追加）。全645 green。doc: 要件04 §10（冪等・request_id・usage・実行時単価・推定原価・成功失敗）／要件02 §4.6・§3.17が既述で整合＝影響なし。推定原価の算出方式はpricing.ts局所の見積もり（レート変動）でADR基準外＝ADR不要。
- 後続への注意: **generation_jobs.usageのDB書込みとper-call台帳記録の“結線”はT-M3-05 worker**が担う（jobId/userId/idempotencyKeyを供給。冪等キー例`${jobId}:${provider}:${callSeq}`）。**D-4（失敗call記録責務）**: 台帳ヘルパは`status=failed`記録に対応済み＝workerが捕捉した失敗callも`recordExternalApiUsage`で記録すればよい（案B寄り。最終決定はT-M3-05で）。`reduceWebSearchMaxUses`のretry適用・検索toolのversion env化・search+JSON併用許可リスト（normalize.ts空）はworker/実装時の公式doc確認で対応。価格改定時はpricing.tsを更新。

### T-M3-04: GENコンテキスト組み立て（固定部＋可変部） `done`
- 参照: プロンプト設計書 §4.1、プロンプト設計書 §4.2、要件02 §4.4、GEN-P1〜P6 / 依存: T-M3-02、M0 / サイズ: M
- 完了条件:
  - systemが「SYS-GEN＋<base_md>」の固定バイト列、userが<pattern><input><recent_posts>で組み立てられ、未入力項目は「（未指定）」、recent_postsはDB保存済みdraftから各先頭80字・最大10件になることをテストで確認できる
  - P-6で発信テーマがテーマ選択肢マスタのnews_category対応に該当する場合のみ<news_digest>（直近7日・impact優先high→mid→low・同impactは新しい順・最大10件・title/summary/source_url/impactのJSON配列）が入り、非該当なら空になる
- メモ: <quote_post>枠はP-5有効化後用にインターフェースだけ確保し実装しない。recent_postsのためのX API追加読取は行わない。可変値をsystemへ混ぜないことがキャッシュ効率の要。
- 実装メモ: `ai/gen-context.ts`。`buildGenSystem(baseMd)`=`[SYS_GEN, "<base_md>\n…\n</base_md>"]`（base_mdを最終ブロック＝キャッシュ境界、可変値なし）。`buildGenUser`=<pattern>/<input>（空は（未指定））/<recent_posts>（空は（未指定））、newsDigest`undefined`はタグ省略・`[]`は空配列出力（P-6非該当）・配列はJSON、quotePostは指定時のみ（P-5予約）。`formatRecentPosts`＝codepoint安全に先頭80字・最大10・空白圧縮。`fetchRecentPostBodies`＝status='posted'のdraftをposted_at降順max10、thread先頭ポストtext（X API追加読取なし）。`fetchNewsDigest`＝`category::text=any()`・published_at直近7日・`impact` high→mid→low→published_at降順・max10（categories空で[]）。theme→category判定は既存`themesToNewsCategories`を再利用（worker側で settings.themes から算出）。テスト+12（ユニット9: system/user/（未指定）/news省略・空[]・配列/quote/80字・max10／DB3: posted限定・新しい順・先頭ポスト、news category/7日/impact優先、空categories）。全657 green。doc: プロンプト設計書 §4.1/§4.2・要件02 §4.4が既述で整合＝影響なし。
- 後続への注意: T-M3-05 workerが settings.themes→`themesToNewsCategories`→`fetchNewsDigest`（P-6のみ）、`resolvePromptTemplate(kind)`→pattern、base_md（x_accounts.base_md）→`buildGenSystem`、`fetchRecentPostBodies`→`buildGenUser`で`TextGenRequest`を組む。thread先頭ポストは`{text}`/文字列両対応。

### T-M3-05: post_generation workerハッピーパス（JSON検証・修復・draft作成・通知） `done`
- 参照: 要件04 §8、要件04 §14、プロンプト設計書 §5.1、プロンプト設計書 §7.1、プロンプト設計書 §7.4、要件02 §4.7、N-4、P-1〜P-4、P-6 / 依存: T-M3-03、T-M3-04、T-M3-01、M2 / サイズ: L
- 完了条件:
  - leaseされたpost_generation jobがモックproviderで、前提再検証→stage更新（validating→research→writing）→生成→zodによるJSON検証→draft作成（threadとinitial_threadを同値保存・weighted_length算出・ニュース起点はsource_news_item_id保存）→job succeeded→draft_created通知（dedupe_key `draft:{id}:created`）まで完走する
  - JSON parse失敗時にコードフェンス除去→再パース→同一job内の修復指示付きcall 1回（残り30秒未満なら開始せずretryableでqueuedへ）が行われ、なお失敗ならjob failed＋error通知になる
  - AI応答の`error`フィールド返却時はjob failedとなり、値はログ用に保存してユーザーへは安全なメッセージだけを表示する
- メモ: lease・retry・stale回収はM2のjob基盤を利用。premium生成枠のreserve/refund（要件03 §7）はM6で追加するためフック位置のみ用意。auto mode時のpost_publish子job作成はスケジュール側マイルストーン（M4）で扱う。
- 実装メモ: 中核`jobs/post-generation.ts` `executePostGeneration`（deps注入: db/resolveProvider/gatherPrereqInputs、pure化しモックproviderでDBテスト）。冪等（source_job_id存在で already_done）→validating（前提再検証=checkExecutionPrerequisites）→research（buildGenSystem＋resolvePromptTemplate＋fetchRecentPostBodies＋P-6のみfetchNewsDigest）→writing（runTextGeneration）→AI error/JSON不能は失敗→draft作成（thread=initial_thread・postsToThread=weighted_length・source_news_item_id）→usage保存→draft_created通知。stageは`heartbeat`（独自tx）。`ai/gen-output.ts`=SYS-GEN出力zod（posts/sources/error string[]）＋postsToThread。server配線`post-generation-server.ts`（resolveTextProvider＋env model＋gatherExecutionPrereqInputs）をhandlers.tsに**動的import登録**（レジストリ読込でenv検証を走らせない）。**設計判断**: runJobの汎用finalizerはthrow時にhandler txをロールバック＋error/usage/通知/retryを書かない→失敗系はpoolで別途 error jsonb（§4.10形状・provider生値はprovider_raw_errorへ、userへは安全なmessage）＋usage＋error通知を確定保存してからthrow（runJobがstatus=failed）。**副次修正**: `twitter-text`はESMがdefault exportのみ→`text/weighted-length.ts`と`post/text-metrics.ts`をdefault import化（handlers経由でbuildに入り発覚）。worker.db.testの汎用succeededテストはpost_generationが実handler化したためimage_generation（placeholder）へ変更。テスト+9（gen-output 4／DB 5: happy・冪等・AI error・JSON不能・前提不足）、全666 green・build通過。doc: 要件04 §8/§14・プロンプト設計書 §5.1/§7.1/§7.4・要件02 §4.7 が既述で整合＝影響なし（runJob設計制約はD-5へ）。
- 後続への注意: **retryable(429/5xx/timeout)のbackoff付きqueued差し戻し・<30秒でのrepair-skip差し戻し・reduceWebSearchMaxUses適用はrunJob側の中央化（D-5）待ち**（現状は失敗=failed確定）。**external_api_usage_eventsへのper-call記録の結線**（`recordExternalApiUsage`）は本handlerで未実施＝原価台帳連携タスクで追加。**D-4**: 失敗時usageはgeneration_jobs.usageへ保存済み（案B寄り）。text-metrics.ts(T-M3-01)とtext/weighted-length.tsの重複は将来統合候補。T-M3-06が生成後検証（GEN-FIX/NG/出典/インジェクション）をhooksへ実装。

### T-M3-06: 生成後検証パイプライン（GEN-FIX・NG・出典・インジェクション） `done`
- 参照: プロンプト設計書 §6.9、プロンプト設計書 §7.2〜7.7、要件04 §5、要件06 §4.3、L-7、GEN-FIX / 依存: T-M3-05 / サイズ: M
- 完了条件:
  - 280超過ポストのみPT-FIXで最大2回短縮され、なお超過なら該当ポストに編集必須マーク（警告）付きで下書き化される。cashtag2件以上には自動投稿ブロック警告が付く
  - NGワード検出ポストは警告付き下書き化＋自動投稿ブロックとなり、出典必須パターン（P-1/P-4/P-6、参考URL指定時のP-2/P-3）でsourcesが空なら再試行1回→なお空なら「出典を確認してください」警告付き下書き化となる
  - SSRF検証を通過した出典URLだけがコードで最終ポストへ付加され同ポストのsourcesへ保存される。生成結果に指示への言及・不自然なURL・NGワードがあれば自動投稿ブロック警告が付く
- メモ: GEN-FIXは親jobと同じキーで実行し、premiumカウントも親jobの1回に含む（追加消費なし）。
- 実装メモ: コア`post/generation-validation.ts` `finalizeThread`（pure＋shorten/validateSource注入）。各ポスト: 加重280超過は`shorten`(PT-FIX)で最大2回→なお超過で`length_exceeded`／cashtag≥2で`cashtag_multiple`（text-metrics）／NG検出で`ng_word`（ng-words）／指示マーカーor検証済み出典に無いURLで`injection_suspected`。出典はSSRF（validateSource）通過分のみ最終ポストへ、出典必須パターン（sourceRequired: P-1/4/6常時・P-2/3はURL時）で通過ゼロなら`source_missing`＋sourcesMissing。警告コードは`AUTO_POST_BLOCKING_WARNINGS`＝下書きは自動投稿阻害（要件06 §4.3）。worker結線: post-generation.tsで`postsToThread`を`finalizeThread`に置換、shorten=textGen+PT-FIX（usageを親jobへ合算）、出典必須で空なら**runTextGenerationを1回再生成**して再finalize、FIX/再生成のProviderCallをusage.callsへ加算。SSRF server配線`post/source-url-server.ts`（node dns.lookup{all}＋fetch）。テスト+10（ユニット9: FIX最大2・cashtag・NG・SSRF選別・injection・出典必須空／DB1: NG→draft警告）。全676 green・build通過。doc: 警告コード語彙＋SSRF出典を要件02 §4.7へ追記（v1.13）。
- 後続への注意: 自動投稿ゲート（M4）は`thread[].warnings`を`AUTO_POST_BLOCKING_WARNINGS`で判定し手動確認へ切替。injection判定はヒューリスティック（指示マーカー＋出典外URL）で誤検知の可能性あり＝将来調整可。P-5引用検証（§7.6）はfeature flag OFFで未実装。

### T-M3-07: 生成job Server Actions（createGenerationJob／get／retry／cancel） `done`
- 参照: 要件05 §5、要件05 §12、要件05 §2.2、要件06 §3.2、要件06 §4.2、要件04 §3 / 依存: T-M3-05、M1、M2 / サイズ: M
- 完了条件:
  - createGenerationJobがzod検証・前提検証（契約/キー/X連携/発信設定の不足時はsubscription_required等のコード＋details.不足項目と設定画面パス）・x_account_id所有権と一致検証（不一致はjob_conflict）・request_key冪等（同keyは既存job_id返却）・同時queued/running 5件制限を満たし、`after()`でworkerへdispatchされることを統合テストで確認できる
  - retryGenerationJobはfailed jobのみparent_job_id付き新jobを冪等作成し、cancelGenerationJobはqueuedのみcanceled化（runningは拒否）、getGenerationJobは所有者のみ参照できる
- メモ: 前提検証はM1の契約状態・M2のキー/X連携状態を参照する共通ヘルパとして実装（ニュース画面のcreateDraftFromNewsやホーム初期設定ガイドからも再利用される）。P-5のfeature_disabled拒否は本マイルストーン後段のタスクで実装。
- 実装メモ: コア`jobs/generation-jobs.ts`（zod＋deps注入: runInTx/gatherPrereqInputs/quotePostEnabled）。createGenerationJob=同一tx内で request_key冪等確認→active一致（`profiles.active_x_account_id`≠指定はjob_conflict:x_account_mismatch）→前提再検証（`gatherExecutionPrereqInputs`＋`checkExecutionPrerequisites`でコード＋missing＋settingsPath）→queued/running 5件制限（MAX_ACTIVE_JOBS=job_conflict:too_many_active_jobs）→`on conflict (request_key) do nothing`挿入（競合時は既存返却）。P-5はquotePostEnabled=false時にexternal前にfeature_disabled。request_keyは`requestKey(userId, token)`。retry=failedのみparent_job_id付き冪等新job。cancel=queuedのみcanceled（running/終端はjob_conflict、canceledは冪等）。get=owner joinのみ。Action`app/actions/generation-jobs.ts`が pool・`gatherExecutionPrereqInputs`・`env.FEATURE_QUOTE_POST_ENABLED`を束ね、新規作成時のみ`after(()=>dispatchJob)`。テスト+18（ユニット14: 全分岐／DB4: 冪等・5件制限・active不一致・retry/cancel/get）。全694 green・build通過。doc: 要件05 §5/§12/§2.2が既述で整合＝影響なし。
- 後続への注意: regenerateDraft/publishDraft/reconcile/clone等の下書き系Action（要件05 §5）は後続タスク。前提検証の共通化（createGenerationJobのassertPrereqs）はニュースcreateDraftFromNews（M4）でも再利用可。P-5有効化時はquote_url必須＋対象取得検証を追加。

### T-M3-08: SC-07作成タブ：生成フォーム（2ペイン） `done`
- 参照: SC-07、要件06 §4.1、要件06 §4.2、P-1〜P-4、P-6、P-7、要件05 §12 / 依存: T-M3-07 / サイズ: M
- 完了条件:
  - /app/postsの作成タブが2ペイン（パターン選択＋入力／プレビュー・結果）で表示され、P-1〜P-4/P-6を選択できる（P-5はflag OFFで非表示）
  - 共通入力（参考URL・追加指示）とP-2のみの「自分の考え」、画像ON/OFF＋provider選択（BYOKはvalidな登録キーのproviderのみ活性）が表示され、任意入力が空でも生成を開始できる
  - 生成開始でcreateGenerationJobが呼ばれ、前提不足エラー時は不足項目一覧と「設定へ」ボタンが表示される
- 実装メモ: `/app/posts/page.tsx`（server）をタブ（作成/下書き/履歴、作成のみ実装）＋作成フォームへ刷新。`resolveActiveXAccountForUser`でactive解決（無ければX連携導線）、plan＋`FEATURE_QUOTE_POST_ENABLED`でP-5表示制御、画像provider活性判定（premium=運営キー＋画像モデル設定済みのopenai/google、BYOK=user_api_keysのvalidなopenai/google）。クライアント`create-post-form.tsx`＝2ペイン（左: パターンradio＋参考URL＋P-2のみ自分の考え＋追加指示＋画像ON/OFF＋provider select／右: 結果）、`crypto.randomUUID()`をrequest_keyに`createGenerationJobAction`呼び出し、任意入力空でも送信可。前提不足エラー（details.settingsPath付き）は`ExecutionPrereqNotice`（不足項目＋設定へ）、その他はインラインエラー。**BACKLOG修正**: 前サイクル（T-M3-07）の編集でT-M3-08ヘッダ行を誤削除していたのを復元。全694 green・build通過（testing-library未導入のためUIはtypecheck/lint/build検証）。doc: SC-07・要件06 §4.1/§4.2が既述で整合＝影響なし。
- 後続への注意: 進捗ポーリング（progress_stage表示・再訪復元・queued 60秒表示・failed再試行導線）はT-M3-09。生成結果（draft）表示はT-M3-09/11。下書き/履歴タブは後続。

### T-M3-09: SC-07作成タブ：進捗ポーリングと再訪復元 `done`
- 参照: 要件06 §4.2、要件04 §3、PRD §7 / 依存: T-M3-08 / サイズ: M
- 完了条件:
  - job作成後にgetGenerationJobをポーリングしてprogress_stage（validating/research/writing/image）をプログレス表示し、succeededで生成結果（draft）表示へ遷移する
  - queuedのまま60秒超過で「開始が遅れています。自動で再開されます（最大5分）」を進行中扱いで表示し、failedの場合のみ原因と再試行導線（retryGenerationJob）を表示する
  - 生成中に画面を離れて再訪してもactive jobの状態が復元される
- 実装メモ: `create-post-form.tsx`にjob状態＋useEffectポーリング（2.5s、`getGenerationJobAction`、TERMINALで停止）を追加。progress_stageをステッパー表示（validating/research/writing＋imageはON時のみ、済/進行中/未）。queued&created_atから60秒超過で「開始が遅れています。自動で再開されます（最大5分）」（進行中扱い）。succeeded→「下書きを作成しました」＋下書き確認リンク。failed→再試行ボタン（`retryGenerationJobAction`）。**再訪復元**: page（server）が active x_account の queued/running な post_generation 最新1件を`initialJob`としてフォームへ渡し、ポーリングを再開。生成中は「生成する」ボタン無効化。全694 green・build通過（UIはtypecheck/lint/build検証）。doc: 要件06 §4.2 が既述で整合＝影響なし。
- 後続への注意: succeeded時の下書き“表示”遷移は下書きタブ（T-M3-11）へリンク（`?tab=drafts`）で暫定接続。job.errorのユーザー向け表示はコード化メッセージのみ（生値は出さない）。ポーリングはserver action経由（M4でrealtimeにするなら別途）。

### T-M3-10: 下書きServer Actions（listDrafts／updateDraft／discardDraft） `done`
- 参照: 要件05 §5、要件06 §4.3、要件02 §3.9、要件02 §4.7、S-5 / 依存: T-M3-01、M1 / サイズ: M
- 完了条件:
  - updateDraftが`status=draft`のみ・expected_updated_at楽観lock（0件更新はjob_conflict）・1件以上かつpattern別最大数（P-1=6/P-2=1/P-3=7/P-4=5/P-6=7）・所有draftの既存画像のみ参照可を検証し、保存時に加重文字数・NG警告を再計算する。initial_threadは編集で更新されない
  - discardDraftはdraft/failedのみ許可し、未解決の投稿ID・作成成否があるfailedは拒否する。破棄成功時はdraft専用pathの生成画像をbest effortで削除する
  - listDraftsがactive_x_accountのstatus別フィルタ（下書き=draft/failed、履歴=posted）で一覧を返す
- メモ: テストはseed済みdraftで実施可能（worker完成を待たない）。破棄はstatus=discardedへ遷移し物理削除しない。
- 実装メモ: コア`lib/drafts.ts`（Queryable＋deleteImages注入）。updateDraft=owner join→status=draft限定（他statusはjob_conflict）→post数1..PATTERN_MAX_POSTS[pattern]（違反validation_error）→imageLocalIdsは既存local_id subset限定→`revalidateEditedThread`（加重文字数＋length/cashtag/ng警告のみ、FIX/SSRF/injectionなし）→楽観UPDATE（0行でjob_conflict）。initial_threadは不変。discardDraft=draft/failed限定、failedでtweet_ids非空 or last_post_error有りは`unresolved_posting`で拒否、status=discardedへ（物理削除せず）＋画像best-effort削除。listDraftsForAccount=active_x_account、drafts=draft/failed・history=posted。`generation-validation.ts`に`PATTERN_MAX_POSTS`＋`revalidateEditedThread`追加。Action`app/actions/drafts.ts`（pool・active解決・Supabase Storage remove）。**設計判断**: 楽観lockは`updated_at::text`を完全精度versionトークンに（JS Dateミリ秒往復ではtimestamptzマイクロ秒が欠落し照合が常にfailするため）。テスト+16（ユニット: drafts分岐・revalidate・PATTERN_MAX／DB4: 楽観lock・pattern max・discard(draft/failed/unresolved/posted)・list filter）。全710 green・build通過。doc: 要件05 §5・§4.3・要件02 §3.9/§4.7が既述で整合＝影響なし。
- 後続への注意: **他のexpected_updated_at系楽観lock（updateDraftのquote fields拡張・publish等）も`updated_at::text`トークンで統一する**（ミリ秒往復回避）。下書き編集UI（T-M3-12）は本Actionを使い、version tokenにlistで得た`updated_at`（text）を渡す。P-5のquote fields編集は有効化後。画像のpost割当編集はT-M3-12/画像タスク。

### T-M3-11: SC-07下書きタブ（一覧・詳細・破棄・警告表示） `done`
- 参照: SC-07、S-5、要件06 §4.3、要件06 §10、要件04 §14 / 依存: T-M3-10 / サイズ: M
- 完了条件:
  - 下書きタブに未投稿draft（draft/failed）が一覧表示され、警告（文字数超過・NG・出典不足・画像失敗）がポスト/下書き単位のバッジで表示される
  - 破棄操作が確認ダイアログ付きで動作し、通知リンク形式`/app/posts?tab=drafts&draftId=...`で対象下書きを直接開ける
  - 派生下書き（parent_draft_id）に派生元へのリンクが表示される
- 実装メモ: `/app/posts`をタブ対応（create/drafts/history、タブはLink `?tab=`）に刷新。drafts tab=`listDraftsForAccount(active,'drafts')`→`drafts-list.tsx`（クライアント）。各下書き: pattern・failed/警告バッジ・ポスト単位の警告バッジ（length_exceeded/cashtag_multiple/ng_word/source_missing/injection_suspected＋画像failedで画像失敗）・加重文字数/280・自動投稿手動確認バッジ。破棄=AlertDialog確認→`discardDraftAction`（expected_updated_at=draft.updated_at）→router.refresh。`parent_draft_id`があれば派生元リンク（`?tab=drafts&draftId=`）。deep-link=`?draftId=`で該当cardをring強調＋`id=draft-{id}`/`scroll-mt`。`DraftView`に`parent_draft_id`追加。**T-M3-05のdraft_created通知linkを`/app/posts?tab=drafts&draftId={id}`のdeep-link形式に更新**（通知から対象下書きへ直接遷移）。全710 green・build通過（UIはtypecheck/lint/build検証）。doc: SC-07・要件06 §4.3/§10が既述で整合＝影響なし。
- 後続への注意: 下書き“編集”UI（本文編集・並べ替え・追加・削除→updateDraftAction）はT-M3-12。履歴タブ（posted）はT-M3-22。deep-linkのscrollIntoViewはCSS `scroll-mt`＋id anchorで対応（自動スクロールが要れば別途client効果）。

### T-M3-12: SC-07下書き編集UI（本文編集・並べ替え・追加・削除） `done`
- 参照: 要件06 §4.3、要件05 §12、PRD §7 / 依存: T-M3-11 / サイズ: M
- 完了条件:
  - 各ポストの本文編集・並べ替え・追加・削除ができ、加重文字数カウンタと280超過警告がリアルタイム表示される
  - pattern別最大数超過・空本文は保存できず、楽観lock競合時（job_conflict）は再読込を促すエラーが表示される
  - モバイル幅でも下書き全文確認・本文編集・破棄が操作できる
- 実装メモ: `draft-editor.tsx`（クライアント）＝ポスト単位のtextarea編集・↑↓並べ替え・×削除・＋追加、`weightedLength`（twitter-text、client）で加重文字数/280をリアルタイム表示＋超過警告。pattern別最大（inline map）超過・空本文・0件は保存無効化。保存=`updateDraftAction`（expected_updated_at=draft.updated_at）→success:router.refresh＋編集終了／job_conflict:「最新に再読込してください」。drafts-list.tsxのDraftCardにstatus=draftのみ「編集」トグルを追加（編集中はDraftEditor、通常は読み取りthread）。モバイルは1カラム（textarea幅100%）で全文確認・編集・破棄可。**server強化**: `updateDraft`で空本文（trim空）をvalidation_error(empty_post)に（要件05 §12）。テスト+1（空本文拒否ユニット）。全711 green・build通過（UIはtypecheck/lint/build検証）。doc: 要件06 §4.3・要件05 §12が既述で整合＝影響なし。
- 後続への注意: 追加指示付き再生成（regenerateDraft・派生下書き）はT-M3-13。画像のpost割当編集・quote編集は画像/P-5タスク。編集時のNG/出典警告はupdateDraft保存時に再計算（表示は保存後の再読込で反映）。

### T-M3-13: regenerateDraft（追加指示付き再生成） `done`
- 参照: 要件05 §5、要件06 §4.3、PRD §5.4 / 依存: T-M3-07、T-M3-11 / サイズ: M
- 完了条件:
  - regenerateDraftが元draft（status=draftまたは未解決投稿のないfailed）の本文・pattern・検証済みsource情報を入力snapshotとしてjobへ保存し、生成成功時にparent_draft_id付きの新draftを作成、元draftは変更・破棄されない
  - request_key冪等で、UIから追加指示を付けて再生成→派生draftが下書きタブに現れ、採用しない版を破棄できる
- メモ: 再生成も新しいtop-level jobとして扱う（premiumの生成枠1消費の枠管理はM6）。
- 実装メモ: `generation-jobs.ts` `regenerateDraft`＝元draft（owner・status=draft/clean-failed）を読み、pattern・previous_posts（thread本文）・additional_instructionsを`job.input`（parent_draft_id＝元draft）へsnapshotして**新しいtop-level post_generation job**を冪等作成（request_key・5件制限・prereq・P-5 feature gate共通化）。post-generation handlerを拡張: `job.input.parent_draft_id`→新draftの`parent_draft_id`に設定、`job.input.previous_posts`→`buildGenUser`の`<previous_draft>`ブロック（改善の素材）。gen-context `buildGenUser`に`previousDraft`追加。元draftは読むだけで変更・破棄しない。Action`regenerateDraftAction`（新規のみafter dispatch）。UI: drafts-list.tsxに「再生成」トグル＋`RegenerateBox`（追加指示textarea→`regenerateDraftAction`→「完了後に派生下書きが表示」）。派生draftは`parent_draft_id`でT-M3-11の派生元リンクに現れ破棄可。テスト+5（ユニット4: snapshot/parent_draft_id・非regenerable・unresolved・冪等／DB1: parent_draft_id伝播）。全716 green・build通過。doc: 要件05 §5・要件06 §4.3が既述で整合＝影響なし。
- 後続への注意: premium生成枠のreserve/refund（1消費）はM6。regenerate結果の進捗表示は作成タブのポーリング（T-M3-09）とは別導線（下書きタブは完了後の一覧refreshで反映。必要ならjob追跡UIを後続で）。source/quote snapshotのうちquoteはP-5有効化後に拡張。

### T-M3-14: 画像生成アダプタ（OpenAI／Gemini）と画像正規化 `done`
- 参照: プロンプト設計書 §5.5、P-7、要件06 §6、要件05 §12 / 依存: M2 / サイズ: M
- 完了条件:
  - 画像アダプタがOpenAI/Geminiをモックで呼び分け、16:9へ最も近い対応値への変換指定、返却画像のデコード・形式/実寸/MIME/容量検証を行う
  - JPG/PNG/WEBP・5MB以下への変換・圧縮がテスト画像で確認できる
- メモ: モデル名は環境変数（OPENAI_IMAGE_MODEL／GEMINI_IMAGE_MODEL）。プロバイダ固有のsize文字列等の差異はアダプタへ閉じ込め共通仕様にしない。
- 実装メモ: 純粋コア`src/lib/ai/image.ts`（`ImageGen`契約＋`makeImageGen`でprovider呼び分け＋`pickNearestSize`でアスペクト比→最近傍。OpenAIはpixel size文字列/Geminiはaspect ratio文字列をアダプタ内で解決、b64デコードして`RawImage{bytes,declaredMime}`を返す）。正規化`src/lib/ai/image-normalize.ts`（sharp。`inspectImage`で実形式/実寸/容量検証、`normalizeForX`でJPG/PNG/WEBP・5MB以下へ変換/圧縮。許可形式かつ上限内はそのまま返す）。server配線`src/lib/ai/image-client.ts`（`resolveImageGen(ResolvedKey)`で実SDK注入）。sharp採用は[ADR-0004]、package.jsonへ直接依存追加（Next同梱でbinary取得不要）。T-M3-15はこの`resolveImageGen`＋`normalizeForX`を画像jobから呼ぶ。

### T-M3-15: image_generation workerと生成からの連鎖 `done`
- 参照: 要件04 §8、要件04 §9、GEN-IMG、プロンプト設計書 §4.2、プロンプト設計書 §6.8、要件02 §4.8 / 依存: T-M3-05、T-M3-14、T-M3-02 / サイズ: L
- 完了条件:
  - 画像ONのpost_generationが親job終端（succeeded）へのcommit後に決定的key（`parent:{parent_job_id}:image_generation:{draft_id}`）でimage_generation子jobを作成・dispatchし、子workerがPT-IMG（base_mdセクション3＋1ポスト目本文）→画像生成→private Storage保存→drafts.images更新→draft確定・draft_created通知まで完走する（モックprovider）
  - 画像生成またはStorage保存の最終失敗時は本文生成jobを失敗させず、draftを画像なし＋警告で確定して通知する（子jobはfailed）
  - 子jobのrequest_keyによりworker再実行でも子jobが重複作成されない
- メモ: premium画像枠のreserve/refundはM6。auto modeで画像workerがpost_publishを作成する経路はM4で追加。dispatch失敗時はqueuedのまま残しscheduler_tick回収（M2）に委ねる。
- 実装メモ: 中核`jobs/image-generation.ts` `executeImageGeneration`（deps注入: db/resolveTextProvider/resolveImage/uploadImage/recordStage、pure化しモックでユニットテスト）。冪等（drafts.imagesにready印で already_done）→heartbeat(image)→PT-IMG（`resolvePromptTemplate(image)`＋`extractBaseMdSection(base_md,3)`＋1ポスト目、`runTextGeneration`でJSON{prompt,aspect}）→`resolveImageGen`で画像生成→`normalizeForX`（T-M3-14）→Storage保存（path=`user/xaccount/draft/localId.ext`）→drafts.images(ready)＋usage＋draft_created。失敗時はdrafts.images(status=failed,storage_path="")＋error＋draft_created通知してthrow（子failed・本文は残る）。server配線`image-generation-server.ts`（resolveTextProvider＋resolveImageProvider→resolveImageGen＋Supabase admin storage.upload）をhandlers.tsに動的import登録。**連鎖**: post-generation.tsに`ensureImageChildJob`（決定的key＋on conflict、already_doneパスでもensure）を追加し画像ON時はdraft_created送信をスキップ。**汎用連鎖dispatch**: runJob成功確定後に`dispatchChildJobs`（parent_job_id一致・queued）をbest-effortで起動（親running中はacctRunning直列化でleaseできないため成功後に行う）。**副次**: post-generationのheartbeatを`recordStage`注入化（ユニットテスト可能に）。worker.db.testの汎用successはimage_generation実handler化に伴いsuggestionへ変更。doc: 要件04 §1/§9・ADR-0002を「子jobは親succeeded後にdispatch」へ精緻化、要件02 §4.8/プロンプト設計書 §5.5/§6.8/§4.2は既述と整合。テスト+11（image-generation 5／post-generation chain 3／extractBaseMdSection 3）、全744 green・build通過。
- 後続への注意: **画像表示・再生成UI（regenerateImage）はT-M3-16**。署名URL生成は表示時（要件02 §4.8）。auto投稿で画像workerがpost_publishを連鎖する経路はM4（`dispatchChildJobs`が同じ仕組みで流用可能）。

### T-M3-16: 画像表示・再生成（regenerateImage）UI `done`
- 参照: 要件05 §5、要件06 §6、要件04 §9、P-7 / 依存: T-M3-15、T-M3-11 / サイズ: M
- 完了条件:
  - 下書き詳細で1ポスト目の添付画像が短時間の署名URL（DBへ永続化しない）で表示され、再生成ボタンでregenerateImageがimage_generation jobを冪等作成する
  - 再生成中は既存画像を表示し続け、新画像のStorage保存とdraft参照切替の成功後に旧objectがbest effort削除される。再生成失敗時は既存画像が維持される
- メモ: BYOKでOpenAI/Geminiがともに未登録の場合はprovider選択を非活性にする（PRD §8.2）。
- 実装メモ: 表示は`lib/images/signed-url-server.ts` `attachSignedImageUrls`（Supabase admin `createSignedUrl`・TTL300s、ready画像のみ、`DraftImage.signed_url`へ転写・DB非永続）をpage.tsxで下書き/履歴ロード後に適用。`DraftImage`に表示専用`signed_url?`追加。再生成中核`generation-jobs.ts` `regenerateImage`（request_key＋「1draftにactive画像job1件」の二重冪等、draft所有/状態(draft/failed)検証、`{regenerate:true}`inputでimage_generation manual job作成）＋`regenerateImageAction`（!dedupedでdispatch）。**画像job分岐**（T-M3-15の`executeImageGeneration`拡張）: `job.input.regenerate`時は既存ready印でも already_done せず新規生成→新path保存→drafts.images置換→**旧readypathをbest-effort削除**（`deleteImages`dep追加・server配線でSupabase admin `storage.remove`）→draft_createdは送らない。再生成失敗時はdrafts.imagesへ触れず（既存画像維持）error/usageのみ記録してthrow。UIは`drafts-list.tsx`の`ImageSection`（署名URLで`<img>`表示・再生成ボタン・provider未登録時disabled・running中はオーバーレイ「再生成中…」＋job pollで成功時router.refresh・失敗時は既存画像維持のnotice）。doc: 要件05 §5のregenerateImage引数を`(request_key, draft_id)`へ確定（providerはaccount設定解決）、要件06 §6に署名URL表示・provider未登録非活性を追記。要件04 §9は既述と一致。テスト+6（image-generation regen 2／generation-jobs regenerateImage 4）、全750 green・build通過。
- 後続への注意: **D-6**（生成ごとのimage_provider指定を尊重するか／account設定に一本化するか）を要決定に追加。現状はaccount設定(ai_purpose_config)解決で動作し、作成フォームの`image_provider`選択は画像jobで未使用。案A採用時は`resolveImageProvider`にpreferred引数を追加する。

### T-M3-17: X投稿APIクライアント（dry_run対応・原価記録） `done`
- 参照: PRD §8.1、要件04 §5、要件04 §10、要件01 §3.1、要件02 §3.17 / 依存: M2 / サイズ: M
- 完了条件:
  - 投稿作成（reply・media_ids対応）・投稿削除・media upload・直近投稿/単一ポスト取得がモックHTTPで動作し、429/5xx/networkへ指数backoff+jitterの最大2回再試行、401/403は再試行なしでkey/token失効エラーへ正規化される
  - `X_POSTING_MODE=dry_run`ではX APIを一切呼ばず決定的なダミーtweet_idを返し、dry-runであることが呼び出し結果から判別できる
  - 原価集計対象の呼び出し（create/delete/read）が成功・失敗を問わず`external_api_usage_events`へ冪等記録され、media uploadは原価台帳から除外される
- メモ: OAuth tokenの復号・single-flight refreshはM2のX連携基盤を利用。dev/previewはdry_run必須（要件01 §3.1）。単価は環境変数X_COST_*のsnapshotを使用。
- 実装メモ: **M2で`x/client.ts`が既存**（createPost[reply/media_ids/quote]・deletePost・getMe・getTweetMetrics・retry[429/5xx/network→backoff+jitter最大2再試行・`../jobs/retry`再利用]・401/403→XApiError(auth)無再試行・dry_run擬似ID＋`dryRun`フラグ）。本タスクの差分のみ実装: (1)**live `uploadMedia`**（`POST /2/media/upload`・JSON body `media`(base64)/`media_category=tweet_image`/`media_type`・応答`data.id`。公式docs.x.com 2026-07-24確認）。(2)**原価pricing** `x/pricing.ts`（`xUnitCost(operation, XCostConfig, {hasUrl})`。create=URL有無で通常/URL付き、delete=interaction、read=0）。(3)**台帳記録ラッパ** `x/usage.ts` `recordedXCall(db, {ctx,operation,unitCostUsd,idempotencyKey}, call)`（成功/失敗を`external_api_usage_events`へ冪等記録[recordExternalApiUsage再利用]・dry_runは記録せず・失敗は推定原価0・記録失敗はbest-effortでAPIエラーを優先）。(4)server配線`client-server.ts`に`xCostConfig()`（env `X_COST_*` snapshot・未設定は0）。**operationはmigration CHECKと一致**（x_post_create/x_post_delete/x_post_read/x_user_read）。doc: 要件04 §10にdry_run非記録・read単価0・失敗原価0を明示（§3.17/§3.4/§10と整合）。テスト+9（uploadMedia live 1／pricing 3／usage 4／client既存更新1）、全758 green・build通過。
- 後続への注意: **T-M3-18 post_publish worker**は`recordedXCall`＋`xUnitCost`＋`xCostConfig`で各投稿を台帳記録し、consume event（利用枠`usage_events`）は別ledger（`usage_counters`）で扱う。media uploadは`recordedXCall`で包まない（台帳除外）。冪等keyはjob/tweet単位で採番する。

### T-M3-18: post_publish workerハッピーパス（スレッドreply連投・日次50上限・usage_events） `done`
- 参照: 要件04 §10、要件06 §7、O-5、S-6、要件03 §7.3、要件03 §7.4、要件02 §3.13、要件04 §13 / 依存: T-M3-17、T-M3-10、M2 / サイズ: L
- 完了条件:
  - dry_runで、draftのlock（draft/再試行可能failed→posting）→検証（契約・X token・日次上限・自動投稿を阻害する警告・thread）→画像があればmedia upload→1ポスト目投稿→以降は直前の自分のtweet_idへのreply連投→各成功直後のtweet_ids保存＋全プラン`post_create` consume event（冪等key `draft:{draft_id}:tweet:{tweet_id}:post:create`・counter_typeは最終payloadのURL有無で分類）→status=posted・root_tweet_id・posted_at・posted_mode更新→posted通知（dedupe_key `draft:{id}:posted`）まで完走する
  - 当日JSTの同一Xアカウントのpost_create件数＋投稿予定ポスト数が`X_DAILY_POST_LIMIT`（既定50）を超える場合は実行せず、翌日まで停止の文言でエラーになる
  - X media upload失敗時は本文を投稿せずdraftをfailed（再試行可能）にし、投稿完了時に`next_metrics_at`が1日checkpointへ設定される
- メモ: leaseはuser単位のpost_publish直列advisory lockを含む（M2基盤）。premiumの通常/URL付き枠のロールバック安全残量検証とcounter加算はM6（本タスクは全プラン共通のusage_events記録まで）。tweet_id別実績の収集・表示（metrics_collector・SC-09）は別マイルストーン。
- 実装メモ: 中核`jobs/post-publish.ts` `executePostPublish`（deps注入: db/getAccessToken/createPost/uploadMedia/downloadImage/costConfig/dailyLimit/recordStage、pool駆動で各ポスト後の tweet_ids/consume を即確定・pure化しモックでユニットテスト）。冪等（status=postedで already_done）→lock（`update...status='posting' where status in('draft','failed') and jsonb_array_length(tweet_ids)=0`・0行→job_conflict）→検証（thread非空／auto時`threadBlocksAutoPost`／日次上限=当日JST post_create consume件数+thread長>limitで`status='draft'`へ戻し停止／`getAccessToken`失敗→x_token_invalid）→readyimage有れば`downloadImage`→`uploadMedia`（失敗→failed[retryable]・本文未投稿）→スレッド連投（1件目reply無・以降直前tweetへreply、1件目のみmediaIds、P-5 quote_url末尾合成）→各成功直後 tweet_ids append＋usage_events consume（tweet単位冪等key・counter_typeは最終text URL有無で post_normal/post_url・month=JST）＋原価は`recordedXCall`（T-M3-17）→status=posted/root_tweet_id/posted_at/posted_mode/`next_metrics_at=now+1day`→posted通知。server配線`post-publish-server.ts`（getValidXAccessToken＋xClientDeps createPost/uploadMedia＋xCostConfig＋Supabase admin storage.download＋env.X_DAILY_POST_LIMIT）をhandlers.tsに動的import登録。**dry_run方針**（§10と完了条件1の差異を調整）: dry_runでもworker記帳（tweet_ids擬似・consume・status=posted・通知・next_metrics_at）は実行し投稿フロー/日次上限を検証可能にする。実X書込と原価台帳記録・premium月次counter加算は行わない→要件04 §10を実装に合わせ更新。テスト+9（happy/URL分類/冪等/media添付/media失敗/日次上限/auto警告block/token失効/lock不可）、全767 green・build通過。
- 後続への注意: **T-M3-19 resume/逆順ロールバック**は、途中失敗で残った tweet_ids（本タスクは failed に残す）から再開・逆順削除する。**publishDraft action（job作成）は別途**必要（要件05 §5・未実装。post_publish jobをdraft_id/mode付きで冪等作成しdispatch）。auto投稿でimage job→post_publish連鎖はM4（`dispatchChildJobs`流用）。premium枠のreserve/refund・usage_counters加算はM6。

### T-M3-19: スレッド途中失敗のresumeと逆順ロールバック `done`
- 参照: 要件04 §11、要件06 §7、要件03 §7.3、PRD §7、要件04 §13 / 依存: T-M3-18 / サイズ: M
- 完了条件:
  - 途中失敗時に保存済みtweet_ids.lengthを再開位置として同一job内で1回だけresumeし、成功すればpostedになる（モックXで失敗位置を注入して検証）
  - resume再失敗時は成功済みtweet_idsを逆順削除し、削除成功ごとに全プラン`post_delete` consume event（冪等key `draft:{draft_id}:tweet:{tweet_id}:post:delete`・元post_createと同じcounter_type）を作成、draftはfailedとなり`last_post_error`へdeleted_tweet_ids/remaining_tweet_idsが保存されerror通知が作られる
  - 削除失敗分はremaining_tweet_idsに残り追加消費なし、tweet_idsは監査用に保持され、残存IDが確定した場合は`next_metrics_at`が設定される
- メモ: rollback削除にもX APIのretry方針（最大2回）を適用。手動・自動投稿とも同一規則。
- 実装メモ: T-M3-18の`post-publish.ts`を拡張。投稿ループを`postOne(i)`（成功直後 tweet_ids append＋post_create consume）＋resumeループ（`tweetIds.length`起点、途中失敗で`resumed`フラグ1回だけ再開→再失敗で`rollbackThread`）に再構成。`rollbackThread`（成功済みtweet_idsを末尾から`deletePost`＋`recordedXCall`[x_post_delete原価]＋post_delete consume[元と同じcounter_type・tweet単位冪等key]、削除失敗はremainingへ残し追加消費なし、tweet_ids保持、`last_post_error`=§4.10形状[deleted/remaining/failed_post_index/ambiguous_*空]、残存ありで`next_metrics_at`設定、error通知）。rollback削除もX client内蔵retry（最大2回）を利用。deps/server配線に`deletePost`追加。dry_runでも同経路（実削除はclient内で擬似）。テスト+3（resume成功/rollback削除成功・deleted記録/削除失敗→remaining＋next_metrics）、全770 green・build通過。doc: 要件04 §11・§13・要件02 §4.10 は本仕様を既述で一致（変更なし）。premium月次counterの2消費はM6。
- 後続への注意: **T-M3-20 結果不明時の照合**は、投稿create/delete のtimeout/接続断/5xx（作成成否不明）時に`ambiguous_create_indices`/`ambiguous_delete_tweet_ids`へ記録し、直近投稿の再取得で一致1件のみ確定して継続、複数/なしは`post_state_unknown`でfailed（要件04 §10末尾・§11・要件05 §2.2・要件02 §4.10）。`getTweetMetrics`/直近投稿取得を利用。

### T-M3-20: 投稿・削除の結果不明時の照合 `done`
- 参照: 要件04 §5、要件04 §10、PRD §7、要件05 §2.2、要件02 §4.10 / 依存: T-M3-19 / サイズ: M
- 完了条件:
  - post作成のtimeout/切断/5xxで成否不明の場合、同一本文を再送せず対象アカウントの直近投稿から本文・作成時刻・reply先が一致する候補を照合し、1件だけならそのtweet_idを保存して継続することがモックで確認できる
  - 候補なし・複数は`post_state_unknown`でfailedとなり、`ambiguous_create_indices`が保存されXでの確認を促す通知が作られる
  - 削除の結果不明は対象IDを再取得して存在確認し、削除済みなら成功扱い、判定不能は`ambiguous_delete_tweet_ids`へ保存してfailedになる
- メモ: 外部API成功後にworkerが落ちる可能性に備え、tweet_id等の外部結果を先に保存してからreconcileする（要件04 §4）。
- 実装メモ: T-M3-18/19の`post-publish.ts`を拡張。X clientに`getRecentPosts`（GET /2/users/:id/tweets・created_at/referenced_tweets、docs.x.com 2026-07-24確認）追加。**create結果不明**（`isAmbiguousError`=XApiError kind network/server）時は再送せず`reconcileCreate`（直近投稿を本文一致＋reply先一致[i>0はtweetIds[i-1]/i=0はnull]＋created_at窓15分で照合）→1件のみ確定でtweet_id保存し継続、0/複数は`failAmbiguousCreate`（post_state_unknown・ambiguous_create_indices・remaining=作成済み・next_metrics・error通知、rollbackしない）。definite失敗は従来通りresume/rollback。**delete結果不明**（rollback中のdeletePost失敗）は`checkTweetExists`（getTweetMetrics: 存在=true/消失=false/取得不能=null）で、false→削除成功扱い（post_delete consume）、true→remaining、null→ambiguous_delete_tweet_ids。last_post_errorは§4.10形状。deps/server配線に`getRecentPosts`/`checkTweetExists`＋`x_user_id`（loadJob）追加。テスト+6（create照合1件成功/候補なしunknown/複数unknown、delete消失→成功/存在→remaining/不能→ambiguous）、全775 green・build通過。doc: 要件04 §10[行75-76・189]・§11・要件05 §2.2・要件02 §4.10 に既述で一致（変更なし）。
- 後続への注意: **reconcileDraftPosting action（要件05 §5・未実装）**が、post_state_unknown/ambiguous を持つfailed draftをX再照合で解消する（別タスク）。**publishDraft action（T-M3-21）**が post_publish jobを作成する。

### T-M3-21: publishDraft Actionと手動投稿UI（最終確認） `done`
- 参照: 要件05 §5、要件06 §7、SC-07、S-5 / 依存: T-M3-18、T-M3-12 / サイズ: M
- 完了条件:
  - publishDraftが`status=draft`（またはtweet_id作成履歴・残存ID・曖昧状態がすべてないretryable failed）のみ許可し、activeな同種jobがなければrequest_key冪等でpost_publish jobを作成・`after()`でdispatchする
  - SC-07の投稿ボタン→最終確認modalに「thread途中失敗時は作成済みポストを自動削除し、削除後はX上で復元できない」ことが明示され、確認後にdry_runで投稿完了（下書きタブから消え履歴タブへ移動）まで動作する
  - posting中のdraftは編集・破棄・再投稿操作が無効化される
- 実装メモ: 中核`generation-jobs.ts` `publishDraft`（request_key＋active post_publish job[unique index]の二重冪等、draft所有/状態検証: draft はOK・failed は`hasUnresolvedPosting`[tweet_ids非空/remaining/ambiguous]なら job_conflict:unresolved_posting・その他は not_publishable、投稿prereq`assertPostingPrereqs`、`{mode}`inputでpost_publish job作成）。投稿用prereq`checkPostingPrerequisites`（execution-prereqs.ts・契約→Xキー(BYOK)→X連携のみ、AI/発信設定は不要）を追加。`publishDraftAction`（!dedupedでafter dispatch）。UI`drafts-list.tsx`: `PublishButton`（最終確認AlertDialog=「途中失敗で作成済み自動削除・復元不可」明示）＋job pollで成功→router.refresh（下書き→履歴）／失敗→通知＋refresh。**投稿中は編集/再生成/投稿/破棄を無効化＋「投稿中…」表示**（locked）。ImageSectionもpublishing中disable。テスト+8（publishDraft: draft作成/active dedup/request_key冪等/clean failed許可/unresolved[tweets]拒否/unresolved[ambiguous]拒否/posted拒否/prereq）、全783 green・build通過。doc: 要件05 §5は既述で一致、要件06 §7に「posting中disable・投稿prereqはAI不要」を追記。
- 後続への注意: failed下書きの republish（tweet_id作成済み）は clone（cloneFailedDraftForRetry・未実装）経由。UIは status=draft のみ投稿ボタン表示（clean failed の直接再投稿はactionが許可するがUI導線は後続）。reconcileDraftPosting action は別タスク。

### T-M3-22: SC-07履歴タブ（投稿履歴） `done`
- 参照: S-6、SC-07、要件06 §4.3、要件02 §3.9、要件04 §14 / 依存: T-M3-18、T-M3-11 / サイズ: S
- 完了条件:
  - postedのdraftが履歴タブに投稿日時・自動/手動（posted_mode）・パターン・tweet_ids（X上ポストへのリンク）付きで一覧表示され、本文・順序は編集不可の閲覧専用で表示される
  - 通知リンク形式`/app/posts?tab=history&draftId=...`で対象履歴を直接開ける
- 実装メモ: `DraftView`＋`DRAFT_COLUMNS`に`tweet_ids`/`posted_mode`を追加（listDraftsForAccountの両tabで返る）。新規`history-list.tsx`（`HistoryList`/`HistoryCard`・**閲覧専用**: パターン・posted_mode(自動/手動)バッジ・投稿日時・thread本文・各ポストの「Xで見る（ポストN）」リンク[`https://x.com/{handle}/status/{tweetId}`・handle無しは`i`にフォールバック]、`draft-{id}`アンカー＋selectedDraftIdでring強調）。page.tsxのhistory branchをplaceholderから`HistoryList`へ差し替え（handleは`x_accounts.handle`をactiveXAccountIdで取得）。postedはdrafts tabから消えhistory tabへ（listはstatus=postedのみ）。posted通知link`/app/posts?tab=history&draftId=`はT-M3-18で設定済み→deep-link強調が機能。テスト: 既存783 green（UIタスク・DraftView変更はstatusのみ検証のDB/unit testに影響なし）・build通過。doc: 要件06 §6/§7[行168-169]・SC-07[行19]・要件04 §14 に既述で一致（変更なし）。
- 後続への注意: 部分失敗でX上に残ったtweet_id・rollback削除済みIDの実績表示（要件06 §8 行211）・metrics_collector（SC-09）はM5。X permalink handleは`x_accounts.handle`を使用。

### T-M3-23: reconcileDraftPostingとfailed下書きの復旧UI `done`
- 参照: 要件05 §5、要件06 §7、要件06 §10 / 依存: T-M3-20 / サイズ: M
- 完了条件:
  - reconcileDraftPostingがfailed draftのみ対象に、全投稿が意図したthreadとして存在すれば不足tweet_id/`post_create` consumeを冪等補完してpostedへ確定する（モックX）
  - アプリが実行して結果不明だった削除が削除済みと確認できた場合は`post_delete` consumeを補完して未解決情報を消し、候補複数・一部残存はfailedを維持する
  - 未解決の投稿ID・作成成否があるfailed draftは破棄が無効化され「Xと再照合」ボタンが表示される。再照合後も判定不能ならXへのリンクとサポート連絡先が表示される
- 実装メモ: 中核`lib/reconcile-posting.ts` `reconcileDraftPosting(deps,{userId,draftId})`（failedのみ・deps注入db/getAccessToken/getRecentPosts/checkTweetExists）。**判別**: `tweet_ids.length < thread.length`＝作成不明→直近投稿で全ポストを本文＋reply連鎖照合し全確定なら不足tweet_id補完＋新規のみpost_create consume→posted（root/posted_at/next_metrics/last_post_error=null）、一意確定不可はstill_failed。thread完了＋`ambiguous_delete_tweet_ids`＝削除不明→`checkTweetExists`で消失→post_delete consume補完＆deleted_tweet_idsへ移動、存在/不能はstillAmbiguous（remaining維持）→last_post_error更新（deletes_reconciled）。consumeは冪等key。action`app/actions/drafts.ts` `reconcileDraftPostingAction`（getValidXAccessToken＋X client getRecentPosts/getTweetMetrics配線）。UI`drafts-list.tsx`: `DraftView`に`last_post_error`追加、`unresolvedPosting`（tweet_ids非空/remaining/ambiguous）判定で**破棄無効化**＋`ReconcilePanel`（「Xと再照合」→postedでrefresh[履歴へ]／still_failedでX リンク＋サポート導線）。テスト+6（create照合→posted/照合不可→failed、delete全消失→consume補完・一部存在→remaining維持、guard: 非failed/未所有）、全789 green・build通過。doc: 要件05 §5[行167・177]・要件06 §7・要件02 §4.10 に既述で一致（変更なし）。
- 後続への注意: **T-M3-24 cloneFailedDraftForRetry**は、reconcile後に「曖昧状態・残存IDなし」かつ tweet_id作成履歴あり（全削除確認済み）のfailed draftを本文/pattern/source/画像copyで複製（parent_draft_id・AI不使用）。remaining（確定live）の再削除フローは本タスク対象外（reconcileは消失確認のみ）。

### T-M3-24: cloneFailedDraftForRetry（新しい下書きとして再試行） `done`
- 参照: 要件05 §5、要件04 §11、要件06 §7 / 依存: T-M3-23 / サイズ: M
- 完了条件:
  - 全tweet_idの削除・不存在が確認済み（曖昧状態・残存IDなし）のfailed draftだけに「新しい下書きとして再試行」が表示され、本文・pattern・source情報を複製したparent_draft_id付き新draftがAI呼び出し・生成枠消費なしで作成される
  - 画像はStorage objectを新draft用pathへcopyし、全copy成功後に新しい画像参照を保存する。途中失敗はcopy済みobjectをbest effort削除して新draftを作らない
  - 新draftは複製時本文がinitial_threadにも設定され、source_job_id・tweet_ids・投稿日時・実績・投稿errorが空で、空の投稿状態から投稿を開始できる
- メモ: AIを使わない複製draftは下書き承認率の集計対象外（source_job_idを持たないため自然に除外される。要件06 §4.3）。
- 実装メモ: 中核`lib/drafts-clone.ts` `cloneFailedDraftForRetry`（deps注入db/copyImage/deleteImages/newId）。適格性: failed＋tweet_ids非空（作成履歴）＋未解決なし（remaining/ambiguous空）、それ以外は job_conflict（not_clonable/no_creation_history/unresolved_posting）。**画像**: newDraftId=uuidを先に採番→ready画像をStorage copyで新path`{user}/{xacct}/{newDraftId}/{localId}.{ext}`へ、全copy成功後にinsert。途中失敗はcopy済みをdeleteImages（best effort）してthrow（**新draftを作らない**）。insertはid明示・thread=initial_thread・source_job_id=null・tweet_ids等default空・parent_draft_id/quote/source_news_item_id複製。冪等は「同一元draftの未投稿AI無し複製（parent一致・source_job_id null・status=draft）」のdedup（**request_keyはdraftsに列がなく列挙保存しない**→parent基準dedupで実用的二重防止。厳密request_key dedupは列追加要）。action`app/actions/drafts.ts` `cloneFailedDraftForRetryAction`（Supabase admin storage.copy/remove配線）。UI`drafts-list.tsx`: **T-M3-23のunresolvedPostingを精緻化**（tweet_ids非空を除外しremaining/ambiguousのみに）＋`hasCreationHistory`/`cloneEligible`導出。cloneEligibleで「新しい下書きとして再試行」ボタン、破棄は`hasCreationHistory||unresolved`で無効、reconcile panelは`unresolved`時のみ。テスト+6（clone成功[copy/insert/parent/initial_thread]・dedup・非failed拒否・履歴なし拒否・未解決拒否・copy失敗→削除&no-draft）、全795 green・build通過。doc: 要件05 §5[行168・179]・要件04 §11・要件06 §7[行164・188・203] に既述で一致（変更なし）。
- 後続への注意: clone冪等はparent基準（request_key列なし）。厳密化が必要なら drafts に request_key 列を追加。remaining（確定live）の再削除フローは未実装（reconcileは消失確認のみ）。これでM3投稿系（生成→画像→投稿→resume/rollback→結果不明照合→復旧clone）が一巡。

### T-M3-25: P-5引用ポストのflag OFF拒否・非表示 `done`
- 参照: P-5、PRD §5.4、要件05 §5、要件06 §4.1、要件06 §5、要件04 §1、要件01 §3.1 / 依存: T-M3-21、T-M3-16 / サイズ: S
- 完了条件:
  - `FEATURE_QUOTE_POST_ENABLED=false`（既定）でcreateGenerationJobのP-5指定、およびP-5 draftへのregenerateDraft/publishDraft/regenerateImageが、外部API呼び出しと利用枠消費の前に`feature_disabled`で拒否される
  - workerはqueuedのP-5 jobを外部API・利用枠を消費する前に`feature_disabled`でcanceledにする
  - UIはP-5をパターン選択肢・新規生成導線から非表示にし、既存P-5 draftは本文と対象URLの閲覧のみ可（再生成・画像再生成・投稿ボタン無効＋「引用ポスト機能は現在利用できません」表示）。未解決の投稿状態がなければ破棄は可能
- メモ: flag判定はServer only。有効化後の機能（対象ポスト取得検証・<quote_post>入力・quote_url合成投稿）は本マイルストーンでタスク化しない（有効化はLLM入力契約と自動検証の完成後に別途）。
- 実装メモ: **既存**: createGenerationJob(T-M3-07)・regenerateDraft(T-M3-13) はP-5拒否済み、作成フォームP-5非表示(T-M3-08)。**追加**: `regenerateImage`/`publishDraft` に draft.pattern ロード＋`pattern==='p5' && !quotePostEnabled → feature_disabled`。**worker cancel**: post-generation.ts に `quotePostEnabled` dep追加、loadJob直後（外部/枠消費前）に P-5＋flag OFF なら `status='canceled'`（`where status='running'`）＋throw。**runJob**（worker.ts）の succeeded/failed 終了更新に `and status='running'` ガード追加（handlerの自己終端[canceled]を上書きしない・汎用改善）。post-generation-server で `env.FEATURE_QUOTE_POST_ENABLED` を配線。**UI** drafts-list: `quotePostEnabled` prop（page→DraftsList→DraftCard）、`p5Disabled=pattern==='p5' && !flag` で編集/再生成/画像再生成/投稿を無効化＋「引用ポスト機能は現在利用できません」表示、破棄は未解決なしなら可。テスト+5（regenerateImage/publishDraft P-5拒否、worker P-5 cancel、既存matcher更新[d.pattern追加]）、全798 green・build通過。doc: 要件05 §5[行173]・要件04 §1[行19]・要件06 §4.1[行149] に既述で一致（変更なし）。
- 後続への注意: **runJobに`status='running'`ガードを追加**したので、以後handlerがpoolで自己終端（canceled等）した状態はrunJobの一括finalizeで上書きされない（D-5の中央finalizer検討時に前提となる挙動）。有効化後のP-5機能（対象取得検証・<quote_post>・quote_url合成）は別タスク。

### T-M3-26: SC-05ホーム確認キュー `done`
- 参照: SC-05、要件06 §1、要件06 §10、S-5 / 依存: T-M3-11 / サイズ: S
- 完了条件:
  - /appに確認待ち下書き（未投稿draft・警告付き含む）のカードが表示され、各行からSC-07の該当下書きへ遷移できる
  - 確認待ちが0件のときは空状態と「今すぐ作成」（SC-07作成タブへの導線）が表示される
- メモ: ホームの他要素は各担当で追加する：次回スロット表示はM4、重要ニュースはニュース側、実績・利用残量表示は分析／M6側。初期設定ガイドカードはM1/M2の前提検証ヘルパを表示する画面で、本タスクと同居させる場合も導線のみ。
- 実装メモ: `src/app/app/confirmation-queue.tsx` `ConfirmationQueueCard`（server component・表示専用）。/appホーム（page.tsx）で `resolveActiveXAccountForUser`＋`listDraftsForAccount(...,'drafts')` をロードし `status==='draft'` を確認待ちとしてfilter→カード表示（pattern・警告[thread警告 or image失敗]で「要確認」バッジ・更新時刻・本文冒頭line-clamp、各行 `/app/posts?tab=drafts&draftId=` へLink）。0件は空状態＋「今すぐ作成」（`?tab=create`）。SetupGuideCard（既存）と同居。次回スロット/ニュース/実績/残量は範囲外（M4/分析/M6）。テスト: 全798 green（UIタスク・listDraftsForAccountは既存テスト）・build通過。doc: 要件06 §1[行17 SC-05 catalog]・§10[行228 確認待ちなし→今すぐ作成] に既述で一致（変更なし）。**M3（AI生成〜投稿〜復旧）完了**。
- 後続への注意: **M3全タスク（T-M3-01〜26）done**。次はM4（自動運用・スケジュール・ニュース・通知）。ホームの次回スロット表示はM4のschedule実装時に本カードへ追加する。

## M4: 自動運用・ニュース・通知

### T-M4-01: schedule_slots CRUD Server Actions（一覧・作成・更新・停止・削除） `done`
- 参照: S-1、S-2、S-4、SC-08、要件05 §7、要件05 §12、要件02 §3.10 / 依存: M0、M2 / サイズ: M
- 完了条件:
  - zod検証（pattern p5不可・weekdays 0〜6重複なし1件以上・time_jst 09:00〜22:00の00/30分・画像ON時provider必須・instructions 2,000字以下）の違反がvalidation_errorになる単体テストが通る
  - updateScheduleSlot/disableScheduleSlot/deleteScheduleSlotでexpected_updated_at不一致が0件更新となりjob_conflictを返すことをローカルDBで確認
  - mode=autoの作成・auto変更・再有効化は、x_accountsの現行version同意（consent_version一致かつconsented_at非null かつdisabled_at null）がない場合に拒否される
- メモ: M0のDBスキーマ（schedule_slots）とM2のactive_x_account検証（所有権・status=active・profiles.active_x_account_id一致→不一致はjob_conflict）を前提。同意記録Action自体は次タスクだが、本タスクではx_accountsカラムを読む同意判定ヘルパーを実装して共用する。
- 実装メモ: 中核`lib/schedule-slots.ts`（zodスキーマ createScheduleSlot/updateScheduleSlot/slotLock、`validTimeJst`[09:00〜22:00・00/30分・22:30除外]、weekdays[0-6・重複なし・1件以上]、`imageProviderRefine`[画像ON→provider必須]、instructions≤2000、pattern p1-p4/p6[**P-5除外**]）。CRUD: list/create/update/disable/delete、all本人・active_x_account スコープ、update/disable/deleteは`updated_at::text=$expected`の楽観lock（0件更新→job_conflict）＋loadOwnedSlot所有権（未所有→not_found）。**同意ゲート** `assertAutomationConsent`（x_accounts: automation_consent_version===CURRENT＋consented_at非null＋disabled_at null、不成立で`automation_consent_required`）を create(mode=auto)・update(→auto) で適用。`CURRENT_AUTOMATION_CONSENT_VERSION`を`lib/legal.ts`へ追加。ErrorCode `automation_consent_required`(403)を追加（errors.ts＋stripe checkout/portalのHTTP_STATUS map＋要件05 §2.2表）。action`app/actions/schedule.ts`（getCurrentUser＋resolveActiveXAccountForUser[status=active検証済み]＋withTransaction runInTx＋revalidate）。テスト+16（schema検証: P-5/weekdays/time/画像provider/instructions、consent gate 作成/auto化、楽観lock update/disable/delete→job_conflict、未所有→not_found、active無し→x_account_required）、全814 green・build通過。**注**: 楽観lockはユニット（mock 0件更新）で検証。実local DBでの`.db.test`はDB稼働時に追加（サンドボックスでcolima未起動のため今回はunit検証）。doc: 要件05 §7/§12・要件02 §3.10 は既述で一致、§2.2にerror code追記。zod v4の`.uuid()`はversion/variant厳格（テストuuidは有効値必須）。
- 後続への注意: **T-M4-02**が`recordXAutomationConsent`（automation_consent_version=CURRENT＋consented_at保存・disabled_at null化）と`disableXAutomation`（disabled_at設定＋auto slot無効化＋queued auto job cancel）を実装。同意判定は本タスクの`assertAutomationConsent`/`CURRENT_AUTOMATION_CONSENT_VERSION`を再利用可。schedule UI（SC-08）は別タスク。scheduler_tickのenqueueは別タスク（M4後半）。

### T-M4-02: 自動投稿の明示同意Action（recordXAutomationConsent／disableXAutomation） `done`
- 参照: S-3、A-3、要件05 §4.3、要件05 §7、要件02 §3.3、要件06 §3.5 / 依存: M2 / サイズ: M
- 完了条件:
  - recordXAutomationConsentは現行説明version＋confirmed=trueのみ受理してautomation_consent_version/consented_atを保存しdisabled_atをnull化する。旧version・未checkは拒否されることをテストで確認
  - disableXAutomationが同一transactionでautomation_disabled_atを設定し、対象Xアカウントの全auto slotをenabled=false化して無効化件数を返す
  - disableXAutomation実行時、X投稿を未開始のqueuedなauto起点job（post_generation/post_publish）がcanceledになることをローカルDBで確認
- メモ: OAuth認可を同意と扱わない（PRD §8.1）。opt-out即時反映の正本。disconnectXAccount（M2実装）からも同じslot無効化処理を呼べるよう関数を切り出す。
- 実装メモ: 中核`lib/x/automation-consent.ts`。`recordXAutomationConsent(db,userId,input)`（confirmed=true＋consent_version===CURRENT のみ受理、旧version/未checkは`validation_error`[details.reason]、x_accounts更新[version/consented_at=now/disabled_at=null] rowCount=0→not_found）。`disableAutomationForAccount(tx,xAccountId)`【切り出し・再利用】（disabled_at=coalesce(...,now())＋auto slot enabled=false＋queued auto起点job[kind post_generation/post_publish・slot_id∈auto slots]をcanceled、{disabledSlots,canceledJobs}返却）。`disableXAutomation(userId,xAccountId,deps)`（所有権→disableAutomationForAccount）。**disconnectXAccount（account-actions.ts）をリファクタ**し同関数を呼ぶ（従来のslot無効化に加えjob cancelも共通化）。action`app/actions/schedule.ts`に`recordXAutomationConsentAction`/`disableXAutomationAction`。テスト+7（consent: 保存/未check拒否/旧version拒否/未所有not_found、disableAutomationForAccount: disabled_at＋slot＋job cancel＋counts、disableXAutomation: 未所有/owned）、全821 green・build通過。**注**: queued auto job cancelはユニット（mock rowCount）で検証、実DB`.db.test`はDB稼働時（サンドボックスcolima未起動）。doc: 要件05 §4.3/§7[行143-144/150/201]・要件02 §3.3 は既述で一致（変更なし）。副次: oauth-callback.test.tsに稀にflaky（sealed token・単体/再実行で通過・本変更と無関係）。
- 後続への注意: **T-M4-03**（post_publish worker がX呼び出し直前に automation_disabled_at を再確認し撤回済みなら投稿せず停止）。auto post_publish が slot_id を持たない場合、disableAutomationForAccount のjob cancel条件（slot_id∈auto slots）に掛からないため、T-M4-03のworker再確認が最終防波堤。running jobはcancel対象外（worker再確認で止める）。

### T-M4-03: auto起点投稿の同意再検証（post_publish worker・X呼び出し直前） `done`
- 参照: S-3、要件04 §10、要件05 §7、要件06 §7 / 依存: T-M4-02、M3 / サイズ: S
- 完了条件:
  - 同意撤回済み（automation_disabled_at設定済み）状態でauto起点post_publishを実行すると、X APIモックが一切呼ばれずdraftが未投稿のまま残ることをテストで確認
  - 同意version変更後の旧version同意でも同様に投稿せず停止し、draft modeと手動投稿は影響を受けない
- メモ: M3の投稿実行worker（要件04 §10手順2）へ同意判定ヘルパーを組み込む縦の薄い変更。検証はX_POSTING_MODE=dry_run＋モックで完結。
- 実装メモ: `post-publish.ts` の検証フェーズ（auto警告チェック直後・**token取得/media/投稿の前**）に mode==='auto' 時の同意再確認を追加。x_accountsを `automation_consent_version=CURRENT ＋ consented_at非null ＋ disabled_at null` でok判定（`CURRENT_AUTOMATION_CONSENT_VERSION`使用）。ok≠trueなら draftを`status='draft'`へ戻し、jobを`canceled`（`where status='running'`ガード）にして`PostPublishError("automation_consent_revoked")`をthrow（X APIは一切呼ばない）。撤回・旧version（version不一致）はいずれもok=falseで同一停止経路。manual/draft modeは同意チェックをスキップ（手動投稿は影響なし）。テスト+3（consent revoked/stale→無投稿・draft復帰・job canceled、consent current→通常投稿、manual→consent照会なし）、全824 green・build通過。doc: 要件04 §10 step2・要件05 §7 に既述で一致（変更なし）。
- 後続への注意: runningのpost_publish jobはT-M4-02のcancel対象外だが、本worker再確認が最終防波堤。auto post_publishの生成連鎖（auto post_generation→post_publish、slot_id/mode伝播）はM4のauto実行タスクで配線する。

### T-M4-04: SC-08 スケジュール画面（週間プレビュー・スロットCRUD UI・楽観lock） `done`
- 参照: SC-08、S-1、S-2、S-4、要件06 §1、要件06 §2、要件05 §7 / 依存: T-M4-01 / サイズ: M
- 完了条件:
  - 曜日×時刻（09:00〜22:00・30分刻み）の週間プレビューにslotが表示され、作成・編集・停止・削除がServer Action経由で反映されることをローカルで確認
  - 編集競合（job_conflict）時に最新値の再読込を促すUIが表示される
  - パターン選択肢にP-5が表示されない（P-5はスケジュール対象外・flag OFF非表示）
- メモ: 空状態・読み込み中・失敗状態を用意（要件06 §2）。mode=auto選択時の同意modalは次タスクで接続する（本タスクでは同意なしauto保存がサーバー側で拒否されることの表示まで）。
- 実装メモ: `/app/schedule/page.tsx`（placeholder→実装）でslot一覧・imageProviders・automation同意状態・active_x_accountをロード（未連携は設定導線）。client`schedule-manager.tsx`: **WeekPreview**（時刻×曜日テーブル、slotをpattern略称バッジで表示・auto/draft/停止中で色分け）＋作成/編集フォーム`SlotFields`（**パターンはp1-p4/p6のみ=P-5除外**・曜日checkbox・時刻select[09:00-22:00の30分]・mode radio[下書き/自動]・画像toggle+provider・追加指示）＋`SlotRow`（編集inline/停止/削除）。全CRUDはT-M4-01のServer Action経由（create/update/disable/delete）→成功でrouter.refresh。**job_conflict**は「他の場所で更新…再読み込み」表示。mode=auto＋未同意は事前ヒント＋保存時`automation_consent_required`をメッセージ表示（同意modal接続はT-M4-05）。空状態あり。テスト: 全824 green（UIタスク・CRUDロジックはT-M4-01のschedule-slots.testで検証済み）・build通過。doc: 要件06 §2[SC-08]・§1[空状態・初期スケジュール作成なし]・要件05 §7 に既述で一致（変更なし）。
- 後続への注意: **T-M4-05**が自動投稿同意modal（説明文version付きcheckbox・recordXAutomationConsentAction）とSC-08/SC-11の「自動投稿をすべて停止」（disableXAutomationAction・無効化slot数表示）をこの画面へ接続する。読み込み中状態はSSR（router.refresh）依存のため明示spinnerは省略（各アクションはpending表示あり）。

### T-M4-05: 自動投稿同意モーダルと「自動投稿をすべて停止」UI（SC-08／SC-11） `done`
- 参照: S-3、SC-08、SC-11、要件06 §3.5、要件06 §7、PRD §8.1 / 依存: T-M4-02、T-M4-04 / サイズ: S
- 完了条件:
  - 初めてmode=autoを選ぶと、指定時刻に確認なしで投稿されること・thread途中失敗時の自動rollback削除と不可逆性・投稿責任・停止方法を説明するmodalと説明文version付き明示checkboxが表示され、同意完了までauto slotを保存できない
  - SC-08とSC-11の「自動投稿をすべて停止」がdisableXAutomationを呼び、無効化slot数が表示される
  - 同意済みアカウントではmodalが再表示されず、説明文version更新時（consent_version不一致）は再同意が要求される
- メモ: 説明文はコード管理のversion付き定数とし、文面変更でversionを上げる運用にする。
- 実装メモ: `schedule-manager.tsx` の `SlotFields` に同意ゲート追加。mode=auto ＋ 未同意（`automationConsented` propベース＋本フォームでの同意）で保存すると `AutomationConsentModal`（説明: 確認なし投稿・途中失敗の自動rollback削除と復元不可・投稿責任・停止方法、`CURRENT_AUTOMATION_CONSENT_VERSION`付き明示checkbox）を表示、同意checkまで「同意して保存」不可。同意→`recordXAutomationConsentAction`成功→そのままslot保存。同意済み（サーバー判定は現行version一致）はmodal非表示、version更新時は`automationConsented=false`となり再同意要求。**`StopAllAutomationButton`（export・SC-08/SC-11共通）**: 確認dialog→`disableXAutomationAction`→無効化slot数表示＋refresh。SC-08はauto slot有り時に表示、**SC-11（設定Xアカウントタブ）**は`automationActive`アカウント行に同ボタンを再利用。テスト: 全824 green（UIタスク・consent/disableロジックはT-M4-02のautomation-consent.testで検証済み）・build通過。doc: 要件06 §3.5・PRD §8.1 に既述で一致（変更なし）。
- 後続への注意: **M4スケジュールUI一巡**（CRUD＋同意＋停止全）。scheduler_tick（T-M4-06〜）が実際にauto/draft slotをenqueueして自動運用を稼働させる。説明文の実コピー改訂時は`CURRENT_AUTOMATION_CONSENT_VERSION`を更新（既存同意が失効し再同意要求）。

### T-M4-06: scheduler_tick骨格＋全tick冪等enqueue `done`
- 参照: 要件04 §6、要件04 §7.1、要件04 §7.2、S-2、O-5、要件03 §7.4、ADR-0002、要件05 §3 / 依存: T-M4-01、T-M4-02、M1、M3 / サイズ: L
- 完了条件:
  - GET /api/cron/scheduler-tick（CRON_SECRET Bearer認証・force-dynamic）が「job名＋時間窓」の受付（`cron_runs` window claim、`withCronWindowClaim`）を確保し、確保できなければ処理済み相当の2xxを返す（ADR-0003。セッションadvisory lockは使わない）
  - 同一slot・同一定刻窓で複数回tickを実行してもjobが1件だけ作られる（schedule_run_key unique＋last_run_at同一transaction更新）ことをローカルDBで確認
  - §7.1の条件（enabled=false／契約がtrialing・active以外／X account非active／同意なしauto／BYOKキーinvalid／premiumロールバック安全残量不足／当日JST post_create＋パターン別最大数が50超）の各ケースでenqueueされないテストが通る
- メモ: enqueueは直前10分以内の未処理slot対象・1起動500件上限。scheduled_forをUTC保存。premiumの必要残量はP-1=通常10＋URL1／P-2=通常1／P-3=通常12＋URL1／P-4=通常8＋URL1／P-6=通常12＋URL1の保守的仮定（要件04 §7.1）。M1の契約状態同期・M3の利用枠算出ヘルパーとjob作成基盤を前提。
- 実装メモ: 既存route`/api/cron/scheduler-tick`（CRON_SECRET・force-dynamic・`withCronWindowClaim`）＋`runSchedulerTick`骨格にenqueueフェーズ(2)を追加。中核`lib/jobs/schedule-enqueue.ts` `enqueueDueSlots(deps)`: `loadDueSlots`（enabled＋`extract(dow)=any(weekdays)`＋JST time_jst∈[now-10min,now)、500件）→ 各slotで§7.1判定`isEligible`（契約trialing/active・x_status=active・base_md_version≥1・p5除外・auto時consent[version===CURRENT＋consented＋not disabled]・**BYOKは`keysValid`**[ai_purpose_config.textキーvalid＋image時imageキー＋auto時xキー]・**premiumは`premiumBudgetOk`**[usage_counters vs 200/20/100/20＋auto時ROLLBACK_SAFE_BUDGET p1..p6]・`dailyLimitOk`[当日JST post_create件数＋PATTERN_MAX_POSTS≤limit]）→ `enqueueSlot`（runInTxで `insert generation_jobs(...schedule_run_key=slot:{id}:{yyyy-mm-dd}:{hh:mm}, scheduled_for=JST→UTC, trigger=schedule, slot_id) on conflict do nothing` ＋ 挿入時のみ`last_run_at=now()`更新＝同一tx冪等）。cron.tsに配線（dailyLimitはrouteが`env.X_DAILY_POST_LIMIT`を渡す。cron.tsはenvをimportせず＝test module読込でenv検証を走らせない）。テスト+11（eligible→enqueue＋last_run_at、冪等[on-conflict→0件・last_run更新なし]、§7.1除外9ケース）、全835 green・build通過（cron.db.testも実DB通過）。doc: 要件04 §6/§7.1/§7.2[schedule_run_key形式・same-tx・scheduled_for UTC]・ADR-0003・要件05 §3 に既述で一致（変更なし）。
- 後続への注意: **tick処理順** 現状 (2)enqueue→(3)dispatch(50)→(4)stale回収。**T-M4-07** が (1)期限切れcancel＋schedule_missed通知（`scheduled_for+10min`超のschedule起点post_generation・dedupe集約・missed key `slot:{id}:{date}:{hh:mm}:missed`）と dispatch上限・P-5 cancel を追加し順序を確定（要件04 §1: cancel→enqueue→dispatch→cleanup）。auto post_generation→post_publish連鎖（slot mode伝播）は別タスク。

### T-M4-07: scheduler_tick dispatch（50件）＋期限切れcancel・schedule_missed通知 `done`
- 参照: 要件04 §1、要件04 §6、要件04 §7.1、要件04 §7.2、要件04 §14、P-5、ADR-0002 / 依存: T-M4-06、M3 / サイズ: M
- 完了条件:
  - queued 51件を仕込んだ状態で1起動が最大50件だけをscheduled_for昇順→created_at昇順でPOST /api/jobs/runへdispatchする（workerはモック）ことをテストで確認
  - scheduled_for+10分超のschedule起点post_generationがdispatchされる前にcanceled化（1起動500件まで・外部API/利用枠消費なし）され、schedule_missed通知が同一Xアカウント×時間窓でdedupe_key集約により1件になる。未enqueueのまま10分超のslotにも冪等key slot:{slot_id}:{yyyy-mm-dd}:{hh:mm}:missedで通知が作られる
  - FEATURE_QUOTE_POST_ENABLED=falseでqueuedのP-5 jobが外部API・利用枠消費前にfeature_disabledでcanceledになる
- メモ: tick内処理順は (1)期限切れcancel＋missed通知 → (2)enqueue → (3)dispatch → (4)メール・cleanup を骨格として固定する（要件04 §1）。dispatchは202受領までの軽量HTTPでworker完了を待たない。
- 実装メモ: 中核`lib/jobs/schedule-recovery.ts` `recoverSchedule(deps)`: (a)`cancelExpiredJobs`（CTEで `scheduled_for+10min<now` の schedule起点post_generation queued を500件canceled・RETURNINGでslot_id/user_id/JST occ_date/occ_time取得→各に schedule_missed の error通知[冪等key `slot:{slot_id}:{yyyy-mm-dd}:{hh:mm}:missed`・通知設定尊重]）、(b)`notifyUnenqueuedMissed`（enabled slotで定刻+10〜70分経過かつ該当schedule_run_keyのjob無し→同keyでmissed通知・500件）、(c)`cancelFeatureDisabledJobs`（!quotePostEnabled時 pattern='p5' queued を canceled）。`runSchedulerTick`を **(1)recoverSchedule→(2)enqueue→(3)dispatch(limit50・scheduled_for昇順→created_at昇順)→(4)stale回収** の順に確定（要件04 §1）。routeが`env.X_DAILY_POST_LIMIT`＋`env.FEATURE_QUOTE_POST_ENABLED`を渡す。テスト+5（expired cancel＋missed通知/dedupe非計上、un-enqueued missed、P-5 cancel flag off/on）、全840 green・build通過（cron.db.test実DB通過）。doc: 要件04 §1/§6/§7.2・§19・§98[dispatch50/cancel500] に既述で一致（変更なし）。
- 後続への注意: **dispatch 50件上限** はdispatchクエリの`limit 50`で担保（cron.db.testのcatch-upで経路確認）。51件専用の.db.testは未追加（limit句は自明）。schedule_missed通知は 'schedule_missed' enum型ではなく `type='error'`＋missed dedupe_key で表現。**T-M4-08** がstale回収のkind別終端処理（image/publish/md_merge）とrefund（M6の枠返還は別だが§7.3/7.5の終端）を拡張する。

### T-M4-08: scheduler_tick stale回収のkind別終端処理・refund `done`
- 参照: 要件04 §4、要件04 §6、要件04 §14、要件03 §7.3、要件03 §7.4、要件03 §7.5 / 依存: T-M4-07、M3 / サイズ: L
- 完了条件:
  - locked_at<now-10分のrunning jobがattempt<3ならqueuedへ戻り、attempt>=3ならfailed確定と同一transactionで未返還reserve（job:{id}:generation/image:refund）がrefundされる。tickを2回実行しても冪等keyにより二重返還されないことをテストで確認
  - stale post_publishでdraftがposting→failedへ戻りlast_post_errorが保存される。stale image_generationでdraftが画像なし＋警告で確定し、draft modeは通知・auto modeはpost_publish子job作成へ進む
  - stale md_mergeでsourceがanalyzedへ戻り削除未完了通知が作られ、全kind共通でdedupe_key job:{id}:failedのerror通知が作られる
- メモ: workerの失敗経路と同一の終端処理をtick側から呼べるよう、M3実装の終端処理関数を共通化して再利用する。
- 実装メモ: 新規`lib/jobs/terminal.ts` `finalizeFailedJob(client, jobId, kind)` に終端処理を集約し、`stale.ts` の既定 `terminalHandler` へ配線（`recoverStaleJobs` が failed 更新と同一tx・同一PoolClientで呼ぶ）。(a)**refund**: 元reserve行(`job:{id}:generation|image:reserve`)から `counter_type`/`operation`/`month` を引き継いで delta=-1 の refund event(`job:{id}:...:refund`)を `ref_event_id` 付きで insert→`usage_counters` を該当列 greatest(0,-1)。refund の unique と「元reserveが在る場合のみ」で二重返還を防ぐ（reserve作成はM6のため現状no-op・先行配線）。(b)**post_publish**: draft `posting`→`failed`＋`last_post_error`。(c)**image_generation**: draft を画像なし＋failed印で確定（ready画像があれば触れない）、`mode`（自job or 親post_generation `input.mode`）が auto なら post_publish子job作成（request_key `job:{draftId}:post_publish:auto`・active二重投稿ガード）、draft なら `draft_created` 通知。本文が使えるため image は `error` 通知を出さない。(d)**md_merge**: source `removing`→`analyzed`。error通知は image_generation を除く各kindで dedupe_key `job:{id}:failed`。テスト+12（unit: kind別ルーティング/dedupe key・auto/draft分岐・active gate、db: refund二重実行冪等[refund1件・counter 1→0]・post_publish revert・auto image→post_publish子job・md_merge source revert）。全852 green・build通過。doc: 要件04 §4 を image_generation の通知分岐（draft_created／error非発行）・`finalizeFailedJob`集約・refundの引継ぎ方法で明確化（§14 `job:{id}:failed`・§7.3/§7.4は既述で一致）。
- 後続への注意: **stale terminalは`finalizeFailedJob`が既定ハンドラ**。worker失敗経路（各M3 handlerがpoolで個別確定）との完全共通化は **D-5**（runJob中央finalizer）で行う。**auto image→post_publish** の mode は親post_generation `input.mode` 由来。**success経路の auto post_generation→post_publish連鎖（slot mode伝播）は別タスク**（未実装）で、そこでも同じ `input.mode`/`request_key` 規約に揃えること。**軽微な既存不整合**: `post-generation.ts` の worker失敗通知 dedupe が `job:{id}:error`（§14は `job:{id}:failed`）。stale経路は §14 準拠の `job:{id}:failed` を使用。D-5対応時に worker側も `:failed` へ寄せて統一する。

### T-M4-09: scheduler_tick cleanup（40日データ削除・未参照Storage画像削除） `done`
- 参照: 要件04 §6、要件04 §14、要件01 §9 / 依存: T-M4-06 / サイズ: M
- 完了条件:
  - 41日前のnews通知→参照されないnews_items→external_api_usage_events明細の順で各500件/起動まで削除され、通知payloadから参照中のnews_itemsは削除されないことをローカルDBで確認
  - 作成24時間超でdraftから参照されないStorage画像が1起動100件までbest effortで削除され、削除直前の再確認で参照が付いたobjectは削除されない（Storageモックで検証）
  - `claimed_at`が40日超の`cron_runs`行が1起動500件まで削除される（要件01 §9・要件02 §3.18・ADR-0003）ことをローカルDBで確認
  - cleanup失敗が投稿系処理を失敗させず、Sentry記録（モック）のうえ次回へ繰り越される
- メモ: news通知の削除をnews_itemsより先に行う順序が要件（要件04 §14）。cron_runsのcleanupは他の40日保持データと同様にscheduler_tickで実施する。
- 実装メモ: 新規`lib/jobs/schedule-cleanup.ts` `cleanupOldData(deps)` を `runSchedulerTick` の第(5)段（stale回収の後）に追加。順に (1)`type='news'` 40日超通知(500) → (2)未参照 news_items(500: `drafts.source_news_item_id` と 通知payload `news_item_ids` の**両方**から未参照のもの。`jsonb_exists`で判定) → (3)`external_api_usage_events` 40日超(500) → (4)`cron_runs` `claimed_at` 40日超(500) → (5)Storage画像(100)。各段は独立 try/catch し、失敗は `onError`（Sentry想定）へ記録して他段・tick本体を止めない。閾値は定数 `make_interval(days=>40)` / `hours=>24`。**Storage画像**: `storage.objects`(bucket_id・created_at>24h・drafts.images未参照)から候補抽出→**削除直前に1件ずつ再度参照確認**して付いたものを除外→`removeStorageObjects` で削除。`removeStorageObjects`/`imageBucket` 未指定なら画像段skip（cron.dbテストや将来のテストで安全）。route が env から `SUPABASE_STORAGE_BUCKET_IMAGES` と admin storage remove、`onCleanupError`(暫定 console.error) を注入。`SchedulerTickResult` に `cleaned` 追加。テスト+6（unit: 削除順序・画像skip・再確認除外/全参照時no-remove・step分離onError、db: 40日超削除＋直近/draft参照/通知payload参照の保持＋通知先消し→item未参照化の順序）。全858 green・build通過。doc: 要件04 §1/§6/§14・要件01 §9・要件02 §3.18 に既述で一致（変更なし）。
- 後続への注意: **Sentry未配線**。cleanup失敗は暫定 `console.error`。Sentry導入時に `onCleanupError` を `captureException` へ差し替える（tech stack §Sentry）。通知メール回収（tick第4段の残り=queuedメール100件/10並列）は **T-M4-17**。cleanupは `removeStorageObjects`/`imageBucket` 注入時のみ画像段を実行する設計。

### T-M4-10: NEWS実行モジュール（SYS-NEWS組み立て・{{hours}}切替・出力検証・原価記録） `done`
- 参照: N-1、NEWS、プロンプト設計書 §6.10、プロンプト設計書 §4.2、プロンプト設計書 §5.6、プロンプト設計書 §7、要件02 §3.7、要件02 §3.17、要件01 §3.5 / 依存: M3 / サイズ: M
- 完了条件:
  - providerモックで、JST 12:00〜20:00起動はhours=3、9:00/10:00/11:00起動はそれぞれhours=15/16/17（前日18:00始点で夜間・稼働終了間際を補完）、n=5、category_ja、known_urls（直近48時間のsource_url）がプロンプトへ正しく埋まることをテストで確認（各回3時間ラップで全時間帯が3回に1回成功すれば欠落しない・D-3/ADR-0003）
  - 応答JSONのzod検証（title30字・summary120字・source_url必須・impact high/mid/low・published_at ISO8601・最大5件・空配列許容）が不正応答を弾き、コードフェンス除去→修復callフォールバックが機能する
  - request ID・usage・実行時単価・推定原価がexternal_api_usage_events（user_id=null）へ冪等keyで記録される
- メモ: NEWS_TEXT_PROVIDER（既定anthropic）で解決し、無効時は失敗させて別providerへ自動切替しない（要件01 §7）。M3の共通TextGenアダプタを再利用。NEWSはgeneration_jobsへ保存しない（要件04 §2）。
- 実装メモ: 中核 `lib/jobs/news-research.ts` `researchNews(category, deps)`（1分野・injectable）。`SYS_NEWS`（gen-prompts.ts にコード定数追加＝§6.10全文・drift snapshot対象・account編集不可）を `newsCategoryLabel(category)`／`newsLookbackHours(jstHourOf(clock))`／n=5 で埋め、known_urls（同分野・直近48h source_url・最大200件）を user の `<known_urls>` に渡す。`{{hours}}`: JST 9/10/11→15/16/17、12〜20→3。生成は `runTextGeneration`（Web検索 maxUses=5・jsonSchemaは併用せずコードフェンス除去＋修復call 1回でJSON検証）を再利用。応答は `newsOutputSchema`（title≤30/summary≤120/`z.url()`/impact enum/`z.iso.datetime({offset:true})` optional/items≤5）で検証。provider call は `recordExternalApiUsage`（`providerCallToUsageEvent` に userId=null）で原価台帳へ `${ledgerKeyPrefix}:{seq}` 冪等記録。`ExternalApiUsageInput.userId` を `string|null` に拡張。`newsCategoryLabel` を themes.ts に追加。テスト+8（hours/JST時算出、prompt埋め込み[category_ja/hours/n/known_urls]、9時=15h、コードフェンス+空配列、title>30の修復→InvalidProviderOutputError、原価 user_id=null＋冪等key）。全866 green・build通過。doc: §6.10/§5.6/要件02 §3.17 に既述で一致（変更なし）。
- 後続への注意: **server配線とオーケストレーションは T-M4-11**（GET /api/cron/news-fetch）。T-M4-11 が resolveNewsKey→TextGenアダプタ構築、`clock=起動時刻`、`ledgerKeyPrefix=news:{window_key}:{category}`（窓冪等）、6分野最大3並列・分野別commit・`source_url` canonical unique で重複排除を担う。`researchNews` は news_items へ保存しない（保存はT-M4-11）。

### T-M4-11: GET /api/cron/news-fetch（6分野・最大3並列・分野別commit・source_url重複排除） `done`
- 参照: N-1、要件04 §2、要件04 §6、要件05 §3、要件01 §7、要件02 §3.7 / 依存: T-M4-10 / サイズ: M
- 完了条件:
  - providerモックで1分野を失敗させても他5分野の新規news_itemsがcommitされ、失敗分野は既存ニュースを保持したままSentry（モック）へ記録される
  - source_urlをcanonical化したunique制約で既存と重複する項目が保存されず、同じ時間窓の再実行が分野単位冪等keyによりAIリサーチを重複実行しない
  - 時間窓の受付（`cron_runs` window claim、ADR-0003）により並行起動の一方が処理済み相当の2xxで終了する
- 実装メモ: `lib/jobs/news-fetch.ts` `runNewsFetch(deps)`（オーケストレーション・injectable）＋`lib/news-url.ts` `canonicalizeSourceUrl`。6分野を固定サイズプール（既定 concurrency=3）で `researchCategory` 実行→分野ごとに `news_items` へ per-insert commit（`source_url` を canonical 化して `on conflict (source_url) do nothing`、rowCount>0 のみ saved 計上）。分野失敗は try/catch で隔離し `onError`（Sentry想定）へ記録・他分野へ波及させない（既存ニュース保持）。route（既存stub置換）は認証→`withCronWindowClaim("news_fetch", hourWindowKey)` で受付→**受付通過後に** `resolveNewsProvider` を遅延import（envをmodule読込で走らせない）→分野ごとに `resolveNewsProvider({deadline: createDeadline()})`＋`researchNews(clock=起動時刻, ledgerKeyPrefix=news:{windowKey}:{category})`。`ResolvedTextProvider` に `model` を追加（researchNewsのProviderCall用）。canonical化: scheme/host小文字・既定ポート除去・fragment除去・utm_*/fbclid等トラッキング除去・残クエリ安定ソート・末尾スラッシュ除去。テスト+9（url canonical 5、news-fetch: 分野失敗隔離+onError・canonical重複non-save・concurrency≤3、db: canonical unique で既存collapse＋新規保存）。全875 green・build通過。doc: 要件02 §3.7 に canonical化アルゴリズムを追記（§2/§6/要件05 §3/ADR-0003 は既述で一致）。
- 後続への注意: **時間単位ダイジェスト通知**（成功分野の新規ニュースを対象に window単位でfan-out）は **T-M4-12**。runNewsFetch は news_items 保存までで、ダイジェスト作成は含まない。researchNews の per-category deadline は adapter の pause_turn 予算＋researchNews内 callTimeoutMs の二重だが実害なし（同時刻起点）。
- メモ: 6分野を最大3並列で実行し1分野のFunction内目安90秒（要件04 §5）。CRON_SECRET Bearer認証・force-dynamic。
  決定済み（2026-07-21・D-3・案I）: 「時間窓の欠落を許容しない」は、各回が直近3時間分を重ねて取得（プロンプト設計書 §6.10の`{{hours}}`）し、1時間ごと起動の窓の重なりで3回に1回成功すれば欠落しない方式で満たす。9:00/10:00/11:00は前日18:00以降を補完（15/16/17h・稼働終了間際の欠落防止）。重複は`source_url` canonical unique＋`<known_urls>`で排除。`cron_runs`受付は並行/重複起動の抑止のみで欠落回復はラップ取得側。NEWSは`generation_jobs`を使わない（§2）。UIは既定で過去7日表示（要件06 SC-06）。詳細はADR-0003。

### T-M4-12: 時間単位ニュースダイジェスト通知fan-out（news_config適用・dedupe） `done`
- 参照: N-3、要件04 §6、要件04 §14、要件02 §3.15、要件02 §4.2、要件02 §4.3、O-2 / 依存: T-M4-11 / サイズ: M
- 完了条件:
  - news_config・notification_configの異なる複数ユーザーを仕込み、categories/impact_filter一致の新着があるtrialing/activeユーザーにだけ通知rowが作られ、該当0件・両channel OFF・非契約ユーザーには作られないことをローカルDBで確認
  - user_id+dedupe_key（news-digest:{window_started_at}）により同一時間窓の再実行で通知rowが増えない（insert...select相当の一括fan-out）
  - タイトル・本文へ高impact優先・同impactは新しい順で最大5件＋全件数＋一覧リンク（/app/news?from=...&to=...）が入り、payloadのnews_item_idsはmax_items（既定20）で切られtotal_countは全件数を保持する
- メモ: news_fetchの6分野settle後に成功分野の新規保存ニュースだけを対象に実行。分野失敗自体はユーザーへニュース通知しない。メールONユーザーはemail_status=queued＋email_available_atを設定（送信は後続タスク）。
- 実装メモ: `lib/jobs/news-digest.ts` `fanOutNewsDigest(deps)`。窓 [windowStart, +1h)（UTC hour-aligned＝`newsDigestWindowStart(now)`。JST/UTCとも時境界一致）。単一集約SQL（CTE: new_items[窓内fetched_at]→eligible[trialing/active＋news channelいずれかON]→matched[categories `?` ni.category ∧ impact_filter `?` ni.impact・`row_number() over(partition by user order by impact優先(high→mid→low),fetched_at desc)`]→group by user）で user別に total_count・item_ids(rn≤max_items)・top_titles(rn≤5) を取得。JS で title=`ニュースダイジェスト N件`、body=先頭5件`・`列挙＋`ほかN件`、payload={window_started_at/ended_at, total_count, news_item_ids} を組み、`insert ... on conflict (user_id, dedupe_key) do nothing`（dedupe `news-digest:{fromIso}`）。email ON→email_status=queued＋email_available_at=now()。route は runNewsFetch settle 後に `fanOutNewsDigest({windowStart: newsDigestWindowStart(now)})` を同一window claim内で実行。テスト+6（unit: dedupe/title/body(top5+ほか)/payload・空・email queued・再実行0、db: A(ai,web3×high,mid)=2件[high先頭]・B(ai×high)=1件[email queued]・両OFF/canceled/該当なしは0・再実行で増えない）。全881 green・build通過。doc: 要件04 §6/§14・要件02 §4.2/§4.3 に既述で一致（変更なし）。
- 後続への注意: 一覧UI（/app/news）とメール送信（email_status=queued の回収・送信）は別タスク（**T-M4-14/16/17**）。dedupe/payload/link/impact優先順は本実装を正とする。title/body文言は他通知同様コード管理（docsは形式のみ規定）。

### T-M4-13: 通知一覧UI＋既読管理（ヘッダー未読バッジ含む） `done`
- 参照: O-2、要件05 §10、要件04 §14、要件02 §3.15、要件06 §2 / 依存: M2、M3 / サイズ: M
- 完了条件:
  - listNotificationsがin_app_enabled=trueのrowだけをcursor・unread_onlyで返し、メール専用の台帳rowが一覧に出ないことをテストで確認
  - 個別既読・全既読でread_atが設定され、ヘッダーの未読バッジ件数が更新される
  - ダイジェスト通知のlinkから/app/news?from=...&to=...へ遷移できる（各typeのlink遷移が機能する）
- メモ: App Shell（M2）とM3の通知作成基盤を前提。表示はseedした通知rowで検証できるため、ダイジェストfan-outとは独立に実装可能。
- 実装メモ: **本タスクのスコープは T-M2-20（通知ベル・通知一覧, `done`）で先行実装済み**（重複実装しない）。既存資産で全完了条件を充足: (1) `lib/notifications.ts listNotifications`（`in_app_enabled=true`のみ・本人スコープ・keyset cursor・`unreadOnly`で`read_at is null`絞り込み）＝unit `notifications.test.ts:80`（unreadOnly→`read_at is null`）＋db `notifications.db.test.ts:96,158`（email-only=`in_app=false`は一覧/未読数に出ない）で確認。(2) `markNotificationRead`（coalesce冪等・本人のみ）/`markAllNotificationsRead`＋Action が最新unreadCountを返しベルのバッジ即時更新＝db `:132`（冪等）＋unit・Actionで確認。(3) link遷移: `notification-bell.tsx` が項目クリックで既読化→`router.push(item.link)`、db `:141-143`（link保持=完了条件3）。ダイジェストlink `/app/news?from=..&to=..` は T-M4-12 で生成・検証済み。既存13テスト（unit10・db3）green。コード変更なし・BACKLOGのみ更新。doc: 要件05 §10・要件06 §2・要件02 §3.15・要件04 §14 は既述で一致（影響なし）。
- 後続への注意: `unread_only` トグルUIはベルには未搭載（Actionは対応済み）。専用の全画面通知ページも未作成だが完了条件・要件06 §2（ヘッダベル＋一覧）は満たす。必要になれば別タスクで追加。

### T-M4-14: SC-06 ニュース画面（一覧・絞り込み・news_config・時間窓適用） `done`
- 参照: N-2、SC-06、要件05 §6、要件05 §4.1、要件05 §12、要件02 §4.2、要件06 §3.4、要件06 §10 / 依存: M2 / サイズ: M
- 完了条件:
  - seedしたnews_itemsが分野・インパクトで絞り込めて、初期表示にnews_configの既定（6分野・高中・20件）が適用される。updateNewsConfigで表示分野・件数の変更が保存される
  - listNewsItemsがcategories/impacts/from-to（最大24時間）/cursor/limit（1〜100）を検証し、/app/news?from=...&to=...で対象時間窓の該当ニュース（ダイジェスト掲載外を含む）だけが一覧される
  - 最新取得失敗時に前回成功分を表示し更新失敗を注記する状態表示がある
- メモ: 表示項目はカテゴリー・要約・遷移先URL・インパクト（N-2）。ニュースデータはseedで検証できるためnews-fetch routeとは独立に実装可能。
- 実装メモ: 中核 `lib/news-items.ts` `listNewsItems(db, input)`（`listNewsItemsSchema` で検証＝categories/impacts列挙・from/to両揃い＋≤24h・limit 1-100、不正は AppError('validation_error')）。窓は from/to 揃い時 `fetched_at ∈ [from,to)`（ダイジェスト窓一致・掲載外含む）、無指定は `coalesce(published_at,fetched_at) >= now()-7d`。並び/keyset cursor は `coalesce(published_at,fetched_at) desc, id desc`。server `news-items-server.ts`＋Action `app/actions/news.ts listNewsItemsAction`（認証）。**updateNewsConfig は既存**（T-M2系 settings）を再利用。UI: `app/app/news/page.tsx`（server: getSettingsForUser の news_config を初期フィルタ＝既定6分野・高中・20件、searchParams from/to を parseWindow で検証適用、初期listを try/catch）＋ `news-browser.tsx`（client: 分野/インパクトchip＋表示件数→「この設定で表示・保存」で updateNewsConfigAction 保存後 re-list、もっと見る、**取得失敗時は前回成功分を保持し注記**、通知窓バナー＋全件表示リンク、集約説明）。既存placeholder page を置換。テスト+9（unit: limit/enum/from-to両揃い/≤24h検証・window vs 既定7日・cursor、db: category/impact絞り＋fetched_at窓＋7日既定）。全890 green・build通過。doc: 要件05 §6 に window=fetched_at/既定=published_at・並び・SC-06絞り込み=news_config保存 を追記（§06 §10 は既述で一致）。
- 後続への注意: **createDraftFromNews＋作成済みバッジは T-M4-15**（news-browser の各itemに生成ボタン/バッジを追加）。SC-06フィルタUIは news_config を直接編集・保存する方式（別途 settings 画面でも編集可）。表示件数は news_config.max_items（listのlimit）と同一。

### T-M4-15: SC-06 ニュース起点生成（createDraftFromNews）＋作成済みバッジ `done`
- 参照: N-4、SC-06、要件05 §6、要件06 §4.2、GEN-P1 / 依存: T-M4-14、M3 / サイズ: S
- 完了条件:
  - 「すぐに投稿作成」でcreateDraftFromNewsがP-1のpost_generation jobを冪等作成し（同じrequest_key再送で同じjob IDを返す）、inputへnews_item_id・source_urlが引き継がれてsource_news_item_idがdraftへ保存される（workerはモック）
  - 画像ON時のimage_provider必須と実行前提エラー（api_key_required等のdetails＋設定導線表示）がcreateGenerationJobと同じ挙動になる
  - 生成済みニュースカードにdrafts.source_news_item_id由来の作成済みバッジが表示される
- メモ: M3のcreateGenerationJob基盤・GEN実行を前提とし、SC-06からの起動導線とバッジ導出のみを実装する縦の薄いタスク。
- 実装メモ: 中核 `generation-jobs.ts createDraftFromNews(userId, input, deps)`＝news_item の `source_url` を引き（無ければ not_found）、`pattern:'p1'`＋`news_item_id`＋`source_url` で **createGenerationJob に委譲**（前提再検証・所有権/active一致・image_provider制約・5件制限・request_key冪等をそのまま継承＝完了条件2は構造的にパリティ）。worker（既存T-M3-05）が `input.news_item_id` を `drafts.source_news_item_id` へ保存。Action `createDraftFromNewsAction`（x_account_id は `resolveActiveXAccountForUser` でサーバ解決・未連携は設定導線付きエラー、!deduped で after() dispatch）。バッジ: `news-items.ts listCreatedNewsItemIds(db, xAccountId, ids)`＋server wrapper。page が初期itemの作成済みidを算出し渡す。`listNewsItemsAction` は表示中アカウントの `createdNewsItemIds` も返す（load-more badge）。UI: news-browser の各カードに「すぐに投稿作成」（冪等 request_key `news-draft:{id}`・画像既定OFF）／「作成済み」バッジ、生成失敗時は message＋details.settingsPath の「設定を開く」導線。テスト+4（not_found・P-1委譲[source_url/news_item_id伝播]・request_key冪等・image_enabled時の前提チェック到達＝settingsPath）。全894 green・build通過。doc: 要件05 §6・要件06 §4.2/§10・N-4 に既述で一致（影響なし）。
- 後続への注意: SC-06「すぐに投稿作成」は画像OFF固定（画像付き生成は SC-05 作成フォーム／createDraftFromNews の image_enabled 入力で可能）。request_key は news_item 単位固定のため同一ニュースの再クリックは同一jobを返す（deduped）。作成済みバッジは表示中Xアカウント基準。

### T-M4-16: Gmail SMTPメール送信モジュール＋通知commit後のafter()送信 `done`
- 参照: O-2、要件04 §14、要件01 §3.6、要件01 §8、要件02 §3.15 / 依存: M3 / サイズ: M
- 完了条件:
  - SMTPトランスポートのモック（またはローカルSMTPサーバ）で送信成功時にemail_status=sent・email_provider_id・email_sent_atが保存され、冪等key notification:{id}で同じ通知の二重送信が発生しない
  - 429/5xx/networkエラーでemail_attempts加算＋指数backoffのemail_available_at更新のうえqueuedに留まり、3 attempt失敗または401/403でfailedとなりemail_errorへ秘密値を含まない要約だけが保存される
  - notification作成時に設定snapshotでメールONならqueued化され、commit後のafter()から送信が起動される
- メモ: SMTP_HOST/PORT(587 STARTTLS)/SMTP_USER/SMTP_APP_PASSWORD/EMAIL_FROM/EMAIL_REPLY_TOを使用。実Gmail送信の確認はopen_questions（App Password発行後）。M3の通知作成ヘルパーへqueued化ロジックを組み込む。
- 実装メモ: **依存追加 nodemailer@9＋@types/nodemailer**。中核 `lib/email/notification-email.ts` `sendQueuedNotificationEmail(deps, id)`（DB・`EmailTransport` 注入で純粋）: queued かつ `email_available_at<=now` の1件を送信→成功で `email_status='sent'`＋`email_provider_id`＋`email_sent_at`（`id AND email_status='queued'` guard で二重送信防止・provider冪等は `Message-ID <notification:{id}@domain>`）。失敗は `EmailSendError.kind` で分類し retryable（429/5xx/network）かつ attempt<3 は `email_attempts`加算＋`backoffMs`（retry.ts再利用）で `email_available_at` 更新して queued 継続、それ以外（401/403 auth・3 attempt・unknown）は `failed`。`email_error` は要約のみ（`smtp:{code}[:{responseCode}]`／`send_failed`）。server `notification-email-server.ts`＝envからnodemailer transport遅延構築（587 STARTTLS・SMTP未設定はskip）・SMTPエラー→`EmailSendError`分類（`classifySmtpError`）・`sendNotificationEmailForId(id)`＋`dispatchNotificationEmail(id)`（`after()`即時送信・失敗握り潰し）。queued化は各通知作成側で既存（email ON→queued＋email_available_at）。commit後after()送信は `fanOutNewsDigest` が `createdIds` を返し news-fetch route が `dispatchNotificationEmail` する経路で配線。テスト+7（sent＋provider_id・not-queued skip・guard0 skip・retryable requeue backoff・3 attempt failed・auth即failed・unknown要約）。全901 green・build通過。doc: 要件01 §3.6 に nodemailer/SMTP・冪等・分類・after()を追記（要件04 §14 は既述で一致）。
- 後続への注意: **queuedメール回収（tick第4段・100件/10並列）＋retryNotificationEmail は T-M4-17**（全 queued を確実に送る主経路。after()送信は best-effort 補助）。他通知作成経路（job error/posted/draft_created/billing/X失効）の after() 送信配線は未接続だが、tick回収が全 queued を拾うため送信は保証される（T-M4-17 で回収）。実Gmail送信の疎通確認は App Password 発行後（open_questions）。

### T-M4-17: queuedメール回収（tick第4段）＋retryNotificationEmail `done`
- 参照: 要件04 §6、要件04 §14、要件05 §10 / 依存: T-M4-16、T-M4-06 / サイズ: S
- 完了条件:
  - queuedかつemail_available_at<=nowのメール150件を仕込み、tick1起動で最大100件・最大10並列だけ送信処理される（SMTPモック）ことをテストで確認
  - 最古のqueuedメールが10分超の場合にSentry（モック）へ警告が記録される
  - retryNotificationEmailがemail_status=failedのみ受理してattemptsを0へ戻しqueued化し、同一通知の1分以内の連続実行を拒否する
- メモ: tickの処理順(4)へ組み込む。回収上限100件/起動は要件04 §6の1起動上限表を正とする。
- 実装メモ: 中核 `lib/email/recover-queued.ts` `recoverQueuedEmails(deps)`＝実行可能queued(email_available_at<=now)を `email_available_at asc nulls first, created_at asc` で最大100件select→固定サイズプールで最大10並列 `send`（注入=sendNotificationEmailForId）。最古の実行可能queued(min created_at)が10分超なら `onStaleWarning(ageMs)`（Sentry想定）。outcome別tally返却。`runSchedulerTick` の第(4')段（stale回収の後・cleanupの前）に配線し `SchedulerTickResult.emailsRecovered` 追加。route が `sendEmail=sendNotificationEmailForId`＋`onEmailStaleWarning`(暫定 console.warn) を注入（sendEmail未注入なら skip）。`retryNotificationEmail(db, userId, id)`（notifications.ts）＝本人・`email_status='failed'` のみ受理し、`email_last_attempt_at < now()-1min` guard 付きで `email_status='queued'`・`email_attempts=0`・`email_error=null`・`email_available_at=now()` へ更新。非failed=job_conflict:not_failed、1分以内=job_conflict:retry_too_soon、不在=not_found。server wrapper＋Action `retryNotificationEmailAction`。テスト+8（回収: 150→100件/並列≤10・outcome tally・10分警告有無、retry: 失敗のみ受理/not_found/not_failed/too_soon）。全909 green・build通過。doc: 要件04 §6/§14・要件05 §10(line244) に既述で一致（影響なし）。
- 後続への注意: retryNotificationEmailAction は実装済みだがUI導線（失敗メールの再送ボタン）は未接続（完了条件はAction挙動。必要時に通知/設定UIへ追加）。tick第(4')段は sendEmail 注入時のみ実行（cron.dbテスト等では skip）。SMTP未設定時は send 内で skip されるため回収は no-op で安全。

### T-M4-18: launchd plist一式＋呼び出しスクリプト＋ローカルセットアップ検証 `done`
- 参照: 要件04 §6、要件01 §6、運用メモ §1、運用メモ §2、N-1 / 依存: T-M4-07、T-M4-11 / サイズ: M
- 完了条件:
  - 4本のLaunchDaemon plist（news-fetch: JST9〜20時毎時00分／scheduler-tick: 5分間隔12エントリ／metrics-collector: 毎時00分／follower-snapshot: 毎時10分。すべてStartCalendarInterval）がplutil -lintで妥当と判定される
  - 呼び出しスクリプトがCRON_SECRETをKeychainまたは所有者限定秘密ファイルから読み、Bearer付きでローカル起動アプリの/api/cron/*へ到達して2xx／secret不一致時401を正しく扱う（plistへ秘密値を直書きしない）
  - モックサーバテストで接続timeout10秒・全体210秒・5xx/timeout時の30秒→60秒の最大2回再試行・3回失敗時のローカルlog記録・HTTP redirectの非成功扱いが確認できる
- メモ: metrics-collector/follower-snapshotのroute本体は別マイルストーン（分析系）実装のため、当該2本は認証疎通（401/404の期待挙動）確認までとし、route実装後に再検証する。実Macへの配置・launchctl bootstrap・24時間監視はopen_questions（運用メモ §1〜2）。
- 実装メモ: `ops/launchd/` に4 plist（`com.spaceai.{news-fetch,scheduler-tick,metrics-collector,follower-snapshot}.plist`・全て `StartCalendarInterval`。news-fetch=Hour 9〜20/Minute 0の12件、scheduler-tick=Minute 0〜55の5分刻み12件、metrics=Minute 0、follower=Minute 10。`__INSTALL_DIR__` プレースホルダ・秘密値なし・RunAtLoad false）＋`cron-call.sh`（endpoint名を引数に、`CRON_SECRET_FILE`優先→Keychain `space-ai-cron-secret` から秘密取得、`--connect-timeout 10 --max-time 210 --max-redirs 0`＋`Authorization: Bearer`、2xxのみ成功、6/7/28/35・5xx を retryable として `CRON_RETRY_DELAYS`（既定30 60）で最大2回再試行、非retryable/枯渇は `CRON_LOG` へ記録して非0終了）＋`README.md`（配置手順）。テスト `src/ops/launchd.test.ts`+8（plutil -lint 4本・StartCalendarInterval本数/値・plistに秘密なし／2xx=exit0＋Bearer到達・401非再試行・redirect非成功・5xx3回＋log・timeout3回＋log。plutil/bash/curl無ければskip）。全917 green・build通過。doc: 運用メモ §2 に `ops/launchd/` 実体の参照を追記（§1/§2の方針は既述で一致）。**M4 完了**。
- 後続への注意: metrics-collector/follower-snapshot の route は現状stub（M5分析系で本体実装）＝launchd疎通は認証まで。実Mac配置・`launchctl bootstrap`・timezone/スリープ設定・24時間監視は open_questions（運用メモ §1/§2）。plist の `__INSTALL_DIR__` と `APP_BASE_URL` は配置時に実値へ置換する。

## M5: 学習・分析

### T-M5-01: T-M5-01: X API読取クライアント（タイムライン・tweet lookup・user lookup） `done`
- 参照: L-1、L-2、L-3、K-1、K-3、要件04 §12、要件04 §13、PRD 8.1、要件02 §3.17、要件04 §5 / 依存: M2、M3 / サイズ: M
- 完了条件:
  - HTTPモックで「指定ユーザーの直近ポスト取得（20件/100件・ページング）」「tweet_id最大100件のbatch lookup（public＋non-public metrics fields）」「user lookup（followers_count）」が共通型で返るテストが通る
  - 429/5xx/networkで指数backoff＋jitterの最大2回retry後に最終失敗となり、401/403は即失敗になる
  - 読取呼び出しごとに external_api_usage_events へ operation=x_post_read/x_user_read が冪等記録され、同一idempotency_keyの再実行で重複しない
- メモ: OAuth user contextのtoken復号・refresh（single-flight lease）はM2の既存機構を利用。原価台帳への冪等記録helperはM3/M4のものを再利用。異なるuser tokenを同一requestへ混ぜない契約（要件04 §6）をクライアント層で強制する。学習（LRN）・metrics_collector・follower_snapshotの3機能で共用する。
- 実装メモ: 既存 `client.ts`（`callX` retry/backoff・401/403即失敗＝XApiError auth・`recordedXCall` [usage.ts] の冪等台帳記録・`xUnitCost` 読取0）を土台に拡張。client.ts追加: `getUsersByIds`（GET /users?ids=…&user.fields=public_metrics→followers_count）、`getRecentPosts` に `paginationToken`＋結果 `nextToken`（GET /users/:id/tweets の max_results 5-100・meta.next_token）。新規 `read-client.ts`（共用読取層・deps注入）: `readUserTimeline`（limit までページング蓄積・各ページ x_post_read 記録 key `{base}:page:{i}`）、`readTweetMetrics`（≤100 で chunk・各 chunk x_post_read 記録 `{base}:chunk:{i}`・merge）、`readUserFollowers`（≤100・x_user_read 記録）。単一 accessToken を deps に束ね「異なるuser token混在なし」を型で強制。server `read-client-server.ts buildXReadDeps(accessToken, ctx)`（pooledDb＋xClientDeps）。テスト+5（timeline 2ページ蓄積40件＋page:0/1記録・単ページ停止・401非retry＋failed記録、tweet 150→100/50 chunk＋chunk:0/1、followers＝x_user_read）。全922 green・build通過。doc: 要件04 §12/§13・要件02 §3.17・要件04 §10 に既述で一致（影響なし）。
- 後続への注意: **token復号・refresh（M2 token-refresh）で得た accessToken を buildXReadDeps へ渡す**のは各消費側（T-M5-03 learning／metrics_collector／follower_snapshot）。idempotencyKeyBase は消費側が安定値で決める（例 learning:{sourceId}:posts／metrics:{xAccountId}:{window}／follower:{xAccountId}:{date}）。getUsersByIds/getTweetMetrics は ids ≤100 前提（read-client が chunk 済み）。handle→user_id 解決（参考アカウントURL）は T-M5-02/03 側。

### T-M5-02: T-M5-02: 学習ソースCRUDのServer Actions（追加・一覧・削除の受付） `done`
- 参照: L-1、L-2、L-3、要件05 §8、要件05 §12、要件02 §3.6、SC-10 / 依存: M1、M2、M3 / サイズ: M
- 完了条件:
  - ローカルDBのテストで ref_account 4件目 / ref_post 11件目の追加が validation_error で拒否され、removed済み同一URLの再追加は既存rowが復元される
  - removeLearningSource が analyzed→removing化＋md_merge job作成、pending/failed→AIを呼ばず直接removed に分岐し、同一アカウントにqueued/runningのlearning_analysis/md_mergeまたはremoving sourceがある場合は job_conflict になる
  - request_key再送で既存job IDが返り（冪等）、実行前提不足（契約・キー・X連携・発信設定）時は details に不足項目と設定画面パスを含むエラーが返る
- メモ: addLearningSource / listLearningSources / removeLearningSource。URL検証はref_account=XアカウントURL、ref_post=x.com|twitter.comの/{handle}/status/{id}形式のみ。x_account_id明示送信＋active一致検証（要件05 §1）。同一ユーザーのqueued/running 5件上限もここで適用。job作成後は after() でdispatch。md_merge workerの本体はT-M5-05。
- 実装メモ: 中核 `lib/learning-sources.ts`（DB・前提収集注入）。`normalizeLearningUrl(type,url)`＝host x.com/twitter.com・ref_account `/{handle}`／ref_post `/{handle}/status/{digits}`・handle `[A-Za-z0-9_]{1,15}`→`https://x.com/{handle}[/status/{id}]` へ正規化（不正は validation_error）。`addLearningSource`: request_key 先行照合で冪等（状態ガード前に既存job返却）→assertActiveAccount（active一致・不一致 job_conflict）→assertNotBusy(removing source→job_conflict)→assertPrereqs（checkExecutionPrerequisites・不足は code＋details.missing/settingsPath）→removed同一URLは既存row復元(pending・analysis_summary null)／新規は非removed件数 ref_account<3・ref_post<10 検査（超過 validation_error:limit_reached）＋assertJobBudget(5件)→learning_analysis job を request_key 冪等作成。`removeLearningSource`: request_key先行照合→assertActiveAccount→対象load(なし not_found)→assertNotBusy(removing source or queued/running learning_analysis/md_merge→job_conflict)→analyzed=removing化＋md_merge job／pending・failed=直接removed(job null)／その他 job_conflict。server結線＋Action（list=active解決、add/remove は after() dispatch）。テスト+11（unit: URL正規化6、db: 4件目/11件目 validation_error・removed復元・request_key冪等・analyzed→removing+md_merge＋busy job_conflict・pending直接removed・prereq details）。全933 green・build通過。doc: 要件05 §12 に ref_account URL検証＋canonical化を追記（§8/§1 は既述で一致）。
- 後続への注意: **learning_analysis worker 本体は T-M5-03、md_merge 本体は T-M5-04/05**（本タスクは受付＋job冪等作成まで）。`own_posts`/`reimportOwnPosts`（§211・30日1回）は本タスク対象外（別途）。SC-10 の学習ソースUIは未実装（Actionのみ）。addLearningSource は learning_analysis job を必ず作る（新規・復元とも）。

### T-M5-03: T-M5-03: learning_analysis worker（LRN-1〜3の取得・分析・保存） `done`
- 参照: L-1、L-2、L-3、LRN-1、LRN-2、LRN-3、プロンプト §6.11、プロンプト §6.12、プロンプト §6.13、プロンプト §4.2、プロンプト §7、要件04 §12、要件03 §7.1、要件03 §7.3 / 依存: T-M5-01、T-M5-02、M3 / サイズ: M
- 完了条件:
  - モックAI＋モックX読取で、3 type（参考アカウント20件・参考投稿1件＋metrics・自己投稿100件）それぞれのjobが analysis_summary をzod検証のうえ保存し succeeded になる
  - JSON parse失敗時に同一job内で修復callが1回だけ追加され、なお失敗なら source=failed・error通知・premium生成枠refund（冪等key job:{id}:generation:refund）となる
  - premiumでは開始時に生成枠reserve（+1）が usage_events/usage_counters へ同一transactionで記録され、BYOKでは枠を消費しない
- メモ: 既存のlease基盤（advisory lockによる同一Xアカウント直列）とAIアダプタを利用。PT-L1〜L3はbase_mdを読まず、取得データを<posts>/<post>/<metrics>タグで素材として渡す。PT-L2にはref_postのpublic metricsを渡す。ここでは分析結果保存＋暫定analyzed化まで（merge後の確定はT-M5-04で置換）。
- 実装メモ: 中核 `lib/jobs/learning-analysis.ts` `executeLearningAnalysis(deps)`（DB pool・runInTx・provider解決・X読取を注入）。type別に `<posts>`(ref_account 20件/own 100件)・`<post>`+`<metrics>`(ref_post) を素材にし PT-L1/L2/L3（gen-prompts.ts にコード定数追加・drift snapshot対象）で分析→`runTextGeneration`（修復call1回・zod検証: L1 style/structure/topics/takeaway・L2 why/pattern/caution・L3 vocabulary/tone/perspective/signature/examples）→`analysis_summary={type,...parsed}` 保存＋source `analyzed` 化（暫定・T-M5-04でMD-MERGE確定へ置換）＋job usage保存。**premium は開始時に生成枠 +1 reserve**（`usage/generation-reserve.ts reserveUsage`・event＋usage_counters を runInTx で同一tx・冪等key `job:{id}:generation:reserve`）、BYOKは非消費。失敗（invalid_output/取得不能）は source=failed・error通知(dedupe `job:{id}:failed`)・**premium refund**(`refundUsage`・`job:{id}:generation:refund`)→throw。冪等: 既 analyzed は already_done。共有 `generation-reserve.ts`（reserve/refund）を新設し terminal.ts の refund をこれへ統一。client.ts に `getUserByUsername`(handle→id)＋`getTweetMetrics` に text 追加。server `learning-analysis-server.ts`（token=getValidXAccessToken・read-client・resolveTextProvider）を handlers.ts に登録。テスト+17（worker unit: 3type analyzed/analysis_summary・premium reserve key・BYOK非reserve・already_done・失敗時 failed+notif+refund、reserve db: +1/refund -1 冪等・reserve無しrefund no-op、prompt drift）。全942 green・build通過。doc: §6.11〜6.13・§4.2/§7・要件04 §12・要件03 §7.1/§7.4 に既述で一致（影響なし）。
- 後続への注意: **MD-MERGE（同一job内・base_md反映）は T-M5-04** が analyzed 確定を置換。生成枠 reserve は本タスク（LRN）が最初の実装点＝post_generation/image の reserve は M6（D-5）。`analysis_summary` 形式は `{type, ...analysisJSON}`（T-M5-04 の merge が全active source の analysis を読む）。fetch系（handle→id・tweet text・own timeline）は server 注入でmock可能。生成枠上限(100)の事前ゲート（usage_limit_exceeded）は M6。

### T-M5-04: T-M5-04: 同一job内MD-MERGEとbase_md version競合処理 `done`
- 参照: L-8、MD-MERGE、プロンプト §6.14、プロンプト §3.4、要件04 §1、要件04 §12、要件05 §9、要件02 §3.4 / 依存: T-M5-03、M2 / サイズ: M
- 完了条件:
  - モックAIで、分析成功後に同一job内でセクション5・6が「対象セクション現在値＋全active source analyses」からmergeされ、base_md新version（change_source=learning）・base_md_versions履歴・source=analyzed確定が同一transactionで反映される（セクション1〜4は不変）
  - merge書き込み時に開始時versionと異なるversionを注入すると、最新versionから再mergeするかretryableとしてqueuedへ戻る（上書き消失しない）テストが通る
  - merge結果が6見出し構造を保つことをコード検証し、崩れた出力はJSON/構造エラーとして修復・失敗処理される
- メモ: progress_stage=merging。mergeカウントは親learning_analysis jobの生成枠1回に含む（追加消費なし）。updatePersonaSettings等のbase_md書き込みと競合するためexpected version条件付きupdateを必須にする（要件05 §9）。M2依存はベースmd初版（version>=1）の存在。
- 実装メモ: `lib/jobs/md-merge.ts` `executeMdMerge(deps, {confirmSourceId|removedSourceId})`。トリガーソース種別で**該当1セクションのみ**を対象化（own_posts→§5文体・自分らしさ／ref_account・ref_post→§6参考にする型。§4.2「該当セクションのみ」）、非対象§と§1〜4は byte-for-byte 保持（`persona-settings.replaceLearningSections`＋`validateBaseMdStructure`）。対象を「現在値＋全active source analyses（同セクション種別・analyzed＋確定対象、removed除外）」から PT-MD-MERGE（gen-prompts.ts 追加・drift snapshot）で書き直し→**開始version一致時のみ条件付きupdate→0件なら最新から再merge**の bounded retry（上書き消失防止）→base_md新version・`base_md_versions`(change_source=learning)・source状態（confirm=analyzed／removed=removed）を**同一tx**確定。version競合枯渇/時間不足(canStartCall)は `MdMergeConflictError`(retryable)、見出し混入/内容ありなのに空出力は1回修復→`MdMergeStructureError`。learning worker が分析後 `mergeAfterAnalysis` で呼ぶ（analyzed確定はmerge tx）。**レビュー(workflow・6 CONFIRMED)反映**: (a)retryable失敗は attempt<3 で job を queued へ自己終端しscheduler_tick再dispatch・reserve保持／attempt>=3 で refund+failed（完了条件2）、(b)terminal.ts に learning_analysis/md_merge の生成枠refund＋source failed 追加（stale漏れ防止）、(c)該当セクションのみmerge（両§merge廃止）、(d)空出力wipe防止、(e)Function-wide deadline共有＋canStartCallゲート。テスト+11（merge: target§5/§6・非対象保持・version競合再merge・枯渇・時間不足・見出し・空、retry: requeue<3/terminal>=3、db: 同一tx確定＋非対象保持）。全953 green・build通過。doc: §4.2/§6.14・要件04 §1/§4/§5/§12・要件05 §9・要件02 §3.4 に既述で一致（影響なし）。
- 後続への注意: 完了条件の「セクション5・6」は §4.2「該当セクションのみ」に合わせ**トリガー種別が決める1セクション**をmerge（両更新は非決定LLMで無関係§を drift させるため不採用）。**削除フロー（removedSourceId・standalone md_merge handler・生成停止）は T-M5-05**（executeMdMerge の removed 経路は実装済み・handler登録と removing中生成停止が残り）。retryable自己終端は D-5（runJob中央finalizer）の局所適用。

### T-M5-05: T-M5-05: 学習ソース削除フロー（removing→md_merge→removed・生成停止） `done`
- 参照: L-8、要件04 §12、要件04 §4、要件05 §8、要件06 §9、MD-MERGE、要件03 §7.1 / 依存: T-M5-02、T-M5-04、M4 / サイズ: M
- 完了条件:
  - モックAIで、単独md_merge jobが削除対象analysisと残active analysesから対象セクションを再構築し、merge成功時に base_md新version作成と source=removed化（removed_at設定）が同一transactionで確定する（premium生成枠+1消費）
  - merge最終失敗（およびstale確定時のtick側終端処理）で source が analyzed へ戻り、削除未完了のerror通知rowが作成され、生成枠がrefundされる
  - removing source が存在する間、対象Xアカウントの createGenerationJob / createDraftFromNews / slot enqueue が新規生成を開始しないことをテストで確認できる
- メモ: version競合処理はT-M5-04と共通実装を再利用。removing中はaddLearningSource/reimportOwnPostsも拒否（T-M5-02の検証に組み込み済みなら結線確認のみ）。生成停止ガードはM3/M4の生成job前提検証への追加になるため、該当箇所の変更はドキュメント同期対象。
- 実装メモ: 単独md_merge handler `lib/jobs/md-merge-server.ts` を handlers.ts に登録。premium は開始時に生成枠+1 reserve（削除も1消費・要件04 §12/要件03 §7.1）、`executeMdMerge({removedSourceId})`（T-M5-04共通実装の removed 経路：対象ソース種別で該当セクションのみ再構築・削除analysisを`<removed>`・残active除外・source=removed＋removed_at＋base_md新version(learning)を同一tx）。**version競合はT-M5-04と共通**（最新から再merge）。最終失敗は共通終端 `finalizeFailedJob(_, 'md_merge')`（生成枠refund＋source removing→analyzed＋削除未完了通知）へ集約。retryable（version競合枯渇/時間不足）は attempt<3 で queued 自己終端・reserve保持／>=3 で terminal。**生成停止ガード**: `learning-sources.hasRemovingLearningSource` を新設し、`createGenerationJob`（removing→job_conflict:learning_removing／createDraftFromNews も委譲で継承）と `schedule-enqueue.isEligible`（removing→skip）に追加。removeLearningSource の analyzed→removing＋md_merge job作成・busy拒否は T-M5-02 で結線済み。terminal.ts の md_merge/learning_analysis 生成枠refundは T-M5-04 レビュー時に追加済み。テスト+5（md-merge unit: removed経路[§除外・removed化・summary]、db: removal[target再構築・removed_at・非対象保持]、gen-jobs: removing→job_conflict、enqueue: removing→skip）。全957 green（news-digest.db は共有DB並列の exact-count flake・単体green・本変更と無関係）・build通過。doc: 要件04 §12 に既述＋要件05 §5 に removing生成停止のcross-ref追記。
- 後続への注意: 生成枠refundの共通終端は `finalizeFailedJob`（worker最終失敗＝md-merge-server catch／stale＝recoverStaleJobs、どちらも同一関数）。生成停止ガード `hasRemovingLearningSource` は generation-jobs／schedule-enqueue で共用。removeLearningSource の 5-job budget 明示チェックは未追加（busy直列化で実質担保・§277完全準拠は要すれば別途）。reimportOwnPosts は T-M5-06。

### T-M5-06: T-M5-06: reimportOwnPosts（自分の過去投稿の再取り込み・30日制御） `done`
- 参照: L-3、要件05 §8、要件04 §12、要件02 §3.6 / 依存: T-M5-03、T-M5-04 / サイズ: S
- 完了条件:
  - 前回取り込みから30日未満の再実行が validation_error で拒否され、details に次回実行可能日時が含まれる（時刻モックで30日経過後はjobが作成される）
  - own_posts source は x_account_id ごとに1 rowのunique制約を保ち、再取り込みは既存rowのanalysis_summaryを新しい分析で置き換えてmerge経由でセクション5を更新する
  - removing source存在中は拒否され、request_key再送は既存job IDを返す
- メモ: 初回取り込みはaddLearningSource（type=own_posts, url=null）でも成立するが、Action契約上は reimportOwnPosts を専用Actionとして実装（要件05 §8）。premiumは生成枠+1／実行。
- 実装メモ: `learning-sources.ts reimportOwnPosts(userId, input, deps)`。request_key先行照合で冪等→assertActiveAccount→assertNotBusy(removing→job_conflict)→assertPrereqs→**own_posts行をfind-or-create/reset**（既存 unique index `learning_sources_own_posts_unique(x_account_id) where type='own_posts'` で1件。既存は status=pending・analysis_summary=null・removed_at=null にreset、無ければ url=null で新規）→assertJobBudget(5件)→learning_analysis job 冪等作成。**30日制御**: own_posts の直近 learning_analysis job `created_at`（`updated_at` は trigger更新のため不採用）を基準に `max(created_at) > now()-make_interval(days=>30)` を SQL で判定、too_soon なら validation_error＋`details.next_available_at`（ISO8601）。worker（T-M5-03/04）が PT-L3 で§5をmerge更新。Action `reimportOwnPostsAction`（active一致・!deduped で after() dispatch）。テスト+4（初回作成＋30日未満拒否/next_available_at、31日前jobで再取込＋既存row reset・analysis_summary null、removing中 job_conflict、request_key冪等）。副次: `news-digest.db.test` の窓を実行ごと一意化（共有DB並列の exact-count flake を解消・T-M5-05注記の対応）。全961 green（3連続）・build通過。doc: 要件05 §8/§219・要件04 §12・要件02 §3.6 に既述で一致（影響なし）。
- 後続への注意: 30日基準は「own_posts の直近 learning_analysis job created_at」（成否問わず作成で1回消費＝spam防止）。UIは T-M5-07（SC-10）。addLearningSource は ref_account/ref_post 専用で own_posts は reimportOwnPosts が担う。

### T-M5-07: T-M5-07: SC-10 学習ソースタブUI `done`
- 参照: L-1、L-2、L-3、SC-10、要件06 §2、要件06 §9、要件06 §4.2、要件05 §8 / 依存: T-M5-02、T-M5-05、T-M5-06 / サイズ: M
- 完了条件:
  - モックデータで、一覧（type・URL・status・分析日時）、追加フォーム（type別上限到達時の無効化・URL形式エラー表示）、削除確認、own_posts取り込み/再取り込み（30日制御の残日数表示）が表示・操作できる
  - pending/removing中の進行表示（queued 60秒超は「開始が遅れています。自動で再開されます（最大5分）」）、failed時の原因と再試行導線、removing中は「削除完了まで新規生成を一時停止」の案内が表示される
- メモ: App Shell（M2/M4想定）のSC-10タブ構成に学習ソースタブを追加。Xアカウント切替時の再取得に対応。
- 実装メモ: `/app/ai-settings` の既存 `learning` タブ（プレースホルダ）を置換。server page が active アカウントの `listLearningSourcesForUser`＋`ownPostsReimportEligibilityForAccount`（新設 `learning-sources-server.ts`）を読み `LearningSourcesManager`（client）へ渡す（base_md_version<1 は発信設定へ誘導の空状態）。UI: 追加フォーム（種別select＝ref_account 3/ref_post 10で上限時 option/ボタン無効・URL入力→addLearningSourceAction、validation_error は message＋settingsPath導線表示）、自己過去投稿 取り込み/再取り込み（reimportOwnPostsAction・**30日残日数**表示＝サーバ算出 nextEligibleAt から daysUntil・too_soon 時 details.next_available_at で更新）、一覧（type/URL/status/**分析日時=updatedAt**）、削除（confirm→removeLearningSourceAction）。進行/状態: pending かつ updatedAt から60秒超で「開始が遅れています。自動で再開されます（最大5分）」（15秒間隔で now 更新）・pending「分析中」・failed「原因＋削除して再登録」・**removing 中は上部に「削除完了まで新規生成を一時停止」案内＋全操作無効**。各操作後 listNotifications 相当の再取得＋router.refresh。`LearningSourceView` に updatedAt 追加、`ownPostsReimportEligibility` 追加。UIは本repo方針によりcomponent testなし（型/lint/build＋既存Action単体で担保）。全961 green・build通過。doc: 要件06 §22/§3.6/§81・要件04 §12 に既述で一致（影響なし）。
- 後続への注意: ベースmd/プロンプトタブは T-M5-09/T-M5-11。failed の「再試行」は現状「削除して再登録」導線（learning_analysis の直接retry Actionは無し・retryGenerationJob は job_id 前提のため学習UIからは未接続）。Xアカウント切替はサーバ再描画で反映（active一致）。

### T-M5-08: T-M5-08: ベースmd手動編集・履歴・ロールバックのServer Actions（M-1） `done`
- 参照: M-1、要件05 §8、要件05 §9、要件05 §12、要件02 §3.4、プロンプト §3.1 / 依存: M1、M2 / サイズ: M
- 完了条件:
  - updateBaseMdManual が「## 1.〜## 6.の見出しが順番どおり各1回」の構造検証と5,000字上限を行い、欠落・重複・順序違反・超過を保存拒否する／expected_version不一致は409（job_conflict）を返す
  - standardプランからの updateBaseMdManual / rollbackBaseMd が forbidden(403) になり、md/premiumでは base_md・base_md_version・base_md_versions（change_source=manual/rollback）が同一transactionで更新される
  - rollbackBaseMd が指定版の内容を持つ新versionを作成し（履歴を書き換えない）、learning_analysis/md_merge がrunningの間は3 Actionとも job_conflict になる
- メモ: getBaseMd（所有者のみ）も同時に実装。base_md_version=0（初版未生成）の場合の編集可否は発信設定初回保存が前提のためpersona_required相当で誘導。M1依存はプラン判定、M2依存はベースmd初版生成。
- 実装メモ: 中核 `src/lib/base-md.ts`（純粋・PoolClient/Queryable注入、persona-settings-store と同じ版管理パターン）＝`validateManualBaseMd`（5,000字→validation_error:too_long、`validateBaseMdStructure` 失敗→validation_error:structure）／`applyUpdateBaseMdManual`／`applyRollbackBaseMd`／`getBaseMd`／`listBaseMdVersions`。書き込み順: `loadForWrite`（x_accounts+profiles を `for update`、非active/選択不一致は job_conflict:active_x_account_changed）→`assertEditablePlan`（md/premium 以外 forbidden）→version=0→persona_required→（update側のみ構造/字数検証）→expected不一致→job_conflict:base_md_version_changed→`assertNoLearningRunning`（learning_analysis/md_merge running→job_conflict:base_md_learning_in_progress）→`where base_md_version=$expected` 条件更新（0件→job_conflict）→base_md_versions insert。rollback は指定版 content をロード（無ければ not_found:version_not_found）し change_source=rollback / summary `v{n}へロールバック` で新版を積む（履歴不変）。配線 `base-md-server.ts`（withTransaction＋pooledDb）、Actions `app/actions/base-md.ts`（getBaseMd/updateBaseMdManual/rollbackBaseMd・zod・requireUserId・toUserFacingError）。テスト: unit（validateManualBaseMd valid/too_long/structure×3）＋db（md=version+manual確定／standard=forbidden／expected不一致=job_conflict／learning running=job_conflict／rollback=v1内容の新v3・履歴1:settings/2:manual/3:rollback）。全971 green・build通過。doc: 要件05 §8/§9 の3 Action・同一tx・learning running job_conflict・5,000字は既述で一致、`base_md_version=0→persona_required` と change_source(manual/rollback)・履歴不変を §9 に追記（v1.17）。要件02 §3.4 change_source enum は既に manual/rollback を含む（一致）。
- 後続への注意: SC-10 ベースmdエディタUIは T-M5-09。version=0（初版未生成）UIは発信設定へ誘導する空状態にすること。手動編集セクション1〜4は発信設定フォーム保存で上書きされる旨の警告は本Actionではなくクライアント側で表示（要件06 §9）。

### T-M5-09: T-M5-09: SC-10 ベースmdエディタUI（履歴・ロールバック・プランゲート） `done`
- 参照: M-1、SC-10、要件06 §9、要件06 §2、PRD 5.7 / 依存: T-M5-08 / サイズ: M
- 完了条件:
  - md/premiumで、エディタの保存成功／6見出し構造エラー／version競合（409→再読込促し）の3状態がモックで確認でき、履歴一覧（version・change_source・summary・日時）から指定版のロールバック確認ダイアログ→新version作成まで操作できる
  - standardプランではタブ内容がロック表示（アップグレード導線）になり、直接のAction呼び出しも403になる
  - 手動編集したセクション1〜4は発信設定フォーム保存で上書きされる旨の注意が表示され、学習ジョブrunning中は編集不可表示になる
- メモ: モバイルは閲覧可・編集はPC推奨表示（要件06 §2）。発信設定フォーム保存時の差分警告本体はM2の発信設定UI側だが、警告表示の条件（手動編集済みversionの存在）はここで提供する。
- 実装メモ: `/app/ai-settings` の `base-md` タブ（プレースホルダ）を置換。`base-md-editor.tsx`（client）＝textarea＋文字数カウンタ（5,000字上限で保存ボタン無効・赤字）、保存（updateBaseMdManualAction・expected_version送出）。エラーは `code`＋`details.reason` で分岐: validation_error:structure→「## 1.〜## 6.を順番どおり各1回」、too_long→字数超過、job_conflict:base_md_version_changed→競合バナー＋「再読み込み」ボタン（getBaseMdActionで再取得）、base_md_learning_in_progress→編集不可。履歴一覧（version/change_source ラベル/summary/日時・新しい順）から確認ダイアログ→rollbackBaseMdAction→getBaseMdActionで内容/version/履歴を再取得。学習running中は textarea/保存/ロールバック全無効＋案内。セクション1〜4上書き注意は常時表示。PC推奨バナーは `lg:hidden`。server page: plan==standard→EmptyState（/plans アップグレード導線）／base_md_version<1→発信設定へ誘導／else BaseMdEditor（history=listBaseMdVersionsForUser、learningRunning=isLearningRunningForUser を並列ロード）。中核 base-md.ts に読み取り用 `isLearningRunning(db,userId,xAccountId)` 追加（owner join・kind in learning_analysis/md_merge・status=running）、getBaseMdAction 出力に `learningRunning` 追加。テスト: isLearningRunning 単体（true/false・SQL/paramsスコープ）。UIはrepo方針でcomponent testなし（型/lint/build＋Action単体で担保）。全973 green・build通過。doc: 要件06 §3.7「SC-10 ベースmdエディタ」を新設（v1.15）、§9/§3.6・要件05 §8/§9 と整合。
- 後続への注意: プロンプトエディタUIは T-M5-11（同一タブ構成へ組み込む・standardロック/PC推奨/楽観lock競合は本UIと同型）。発信設定フォーム保存時の差分警告本体はM2側で実装済み（persona-settings-form）。

### T-M5-10: T-M5-10: プロンプトテンプレートServer Actionsとoverride解決（M-2/M-3） `done`
- 参照: M-2、M-3、要件05 §8、要件05 §12、要件02 §3.5、要件02 §6、P-5 / 依存: M1、M3 / サイズ: M
- 完了条件:
  - listPromptTemplates がsystem default＋account overrideを合成して返し、updatePromptTemplate（kind=p1〜p6/image・8,000字上限・expected_updated_at楽観lock）でaccount override rowが作成/更新され、resetPromptTemplate でoverrideが削除されsystem defaultへ戻る
  - 生成パイプライン（GEN-P1〜P6のPT、GEN-IMGのPT-IMG）がaccount overrideを優先して解決することをモック生成テストで確認できる（override保存→生成入力に反映、reset→既定に復帰）
  - standardプランは403、FEATURE_QUOTE_POST_ENABLED=false の間は kind=p5 の更新・リセットを feature_disabled で拒否する
- メモ: system defaultプロンプトのseed（p1〜p6/image各1件）はM0/M3のseedに含まれる想定。未投入ならこのタスクでseed migrationを追加する。システム共通promptは編集対象にしない（要件06 §9）。
- 実装メモ: 既存 `prompts/prompt-templates.ts`（seed/resolveは T-M3-02 済み）に list/update/reset の中核を追加。`listPromptTemplates(db,xAccountId)`＝上書き＋system defaultを合成し `{kind,content,isOverride,updatedAt}`（updatedAtは上書き行のupdated_at ISO・ms／未上書きnull）。`applyUpdatePromptTemplate`＝`assertPromptEditablePlan`（standard→forbidden）→`assertPromptKindAllowed`（p5&!quotePostEnabled→feature_disabled）→`validatePromptContent`（空・8,000字超→validation_error）→expectedUpdatedAt=null は `insert ... on conflict (x_account_id,kind) where x_account_id is not null do nothing`（既存なら job_conflict）／非nullは `where date_trunc('milliseconds',updated_at)=$::timestamptz` 更新（0件→job_conflict:prompt_template_changed）。updated_at はDBトリガー `prompt_templates_set_updated_at` が自動更新。`applyResetPromptTemplate`＝同ガード後 delete（冪等）→system default view。**楽観lockはms精度**（pg driverがtimestamptzをms精度Dateへ変換するため updated_at を date_trunc('ms') で突合）。生成パイプラインは既に post-generation.ts/image-generation.ts が `resolvePromptTemplate(xAccountId)` で override優先解決済み（追加変更なし）。配線 `prompt-templates-server.ts`（active account=resolveActiveXAccountForUser・plan=profiles・flag=env.FEATURE_QUOTE_POST_ENABLED・writeはwithTransaction／未選択は NoActiveAccountError）、Actions `app/actions/prompt-templates.ts`（list/update/reset・z.enum(PROMPT_TEMPLATE_KINDS)・NoActiveAccountError→not_found）。テスト: 単体（guards/validate/list合成）＋db（作成→重複null競合→stale競合→正時刻更新→resolve反映／reset→既定／standard forbidden・p5 feature_disabled）。全980 green・build通過。doc: 要件05 §8 にlist/update/reset解決・楽観lock(ms)・8,000字・reset挙動を追記、§P-5 flagOFFゲートに p5 の update/reset を追加（v1.18）。
- 後続への注意: プロンプトエディタUIは T-M5-11（active account前提でx_account_id入力なし・kind選択/文字数カウンタ/override有無バッジ・楽観lockは expected_updated_at を list の updatedAt から送る・p5はflag OFF中非表示・standardロック/PC推奨）。注意: system既定は `supabase/seed.sql` 投入済み（seed.db.testで7件検証）だが seed.sql本文とコード定数 SYSTEM_DEFAULT_TEMPLATES の等価性テストは未整備（将来ドリフト検出を追加検討）。

### T-M5-11: T-M5-11: SC-10 プロンプトエディタUI `done`
- 参照: M-2、M-3、SC-10、要件06 §2、要件06 §9、P-5 / 依存: T-M5-10 / サイズ: S
- 完了条件:
  - md/premiumで kind選択（p1〜p4/p6・image。p5はflag OFF中非表示）→エディタ編集→保存／「システム既定に戻す」確認→リセットが操作でき、override有無（既定/カスタム）のバッジと文字数カウンタが表示される
  - standardプランではロック表示になり、モバイルでは閲覧可・編集はPC推奨表示になる
- メモ: 楽観lock競合（409）時は再読込を促す。SC-10の他タブ（学習・ベースmd）と同一のタブ構成へ組み込む。
- 実装メモ: `/app/ai-settings` の `prompts` タブ（プレースホルダ）を置換。`prompt-templates-editor.tsx`（client）＝kind select（visible=quotePostEnabledでp5をフィルタ）→textarea＋文字数カウンタ（8,000字上限で保存無効・赤字）＋override有無バッジ（カスタム=反転色／既定=muted）。保存（updatePromptTemplateAction・expected_updated_at=list返却のupdatedAt）→成功時 res.template で該当kindをstate更新。「システム既定に戻す」（isOverride時のみ有効・confirm→resetPromptTemplateAction→system default view）。エラー分岐: job_conflict→競合バナー＋「再読み込み」（listPromptTemplatesActionで再取得）、validation_error:too_long/empty→個別文言。システム共通prompt非対象の注記を常時表示。PC推奨バナーは `lg:hidden`。server page: plan==standard→EmptyState（/plans）／else PromptTemplatesEditor（listPromptTemplatesForUser で templates＋quotePostEnabled をロード）。UIはrepo方針でcomponent testなし（型/lint/build＋T-M5-10のAction/中核単体で担保）。全980 green・build通過。doc: 要件06 §3.8「SC-10 プロンプトエディタ」新設・§3.6タブ記述を更新（v1.16）。
- 後続への注意: SC-10の5タブ（persona/purposes/learning/base-md/prompts）が全て実装完了。kindラベルは既存 PATTERN_LABEL 準拠（p1ニュース解説/p2自分の考え/p3ノウハウ/p4トレンド便乗/p5引用ポスト/p6週次まとめ/image画像プロンプト）。

### T-M5-12: T-M5-12: metrics_collector定時トリガー（due選定・バッチ読取・checkpoint保存） `done`
- 参照: K-1、要件04 §6、要件04 §13、要件05 §3、要件02 §4.9、要件01 §6、S-6 / 依存: T-M5-01、M3、M4 / サイズ: M
- 完了条件:
  - モックXクライアント＋ローカルDBで、next_metrics_at到来のdraft（posted全tweet_id＋failedのremaining_tweet_ids、rollback削除確認済みIDは除外）が選定され、100件/バッチ・user token別分離で読取→checkpoint 1へ保存→next_metrics_atが7日dueへ前進する
  - 取得不能field（non-public metrics等）がnullで保存され0と区別される／同一checkpoint再取得は値とcollected_atを上書きし、過去checkpointは上書きされない（要件02 §4.9のスキーマをzod検証）
  - `/api/cron/metrics-collector` がCRON_SECRET認証＋時間窓advisory lockで二重起動時にno-op 2xxを返し、1起動50account・500tweet_id・外部request最大10並列の上限を守って残りを次回毎時起動へ委ねる
- メモ: 投稿完了時・部分失敗で残存IDが確定した時に next_metrics_at を1日checkpointへ初期設定する処理をM4のpost_publish終端処理へ追加する（要件04 §13。M4コードへの変更としてドキュメント同期対象）。public＋所有ポストのnon-public metrics fieldsを要求。
- 実装メモ: 中核 `jobs/metrics-collector.ts`（DB/X読取/時刻/deadline注入・純粋）＝selectDue（`next_metrics_at<=now`・metrics_completed_at null・account active、posted_atアンカー必須）→targetTweetIds（posted全＋failed remaining−rollback deleted）→targetCheckpointDays（next−posted を1/7/30へスナップ）→未取得IDに絞り最大100件/batch読取→applyCheckpoint（0保持/欠落null・同checkpoint上書き・他保持・latest単調増）→saveDraftCheckpoints（runInTxで `select ... for update`＋update原子化、`where metrics_completed_at is null`）→nextDueAfter（1→+7d/7→+30d/30→完了）。上限50 account・500 tweet_id・batch100・**account単位10並列**（token混在なし・cursor pool）、deadline/上限超過は deferred で次窓へ。配線 `metrics-collector-server.ts`（token=getValidXAccessToken・X読取=read-client・runInTx=withTransaction・onError=console）、cronルートは既存stubへ auth＋withCronWindowClaim＋**遅延import**（env検証回避）で配線。M4 post_publish の next_metrics_at 初期化は既存実装済み（追加不要）。
- レビュー（ultracode: 敵対的4次元workflow）でHIGH2件+MEDIUM1件をCONFIRMED→全修正: (1)**HIGH** 部分失敗draft(status=failed)は post_publish が posted_at を成功時しか設定せず、selectDue の posted_at ガードで全skip→remaining_tweet_ids が永久未収集＋due窓churn。修正=post-publish の部分失敗2経路（rollbackThread/failAmbiguousCreate）で `posted_at = case when hasLive then coalesce(posted_at, now()) else posted_at end` を設定しメトリクスアンカー化（M4への波及変更・要件04 §13/要件02 §3.9 に明記）。(2)**HIGH派生** 収集対象ゼロ（ambiguous_deleteのみ等）でも next_metrics_at 未前進→無限再選定。修正=selectDue で pending 空を advanceOnly に振り分け前進のみ実行。(3)**MEDIUM** X読取例外が run全体をthrow→窓claim済みで同窓再試行no-op→他account starve。修正=runAccount で per-draft try/catch＋onError、失効(isXAuthError)はaccountスキップ・一時失敗は据え置きdeferred。FALSE_POSITIVE 1件（FOR UPDATE跨tx）は saveDraftCheckpoints を runInTx で実tx化して解消。回帰テスト（failed draft収集）追加。全993 green・build通過。doc: 要件04 §13 に posted_atアンカー・failed収集・上限/隔離を追記（v1.5）、要件02 §3.9 posted_at 説明更新（v1.14）。
- 後続への注意（T-M5-13）: unavailable_at 確定（取得不能IDのmax3回読取後）・29〜30日窓・retry due・metrics_completed_at の精密化（unavailable含む全確定）は T-M5-13。現状30日checkpoint収集後は即 metrics_completed_at を設定する簡易版。metrics_collector は posted_at をアンカーに使うため、T-M5-13 の retry due も posted_at 基準で整合させること。フォロワー snapshot（follower_snapshot cron）は別タスク。

### T-M5-13: T-M5-13: metrics_collectorの30日期限・unavailable・収集完了処理 `done`
- 参照: K-1、要件04 §13、PRD 8.1、要件06 §8 / 依存: T-M5-12 / サイズ: M
- 完了条件:
  - 時刻モックで、30日checkpointが投稿後29日〜30日未満の窓で取得され、期限内取得失敗時はprivate fieldをnullのまま確定しpublic metricsも更新終了する
  - X上で削除済み・取得不能と確定したtweet_idに unavailable_at が設定され以後のdue選定から外れる一方、同一draft内の他tweet_idの収集は継続する
  - 対象tweet_idがすべて30日取得済みまたはunavailableになったdraftに metrics_completed_at が設定され、以後の回収対象から外れる
- メモ: 一時的な取得失敗（429/5xx）はnext_metrics_atのretry due設定で次回毎時起動へ委ね、恒久失敗（対象不存在）だけをunavailable確定にする。1 tweet_idあたり最大3回読取（MVP）を超えないことをテストで保証する。
- 実装メモ: T-M5-12 の `metrics-collector.ts` を拡張。(1)**29〜30日窓**: `nextDueAfter(7)` を posted+30d→**posted+29d**（`CHECKPOINT_30_DUE_DAYS=29`）に変更し、30日checkpointを29〜30日窓で取得。`targetCheckpointDays` は posted+29d を 30 へスナップ（既存ロジックで成立）。(2)**non-public期限**: `toCheckpointMetrics(tweet, at, privateAvailable=true)`、`saveDraftCheckpoints` で `privateAvailable = now < posted + NONPUBLIC_DEADLINE_DAYS(30)d`。期限超過は profile_clicks を null で確定（public は保存）。(3)**unavailable確定**: `applyUnavailable(map,id,at)`（冪等・checkpoints保持）。成功読取に不在の対象ID（`didRead = draft.tweetIds.length>0`）を unavailable にし、以後 pending から除外。読取が**throw**した場合は上流(runAccount catch)で draft 未保存＝unavailableにしない（恒久=不在／一時=throw の区別）。(4)**完了判定**: `DueDraft.allTargetIds`（全対象ID）を追加し、`completed = allTargetIds.every(30取得済み || unavailable)` の時 `metrics_completed_at` 確定・`next_metrics_at=null`、それ以外は `nextDueAfter(targetDays)` へ前進。最大3回読取は 1/7/29(→30) の3 checkpoint＋不在即unavailableで自然に担保。テスト: 単体（nextDueAfter +29d/privateAvailable=false→null/applyUnavailable冪等）＋db（29-30窓で30取得&完了／期限超過でprofile_clicks=null／全ID不在→全unavailable&完了／不在1件→unavailable&他継続）。全998 green・build通過。**ultracode 敵対的レビュー（2次元）で CONFIRMED 0件**（FP2件: >100 tweet/draftはthread≤7で到達不能・「最大3回」は3 checkpointの記述でありHTTP retry capではない=既存の据え置き再走査が正）。doc: 要件04 §13（29-30窓・private null・unavailable・完了）は T-M5-12 同期時に記述済み、要件02 §4.9 tweet_metrics.unavailable_at も既存で一致（影響なし）。
- 後続への注意: 実績表示（SC-09）は T-M5-15（getAnalyticsSummary・checkpoint切替・profile_clicks null は `--` 表示・30日後「更新終了」）。retry due は現状「next_metrics_at据え置き＝次毎時窓で再走査」（明示backoff無し・MVP）。

### T-M5-14: T-M5-14: follower_snapshot定時トリガー `done`
- 参照: K-3、要件04 §6、要件04 §13、要件02 §3.11、要件05 §3、要件01 §6 / 依存: T-M5-01、M3 / サイズ: S
- 完了条件:
  - モックXクライアントで、JST当日分snapshotがない status=active のXアカウントだけが処理され、(x_account_id, snapshot_date) のupsertにより同日再実行でも重複rowが作られない
  - `/api/cron/follower-snapshot` がCRON_SECRET認証＋時間窓lockを持ち、1起動100account・最大10並列の上限を守り、token失効等で失敗したアカウントはskipして次回毎時起動へ委ねる
- メモ: followers_countはuser lookup（public_metrics）から取得し、external_api_usage_eventsへx_user_readを記録。書き込みはservice role経由（RLS準拠）。
- 実装メモ: 中核 `jobs/follower-snapshot.ts`（DB/X読取/deadline注入・純粋）＝selectDue（`status=active` かつ `not exists (follower_snapshots where snapshot_date = (now() at time zone 'Asia/Tokyo')::date)`・`created_at,id`順・`limit accounts+1`で超過検知）→account単位最大10並列（metrics-collectorと同じcursor pool）でtoken取得→自 x_user_id の followers_count 読取→`insert ... on conflict (x_account_id, snapshot_date) do update`。count null（取得不能）は書かず deferred、token取得失敗/読取throwはonErrorで隔離skip＋deferred。配線 `follower-snapshot-server.ts`（token=getValidXAccessToken・読取=readUserFollowers・原価台帳idempotencyは `follower:{windowKey}:{xAccountId}` で窓別計上）、cronルート（毎時10分）は既存stubへ auth＋withCronWindowClaim＋**遅延import**で配線。JST日付・upsert・limitはSQL/中核で担保。テスト: db（当日書込&同日再実行で重複なし・count不変／token nullでskip・未書込／count nullで未書込&deferred）＋route-auth（401）。全1001 green・build通過。metrics-collectorのレビュー済みパターン踏襲のため個別レビューは省略。doc: 要件04 §13 follower行を上限/隔離込みに拡充（v1.6）、§6表・§3.11スキーマは既存で一致。
- 後続への注意: フォロワー推移グラフUIは T-M5-16。原価台帳の idempotencyKey は毎時窓を含むため、同一アカウントの当日読取は selectDue の filter により実質1回（初回成功後は当日対象外）。

### T-M5-15: T-M5-15: SC-09 投稿実績表示（tweet_id別・checkpoint切替・スレッド合算） `done`
- 参照: K-1、SC-09、要件06 §8、要件05 §9、要件02 §4.9 / 依存: T-M5-12、M4 / サイズ: M
- 完了条件:
  - モックtweet_metricsデータで、tweet_idごとの行（impressions/likes/reposts/profile_clicks・取得日時）が表示され、1日/7日/30日のcheckpoint切替（既定は取得済み最長checkpoint）が動作する
  - スレッド合算が同一checkpoint取得済みのtweet_idだけで表示時に計算され欠損ID数が併記される／profile_clicks取得不能は0ではなく`--`表示／30日checkpoint後は「更新終了」を表示する
  - 部分失敗でX上に残ったtweet_idは「不完全なthread」と明示して1行ずつ表示し、rollback削除済みIDは監査履歴表示のみで実績集計から除外される
- メモ: getAnalyticsSummary(period_days) Actionをあわせて実装（tweet_metricsから集計、合算の別カラム保存はしない）。M4依存は投稿履歴（posted draft・tweet_ids）の存在。Xアカウント切替で再取得。
- 実装メモ: 中核 `analytics.ts`（純粋）＝`buildDraftAnalytics`（posted=全tweet_id live／failed=remaining live＋deleted監査行、unavailable印、incomplete/metricsCompleted）、`defaultCheckpoint`（合算対象で取得済み最長・無ければ1）、`aggregateThread(draft,checkpoint)`（合算対象=非監査&非unavailable、選択checkpoint取得済みのみ合計・**各fieldは全present非nullの時だけ合計、1件でもnullなら null＝`--`**、欠損数=checkpoint未取得の合算対象数）、`summarize`（checkpoint別 tweets/impressions/likes/reposts/profile_clicks を非null加算）。配線 `analytics-server.ts`（`loadAnalyticsForUser`＝posted＋`remaining_tweet_ids`>0のfailedを posted_at 期間で所有権付き読取、`getAnalyticsSummaryForUser`）、Action `app/actions/analytics.ts`（`getAnalyticsSummaryAction({period_days})`・active account解決）、UI `analytics/page.tsx`（直近90日ロード・未連携はEmptyState）＋`analytics-view.tsx`（client・1/7/30切替＝既定最長・合算カード＋欠損併記・tweet別表・profile_clicks `--`・監査/取得不能/不完全thread/更新終了バッジ）。テスト: 単体9（build/default/aggregate null伝播/監査除外/summarize）＋db2（期間・posted/failed-remaining選定・remaining無しfailed/draft/期間外除外・他ユーザー除外）。全1012 green・build通過。UIはrepo方針でcomponent testなし（型/lint/build＋core/Action単体で担保）。doc: 要件06 §8 に90日窓＋summary集計を追記（v1.17）、§8既述の表示仕様（checkpoint切替/合算/`--`/更新終了/不完全thread/監査除外）と一致。
- 後続への注意: フォロワー推移グラフは T-M5-16（follower_snapshots）。改善提案表示は T-M5-17系（SUGGEST）。実績一覧の期間は90日固定（summary Actionのみ period_days 可変）。checkpoint切替はグローバル（全draft横断・既定=最長）。

### T-M5-16: T-M5-16: SC-09 フォロワー数推移グラフ `done`
- 参照: K-3、SC-09、要件02 §3.11、要件06 §2 / 依存: T-M5-14 / サイズ: S
- 完了条件:
  - seedしたfollower_snapshotsから日次推移グラフが描画され、期間切替（例: 7日/30日/90日）と欠損日のスキップ表示が動作する
  - snapshot未収集時の空状態（収集は日次で自動実行される旨の説明）が表示される
- メモ: グラフはSC-09内の1セクション。レスポンシブ・色以外の状態表現（アクセシビリティ）に留意。
- 実装メモ: 中核 `analytics.ts` に `FollowerPoint`型＋`followerSeriesSummary`（latest/delta(初点比)/min/max/points）を追加。配線 `analytics-server.ts` `loadFollowerSnapshotsForUser`（所有権付き・JST基準の直近days・日付昇順）。UI `analytics/page.tsx` が90日ロードして `follower-chart.tsx`（client・**依存追加なしのinline SVG**）へ渡す。期間切替7/30/90（既定30・client側で now 起点フィルタ、`Date.now` は `useState(()=>Date.now())` で1度確定しrender純粋性を満たす）。欠損日は点を作らず実日付でx配置（gap表現）。折れ線＋circleマーカー（色以外）＋数値サマリ（現在・期間増減）＋`<details>`データ表でa11y。未収集は空状態（日次自動記録案内）。`viewBox`＋`w-full`でレスポンシブ。テスト: 単体3（followerSeriesSummary empty/single/multi）＋db1（期間内昇順・200日前除外・所有権）。全1016 green・build通過。UIはrepo方針でcomponent testなし。doc: 要件06 §8 にフォロワー推移セクションを追記（v1.18）。
- 後続への注意: 改善提案（SUGGEST）は T-M5-17（入力集計）→T-M5-18系（生成・表示）。チャートは外部ライブラリ不使用（inline SVG）＝将来リッチ化する場合もこの方針か、導入時はADRで技術判断を記録。

### T-M5-17: T-M5-17: SUGGEST入力集計モジュール（<stats>/<posts>組み立て） `done`
- 参照: K-2、SUGGEST、プロンプト §6.15、プロンプト §4.2、要件04 §12 / 依存: T-M5-12 / サイズ: M
- 完了条件:
  - fixtureで、7日checkpoint取得済みの比較グループが3件以上なら7日を採用、3件未満なら1日値へフォールバックし、異なる経過日数（checkpoint）を混在させないことがunit testで検証できる
  - <stats>が型×時間帯セルごとの件数・平均（対象metric）JSONとして、<posts>がtweet_id単位・最大50件（本文冒頭100字・pattern・JST投稿時刻・metric値）のJSON配列として生成される
  - 対象は直近30日の投稿に限定され、rollback削除済み・unavailableのtweet_idが除外される
- メモ: LLMを使わない純粋なコード集計（プロンプト設計書 §1の原則）。pure functionとして実装しworkerから分離してテスト可能にする。テーマの事前集計は行わない（テーマはPT-SUGGESTが本文から判断）。
- 実装メモ: `jobs/suggestion-input.ts`（純粋・DB非依存、workerから分離）。`chooseCheckpoint(drafts, nowMs)`＝impressions非nullで7日取得済みが3件以上→7、未満→1（混在禁止）。`buildSuggestionInput`＝直近30日の posted 全tweet_id＋failed remaining（tweet_ids↔thread 同順で本文対応、rollback削除・unavailable除外）から、選択checkpointのimpressions非nullな tweet を投稿時刻降順・最大50件で `posts`（tweet_id/body冒頭100字/pattern/JST `HH:mm`/impressions）化し、同一集合を pattern×時間帯（JST 3時間バケット `0-3`〜`21-24`）で `stats`（count・avg_impressions=四捨五入）へ集計。対象metric=impressions固定。JST算出は ISO+9h の純粋計算（argless Date不使用）。テスト: 単体9（checkpoint選定7/1・混在なし・fallback・posts整形/100字/JST時刻・stats count/avg・30日除外・削除/unavailable除外・50件上限）。全1025 green・build通過。doc: プロンプト §6.15 入力形式に metric=impressions・checkpoint選定・3時間バケット・同一集合集計を追記（v1.5・変更履歴追記）。
- 後続への注意: suggestion worker（PT-SUGGEST実行・zod検証・window_days=30付与・improvement_suggestions保存）と refreshSuggestions/listSuggestions は T-M5-18。evidence.tweet_ids は `<posts>` 内IDのみ許可（worker側で検証）。`buildSuggestionInput` の入力 draft は analytics-server の loadAnalyticsForUser 相当（posted＋remaining有りfailed・30日）を thread 付きで渡す想定。

### T-M5-18: T-M5-18: suggestion workerとrefreshSuggestions/listSuggestions `done`
- 参照: K-2、SUGGEST、プロンプト §6.15、要件05 §9、要件05 §12、要件04 §12、要件02 §3.12、要件02 §4.11、要件03 §7.1 / 依存: T-M5-17、M3 / サイズ: M
- 完了条件:
  - モックAIで、suggestion workerがPT-SUGGEST実行→出力zod検証（最大2件・evidence.tweet_idsは<posts>内IDのみ許可、違反は修復→失敗）→window_days=30を付与して improvement_suggestions へ保存し、比較グループ不足時は提案0件で正常終了する
  - refreshSuggestions が「active suggestion jobなし（partial unique）」「同一JST日の実行済みなし」「前回job以降に新しいmetrics更新あり」をすべて検証し、違反時は理由付きで拒否する（1日1回制御は時刻モックで検証）
  - premiumは生成枠reserve（+1）・最終失敗時refundが冪等keyで記録され、listSuggestions が最新のsuggestion job実行分だけを返す
- メモ: SUGGESTはbase_mdを読まない（プロンプト §4.2）。BYOK=ユーザー選択キー／premium=運営Claudeで実行。request_key冪等・5件上限job_conflictも適用。提案は表示専用でベースmd/プロンプトへの自動反映Actionは作らない。
- 実装メモ: PT_SUGGEST（gen-prompts・drift snapshot更新）追加。worker `suggestion.ts`＝loadJob→fetchDrafts→`buildSuggestionInput`（T-M5-17）→**posts<3ならLLM未呼び出しで0件正常終了（reserveもしない）**、posts≥3なら premium reserve→PT_SUGGEST実行→`makeSuggestionSchema(allowedIds)`（最大2件・evidence.tweet_ids は allowedInts の subset を zod refineで検証、修復1回は runTextGeneration が担当）→同一txで improvement_suggestions 保存（evidence.window_days=30 をコード付与・source_job_id=jobId）＋usage確定。失敗時 persistFailure＋premium refund（冪等）。配線 `suggestion-server.ts`（fetchDrafts=直近30日 posted＋remaining有りfailed・thread/tweet_metrics付き、resolveTextProviderは**遅延import**でenv検証を回避）、handlers に suggestion 登録（placeholder撤去）。job管理 `suggestion-jobs.ts`＝`refreshSuggestions`（request_key冪等・active一致・assertNoActiveSuggestion・assertNotAlreadyToday=同JST日succeeded・assertNewMetricsSinceLastJob=前回job created_at以降のtweet_metrics collected_at・5件上限→job_conflict）／`listSuggestions`（最新succeeded jobの提案・所有者のみ）。Actions `app/actions/suggestions.ts`（refresh=after()でdispatch・list）。
- ultracode 敵対的レビュー（3次元）でCONFIRMED 2件を修正: (1)**HIGH** terminal.ts `finalizeFailedJob` に suggestion case が無く、stale最終失敗でpremium reserveが返還されず枠リーク→learning_analysis/md_mergeと同型の `refundUsage(generation)`＋通知 case を追加（stale refund回帰テスト追加）。(2)**MEDIUM** refreshSuggestions の `insert ... on conflict (request_key)` が active suggestion partial-unique 競合（別トークン並行呼び出し）を吸収できず 23505→internal_error。arbiter無しの `on conflict do nothing`＋re-fetch（自キー→dedup／他→job_conflict active_suggestion_exists）へ修正。全1035 green＋新規テストで検証。doc: 要件04 §12 に reserve=LLM実行時のみ・拒否理由・evidence検証/window_days・listSuggestions を追記（v1.7）。worker test（kind=suggestion no-op）は全kind実handler化に伴い挙動更新。
- 後続への注意: 改善提案UI（表示専用・拒否理由表示・実績不足時の必要3投稿案内）は T-M5-19。suggestion worker は retryable自己終端を持たない（学習workerと異なり）＝一時的provider失敗も最終失敗扱いだが失敗jobは1日1回制限に数えないため手動再試行可（refundは在process＋stale両経路で冪等）。

### T-M5-19: T-M5-19: SC-09 改善提案UI（表示専用） `done`
- 参照: K-2、SC-09、要件06 §10、要件05 §9、PRD 5.6、要件02 §4.11 / 依存: T-M5-18、T-M5-15 / サイズ: M
- 完了条件:
  - 「提案を更新」ボタンから実行→進行表示→最新提案（content＋evidence: 対象投稿リンク・metric・checkpoint・diff_pct・summary）の表示までがモックで動作し、承認・却下・自動反映の操作が存在しない
  - 1日1回制限・新metricsなし・実行前提不足の各拒否理由が表示され、「発信設定やベースmd編集（md/プレミアム）で自ら反映する」旨の案内が表示される
  - 実績不足時は比較グループごとに必要な3投稿と現在件数が表示される（要件06 §10）
- メモ: evidence.tweet_idsから該当投稿（本文冒頭）を引いて根拠として提示する。SC-09は実績・フォロワー・提案の3セクション構成で完成。
- 実装メモ: 配線 `analytics-server.ts` `loadSuggestionsForUser`＝`listSuggestions`（T-M5-18）の最新成功job提案を、evidence.tweet_id→本文冒頭100字（drafts の tweet_ids↔thread 同順map）＋Xリンク（`https://x.com/{handle}/status/{id}`）で enrich し、queued/running suggestion jobの有無を `generating` で返す。UI `suggestions-panel.tsx`（client）＝「提案を更新」→refreshSuggestionsAction（成功=生成中案内＋router.refresh／失敗=code+details.reasonを日本語拒否理由へmap: already_today/no_new_metrics/active_suggestion_exists/too_many_active_jobs/x_account_mismatch）、「再読み込み」＝router.refresh、generating時は「生成中…」＋更新ボタン無効。提案カード（content・metric/checkpoint/diff_pctバッジ・summary・根拠投稿リンク）。**承認/却下/自動反映ボタンは無し**、表示専用＋「発信設定やベースmd編集で自ら反映」案内を常時表示。提案0件時: comparablePostCount<3なら「同一計測時点の投稿が3件以上必要（現在N件）」、≥3なら「目立った提案なし」。comparablePostCount は page が DraftAnalytics（非監査・非unavailable・いずれかのcheckpoint取得済みtweet数）から算出。SC-09 page に3セクション（FollowerChart / AnalyticsView / SuggestionsPanel）を並置。テスト: db（loadSuggestionsForUser の本文/リンクenrich・generatingフラグ）。全1037 green・build通過。UIはrepo方針でcomponent testなし。doc: 要件06 §8 に改善提案セクションを追記（v1.19）。
- 後続への注意: **M5完了**（学習・実績・改善提案の全機能）。実績不足表示は比較グループ単位ではなく対象投稿総数での簡易版（§10の「比較グループごと」を総数で近似・厳密なpattern×時間帯別内訳表示は将来拡張）。改善提案の生成は非同期jobのため「提案を更新」後は router.refresh/再読み込みで結果反映（自動ポーリングはしない）。

## M6: プレミアム・法務・リリース準備

### T-M6-01: premium運営AIキー実行経路（PREMIUM_TEXT_PROVIDER解決とai_purpose_config制約） `done`
- 参照: O-4、A-5、PRD §8.2、要件01 §3.5、要件01 §7、要件02 §4.1、要件05 §4.1、プロンプト §1、プロンプト §5.1 / 依存: M1、M3 / サイズ: M
- 完了条件:
  - premiumユーザーの文章系jobがユーザーAIキー未登録でも運営キー設定（モックprovider）で実行され、standard/mdはユーザーキーが使われる
  - updateAiPurposeConfigでpremiumのtext変更がforbiddenで拒否され、imageは運営キー未設定のproviderを選択できない
  - PREMIUM_TEXT_PROVIDER未設定時はanthropicへ解決し、運営キー未設定で起動時検証が失敗する
- メモ: resolveProviderを拡張し、premiumでは文章生成・分析（GEN/LRN/SUGGEST/MD-MERGE）をPREMIUM_TEXT_PROVIDER（既定anthropic、明示設定時のみopenai/google）の運営キーへ、画像生成を運営OpenAI/Geminiキーへ解決する。premiumのtextはDBへ保存せず実行時に解決し、updateAiPurposeConfigはpremiumのtext変更を拒否・imageは運営キー設定済みproviderのみ許可（SC-10ではread-only表示）。起動時に選択provider・モデルの検証を追加。NEWS用運営Claude経路（全プラン共通）はニュース担当マイルストーン側の実装を再利用する。
- 実装メモ: 完了条件1・2は既存実装（M0/M2/M3）で充足済みを確認＝(1)`resolve-provider.ts` `resolveTextKey` が premium→`operatorTextKey(premiumTextProvider)`（ユーザー設定無視・keySource=operator）、`resolveImageKey` が premium→ユーザー選択openai/googleを運営キーで解決（未設定はfallback／全滅は ProviderConfigError）。standard/md=BYOK。テスト: resolve-provider.test.ts（premium operator・premiumTextProvider openai・image選択尊重）。(2)`ai-purpose-config-store.ts updateAiPurposeConfigRecord` が premium の `patch.text` を validation_error(premium_text_read_only)で拒否、`patch.image` は operatorImageProviders 未設定なら validation_error(operator_key_unavailable)。SC-10 UI（ai-purpose-settings）は premium text を read-only 表示済み。テスト: ai-purpose-config-store.db.test.ts。※完了条件の「forbidden」は既存実装の validation_error（フィールド単位の拒否理由付き）で実現＝意味的に同等のためコード変更せず踏襲。本タスクの新規実装は(3)＝`env-schema.ts` superRefine に preview/production で `PREMIUM_TEXT_PROVIDER`／`NEWS_TEXT_PROVIDER` の**選択provider運営キー動的必須化**を追加（既定anthropic→ANTHROPIC_API_KEY、明示openai/google→OPENAI/GEMINI_API_KEY）。PREVIEW_PROD_REQUIRED の静的 ANTHROPIC_API_KEY は動的判定へ移行（既定時は同等・openai/google選択時に該当キーを要求）。text modelは既に ALWAYS_REQUIRED。テスト: env-schema.test（選択openai/googleでOPENAI/GEMINI_API_KEY必須・default anthropic据置）。全1039 green・build通過。doc: 要件01 §3.5 表の ANTHROPIC_API_KEY 注記を premium/news 両provider選択の運営キー要件へ更新（v1.6）。§7 起動時検証（選択providerキー検証）は既述。
- 後続への注意: premium text は常に運営provider（DB非保存・実行時解決）。imageのみユーザーが運営キー設定済みopenai/googleから選択可。M6残り: T-M6-02（managed OAuth）・以降。

### T-M6-02: premium運営X App経由のOAuth連携（managed経路） `done`
- 参照: A-3、PRD §8.1、要件01 §3.4、要件02 §3.3、要件03 §6、要件05 §4.3 / 依存: M1、M2 / サイズ: M
- 完了条件:
  - premiumユーザーのOAuth startがmanaged client設定でauthorize URLを生成し、callback（X APIモック）でauth_type=managedのx_accounts行が暗号化tokenとともに保存される
  - standard/mdユーザーはmanaged経路を使えず、premiumユーザーはBYOK経路を使えない（期待auth_type不一致で拒否）
  - enableXAccountがplanとauth_typeの不一致をforbiddenで拒否する
- メモ: OAuth start/callbackがplanからclient資格情報（BYOK=user_api_keysのX App／premium=X_MANAGED_CLIENT_ID・X_MANAGED_CLIENT_SECRET）と期待auth_typeを解決する。stateにclient種別を結び付け、callbackで期待auth_typeと不一致なら拒否。managedのconfidential client（client_secret）対応。enableXAccountはplanに対応するauth_typeのみ許可。tokenは利用者ごとにx_accountsへ暗号化保存（app-only tokenで投稿しない）。
- 実装メモ: managed経路は M2 の OAuth 実装（T-M2-12/13/14）で最初から作り込み済み＝(1)`oauth-start.ts` `expectedAuthTypeForPlan`（premium→managed／standard・md→byok）＋`resolveClient` が managed で `managedOAuthClient()`（`X_MANAGED_CLIENT_ID`／`X_MANAGED_CLIENT_SECRET`・secretありでconfidential）を使い authorize URL 生成、state に authType を封緘。(2)callback route `resolveOAuthClient` が `authType==='managed'→managedOAuthClient()`、`exchangeCode` は confidential で `Authorization: Basic base64(id:secret)`（oauth.ts）。`handleXOAuthCallback` は `tx.authType` を伝播し `linkXAccountRecord` が `auth_type=managed` で暗号化token保存（byok時のみ user_api_keys(x) を valid 化＝managedは触らない）。(3)`enableXAccount` が `expectedAuthTypeForPlan(plan)≠auth_type` を forbidden(auth_type_mismatch)。期待auth_typeはplan由来のため standard→managed / premium→byok は構造的に発生しない。本タスクでの新規実装は無し。**追加したのはmanaged経路のテスト**: oauth-callback.test（managed sealed state→resolveClient('managed')・confidential client でcode交換・persist authType=managed）、oauth-callback.db.test（premium managed callback→auth_type=managed・暗号化token・user_api_keys(x)なし）。既存: oauth-start.test（premium→managed）、account-actions.test（enableXAccount auth_type mismatch byok under premium）。全1041 green・build通過。doc: 要件01 §3.4／§7・要件02 §3.3・要件03 §6・要件05 §4.3 に既述で一致（影響なし）。
- 後続への注意: managed の token refresh も confidential client（Basic auth）で行う（token-refresh 実装済み）。app-only tokenでは投稿せず、常に利用者本人のuser context token。

### T-M6-03: プレミアム利用枠サービス基盤（reserve/refund・冪等key・月境界） `done`
- 参照: O-4、要件03 §7.2、要件03 §7.3、要件03 §7.4、要件02 §3.13、要件02 §3.14 / 依存: M0、M1 / サイズ: M
- 完了条件:
  - 同一冪等keyでreserveを2回実行してもeventは1件・counterは+1のみで、2回目はno-opになる（ローカルDBテスト）
  - 上限到達時のreserveはusage_limit_exceededで失敗し、event・counterとも変化しない
  - JST月境界を跨いだrefund（7月reserve→8月refund）が元のmonth=7月のcounterへ-1される
- メモ: DATABASE_URL直結の複文transactionで、usage_countersのFOR UPDATE→上限確認→usage_events insert→counter±1を原子的に行うサーバー専用モジュール。冪等key（job:{job_id}:generation:reserve等）の重複はno-op。refundはref_event_id必須で元reserveと同じcounter/month/operationへ-1。monthはJST基準YYYY-MMで3アカウント合算・繰越なし（月初reset不要）。上限到達はusage_limit_exceededを返す。
- 実装メモ: `usage/generation-reserve.ts`（reserveUsage/refundUsage）は T-M5-03 で基盤実装済み＝完了条件1（冪等reserve: event `on conflict (idempotency_key) do nothing`＋新規挿入時のみcounter+1、2回目no-op）と条件3（refundは元reserve行から month/counter_type/operation をコピーし ref_event_id 付きで当該monthのcounterを-1＝JST月境界跨ぎも元月へ戻る）を充足。本タスクの新規実装は**条件2の上限確認**: reserveUsage に任意 `limit` を追加し、当月 usage_counters を `for update` でロック→現在値読取→（冪等: 既存reserveなら上限判定せずno-op）→`limit`指定かつ `count>=limit` なら `usage_limit_exceeded` を投げ event/counter を一切変更しない（要件03 §7.4）。FOR UPDATE で並行reserveの上限すり抜けを防止。上限値は premium の `PLANS.premium.usageLimits`（generations=100/images=20）を呼び出し側（T-M6-04）が渡す。既存呼び出し（learning/md-merge/suggestion/terminal）は limit 未指定で従来挙動維持（後方互換）。テスト: db（idempotent既存＋**上限到達でusage_limit_exceeded・event/counter不変**＋**cross-month refundが元月へ-1**）。全1043 green・build通過。doc: 要件03 §7.4 の「上限確認」を reserveUsage に実装＝既述と一致（影響なし）。
- 後続への注意: 生成/画像ジョブへの limit 付き reserve 組み込みは T-M6-04（premiumのみ・GEN-FIX等の重複加算防止）。既存workerは現状 limit 未指定なので premium 上限は T-M6-04 で有効化される。

### T-M6-04: 生成・画像ジョブへの生成枠/画像枠reserve/refund組み込み `done`
- 参照: O-4、要件03 §7.1、要件03 §7.5、要件04 §8、要件04 §9、プロンプト §1 / 依存: T-M6-03、T-M6-01、M3 / サイズ: M
- 完了条件:
  - premiumのpost_generation成功で生成枠が+1のみ（GEN-FIX・JSON修復発生時も増えない）、standard/mdではreserve/counter更新が一切発生しない（モックprovider）
  - AI最終失敗でrefund eventが作成されcounterが元に戻る
  - 画像job最終失敗で画像枠だけrefundされ、成功済み本文の生成枠は返還されない
- メモ: premiumのみ：文章系top-level job（GEN-P1〜P6・LRN・SUGGEST・削除時単独MD-MERGE）開始時に生成枠reserve、image_generation開始時に画像枠reserve。最終失敗でrefund（Storage保存失敗も画像refund）。内部retry・JSON修復・GEN-FIX・同一job内MD-MERGEは追加消費なし。ユーザーの再生成・retryGenerationJobは新jobとして新規消費。cloneFailedDraftForRetryと下書き破棄は消費・返還なし。ニュース基盤は対象外。
- 実装メモ: (1)**post_generation**（GEN-P1〜P6）: PostGenerationDeps に `runInTx` 追加。job開始・冪等early-return後・premium時に generation を `limit=PLANS.premium.usageLimits.generations` で reserve。上限到達（usage_limit_exceeded）は persistFailure(usage_limit_exceeded)＋terminal。以降を try/catch で包み、**最終失敗（前提不足/生成error/検証不能/draft保存失敗等）は catch で refund**、成功（draft作成→return）は catch を通らず消費維持。reserveは開始時1回のみ＝GEN-FIX短縮・JSON修復・出典再生成は同一jobの内部callで追加消費しない。(2)**image_generation**: ImageGenerationDeps に `runInTx` 追加。try 先頭で premium時に image を `limit=…images` で reserve、catch 先頭で **画像枠のみ refund**（冪等・reserve未実施ならno-op）。生成枠は親jobの勘定なので不可触（refund type='image'のみ）。(3)既存の generation reserve（learning-analysis/suggestion/md-merge-server）に `limit` を配線（T-M6-03のdefer解消）。stale経路の refund は terminal.ts が既に post_generation→generation・image_generation→image で正しく実装済み。standard/md は plan≠premium で reserve自体スキップ。テスト: post-generation.db（premium成功+1/JSON修復で二重加算なし・standard reserveなし・premium最終失敗refund net0）、image-generation.db（新規: 画像失敗で画像枠のみrefund・生成枠不可触／成功で画像+1）、既存unit/dbの deps に runInTx 追加。全1048 green・build通過。doc: 要件03 §7.1/§7.5 に既述で一致（影響なし）。
- 後続への注意: prereq検証失敗時はreserve→refundのnet0（§7.5「消費なし」= counter net0で満たす。event log にはreserve+refund両方が残る）。learning/suggestion/md-mergeの usage_limit_exceeded は現状 worker のtry外reserveで throw→runJob failed（terminal refund no-op）＝graceful message未整備（premium上限到達の稀ケース。sourceはpending残存し得る）。M6残: 課金Stripe連携・法務ページ・リリース準備。

### T-M6-05: staleジョブfailed確定時の利用枠refund回収 `done`
- 参照: 要件04 §4、要件03 §7.3、要件03 §7.4 / 依存: T-M6-04、M3 / サイズ: S
- 完了条件:
  - reserve済みjobを人工的にstale化（locked_atを過去に設定・attempt=3）してtick handlerをローカル実行すると、failed確定と同時にrefund eventが1件だけ作られcounterが戻る
  - worker側で既にrefund済みのjobに対してtickが追加refundを作らない
- メモ: scheduler_tickのstale回収でattempt>=3のrunning jobをfailed確定する同一transaction内で、当該jobの未返還reserve（job:{job_id}:generation:refund／image:refund）を同じ冪等keyでrefundする。worker通常経路のrefundと二重返還しないことを冪等keyで保証。
- 実装メモ: stale→refund の配線は既存で充足を確認＝`stale.ts recoverStaleJobs` が `attempt>=MAX_ATTEMPTS(3)` の running job を同一tx内で failed確定＋`terminalHandler`（既定=`terminal.ts finalizeFailedJob`）呼び出し。finalizeFailedJob が kind別に `refundUsage`（post_generation/learning/md_merge/suggestion→generation、image_generation→image）を冪等keyで実行。本タスクの新規は**end-to-endテスト**（stale.db.test）: premium reserve済み post_generation job を stale(locked 15分前・attempt=3)化→`recoverStaleJobs`（実 finalizeFailedJob）→failed＋refund event 1件・generations_count 0復帰／worker先行refund済みなら tick が二重refundしない（冪等key）。既存テストの mock terminal handler 差し替え漏れ防止に `afterEach(setStaleTerminalHandler(finalizeFailedJob))` を追加。全green・build通過（下記で確認）。doc: 要件04 §4・要件03 §7.4（stale時 scheduler_tick が同一冪等keyでrefund）に既述で一致（影響なし）。
- 後続への注意: M6残: 投稿枠consume（T-M6-06〜08）・原価台帳（T-M6-09/10）・プラン変更副作用（T-M6-11）・残量表示/通知（T-M6-12/13）・法務/LP（T-M6-14〜16）。

### T-M6-06: 投稿実行の通常/URL付き枠consume（post_create/post_delete・全プラン記録） `done`
- 参照: O-4、要件03 §7.1、要件03 §7.4、要件04 §10、要件04 §11、要件02 §3.13 / 依存: T-M6-03、M4 / サイズ: M
- 完了条件:
  - モック投稿でURLなし3ポストthread全件成功時、post_normalのconsume eventが3件作られ、premiumはnormal_posts_countが+3、standard/mdはeventのみでcounter更新なし
  - 途中失敗→rollback削除成功で、削除分が元投稿と同じcounter_typeで追加consumeされ（同枠2消費）、削除失敗分は追加消費されない
  - X_POSTING_MODE=dry_runではconsume event・counter更新が発生しない
- メモ: X送信直前の最終payload（P-5のquote_url合成後。flag OFF中はP-5経路自体が実行されない）でHTTP(S) URL有無を判定しcounter_type（post_normal/post_url）を決定。tweet_id成功ごとに同一transactionで全プランのconsume event＋premiumのみcounter加算。ロールバック削除成功は対応するpost_createのcounter_typeを引き継ぎ同枠へ+1（作成+削除=同枠2消費）、削除失敗は追加消費なし。日次50上限はpost_createのみ合算。冪等keyはdraft:{draft_id}:tweet:{tweet_id}:post:create|delete。DB保存だけ失敗した場合はreconcileし再送しない。
- 実装メモ: consume EVENT記帳（post_create/post_delete・全プラン・冪等key・counter_type=finalTextでURL判定）と日次50上限はM4 post-publish実装済み。**新規=premium月次counterの加算**: `consumePostSlot(runInTx, {...})` ヘルパを追加し、event insert（on conflict do nothing）＋（新規挿入かつ premium かつ live のみ）normal/url_posts_count +1 を**同一transaction**で実行（§10「同一transaction」・crash時のunder-count窓を排除）。saveCreatedTweet（create）とrollbackThreadのrecordDeleteConsume（delete）を consumePostSlot へ集約。PostPublishDepsに `runInTx`（withTransaction配線）と `postingLive`（env.X_POSTING_MODE==='live'）を追加。rollbackThreadに `plan` を渡す。standard/mdは premiumLive=false でevent記帳のみ、dry_runも同様にcounter非加算（§10）。テスト（新規 post-publish.db.test）: premium+live 3 URL-less→post_create×3・normal +3／standard→event only・counter 0／**dry_run→event記帳あり・counter 0**／rollback（1成功→2件目失敗→t-1削除）→create×1+delete×1・同枠normal +2。全1054 green・build通過。**要注意（仕様整合）**: 完了条件3「dry_runでconsume eventも発生しない」は 要件04 §10（正本）と矛盾＝§10は「dry_runでも consume event・tweet_ids・status等は記帳（日次上限検証のため）、原価台帳とpremium月次counterのみ非実行」。正本§10に従い「dry_run=event記帳あり・counter非加算」で実装（BACKLOG条件3の文言は§10へ寄せて解釈）。doc: §10/§7.1 に既述で一致（影響なし）。
- 後続への注意: M6残: T-M6-07（ロールバック安全残量判定）・T-M6-08（enqueue事前判定）・原価台帳（09/10）・プラン変更（11）・残量表示/通知（12/13）・法務/LP（14〜16）。

### T-M6-07: 投稿直前のロールバック安全残量判定 `done`
- 参照: 要件03 §7.4、要件06 §7、PRD §6.1、O-4 / 依存: T-M6-06 / サイズ: S
- 完了条件:
  - 5ポスト（最終のみURL付き）payloadで必要残量が通常8（2×4）・URL1と算出されるユニットテストが通る
  - 残量不足ケースで投稿jobがX API（モック）を一切呼ばずに失敗し、usage_events/countersが変化せずerror通知が作成される
- メモ: premiumの投稿開始前に最終payload列を通常/URL付きへ分類し、通常枠にmax(R, 2×R_prefix)、URL枠にmax(U, 2×U_prefix)の残量を必須とする（全件成功と、最終投稿失敗時のprefixロールバック削除の両方を賄う）。不足時はX APIを呼ばず枠を消費せずusage_limit_exceededで失敗し通知する。同一userのpost_publish直列化はM4のadvisory lockを前提とする。
- 実装結果: `post-publish.ts`に純関数`requiredPostSlots(finalTexts)`を追加（末尾を除くprefixのみ2倍対象。単一ポストはprefix空でロールバック余力不要）。`executePostPublish`の日次上限checkの直後・X呼び出し（getAccessToken/media upload/createPost）の前に、premium かつ postingLive のときだけ当月`usage_counters`を読み`finalTextAt`列の必要残量と突き合わせるガードを追加。不足時はdraftを未投稿へ戻し、`usage_limit_exceeded`（非retryable）で失敗させ、専用文言＋dedupe `draft:{id}:usage_limit`の error通知を出す。`finalTextAt`（P-5のquote_url合成含む）はconsumeと同一分類のため定義をガード前へ巻き上げた。`createPostErrorNotification`はtitle/body/dedupeSuffixを任意上書き可能に拡張。ガードの正当性（各枠でrequired≥実消費が全終端結果で成立するタイトな上界）は敵対的レビュー2観点で確認済み。dry_run/BYOKは月次counter対象外のためガードもskip。残量数値・翌月開始日時の詳細表示はT-M6-12/13の担当。docは要件03 §7.4・要件06 §7が既に本挙動を規定済み（影響なし）。

### T-M6-08: スケジュールenqueue時のpremium残量・日次上限事前判定 `done`
- 参照: 要件04 §7.1、要件03 §7.4、O-5、S-2、S-3 / 依存: T-M6-07、M4 / サイズ: S
- 完了条件:
  - premium残量不足のauto slotがenqueueされずに通知される（tick handlerをローカル実行・時刻モック）
  - 当日post_create件数＋パターン別最大数が50を超えるslotはenqueueされない
  - BYOK（standard/md）のslotは残量判定をskipしてenqueueされる
- メモ: enqueue条件へpremium判定を追加：生成枠、画像ONなら画像枠、auto modeならパターン別最大数から算出した必要残量（P-1=通常10＋URL1、P-2=通常1、P-3=通常12＋URL1、P-4=通常8＋URL1、P-6=通常12＋URL1）を通常/URL枠で確認。当日JSTのpost_create件数＋パターン別最大数が50以下であることも確認。不足slotはenqueueせず通知。生成後の投稿直前には実payloadで再判定（前タスク）される二段構え。
- 実装結果: 本体はM4（T-M4-06/07）で実装済みだった。`schedule-enqueue.ts`の`premiumBudgetOk`（生成枠+1／画像ONなら画像枠+1／auto時は`ROLLBACK_SAFE_BUDGET[pattern]`の通常・URL枠）＋`dailyLimitOk`（当日post_create件数＋`PATTERN_MAX_POSTS[pattern]`≤50）が§7.1条件を満たし、`isEligible`はpremiumのみ残量判定・BYOKはkeysValidのみ（残量skip）で分岐。条件1の「通知」は別ステップ`schedule-recovery.ts`の`notifyUnenqueuedMissed`が担う（enqueueされないまま定刻+10〜70分の due slotへ`schedule_missed`通知・dedupe `slot:{id}:{date}:{hh:mm}:missed`）＝enqueue skipと通知は別関数・別時間窓の二段構え。本タスクでは不足していたテストを追加：BYOK（standard/md）がbudget query未発行でenqueueされること、premium autoのURL枠枯渇skip、画像枠枯渇skip。doc影響なし（§7.1が既に本挙動を規定・本体はM4実装、今回はテスト整備のみで本番コード変更なし）。PREMIUM_LIMITSはenqueue内にハードコード定数だがplans.tsと一致（将来はPLANS参照で一本化する余地・別途）。

### T-M6-09: external_api_usage_events原価台帳：AI呼び出しの冪等記録 `done`
- 参照: 要件02 §3.17、要件03 §7.4、プロンプト §5.1、プロンプト §5.6、PRD §6.1 / 依存: M0、M3 / サイズ: M
- 完了条件:
  - モックproviderでのjob実行後、provider call 1回につき1行が記録され、同一冪等keyの再実行で行が増えない
  - 失敗callもstatus=failed・正規化error_code付きで記録され、本文・prompt・秘密値がどのカラムにも含まれない
  - unit_cost_usd/estimated_cost_usdに実行時単価snapshotが保存され、算出不能時はnullになる
- メモ: providerアダプタの全AI呼び出し（GEN/LRN/SUGGEST/MD-MERGE/GEN-IMG、共通NEWSはuser_id=null）について、provider・operation（text_generation/web_search/image_generation）・request_id・status・http_status・error_code・quantity・usage内訳・実行時単価snapshot・推定原価を冪等keyで記録するモジュールを実装し組み込む。成功・失敗を問わず記録。投稿本文・prompt・APIキー・外部レスポンス本文は保存しない。40日cleanupはM3のtick cleanupで実装済みの想定（未実装なら本タスクで追加）。usage_events（利用枠）とは責務を分離。
- 実装結果: 台帳module（`recordExternalApiUsage`/`providerCallToUsageEvent`）はM3で存在しNEWS/X呼び出しのみ配線済みだった。共通ヘルパ`recordProviderCalls(db, calls, {userId, xAccountId, jobId, keyPrefix})`（冪等key `{keyPrefix}:{seq}`）を追加し、GEN=`gen:{jobId}`／LRN=`lrn:{jobId}`／SUGGEST=`sug:{jobId}`／MD-MERGE=`mdmerge:{jobId}`／GEN-IMG=`img:{jobId}`で各jobへ組み込み（NEWSも同ヘルパへ統一）。**インラインMD-MERGEはlearning_analysisと同一jobIdを共有するためprefixを`lrn:`/`mdmerge:`で分離**（衝突回避）。記録はterminal outcome（成功／terminal失敗のpersistFailure）で1回。retryable再dispatch経路（LRN/MD-MERGE）は記録しない（成功済みcallのusageはterminal時に記録）。**cost null化**: `estimateProviderCost`は単価表なしで`null`を返すようにし、`ProviderCall.estimated_cost_usd`と台帳`unit_cost_usd/estimated_cost_usd`を`number|null`へ変更（GenerationUsage合計は`?? 0`）。画像生成callは合成ProviderCall（`operation=image_generation`・cost=null）で記録。40日cleanupはschedule-cleanup（step3）に既存で追加不要。**敵対的レビューでHIGH 1件検出→修正**: LRNが分析phase成功直後（インラインMD-MERGE前）に記録しており、MD-MERGEがretryable失敗→再dispatchすると再課金分が同一冪等keyと衝突して過少計上＋generation_jobs.usageと不整合。記録をMD-MERGE完了後（真のterminal success）へ移動し、terminal失敗時は保持した`analysisUsage`をpersistFailureで記録（過少計上防止）。doc: 要件02 §4.6にcost null化・冪等key規約・画像op記録を追記（§3.17/§4.6は元々null許容を規定済み）。失敗**throw**（SDK例外でusage未返却）call自体の記録責務は要決定D-4（未解決）のまま—本タスクはusage.callsに現れるcall（成功＋status=failed返却）を記録する範囲。

### T-M6-10: external_api_usage_events原価台帳：X API呼び出しの記録と単価snapshot `done`
- 参照: 要件02 §3.17、要件01 §3.1、要件04 §10、PRD §6.1 / 依存: T-M6-09、M4 / サイズ: S
- 完了条件:
  - モック投稿成功でx_post_create行がURL有無に応じた単価snapshot付きで記録され、rollback削除でx_post_delete行が記録される
  - media uploadでは台帳行が作られず、dry_runでは一切記録されない
  - 同一tweet_id操作の再処理（reconcile）で行が重複しない
- メモ: x_post_create／x_post_delete／x_post_read／x_user_readを冪等記録する。作成はURL有無でX_COST_CONTENT_CREATE_USD／X_COST_CONTENT_CREATE_WITH_URL_USD、削除はX_COST_INTERACTION_DELETE_USDのenv単価snapshotを採用。X media uploadは運用logのみで台帳・利用枠から除外。dry_runは記録しない。
- 実装結果: 本体はM3/M4で実装済みだった。`x/usage.ts` `recordedXCall`（成功→単価snapshot×quantity、失敗→status=failed・estimated 0、dryRunスキップ、idempotencyKey冪等）＋`x/read-client.ts`（x_post_read/x_user_readを単価0で記録）＋post-publishのcreate（`xUnitCost(x_post_create,{hasUrl})`でURL別単価）/delete配線＋media upload非ラップ（除外）。本タスクでは統合テストを`post-publish.db.test.ts`へ追加：premium+liveで通常0.01/URL0.02のx_post_create 2行＋media行なし＋idempotency key（`draft:{id}:x_post_create:{i}` index安定＝reconcile重複防止）、rollbackでx_post_delete 0.005、dry_runで台帳0行。doc影響なし（要件04 §10・§02 §3.17が既に規定・本番コード変更なし）。

### T-M6-11: プラン変更のBYOK⇄premium切替副作用（キー再検証・Xアカウントexpired化・再連携バナー） `done`
- 参照: 要件03 §6、要件02 §4.1、要件06 §2、要件06 §9、A-6、O-1 / 依存: M1、T-M6-01、T-M6-02 / サイズ: M
- 完了条件:
  - premiumへのplan変更イベント処理後（モックwebhook＋ローカルDB）、auth_type=byokのアカウントがexpiredになり、user_api_keysは削除されない
  - premium→md変更でmanaged認可アカウントがexpired化され、ai_purpose_configの無効providerが未設定へ戻る。standardへの変更でactive 1件以外がdisabledになる
  - expired中のアカウントに対する投稿・自動実行系Actionが拒否され、App Shellに再連携バナーが表示される
- メモ: 分担：M1のプラン変更タスクはStripe webhookのplan/subscription_status同期とstripe_events冪等処理までを担当。本タスクはwebhook同期後の同一処理として実行する切替副作用を担当する。(1) standard/md→premium: BYOK認可のx_accountsをexpired化（BYOKキーは削除しない）、AIは運営キーへ切替。(2) premium→standard/md: managed認可アカウントをexpired化し、ai_purpose_configのtext/imageを登録済みvalidキーで再検証（無効なら未設定へ戻し初期設定ガイドへ誘導）。(3) md/premium→standard: active_x_account_idの1件以外をdisabled化（active未設定はcreated_at最古のactive 1件維持）。App Shellへ再連携要求の常設バナーを追加し、再連携まで閲覧・編集は許可・投稿と自動実行は停止。
- 実装結果: 副作用本体はM1で実装済みだった。`subscription-sync.ts` `applyPlanTransition`（→premium: byok→expired／premium→: managed→expired＋`revalidateByokPurposeConfig`でai_purpose_config再検証／standard: `applyStandardAccountLimit`でactive1件以外disabled＋active_x_account_id再選択）が条件1・2を満たし`plan-transition.db.test.ts`で検証済み（user_api_keys非削除も確認）。条件3のバナーは`app-banners.ts` `computeXAccountBanners`（auth_type不一致→x_authtype／expired・error→x_status）がApp Shell（`app/app/layout.tsx`でxBanners.map描画）で表示済み・`app-banners.test.ts`で検証済み。自動実行の拒否は`schedule-enqueue.ts` isEligibleが`status='active'`のみenqueueで担保済み。**本タスクの追加**：手動投稿`publishDraft`が下書きの所属x_accountのstatusを見ておらず（active_x_account以外の下書きでも、別のactiveアカウントがあればprereq通過し投稿可能な穴）expiredアカウントの下書きを投稿し得たため、`xa.status != 'active'`なら`x_account_required`（details missing/settingsPath/reason）で拒否するガードを追加。テスト2件（expired/disabled）。doc影響なし（要件06 §2・要件05 §2.2が投稿停止・x_account_requiredを既に規定）。※enqueue後→dispatch前にプラン変更でexpired化する狭いraceはexecutePostPublish未ガード（自動同意再確認で部分緩和・別途検討可）。

### T-M6-12: premium残量表示（ホーム・設定）と上限到達エラー表示 `done`
- 参照: O-4、要件03 §8、SC-05、SC-11、要件06 §10 / 依存: T-M6-03、T-M6-06、M4 / サイズ: M
- 完了条件:
  - premiumユーザーのSC-05とSC-11に4枠のused/limit/remainingが表示され、standard/mdユーザーには表示されない
  - 上限到達時のエラー表示に残量と翌月開始日時（JST）が含まれ、既存下書き・履歴の閲覧は引き続き可能
- メモ: premiumのみusage_countersから当月の4枠（normal_posts/url_posts/generations/images）のused/limit/remainingを要件03 §8のJSON形状で算出し、SC-05ホームとSC-11設定へ表示。usage_limit_exceededエラーの画面表示には残量と翌月開始日時（JST）を含め、既存下書きの閲覧は許可する（要件06 §10）。SC-05の土台はM4までに実装済みの想定。
- 実装結果: 純関数`usage-summary.ts`（`computeUsageSummary`＝§8 JSON形状 used/limit/remaining、remainingは0クランプ／`nextMonthStartJst`・`formatNextMonthStartJst`＝翌月1日00:00 JST・12月→翌1月繰上げ）＋server loader`usage-summary-server.ts`（`loadUsageSummaryForUser(userId, plan)`＝premiumのみ当月JST usage_counters読取、非premium/行なしは全0）を追加。表示専用の`UsageSummaryCard`（4枠 used/limit/remaining＋バー、remaining=0枠に「上限到達（残り0）・{翌月開始日時}にリセット・閲覧編集は継続可」の到達エラー表示）をSC-05ホーム（`app/page.tsx`）とSC-11設定・課金プランタブ（`settings/page.tsx`）へpremium限定で描画。テスト: 純関数8件（JST境界含む）＋DB loader 3件（premium/非premium null/行なし全0）。UIはtsc/lint/build検証（コンポーネントテストなし）。doc影響なし（要件03 §8・要件06 §10・SC-05が既に規定）。上限到達エラー表示は本カードの到達notice（残量0＋翌月開始日時＋閲覧可）で実現。投稿画面インラインでの動的表示や100%常設バナー・通知はT-M6-13が担当。

### T-M6-13: 利用枠80%/100%通知と常設バナー `done`
- 参照: O-4、要件03 §8、要件02 §3.15、要件02 §4.3 / 依存: T-M6-12、M5 / サイズ: M
- 完了条件:
  - counterが80%を跨ぐ更新でusage通知が枠・月ごとに1件だけ作成され、再更新・再実行で重複しない（dedupe_key検証）
  - 100%到達で全/app画面に常設バナーが表示され、notification_configでusageをOFFにしてもバナーは表示される（メールは作られない）
- メモ: counter更新後に閾値を判定し、80%到達は各枠・各月1回のusage通知（dedupe_key例: usage:{month}:{counter_type}:80）、100%到達は通知＋常設バナー。100%バナーはnotification_configにかかわらず表示し、メール・通知一覧作成は設定を尊重。決済失敗・契約停止バナーはM1側の実装を前提とし、本タスクは利用枠100%のみ追加。通知基盤（notifications・メール送信）はM5想定。
- 実装結果: (A)`usage-threshold.ts` `notifyUsageThresholds(db,{userId,key,newCount})`＝閾値80%(ceil(limit×0.8))・100%(limit)以上の枠へ'usage'通知を挿入。dedupe_key `usage:{JST月}:{key}:{80|100}`をSQL内で構築し on conflict(user_id,dedupe_key) do nothing で枠/月/閾値ごと1件。`notification_config->'usage'`のin_app/emailを尊重（両OFFなら行を作らない＝メールも作らない）。counter更新と同一tx。`reserveUsage`（generation/image）と`consumePostSlot`（post_normal/post_url）の increment を `returning {col}` にして直後に呼ぶ（既存の冪等early-returnはnotifyより前なので二重発火なし）。(B)`app-banners.ts` `usageLimitBanner(summary)`＝remaining=0枠があれば常設バナー（notification_config非依存・データ駆動）。App Shell（layout.tsx）が`loadUsageSummaryForUser`(premium限定)→バナーを全/app画面へ描画。テスト: 純関数閾値4件＋DB(dedupe/config OFF/email queued/reserve端到端)4件＋banner 3件。敵対的レビュー2観点で欠陥なし（idempotency・JST月一貫・config尊重・$3二重cast・React key）。doc影響なし（要件03 §8が80%/100%通知＋config非依存バナー＋メール設定尊重を既に規定）。

### T-M6-14: 公開法務3ページの実装（/terms・/privacy・/legal/commercial-transactions） `done`
- 参照: 要件06 §11、要件01 §4、PRD §7、O-1 / 依存: M0 / サイズ: M
- 完了条件:
  - /terms・/privacy・/legal/commercial-transactionsが未ログインで表示される
  - 特商法ページに要件06 §11の事業者情報が全項目表示される
  - /termsに料金・7日trial・自動更新・解約条件・生成コンテンツの最終責任・上限見直し条項が含まれる
- メモ: 認証不要の公開routeとして3ページを実装。/termsは提供条件・禁止事項・X/生成コンテンツの責任（最終責任はユーザー）・料金・7日trial・自動更新・解約・停止免責・premium上限の見直し条項・改定・問い合わせ。/privacyは取得情報・利用目的・外部委託とAI/X APIへの送信・国外取扱い・保持削除・安全管理・開示等窓口。特商法表記は要件06 §11の事業者情報表（販売事業者・所在地・問い合わせ先・電話番号開示方針・返金・解約）を正とする。文面の専門家確認は人間側作業（open_questions参照）。
- 実装結果: 3ページはM0/M1で骨格実装済みだった（`src/app/{terms,privacy,legal/commercial-transactions}/page.tsx`・いずれも /app 配下外の認証不要routeで、build上 ○ Static prerender＝未ログイン表示を確認）。特商法ページは §11 事業者情報全項目＋価格/支払時期/提供時期/自動更新/解約/返金を網羅済みで、不足の**動作環境**を追加。/termsは料金・7日trial・自動更新・解約・生成コンテンツ最終責任を網羅済みで、不足の**Premium利用枠の見直し条項**と**お問い合わせ**を追加（§11 /terms最低内容＋完了条件3を充足）。/privacyは §11 最低内容（取得/目的/外部送信/国外/保持削除/安全管理/開示窓口）を網羅済みで変更なし。文面は全ページ「暫定版・公開前に法務確認」を明示。CURRENT_TERMS/PRIVACY_VERSIONは据え置き（実文面確定＋version確定は法務確認の人間作業・要決定M1）。doc影響なし（要件06 §11が内容を規定・本タスクは§11への準拠補完）。

### T-M6-15: 法務導線の接続（footer・signup同意リンク・Checkout直前再掲） `done`
- 参照: 要件06 §11、要件01 §4、要件03 §1、要件03 §2.1、A-1 / 依存: T-M6-14、M1 / サイズ: S
- 完了条件:
  - LP・signup・plans・アプリ設定のfooterから法務3ページへ到達できる
  - signupの規約同意とプライバシー確認が別checkboxで、各リンクが新タブで開く
  - Checkout開始直前の画面に税込料金・trial・自動更新・解約条件が再掲される
- メモ: LP・会員登録・プラン選択・アプリ設定のfooterから3ページへ到達可能にする。signupは利用規約同意checkboxとプライバシー確認checkboxを別々に表示し、リンクを新タブで開く（version保存自体はM1実装済みの想定。現行version定数と実ページの紐付けを行う）。plans→Checkout直前に税込料金・7日trial・自動更新・支払時期・解約方法を再掲し、LP/plansから特商法表記へ容易に到達できるようにする。
- 実装結果: 共通`LegalFooter`（3法務ページ＝利用規約/プライバシー/特商法へのリンク）を新設し、LP（`app/page.tsx`）・会員登録（`signup/page.tsx`）・プラン選択（`plans/page.tsx`）・アプリ設定（`settings/page.tsx`）へ配置＝条件1充足（footer付与のため各pageをflex-col化）。条件2（規約同意/プライバシー確認の別checkbox＋新タブリンク target=_blank rel=noopener）はM1で実装済みを確認（signup-form.tsx・terms_accepted/privacy_acknowledged）。条件3（Checkout直前の税込料金・7日trial・自動更新・支払時期・解約・提供開始の再掲＋特商法リンク）はplans pageにCheckoutButton直前で実装済みを確認。UIはtsc/lint/build検証（3法務route静的生成）。doc影響なし（要件06 §11がfooter到達性・signup別checkbox・Checkout直前再掲を既に規定）。LP骨格はT-M6-16で刷新予定だがfooterは引き継ぐ。

### T-M6-16: LP（SC-01）の実装 `done`
- 参照: SC-01、要件06 §1、PRD §6、PRD §7、要件01 §4 / 依存: T-M6-14、M0 / サイズ: M
- 完了条件:
  - `/`が未ログインで表示され、提供価値・3プラン税込価格・BYOKの別途API費用負担の明示・/signup導線を含む
  - モバイル幅で本文の横スクロールが発生しない
  - footerから法務3ページへ遷移できる
- メモ: `/`に提供価値、3プラン比較（税込500/1,000/2,980円・7日trial）、BYOKプランはX API・生成AI APIの利用料が別途ユーザー負担であることの明示、premiumはキー不要であること、/signupへの登録導線、法務ページfooterを実装。レスポンシブ対応（PC＋スマホ閲覧）。
- 実装結果: M0プレースホルダ `/`（`app/page.tsx`）を実LPへ刷新。ヘッダ（ログイン導線）／Hero（提供価値見出し＋APP_DESCRIPTION＋「無料で始める」→/signup・「プランを見る」→/plans）／できること4項目（収集・生成・自動投稿・分析）／料金3プラン（PLANSから税込500/1,000/2,980円・Xアカウント上限・7日trial明示、BYOK=standard/mdは「X API・生成AI API利用料が別途ユーザー負担」をamber注記、premiumは「APIキー不要・追加API費用なし」をemerald注記）＋末尾に/signup導線。CTAは`buttonVariants`（Buttonはaschild非対応）。footerは共通`LegalFooter`（T-M6-15）で3法務ページへ。レスポンシブ: max-w-6xl/px-4/`sm:grid-cols-*`/flex-wrap で横スクロールなし。build上 `┌ ○ /`＝Static prerender（未ログイン表示）を確認。doc影響なし（要件06 §1 SC-01が内容を規定）。UIはtsc/lint/build検証。

### T-M6-17: セキュリティヘッダ・cookie属性の仕上げ（CSP/HSTS/nosniff/Referrer-Policy） `done`
- 参照: 要件01 §8、PRD §7 / 依存: M0 / サイズ: M
- 完了条件:
  - productionビルドのローカル起動で全応答にnonceベースCSP・nosniff・Referrer-Policyが付与され、nonceなしinline scriptが実行されない
  - HSTSがproduction相当設定で付与され、認証・OAuth補助cookieにHttpOnly・SameSite=Lax（productionはSecure）が付く
- メモ: nonceベースCSP（frame-ancestors 'none'・object-src 'none'を含む）をmiddlewareで実装し、productionでHSTS・X-Content-Type-Options: nosniff・厳格なReferrer-Policyを付与。production cookieはSecure、認証・OAuth補助cookieはHttpOnly・SameSite=Laxを既定化。既存画面のinline script/styleをnonce対応へ修正。
- 実装結果: このNext(v16)は`middleware.ts`ではなく`proxy.ts`規約で、既存`proxy.ts`→`updateSupabaseSession`が唯一のproxy経路。新設`src/lib/security-headers.ts`（nonce生成・CSP構築・応答ヘッダ付与、next非依存でunit可）を`updateSupabaseSession`へ配線：request headerへnonce+CSPを載せNext.jsに自身のscript/`next/script`(Turnstile)へnonce付与させ、全応答（通常・redirect）へCSP・nosniff・Referrer-Policy（prodはHSTS）を付与。`script-src 'self' 'nonce' 'strict-dynamic'`（'unsafe-inline'無し=nonceなしinline script非実行）、`style-src 'self' 'unsafe-inline'`、`img-src https:`（Xアバター/Storage画像）、Turnstile/Sentryを許可、`frame-ancestors/object-src 'none'`。**静的prerenderはnonce付与不可のため**公開コンテンツ4ページ（LP・法務3）を`force-dynamic`化。cookie（auth/OAuth/billing）はHttpOnly/SameSite=Lax/Secure(prod)を既存setterで確認済み。**runtime検証**: `next build`→`next start`で`/`（動的化後nonce 16件付与）・`/login`（nonce付与）に全ヘッダ付与、HSTS(prod)・img-src https: をcurlで確認。テスト: security-headers 10件＋update-session既存4件パス。doc: 要件01 §8にADR参照追記＋ADR-0005新設（CSP実装方針）。

### T-M6-18: ログredactとServer only境界・安全なエラー変換 `done`
- 参照: 要件01 §8、プロンプト §5.6、要件03 §1、要件02 §5 / 依存: M0、M3 / サイズ: M
- 完了条件:
  - redactユーティリティのユニットテストで対象フィールド（Authorization・cookie・キー・token・prompt・投稿前入力）がマスクされる
  - 秘密値参照moduleをClient Componentからimportするとビルドが失敗する
  - provider例外がユーザー応答でコード化された安全なメッセージへ変換され、レスポンスにstack trace・provider本文が含まれない
- メモ: Sentry beforeSend・共通loggerでAuthorization・cookie・APIキー・token・prompt全文・投稿前の非公開入力をredactする。service role・APP_ENCRYPTION_KEY・providerキー・OAuth tokenを参照するmoduleへ`server-only`を導入しClient Componentからのimportをビルドエラー化。ユーザー向けエラーへprovider本文・stack traceを出さない共通変換層を全Server Action/API/workerへ適用。
- 実装結果: 基盤はM0-M3で実装済みだった。(1) redact `observability/redact.ts`＋`sentry.ts` beforeSend＝Authorization/cookie/token/secret/password/api_key/credentials/prompt/base_md/投稿前入力/nested/arrayをマスク、`redact.test.ts`で全項目検証済み。(3) `observability/errors.ts` `toUserFacingError`＝AppErrorは安全なcode+日本語message、未知（provider例外含む）はinternal_errorへ畳んでstack/provider本文を出さない。`errors.test.ts`でstack非漏洩・cause非公開を検証済みで、Server Action 15/18がこれを使用（残る3=auth-state型定義のみ・legal-consent/authは固定安全文言＋catch握り潰し）。**本タスクの追加**: 秘密値をenvから直接読むのに`server-only`が無かった`jobs/auth.ts`（`process.env.CRON_SECRET`）・`jobs/dispatch.ts`（CRON_SECRET/APP_BASE_URL）へマーカーを追加。`server-boundary.test.ts`を**動的走査**へ刷新（src/lib全走査で env秘密読取/createSupabaseAdminClient/getEncryptionKey を参照するモジュール＝現17件が`import "server-only"`を持つことを強制、regression検出）。純粋core（decrypt注入・env秘密を直接読まない`*.ts`）は対象外＝既存アーキテクチャ通り。build成功で新マーカーがclient transitive importを壊さないことを確認。doc影響なし（要件01 §8が境界・redact・安全エラー変換を既に規定）。

### T-M6-19: Supabase論理バックアップのスクリプトと復元手順 `done`
- 参照: 要件01 §9 / 依存: M0 / サイズ: S
- 完了条件:
  - backupスクリプトがローカル/開発DBに対して暗号化済みdumpファイルを生成する
  - 手順書どおり空のローカルDBへ復元し、schema・seedデータが元と一致する
- メモ: Supabase Free運用向けに`supabase db dump`による論理backupスクリプト（AES等で暗号化しSupabase外へ保存する形式）と、復元手順・週1回＋schema変更前の運用手順を整備する。RPO最大7日・RTO best effortを手順書へ明記。実行環境（常時稼働Mac等）と保存先の用意は人間側作業（open_questions参照）。
- 実装結果: `scripts/db-backup.sh`（`pg_dump --no-owner --no-privileges "$DATABASE_URL"`→`openssl enc -aes-256-cbc -pbkdf2 -salt`でBACKUP_ENCRYPTION_KEY暗号化→`$BACKUP_OUT_DIR/spaceai-{ts}.sql.enc`）と`scripts/db-restore.sh`（openssl復号→`psql "$TARGET_DATABASE_URL"`）を新設。npm `db:backup`/`db:restore`、`.gitignore`へ`backups/`・`*.sql.enc`追加（漏洩防止）。ツールは`supabase db dump`ではなく**pg_dump採用**（フル論理dumpで復元互換・空DBへ0エラー相当で復元、supabase db dumpはCLI依存でschema寄り）。運用メモ`docs/operations/database-backup-restore.md`新設（前提PG17クライアント＋openssl・週1＋schema変更前・RPO≤7日/RTO best effort・復元/検証手順・非superuser復元時の`vault.secrets`/`log_min_messages`権限エラーは無害と明記）。**検証**: ローカルSupabase(PG17.6)で実スクリプトをpg_dump/psql（container 17.6）経由で実行、暗号化dump（Salted__始まりの暗号文・平文SQLでない）→空DBへ復元→public 18テーブル・prompt_templates seed 7件が元と一致を確認。doc: 要件01 §9をpg_dump採用＋運用メモ参照へ更新（v1.8）。実行環境・保管先・鍵管理は人間側作業。

### T-M6-20: リリース判定テストスイート（dependency audit・RLS・認可/CSRF/SSRF） `done`
- 参照: 要件01 §8、要件02 §5、要件05 §11、要件05 §12 / 依存: T-M6-17、T-M6-18、M0 / サイズ: M
- 完了条件:
  - 一括実行コマンドがCI相当環境（ローカル）ですべて成功する
  - RLSテストが別ユーザーからのselect/write拒否をユーザー所有テーブル全般で検証する
  - SSRFテストがprivate IP直指定とredirect先private IPの両方の拒否を検証する
- メモ: リリース判定に必要なテスト群を一括実行可能にする：dependency audit（npm audit相当）、RLS policyテスト（別ユーザーからのユーザー系テーブルselect/write拒否）、認可テスト（CRON_SECRET欠落時のcron/jobs拒否・Stripe署名不正拒否・Origin検証・plan別403）、SSRF検証テスト（出典URLのprivate/loopback/link-local IP拒否・redirect先再検証・timeout 10秒）。
- 実装結果: 個別テストは既存（RLS `db/rls.db.test.ts`、SSRF `post/source-url.test.ts`＝private/loopback/link-local＋DNS rebinding＋redirect先再検証＋timeout、認可 `api/cron/route-auth.test.ts`・`jobs/auth.test.ts`・`api/jobs/run/route.test.ts`・`stripe/webhook.test.ts`）。本タスクの追加: (条件1) 一括実行 `npm run release:check`＝typecheck→lint→audit:check→test（全db含む）→build を新設し、ローカルで全成功を確認（exit 0）。(dependency audit) `scripts/audit-check.mjs`＝`npm audit --json`を解析し critical は必ず、high は allowlist（next/postcss/sharp＝breaking upgrade待ちの既知high・D-7で追跡）外なら失敗。moderate/lowは報告のみ。現状 critical=0/high=3(全allowlist)でOK。(条件2 全般) `rls.db.test.ts`へ横断catalogチェック2件追加＝全public tableでRLS有効（別userのselect構造的遮断）＋authenticated roleに全public tableでINSERT/UPDATE/DELETE grant無し（別userへのwrite不可）。既存の個別isolation/write-denialに横断保証を追加。doc影響なし（要件05 §11/§12・要件02 §5・要件01 §8が対象を既に規定）。既知脆弱性の解消（breaking upgrade）は要決定D-7。

### T-M6-21: リリース前チェックリストの作成と消化（dry_run→live切替・公式ドキュメント再確認） `done`
- 参照: 要件01 §3.1、要件01 §7、要件01 §9、PRD §8.1、要件定義 §7、運用メモ §2〜4、要件03 §9、プロンプト §5.7 / 依存: T-M6-20、T-M6-19、T-M6-15、T-M6-16、T-M6-08、T-M6-10、T-M6-11、T-M6-13 / サイズ: M
- 完了条件:
  - チェックリストがdocs/配下に存在し、開発側で消化可能な全項目に結果が記録されている（人間側残項目は担当と期日欄付きで明示）
  - dev/preview相当のAPP_ENVでX_POSTING_MODE=liveを設定すると起動時検証が失敗することをローカルで確認済み
  - dry_run→live切替手順・rollback手順・backup初回取得の確認項目が消化済み
- メモ: リリース前チェックリストを作成し、開発側で消化可能な項目を実施・記録する：X_POSTING_MODEのdry_run→live切替手順とrollback手順（prodのみlive可・dev/previewはdry_run必須の起動時ガードが未実装なら本タスクで実装）、環境変数一覧（要件01 §3）の環境別充足確認、X API（docs.x.com）・Stripe・AI各社の「実装時に要確認」注記項目の再確認結果の記録（Stripe APIバージョン・Portal Configuration方針は実装メモ/ADRへ）、backup初回取得確認、launchd→Vercel Cron移行条件・手順の確認。Developer Console単価確認・法務専門家確認など運営者アカウントが必要な項目はチェックリスト上の人間側残項目として明示する。
- 実装結果: `docs/operations/release-checklist.md` を新設。§1に開発側消化済み10項目（release:check全成功・X_POSTING_MODE=live起動時ガード・backup round-trip・セキュリティヘッダ・RLS/SSRF/認可・server-only境界・redact/安全エラー・env dev充足・launchd→Cron手順・外部API注記の実装時確認）を根拠付きで記録、§2にdry_run→live切替手順＋rollback手順、§3に人間側残項目12件を担当（運営者/開発）・期日欄付きで明示。X_POSTING_MODE=live起動時ガードは既存（env-schema.ts superRefine＋env-schema.test.ts 3件、dev/preview reject・prod allow）を確認・記録。doc影響なし（要件01 §3.1がガードを既に規定・チェックリストは新規運用メモ）。人間側残項目は要決定・外部準備セクションが正本。

## M7: UX改善の後続（全画面UX監査 2026-07-26 の残件）

全画面のUX監査（10領域並列・60指摘）で洗い出した改善のうち、UI改善サイクルで扱いきれなかった残件。
先行して実装済みの内容は `git log --grep="feat(.*):"`（2026-07-25〜26）を参照。

### T-M7-01: ローカルDBに残る旧テスト残骸の掃除 `done`
- 参照: 要件02 §5 / 依存: なし / サイズ: S
- 完了条件:
  - ローカルSupabaseに残る 2026-07-24 由来の孤児レコード（handle='h' の x_accounts 4件、running のまま放置された learning_analysis job 2件）が消えている
  - フルスイート（`npm test`）が緑のままで、削除がテストのfixture前提を壊していない
- メモ: DBテストが後片付けし損ねた残骸。実データではなくローカル検証環境のみの掃除。今後の再発防止として、残骸を作るテストがどれか特定できれば併せてcleanupを補う。
- 実装結果: ローカルSupabaseのみを対象に、合成テストデータを依存順（external_api_usage_events→notifications→user_api_keys→usage_counters→usage_events→x_accounts→auth.users）で削除。内訳は `handle='h'` の x_accounts 4件＋その依存、UUID合成メール等の auth.users 2457件（`%@example.com` かつ UUID形式/tm10*/verify-*/e2e-* のみを対象）。**実メールアカウント（no.1013kota@gmail.com）とその通知83件は対象外として保持**。削除後 x_accounts/generation_jobs/drafts/schedule_slots はいずれも0件、`npm test` 1154件緑（fixture前提を壊していない）。再発防止調査: 残骸を作り得る *.db.test.ts 19ファイルはいずれも `delete from auth.users` の後片付けを持っており、コード上の欠落ではなく2026-07-24のテスト中断・失敗時の取り残しと判断（コード修正は不要）。

### T-M7-02: job失敗時に必ず原因を残す（runJobの汎用finalizer最小対応） `done`
- 参照: 要件06 §10、要件04 §4 / 依存: なし / サイズ: M
- 完了条件:
  - handlerがerrorを保存する前にthrowした失敗でも `generation_jobs.error` に code と利用者向け message が残る
  - handlerが既に保存したerrorを上書きしない（冪等）
  - 画面（投稿作成の結果ペイン）で汎用文ではなく保存された理由が表示される
- メモ: 現状 `runJob`（worker.ts）は throw 時に `status='failed'` だけを書き、error jsonb を書かない。post-generation 等は persistFailure で自前保存するが、provider設定エラー等はその前に throw するため error=null になり、UIは「生成に失敗しました。時間をおいて再試行してください。」しか出せない（2026-07-26のE2Eで実確認）。要決定 D-5（中央finalizer化）の全面対応は行わず、上書きしない最小追加に留める。
- 実装結果: `worker.ts` の catch を `failJob(jobId, kind, error)` に置換。`update ... set error = coalesce(error, jsonb_build_object(...)) where id = $1 and status = 'running'` で**handler保存済みerrorを上書きせず**、running以外（自己終端・stale回収）も触らない。理由の組み立ては `terminal.ts` の `fallbackJobError(kind, error)`＝ codeは `AppError.code`／handler例外の `code` のうち `^[a-z][a-z0-9_]{0,62}$` に一致するものだけ採用（`23505`・`ECONNREFUSED` 等は棄却）、非該当は `job_failed`。messageは既知ErrorCodeなら `userMessageForCode`、それ以外は `FAILED_NOTICE[kind]`／既定文で、**例外messageやproviderの生値を混ぜない**（`isErrorCode` を `observability/errors.ts` に追加）。併せてlease時に `error = null` を入れ、前attemptの理由が現在の実行結果として残らないようにした。UI側は `create-post-form.tsx:390` が既に `job.error?.message` を優先表示するため配線変更は不要。テスト+9（terminal 5・worker.db 4）、全1163件緑。
- 後続への注意: これは D-5 の**最小対応**であり、retryable判定によるbackoff付きqueued差し戻し・失敗通知・usage refund の中央化は未実施（stale経路のみ `finalizeFailedJob`）。`fallbackJobError` は D-5 本対応時に中央finalizerへ取り込む想定。`post-generation.ts` の worker失敗通知 dedupe が `job:{id}:error`（§14は `:failed`）である既存不整合も D-5 で統一する。

### T-M7-03: ホーム（SC-05）に次回の予定と直近の実績を表示 `done`
- 参照: 要件06 §1 SC-05、要件06 §10 / 依存: なし / サイズ: M
- 完了条件:
  - 有効スケジュールがあるとき「次回の予定（日時・パターン・自動/下書きの別）」がホームに出る
  - 直近の投稿実績サマリが出る（0件時は次の一手を示す空状態）
  - 前提未設定・スケジュール未登録それぞれで行き止まりにならない導線がある
- メモ: 現状ホームは初期設定ガイド・確認待ち・利用枠の3カードのみで、要件06 §10 が求める「予定・実績」が未実装。次回実行の算出は `src/lib/schedule/next-run.ts` の `nextScheduleRun` を再利用する。
- 実装結果: ホームに「次回の予定」「直近の実績」カードを追加（確認待ちと利用枠の間）。予定は純関数 `lib/home/overview.ts` の `scheduleOutlook`（有効スロットのみ `nextScheduleRun` で算出→時刻昇順→最大3件、`no_slots`／`all_disabled` を区別）。実績は `lib/home/overview-server.ts` の `loadRecentPosts`（posted を最大3件・本文冒頭・先頭tweet_id）＋ SC-09 と同じ `getAnalyticsSummaryForUser(…, 7)`。**未計測は0でなく「未取得」**表示（§8の `--`＝取得不能と区別）。初期設定が未完了なら予定カードに「時刻になっても実行されません」警告＋「次にやること」と同じ設定画面への導線。テスト+4（`overview.test.ts`）、全1167件緑。ブラウザ実確認: 予定の並び順・停止中除外・警告表示、全停止／未登録／実績なしの各空状態、履歴deep-linkとXリンク、390px幅で横スクロールなし。
- 後続への注意: 要件06 §1 の SC-05 に挙がる**「重要ニュース」カードは未実装**（§1.4 に未実装と明記）。実績カードは1日checkpointのみを見るため、30日checkpointしか無い古い投稿では「未取得」になる（ホームは直近7日前提）。

### T-M7-04: 分析（SC-09）の既定計測時点・投稿の識別・提案の鮮度 `done`
- 参照: 要件06 §8、要件06 §10 / 依存: なし / サイズ: M
- 完了条件:
  - 既定の計測時点が「その時点の実績を持つ投稿が最も多い時点」になり、直近投稿が空表に見えない
  - 各投稿カードから本文冒頭とXポストへのリンク、投稿履歴へのdeep linkで対象を識別できる
  - 改善提案の最終更新時刻が分かり、生成中は完了まで自動で反映される
- メモ: 用語の平易化（checkpoint→実績を見る時点 等）と未取得/取得不能の区別は 2026-07-26 に対応済み。残りは既定値・識別性・鮮度。`loadAnalyticsForUser` のselectに thread と handle を追加する必要がある。
- 実装結果: (1) **既定の計測時点を仕様変更**。「取得済みの最長」→「その時点の実績を持つ合算対象ポストが最も多い時点（同数なら長い方）」＝ `analytics.ts` の `mostMeasuredCheckpoint`。古い1件が30日を持つだけで直近投稿が空表に見える問題を解消（要件06 §8を更新）。(2) **識別性**: `loadAnalyticsForUser` の select に `d.thread` を追加し、`buildDraftAnalytics` が `tweet_ids` と同順で本文を割り当て（`TweetAnalytics.body`／`DraftAnalytics.excerpt`）。表のポスト列はtweet_id生値をやめ本文冒頭のXリンク（スレッドは `1/3` 付き）、カードに本文冒頭＋履歴deep-link。(3) **提案の鮮度**: 「最終更新 <日時>」を表示し、生成中は5秒間隔・最大24回で自動再取得（完了で自動反映、上限後は手動再読み込み）。併せて `{n}日checkpoint`→「投稿後{n}日の実績」、metric生値→日本語表記に修正（§8「内部用語を出さない」違反）。テスト+6、全1173件緑。ブラウザ実確認: 既定が1日に変わること、本文リンク/履歴リンク、最終更新表示、生成中→完了の自動反映（手動操作なしで7秒以内に切替）、390px幅で横スクロールなし。
- 後続への注意: 提案パネルのポーリングは client の `setTimeout`＋`router.refresh()`。job系の他画面（投稿作成）と方式が異なるため、共通化するなら別タスクで。`mostMeasuredCheckpoint` は一覧全体の既定用で、draft単位の `defaultCheckpoint` は別用途のまま残している。

### T-M7-06: ホーム（SC-05）に重要ニュースカード `done`
- 参照: 要件06 §1 SC-05・§1.4・§10 / 依存: なし / サイズ: S
- 完了条件:
  - 利用者のニュース設定の分野でインパクトが高い新着が、ホームに新しい順で数件表示される
  - 該当なし・取得失敗それぞれで行き止まりにならない（ニュース設定／SC-06への導線と注記）
- メモ: T-M3-26 が「重要ニュースはニュース側」と委譲したまま、M4のニュース系（T-M4-10〜15）で受け皿タスクが起票されず落ちていた分。PRDのスコープ外指定ではない。
- 実装結果: `src/app/app/important-news.tsx` `ImportantNewsCard`（server component・表示専用）。ホームは `getSettingsForUser` の `news_config.categories` ＋ `impacts: ["high"]` ＋ `limit 3` で `listNewsItemsForUser` を呼ぶ（`impact_filter` はSC-06一覧用のためホームでは使わず常に high）。カード順は要件06 §1のカタログに合わせ 予定→重要ニュース→実績。分野ラベルは既存の `themes.ts` `newsCategoryLabel` を再利用。取得失敗は try/catch して「更新できなかった」注記に落とす（ホーム全体を落とさない）。ブラウザ実確認: high 3件のみ表示・low除外・新しい順、分野を絞った空状態（ニュース設定＋SC-06導線）、390px幅で横スクロールなし。全1173件緑・E2E 4件緑。
- 後続への注意: `news-browser.tsx` は独自の `CATEGORY_LABEL` マップを持っており `newsCategoryLabel` と重複している（次のリファクタ枠で統合候補）。ホームは常に high 固定のため、「mid も出したい」という要望が出たら `news_config` に別項目を足すか §1.4 の仕様を変える判断が要る。

### T-M7-05: 自動E2E基盤（Playwright）の導入 `done`
- 参照: 要件01 §7、要件06 全般 / 依存: なし / サイズ: L
- 完了条件:
  - `npm run test:e2e` 相当でリポジトリ管理のE2Eシナリオが実行でき、全assertionが通る
  - 認証済み状態・Xアカウント連携済み状態のfixtureを再現でき、実行後に作成データだけを片付ける
  - 安全既定（`APP_ENV=development`・`X_POSTING_MODE=dry_run`・ローカルSupabase）から外れた環境では実行を止める
- メモ: 現在は自動E2Eが無く、`/verify-e2e` は playwright-cli による探索的確認どまり（「E2E合格」と呼べない）。fixtureのX tokenは `APP_ENCRYPTION_KEY` での封緘が必要、後片付けは `base_md_versions`→`x_accounts` のFK順に注意（2026-07-26の検証で判明）。最初のシナリオ候補: 下書き→dry-run投稿→履歴、スケジュール停止→再開、初期設定ガイドの出し分け。
- 実装結果: `@playwright/test` を devDependency に追加し、`playwright.config.ts`（testDir=`e2e/`・workers 1・baseURL 127.0.0.1:3000・devサーバーは `reuseExistingServer`・失敗時のみtrace/screenshot）と `npm run test:e2e`（`node --env-file-if-exists` で .env/.env.local を読む）を用意。**安全ゲート** `e2e/fixtures/guard.ts` を globalSetup にし、`APP_ENV=development`／`X_POSTING_MODE=dry_run`／Supabase・DB・baseURLがローカル／`APP_ENCRYPTION_KEY`・`SUPABASE_SERVICE_ROLE_KEY` の存在を検査、外れたら1件も動かさず中止（`X_POSTING_MODE=live`・`APP_ENV=production` で中止することを実確認）。**fixture** `e2e/fixtures/account.ts` は service role で確認済みユーザー＋premium/trialing＋active Xアカウント（tokenは `encryptWithKey`＋`resolveKey` で封緘した偽値）を作り、終了時に作成分だけをFK順で削除する（`usage_events` 等の参照元を列挙）。ログインは Turnstile テストキーのtokenが hidden input に入るまで待ってから送信する。**シナリオ4件**（ホーム: 初期設定ガイドと空状態の導線／有効スロットの次回表示と全停止／SC-08 停止→再開のDB追従／下書き→確認ダイアログ→dry-run投稿→posted・履歴のXリンク）が全て緑、実行後の残データ0件を確認。vitest は `src/**/*.test.ts` のみを見るため衝突なし。
- 後続への注意: **`e2e/**` は eslint の `react-hooks/rules-of-hooks` を無効化**（Playwrightのfixtureが取る `use` コールバックを誤検知するため）。CIで動かすには `npx playwright install chromium` とローカルSupabase起動が前提。実行結果（`test-results/`・`playwright-report/`）は gitignore 済み。今後シナリオを増やすときは fixture の削除対象テーブル一覧の追随を忘れないこと。
