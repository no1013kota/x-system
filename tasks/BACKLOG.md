# 開発バックログ

Exos AI MVPの作業キュー。エージェントループ（/dev-loop）はこのファイルを読んでタスクを選択する。

## 運用ルール

- ステータス: `todo` → `doing` → `done`。外部要因で進められないものは `blocked`（理由を明記）
- WIP = 1（`doing` は常に1件以下）。1タスク = 1コミット
- 優先順: 上のマイルストーン・上のタスクほど優先。「依存」のタスクが `done` でないタスクには着手しない（`M0` のような依存はそのマイルストーンの全タスク完了を意味する）
- タスクの追加・分割・並べ替えは自由（参照の要件IDは保持する）。完了タスクは消さず `done` にし、後続に影響する判断があれば「メモ:」へ追記する
- ユーザーに判断・準備してほしいことは「要決定・外部準備」に追記する
- 書式: `### <ID>: <タスク名> \`<status>\`` ＋ 参照/依存/サイズ行 ＋ 完了条件

## 現在の状況と次の一手（2026-08-14 更新）

M0〜M8は実質完了。**2026-08-14、本番（`exosai.net`）へ初回デプロイした**。それまで production は
Supabase が停止・DBが完全に空・有効な本番デプロイが1つも無い状態で、`main` は207コミット遅れていた。
PR #7（`stg` → `main`）で全機能・法務3ページ・改称（Exos AI）・LP刷新・全体リファクタが本番へ入った。

> **本番へ出して初めて分かったこと**: 公開9ページを実ブラウザで確認したところ、
> **`/signup` と `/reset-password` が機能していなかった**（scriptタグ16本すべてCSPで拒否＝会員登録も
> パスワード再設定も不可能）。HTTPは200を返し本文も表示されるため、URLを叩くだけでは分からない。
> 原因は静的prerenderとnonceベースCSPの非両立で、**ADR-0005 がこの因果を正しく書いていながら
> 適用先を手で数え上げていた**ため認証画面が漏れていた。T-M8-87 で修正し、ビルド成果物を走査する
> `npm run check:csp-nonce` を `release:check` へ組み込んだ。
> **E2Eは `next dev` で動きprerenderしないため、この不具合は原理的に検出できない**
> （[開発とテストの進め方](../docs/operations/development-and-testing.md) §11「ビルド成果物を走査する検査」）。

| 区分 | 残り | 場所 |
|---|---|---|
| 開発タスク（着手可） | **なし**（T-M8-68/69/84〜96/113〜119 すべて done・2026-08-17） | 下記M8セクション |
| 開発タスク（blocked） | 1件（T-M7-17 Gemini画像。運営者判断で一旦不要） | 同 |
| 要決定 | **なし**（2026-08-20 に D-19 を含む6件すべて解決）。**2026-08-20 に D-16（stgはPR必須なしの保護）・D-17（法務レビュー不要）・D-18（案A 本人の同意）・D-20（退会手順は対応しない）・D-29（案B 現状維持）を解決**。D-21〜D-26 は 2026-08-11、D-30 は 2026-08-16、D-27・D-28 は 2026-08-17 に解決済み。**D-19 は 2026-08-20 に解決（Sentry 90日固定を採用・プライバシーポリシーへ記載）** | 「要決定・外部準備」 |
| リファクタ | **なし**（R1〜R38 すべて done・2026-08-13） | [REFACTOR_PLAN](./REFACTOR_PLAN.md) |
| 外部準備（人間側） | **本番運用開始に残り1件**＝Xアカウント連携。**Stripeアカウントの本番有効化は2026-08-20に完了**（運営者。T-M8-148。これで契約の申し込みが通る）。ほか法務レビュー・単価確認。**Stripe WebhookのURLは2026-08-18に修正完了**（Stripe APIで確認: `https://exosai.net/api/stripe/webhook` が `enabled`・1件のみ登録） | 「要決定・外部準備」P-1／[リリース前チェックリスト §3](../docs/operations/release-checklist.md) |

**2026-08-18: 2回目の本番反映を完了した（PR #13・47コミット）。** migration 10件を適用。
**自動投稿の連鎖（T-M8-143）が初めて本番へ入った**——それまで `mode=auto` の予約は
下書きを作るだけで投稿されていなかった。データが壊れる不具合2件（T-M8-139/140）も解消。
`doctor` は緑（定時実行 2分前・ニュース48時間で45件・**請求額と表示額の一致** ¥500/¥1000/¥2980）。
認証メールの設定（カスタムSMTP・差出人名「Exos AI」・コード桁数6）は既に正しく、変更不要だった。
**破壊的な3本のmigrationは事前検算をすべて通過**（本番データが想定どおりだった）。
実物スモークはニュース取得のみ成功（$0.18）。生成・画像は**Xアカウント未連携のため未検証**。

**2026-08-19: 本番設定の点検結果（設定側の不一致は0件）。** 「コードは反映したが外部サービスの設定が
古い」型の見落としが無いかを、**相手側に問い合わせて**横断確認した（反映先URLへ curl するだけでは分からない）。

| 見たもの | 確認方法 | 結果 |
|---|---|---|
| Vercel 環境変数（47件） | Vercel API で production/preview を実測 | 全件登録済み。`X_POSTING_MODE`=production `live`／preview `dry_run`、`APP_BASE_URL`=`https://exosai.net`／stg、`X_DAILY_POST_LIMIT`=50／10。**環境の取り違えなし** |
| Supabase Auth 設定 | Management API と `scripts/auth-settings.mjs` の照合 | コード桁数6・有効期間1時間・レート制限3種すべて一致 |
| 認証メールのテンプレート2種 | 本文をリポジトリの `supabase/templates/*.html` と全文比較 | 件名・本文とも一致。`{{ .Token }}`／`{{ .TokenHash }}` あり |
| Site URL / Redirect URLs | 同上 | `https://exosai.net`・`https://exosai.net/**`。**localhost の混入なし** |
| Stripe Webhook | Stripe API（`webhook_endpoints`） | `https://exosai.net/api/stripe/webhook` 1件・`enabled`・必要な6イベントを含む9件を購読 |
| Stripe ポータル設定 | Stripe API | `active=true`・既定設定 |
| 定時実行4本 | Vercel Cron の実行痕跡（`cron_runs` と手動起動の応答） | 4本すべて当該時間窓を実行済み。**launchd には何も登録されていない**＝Vercel Cronが駆動している |
| 本番の状態確認 | `GET /api/cron/doctor` | 未連携のXアカウント以外すべて正常（費用 $6.10・DB 13MB/500MB） |

**教訓**: `X_POSTING_MODE` は正しかったが、**正しいことを誰も検査していなかった**（既定値があるため
欠けても起動し、画面は全部正常に見える）。T-M8-147 で `doctor` の項目に入れた。

- **`main` への直pushは branch protection で拒否される**（PR必須・必須チェック2本）。
  `stg` → `main` のPRは使えない（D-28: ツリー同一でSHA分岐）ので、
  **`main` から作業ブランチを切ってPR**にする。手順は [デプロイ手順 §0](../docs/operations/deployment.md)。

**2026-08-17: 1回目の本番反映を完了した。** migration 5件を適用し、**18日間止まっていた定時実行が動き出した**
（`doctor` で「0分前に動いています」・ニュース48時間で20件）。実物スモーク成功（$0.19）。
キャンペーン価格表示・LP文言・Stripe商品説明も本番へ反映済み。

**次の一手（推奨順）**

1. **本番運用の開始に必要な3件（運営者）**
   (a) ~~**`X_POSTING_MODE=live` をVercelの本番環境変数へ設定して再デプロイ**~~
       → **2026-08-19 確認済み**。本番は `live`（Vercel APIで値を実測。2026-07-20 設定・最新の本番デプロイは
       それより後なので反映済み）。preview は `dry_run`、`APP_BASE_URL` も本番/preview で正しく分かれている。
       **残るのは検証用アカウントでの「少数投稿→自動rollback削除」1回**（リリース前チェックリスト §2）で、
       これは (c) のXアカウント連携が前提。
       **この値は誰も検査していなかった**（既定値があるため欠けても起動し、画面は全部正常に見える）。
       T-M8-147 で `doctor` が「Xへの投稿」として出すようにした
   (b) ~~**Stripe WebhookのURLを `https://exosai.net/api/stripe/webhook` へ変更**~~
       → **2026-08-18 完了**（運営者が実施）。Stripe APIで確認済み:
       `https://exosai.net/api/stripe/webhook` が `status=enabled`・登録は1件のみ・
       `checkout.session.completed` ほか必要なイベントを購読。
       **確認は「Stripeに何が登録されているか」を見ること**——反映先URLへ curl して
       404かどうかを見ても、Stripe側の設定は分からない（2026-08-18、それで誤って
       「未修正」と報告した）
   (c) **Xアカウントの連携**（本番は0件）。連携後に `npm run release:production -- --account <handle>` で
       生成・画像まで含む実物スモークを回す
   (d) **Stripeアカウントの本番有効化**（2026-08-19 判明・T-M8-148）。`charges_enabled = false` /
       `card_payments = inactive` のため、**いま契約の申し込みは誰も完了できない**
       （「7日間無料で利用」が必ず「決済画面を開けませんでした」になる）。
       必要な情報は提出済み（`details_submitted = true`）なので、Stripeダッシュボードのホームで
       残作業と審査状況を確認する。**アプリ側では直せない。** 状態は
       `npm run doctor -- --base https://exosai.net` の「決済の受付（Stripeアカウント）」で読める
2. **D-17（法務文書の弁護士レビュー）**。T-M8-75で条項を19条へ増やし、T-M8-81で屋号を足したため
   レビュー対象が広がっている。専属管轄・免責上限・賠償条項の有効性が論点。
   **T-M8-118のキャンペーン価格表示（二重価格表示）も対象に含める**
3. D-18（法28条の根拠づけ）・D-19（ログ保持期間の実設定）を決める。
   D-16は実質解決済みなのでcloseするだけ。D-20（退会手順）は運営者判断で**削除依頼が来たときに考える**（2026-08-14）
4. 以降は `/maintenance` を週1回・`/add-task` で要望を起票 → `/dev-loop` の運用へ

**LP（SC-01）で残している判断**

- ヒーローのチェック「高品質な投稿を自動作成」は、ハンドオフの禁止表現「生成品質を運営が保証する表現」に
  当たりうる。**運営者が明示的にこの文言を選んだため現状のまま**（2026-08-10）
- 料金セクションの記載範囲は運営者の判断で要約に留めている。法定表示事項の全文は
  `/legal/commercial-transactions` が担う（`legal-pages.test.ts` が網羅を検査）
- `ops/launchd/` のplistラベル・Keychain項目名は旧名（space-ai）のまま。OSに登録される識別子で、
  かつVercel Cronへの移行対象のため据え置き（T-M8-82）

**この2週間で分かったこと**（同じ失敗を繰り返さないため）

- **「HTTPが200で本文も出る」は動いている証拠にならない**。`/signup` はscriptが1本も実行されない状態で
  200を返し続けていた。**公開ページは実ブラウザで、コンソールエラーと失敗リクエストまで見る**
- **原因を正しく書いたドキュメントがあっても、適用先を手で数え上げると漏れる**。ADR-0005 は
  静的prerenderとnonceの非両立を明記していたのに、対象リストから認証画面が落ちていた（T-M8-87）。
  **「対象を列挙する」形の対策は、列挙の正しさを検査するまで完成していない**
- **表示名の一括置換では識別子が残る**。改称でCookie名 `space-ai-recovery` を取りこぼし、
  プライバシーポリシーに旧名が出ていた（利用者が発見・T-M8-82）。逆に一括sedを広げすぎて、
  実在フォルダ名・テストの期待値・launchdのplist名まで壊した。**識別子の置換は実体を先に洗い出す**
- **完全一致のテストは、文言を整えるたびに落ちて「一致させるだけ」の作業になり、
  開示ごと消えたときに気付けない**。文言ではなく「その情報が載っていること」を検査する形へ変えた
- **装飾のためにJSへ依存させない**。LPの出現演出が原因で、JSが動かないと会員登録の唯一の入口が
  白紙になっていた（サーバーは200・テストも緑）。演出を廃止した（T-M8-76）

**リポジトリの状態**: `main` = `origin/main`（本番と一致）。`stg` と `main` はツリー同一だがSHAが分岐（D-28）。
`supabase link` は本番（`hvjizoahdqfvasiqzzkv`）へ向いている——**stgを触る前に張り替えること**。
`npm run release:check` は緑（新設の `check:csp-nonce` を含む）。

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
- 実行結果: 13件緑（47.9s）。実行後の残データ0件（e2eユーザー0・news_items 0・e2e x_accounts 0）。実アカウント（運営者本人のアドレス）とその失敗job 3件は対象外として保持。
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
- メモ: **2026-07-27、動作確認で `scheduler_tick` を実行したところ、溜まっていた queued 通知98通が実際にGmailから送信された**（宛先は本人 運営者本人のアドレス のみ。第三者への送信なし）。`.env.local` に実Gmailの App Password が入っており、コード側に環境ガードが無かった。`local-development.md` には「SMTP_USER/SMTP_APP_PASSWORD を空にする」という**手動の**回避策しか無く、忘れれば必ず再発する。
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

## M8: UIリデザイン（design_handoff_ui）

既存の**見た目だけ**を新デザインへ置き換える。機能・API・ルーティングは変更しない。
作業ブランチは `feature/ui-redesign`。方針は 2026-08-02 に決定（デスクトップ最適化／
デザインの文言に合わせる／URLは変えず1画面に見せる／まとめて進めて節目で確認）。

### T-M8-15: 操作結果の通知をトーストへ集約する `done`
- 参照: デザイン §補助画面 T-1/T-2、要件06 §2.1 / 依存: T-M8-14 / サイズ: L
- 完了条件: 操作の結果はトーストへ集約し、対応するインライン通知を消す。1画面に同時に出る
  インラインの `role="alert"` は入力検証を除き最大1個になる
- 実装メモ:
  - **土台（P0）**: `ToastProvider` を root layout へ、判断は `toast-policy.ts`（単体5件）。
    E2Eへ `toastIn` / `statusIn` を追加し、`alertIn` から**トーストを除外**した。
  - **なぜP0が先か**: `alertIn` は `[role="alert"]` を拾うため、**どこか1箇所でエラートーストを
    出した瞬間に `/login`・`/plans`・`/app/**` の全テストが2要素に当たって落ちる**。
    移行より先に土台を入れる必要があった。
  - 移行は T-M8-16（下書き一覧・アカウント切替）／T-M8-17（スケジュール）／T-M8-18（設定・
    AI設定・ニュース → Xアカウント・APIキー → ベースmd・プロンプト・改善提案 → 投稿作成・
    下書き編集・決済の4コミット）へ分けた。
  - **副産物**: APIキー保存後の導線を `?tab=ai-purpose` と綴り間違えた。未知のslugは先頭タブへ
    丸められるのでリンクは200で開き、テストも通り、利用者だけが違う画面に着く。タブ定義を
    `ai-settings/tabs.ts` / `settings/tabs.ts` へ出して型で縛り、素の文字列は
    `src/app/app/tabs.test.ts` がリポジトリ全体を走査して実在を検査する。
  - **無言の成功を5か所で見つけて潰した**（学習ソースの追加・削除・再取り込み、下書き保存）。
    「一覧に行が増えたことに気づけるか」に委ねていた。移行はインライン通知を消す作業だが、
    実際には**そもそも通知が無い操作**を洗い出す作業でもあった。
- 移行しないもの（判断の対応表・要件06 §2.1 の表と同じ）:
  - **入力検証**（直す場所から離すと何を直せばよいか分からない・`aria-describedby` が切れる）
  - **追加導線に `<button>` を含むもの**（トーストの `action` は `<a>` 1本のみ。本文だけ移すと
    理由のないボタンが残る）
  - **恒常表示**（ジョブ進捗・前提不足の案内・上限バナー・画面状態）。トーストは1回出て消えるため、
    リロードや画面復帰で結果が失われる
  - **URLパラメータ由来の案内**（`?portal=return`・`?checkout=canceled`・`?connected=1`・
    `?password_updated=1`）。**これは画面状態であって操作結果ではない**。再読み込みしても
    URLが同じ状態を主張し続けるので、トーストにすると「消えたのにURLはそのまま」になる。
  - **認証フォームの送信エラー**（ログイン失敗・再設定失敗）。フォーム直上が唯一の出口で
    重複が無く、利用者の視線もそこにある。
- 後続への注意: **成功は5秒で消える。** version番号や件数など後から必要になる情報を
  トーストだけに置かない。**同時に出せるのは1件**なので、一括操作の集約結果は画面側にも残す。
  `useToast()` は Provider の外で no-op なので、**呼んでいるのに何も出ない事故が静かに起きる**。
  移行した画面は `e2e/toast.spec.ts` で1件は「実際に出る」ことを固定する。

### T-M7-55: ニュース取得を3分野×2時間おきへ縮小し、費用を運用可能な水準にする `done`
- 参照: PRD v1.5（N-1/N-2・§6.1）、要件04 §6、CLAUDE.md 原則1・4 / 依存: T-M7-44 / サイズ: M
- 実装メモ:
  - **決定（2026-08-02 ユーザー）**: 分野を **ai・investment・sns の3つ**へ、実行を **10:00〜20:00の2時間おき**（10/12/14/16/18/20時）へ。
  - **根拠（実測）**: stagingで1分野1回あたり **$0.2388 / $0.4957**。従来（6分野×毎時12回）だと**月$518〜1,071**。PRDの旧見積もり（月$64.80〜$108.00）は**検索料金しか数えておらず誤り**だった（費用の主因は検索結果本文の入力token）。新設定では**月$130〜270**。
  - **頻度だけ変えると取りこぼす**。毎時×直近3時間ラップという冗長性の設計なので、窓も作り直した（`newsLookbackHours`）。初回10:00は前日20:00からの空白を埋める**14時間**、以降は間隔2h＋重なり1hの**3時間**。「窓は起動間隔より広い」ことをテストで固定した。
  - **取得しない分野を選べる状態を残さない**（原則1）。設定画面・ニュース一覧の絞り込み・既定値（コード／DBトリガー migration `20260802000001`）をすべて3分野へ揃えた。**発信テーマ（L-5）は6のまま**（生成の方向づけにも使うため縮小しない）。
  - launchd の起動時刻とコードの `NEWS_FETCH_JST_HOURS` が**ずれたらテストが落ちる**ようにした（費用に直結するため）。
- 後続への注意: さらに下げるなら「検索3〜5回」を減らす（`SYS_NEWS`）のが次に効く。**品質への影響が読みにくい**ので実測してから決める。

### T-M8-34: 初回リリースで詰まった箇所を手順へ書き戻す `done`
- 参照: docs/operations/deployment.md、CLAUDE.md 原則3（手順を記憶に依存させない） / 依存: T-M8-33 / サイズ: S
- 経緯: M8をstagingへ反映する過程で、**ゲートが3回止まった**。どれも「知らないと必ず詰まる」種類で、
  手順書に書かれていなかった。次の人（＝将来の自分）が同じ所で止まらないように書き戻す。
- 内容:
  - **`STAGING_BASE_URL` などが `.env.example` にも手順書にも無かった。** 「反映先のURLが設定されて
    いません」で止まる。`.env.example` へ4つ（`STAGING_BASE_URL` / `PRODUCTION_BASE_URL` /
    `STAGING_CRON_SECRET` / `PRODUCTION_CRON_SECRET`）を追記し、デプロイ手順にも表で書いた。
  - **migration適用時の警告を「失敗」と読み違えないように書いた。** `supabase db push` の後に
    `failed to cache migrations catalog: ... pgdelta-target-ca.crt: ENOENT` が出るが、
    **migration自体は適用されている**（CLIのカタログキャッシュだけが失敗する）。
  - **要決定D-16を起票**: `stg` は未保護のままで、**CIが赤でもstagingが更新される**。
    2026-08-03のマージで実際に起きた（E2E1件のタイムアウトで赤 → その間stagingは新コードで公開済み）。
    `main` はD-8/D-14で保護済みなので、同じ穴が`stg`に残っている形。
- 実際に詰まったもう1つ（記録のみ）: `.claude/skills/` はサンドボックスで書き込み禁止のため、
  ブランチ切り替え後の `git pull` が `unable to unlink` で失敗した。中身は `origin/stg` と同一
  だったので破棄して取り込み直した。
- 検証: typecheck / lint 緑。`npm run release:staging` が**7項目すべて緑**になり、デプロイ後の検証
  （人間確認・実物スモーク $0.3412）まで通過することを確認した。

### T-M8-35: Stripe Portal設定スクリプトに対象環境の指定を必須化する `done`
- 参照: 要件03 §2.2、docs/operations/deployment.md §1.4 / 依存: T-M8-34 / サイズ: S
- 症状: stagingを直すつもりで実行したのに `.env.local`（＝ローカル）の値が読まれ、**ローカルの
  configuration を更新して「成功」と表示した**。stagingは直っていないのに出力は緑で、
  doctorを叩き直すまで気付けなかった（原則1「黙って壊れない」に反する）。
- 直したもの: `--target <local|staging|production>` を必須にし既定を持たせない。構成IDは環境ごとの
  接頭辞付き変数から読む。既存構成の**上書き更新専用**にする（新規作成をやめ、env書き換えの手順を消した）。
  出力に `target` / `appBaseUrl` / `valueSources` を必ず載せる。
- 後続: T-M8-50 で「足りない値をまとめて示す」「候補を一覧する」まで広げた。
- 検証: 4モード実測（`--dry-run` / `--target` なし＝エラー / local 成功 / staging 成功）。

### M8監査（2026-08-04）: UI改修の後始末

利用者の依頼「リファクタリング／問題のあるUI／使われなくなったバックエンドAPI」を受けて、
4観点（デッドコード・問題UI・リファクタ・一貫性）で並列監査し、**各所見を否定側から検証**した。
所見32件 → 確認17件（重複を除くと15件）／棄却15件。**棄却15件は「一見おかしいが実際は正しい」**
もので、これを潰さずに直すと動いているものを壊す（例: サーバ側に同じ判定が二重にあるので
UI側boolean を壊しても投稿は誤爆しない）。

優先度は「利用者・運営者への実害があるか」で決めた。**見た目の不統一より、黙って壊れることを先に直す**。

| 区分 | タスク | 内容 |
|---|---|---|
| A（実害） | T-M8-36 | 状態チップが無色（Xアカウント・学習ソース） |
| A | T-M8-37 | 押す前に止まらない3画面（テーマ未選択・URL空・件数範囲外） |
| A | T-M8-38 | コピー失敗を黙って捨てる（callback URL） |
| A | T-M8-39 | 手動投稿の長さ超過をサーバが止めない |
| A | T-M8-40 | doctorがメール全滅を ✅ と表示（`failed` を数えていない） |
| B（保守性） | T-M8-41 | 失敗下書きの可否boolean 8個を純関数へ抽出／`upcoming-schedule` のローカル定数／`CategoryChip` のラベル導出（3件まとめて実施） |
| C（統一） | T-M8-43 | インラインバナーの危険色2系統 → `Notice` 新設（warn/info/success の約37箇所は未着手） |
| C | T-M8-44 | 手書きチップ13箇所 → `Badge` |
| C | T-M8-42 | カード見出し3規格 → `CardTitle` |
| C | T-M8-45 | `lucide-react` 撤去（6ファイル） |
| A | T-M8-46 | 押せない理由が無い4つ目の画面（APIキー保存）※監査中に派生 |
| A | T-M8-47 | ニュース見出しの受理上限30字で分野が0件 ※`smoke:live` で発見 |
| — | T-M8-48 | push前点検で見つかったCI赤・E2E flake・docs矛盾の5件 |
| — | T-M8-49 | doctorが案内するコマンドがそのまま動くことを機械検査 |
| — | T-M8-51 | 上記の点検で「あとでよい」と判定した30件（A6/B4/C7/D3/E7）を全部消化 |
| — | T-M8-52 | warn/info/success のインラインバナー約37箇所を `Notice` へ寄せる |

### T-M8-36: 状態チップの無色化を直し、tone名がclassNameへ流れないようにする `done`
- 参照: 要件06 §2/§9、デザイン §カラー、CLAUDE.md 原則1 / 依存: T-M8-35 / サイズ: S
- 症状: `STATUS_TONE[status]` の値（`"success"` などの **tone 名**）を `Badge` の `tone` prop では
  なく className へ文字列展開していた。生成されるのは `class="... success"` で、Tailwind に該当
  ユーティリティが無いため**色が一切当たらない**。Xアカウントの4状態（有効／要再連携／停止中／
  エラー）が全部同じ灰色枠になり、**トークンが切れているアカウントに気付けない**。
  学習ソースの状態チップは背景色の指定自体が無く、同じく4状態が同じ見た目だった。
- 直したもの: 両方を `<Badge tone={...}>` へ。学習ソースにも意味別の tone マップを置いた
  （pending: info / analyzed: success / failed: danger / removing: warn）。
- 再発防止（2段）:
  - `src/components/ui/badge-tone.test.ts` — **`BadgeTone` 型として宣言された識別子が
    `className` の中に現れないこと**をリポジトリ全体で検査する。tone からクラス文字列を引いた
    変数（`toneClass` 等）は対象にしない。
  - E2E 2件 — **クラス名ではなく計算された背景色**を見る（`getComputedStyle().backgroundColor`）。
    クラス名を確かめても、Tailwindがそのユーティリティを持たなければ色は出ないので同じ見落としが
    再発する。実際に修正を戻すと `rgba(0, 0, 0, 0)` で落ちることを確認した。
- 後続への注意: この型の退行は **typecheck・lint・既存E2Eがすべて緑**のまま通る（型は `string`
  として妥当で、DOM上は要素が存在する）。**色が消えたことだけが症状**なので、目で見るまで分からない。

### T-M8-39: 手動投稿の長さ超過をサーバー側で止める（Xに部分スレッドを残さない） `done`
- 参照: 要件04 §10 step2/step3、要件06 §7、CLAUDE.md 原則1 / 依存: T-M8-36 / サイズ: S
- 症状: 加重280超過の判定が `mode === "auto"` のときだけ効いていた。画面からの手動投稿は
  `mode: "manual"` なのでこの分岐に入らず、**サーバー側に長さの再検証が1つも無かった**
  （`drafts-list.tsx` の表示分岐が唯一のゲート）。UIの分岐は `.tsx` なので単体テストの網に
  入らず（`environment: node` かつ `include: src/**/*.test.ts`）、壊れても緑のまま通る。
- なぜ実害か: **Xは280超過を400で拒否する。** スレッドは1ポストずつ作るので、3本目で拒否されると
  **1〜2本目はX上に残ったまま**になる。reconcileが必要な状態で、取り返しがつかない。
- 要件は元から書かれていた: 要件06 §7「文字数超過がある下書きは**手動投稿でもブロック**し…」、
  要件04 §10 step3「合成後の加重文字数超過はX APIを呼ばず失敗にする」（P-5）。
  **実装だけが追いついていなかった**（ドキュメント側の誤りではない）。
- 直したもの: `findOverLengthText()`（純関数）を追加し、`executePostPublish` の入口で
  `mode` を問わず判定する。保存済みの `weighted_length` ではなく**そのとき投稿する本文**から
  測り直す（P-5は `quote_url` を1本目末尾へ合成するため保存値より長くなる。保存値は編集や
  検証ロジックの変更で古くなり得るが、Xが見るのは本文そのもの）。
- 失敗メッセージは運営者向け: 「2本目の本文が長すぎます（上限280・いま282）。編集して短くしてから
  投稿してください。**Xへの投稿は1件も行っていません**」。最後の一文が無いと、Xを見に行くまで
  部分投稿が残っているか分からない。
- 検証: 単体4件（`findOverLengthText`）＋ post_publish 2件（手動で止まる／`createPost` が
  **1度も呼ばれない**／`quote_url` 合成後の超過も止まる）。`mode === "auto" &&` を戻すと
  新しい2件だけが落ちることを確認した。

### T-M8-40: 送れなかったお知らせメールを見えるようにし、再送できるようにする `done`
- 参照: 要件05 §10、要件06 §2、CLAUDE.md 原則1・2 / 依存: T-M8-39 / サイズ: M
- 症状は2つあり、合わせると**通知メールが全滅していても誰も気付かない**状態だった。
  1. **`doctor` が ✅ を出す。** `judgeQueuedEmails` は `queued` だけを見て `queued === 0` を
     「送信待ちはありません」＝ok としていた。`failed` は終端状態（401/403 または3回失敗で確定）
     なので、**SMTP認証が誤っていて全通知メールが失敗した状態は `queued = 0`**。
     CLAUDE.md 原則1「正常な空と失敗による空を別の値で表す」に正面から反する。
     日次サマリも `queued` のみを数えていた。
  2. **`failed` の復旧手段がコード上どこからも到達できない。** `retryNotificationEmailAction`
     は T-M4-17 から実装済み（要件05 §10 にも記載あり）だが、**呼び出し元が1つも無かった**。
     `NotificationView` に `email_status` が無く、通知ベルもメール状態を描画していなかった。
     `recoverQueuedEmails` は `queued` しか拾わないので、自動でも回収されない。
- 直したもの:
  - `judgeQueuedEmails` が `failed` を受け取り、**1件でもあれば `error`**（送信待ちより先に扱う。
    自動回収されないため）。次の一手に「メール設定（SMTP）を確認 → 通知ベルから再送」を出す。
  - 日次サマリに `failedEmails` を追加し、「気になる点」に数える。
  - `NotificationView.emailStatus` を追加（`listNotifications` の select に `email_status`）。
    通知ベルの該当行に「メールが送れませんでした」＋「メールを再送」を出し、既存Actionへ繋いだ。
  - 再送ボタンは行の**入れ子にせず兄弟**として置く（リンクのある通知の行は `<button>` なので、
    入れ子にすると不正なHTMLになりクリックの伝播も壊れる）。
- 検証: 単体（`judgeQueuedEmails` に「送信待ち0＋失敗あり → error」「失敗は送信待ちより先」の2件、
  日次サマリ1件）／E2E 1件（`failed` の行に文言と再送ボタンが出る → 押すとトースト →
  ボタンが消える → **DBの `email_status` が `queued` へ戻る**）。
- 残した判断: SMTP到達性そのものの確認（`doctor` にSMTPへの接続チェックを足す）は入れていない。
  失敗が1件でも出れば ❌ になるので気付ける経路はできたが、**まだ1件も送っていない環境では
  設定ミスが分からない**。必要になったら別タスクにする。

### T-M8-37: 押す前に止め、押せない理由を画面に出す（3画面） `done`
- 参照: 要件06 §2.1・§4.1・§3.4、CLAUDE.md 原則1・2 / 依存: T-M8-40 / サイズ: M
- 共通の症状: **押せるのに何も起きない／原因の分からないエラーが出る**。3つとも `<form>` が無く
  `type="button"` ＋ `onClick` で送るため、`required` や `min`/`max` 属性は**一度も評価されない**
  （飾りになっていた）。
  1. **投稿作成のテーマ未選択** — 既定は空文字で、押すと `theme: null` が送られ
     `z.enum(POST_THEME_IDS)` で弾かれ「入力内容を確認してください」だけが5秒で消えた。
     どの項目が悪いかも分からず、フィールドの強調もフォーカスも無い。
  2. **学習ソースのURL空** — `add()` が `if (!url.trim()) return;` と黙って抜けていた。
     トースト無し・強調無し・進行表示無しで**完全に無反応**。同じ画面の他の操作（削除・再取り込み）
     は全てトーストを出しており、ここだけが例外だった。
  3. **ニュース表示件数の範囲外** — `onChange` がクランプせず、保存ボタンの `invalid` 判定も
     件数を見ていなかった。欄を空にする（`Number("")` → 0）か101以上で保存でき、汎用エラーになった。
     同じ「表示件数」欄がニュース一覧側ではクランプ済みで、**同じ設定項目が画面によって挙動が違った**。
- 直し方は3つとも同じ形にした。(1) 押せない状態にする、(2) **押せない理由を欄・ボタンの近くに
  文字で置く**、(3) 保険としてハンドラ側の無言 return をトースト／検証メッセージへ変える。
  無効化だけでは「なぜ押せないのか」が分からず、壊れているのと区別できない。
- 副産物: 件数の範囲（1〜100）が zod と2画面の属性に3回書かれていたので `config-defaults.ts` の
  `NEWS_MAX_ITEMS_MIN`/`MAX` ＋ `clampNewsMaxItems()` へ寄せ、2画面で同じ丸め方にした。
  スケジュールのテーマ未選択も同様に、保存前のインライン検証（曜日と同じ形）で止めるようにした。
- 検証: 単体4件（`clampNewsMaxItems`。空文字・NaN・小数・範囲外）／E2E 2件（テーマ未選択で
  生成が押せず理由が出る・選ぶと消える／URL空で追加が押せず理由が出る・入れると消える）。
  既存のテーマ必須E2Eは「押しても job が作られない」という確認だったので、
  「**そもそも押せない**」を確かめる形へ書き換えた。

### T-M8-38: callback URLのコピー失敗を黙って捨てず、成功も読み上げられるようにする `done`
- 参照: 要件06 §1.2.1、CLAUDE.md 原則1・原則2、変更影響表「外部サービスの設定に依存する画面」 / 依存: T-M8-37 / サイズ: S
- 症状1（失敗が消える）: `copyCallbackUrl` が `navigator.clipboard.writeText` を try/catch なしで
  呼んでいた。クリップボード書き込みは**非セキュアコンテキスト**（`navigator.clipboard` が
  undefined）・**権限拒否**・**ドキュメント非フォーカス**のいずれでも失敗する。失敗すると
  unhandled rejection になって `setCopied(true)` に到達せず、ボタンは「コピー」のまま**無反応**。
- なぜ実害か: この文字列は X Developer Console へ**完全一致で登録**する OAuth callback URL。
  コピーできたつもりで古いクリップボード内容を貼ると**X側の設定が食い違い、ログイン・連携が失敗する**。
  相手側の設定ミスはコードに現れず、モックしたテストでは原理的に見えない
  （2026-08-01、stagingでログイン・新規登録が両方不可だったのと同型）。
- 症状2（成功が読み上げられない）: ボタンに `aria-label="callback URLをコピー"` が付いていたため
  読み上げ名が固定され、「コピー」→「コピー済み」の変化が支援技術に伝わらなかった
  （アイコンは `aria-hidden`）。M8で1件直したのと同じ「`aria-label` が中の文字を上書きして
  情報が失われる」型。
- 直したもの: try/catch でエラートースト（「左のURLを選択して手動でコピーしてください。」）を出す。
  `aria-label` を外し、可視テキストを「callback URLをコピー」にして文脈を可視側へ移す。
  `<code>` に `select-all` を付け、コピーできない環境でも手順を終えられるようにした。
- 検証: E2E 1件。`addInitScript` で `navigator.clipboard.writeText` を必ず reject させ、
  **エラートーストが出て「コピー済み」にならない**ことを確認する。

### T-M8-41: 判定と共通部品の重複を畳む（可否boolean・ローカル定数・ラベル導出） `done`
- 参照: 要件06 §7、ADR-0006 原則5、CLAUDE.md「保守運用がしやすいコード」 / 依存: T-M8-38 / サイズ: M
- **振る舞いは変えていない**（条件式を移動しただけ）。3件をまとめた。
- (1) **失敗下書きの可否boolean 8個を純関数へ**（`lib/post/draft-actions.ts`）。
  「Xに残ったポストをどう扱うか」という取り返しのつかない領域のルールが `drafts-list.tsx` の
  中にあり、**単体テストが1件も届いていなかった**（`vitest.config.ts` の `include` は
  `src/**/*.test.ts` で `.tsx` は対象外。`.test.tsx` は0件、RTL・jsdom も未導入）。
  表形式で15件のテストを付けた（作成履歴×未解決の組み合わせ・空配列・failed以外・警告・P-5フラグ）。
  画面の一時状態（`pending` / `publishJobId` / `editing`）だけは component 側に残す。
  **なおサーバー側にも同じ判定がある**（`drafts-clone.ts` / `drafts.ts` / `generation-jobs.ts` /
  `post-publish.ts` に単体テスト付き）ので、ここが壊れてもXへ誤爆はしない。画面側は
  「押せてしまってサーバーに弾かれる」を防ぐ一次ゲート。
- (2) **`upcoming-schedule.tsx` のローカル定数を共通へ**。共通の `primaryLinkClassName` と
  **同名のローカル定数**を持ち、中身は `focus-visible` の3クラスが抜けていた。ホームの主操作2本
  だけキーボードフォーカスの見え方が他画面と違い、名前が同じなので grep でも取り違えやすかった。
  `cardClassName` も `Card` へ寄せ、`confirmation-queue.tsx` の直書きも共通へ。
  **`Card` に `as` を足した**（既定 `div`）。`section` を `div` にすると landmark が消え、
  支援技術からもテストからも「1つのまとまり」として扱えなくなる（実際にE2Eが落ちて気付いた）。
- (3) **`CategoryChip` がラベルを自分で引く**。色を決めるために `category` を受け取っているのに
  ラベルは `children` で呼び出し側に作らせていたため、2つの呼び出し側が別の方法で同じラベルを
  引いていた（一方は自前Map、もう一方は `as NewsCategory` キャスト付き）。`children` を渡せば
  従来どおり上書きできる。
- 検証: 単体 1,585件（新規15件）／typecheck・lint 緑／**E2E 44件すべて緑**（1 skip は実AI）。
  ホーム1440pxを実ブラウザで確認。

### T-M8-42: カード見出しを `CardTitle` へ揃える（3規格の混在を解消） `done`
- 参照: ADR-0006 原則5、デザイン §タイポグラフィ / 依存: T-M8-41 / サイズ: M
- 症状: `/app/**` のカード見出し `<h2>` に3つの規格が並存していた。新デザインは
  `text-[15px] font-bold`（11箇所）だが、`text-sm font-semibold`（14px/600・8箇所）と
  `text-xl font-semibold`（20px/600・9箇所）が残っていた。**同一画面のタブ間で違うのが問題**で、
  `/app/settings` は「通知」タブが15px/700なのに「ご契約」「お問い合わせ」「APIキー」
  「Xアカウント」が20px/600、つまり**タブを切り替えるだけで見出しが1.33倍になっていた**。
  `/app/schedule` は同じ画面に15pxと14pxが縦に並び、`/app/analytics` は15pxが1つも無かった。
- 直したもの: `/app/**` の `<h2>` 26箇所を `CardTitle` へ置換（`id` はそのまま通るので
  `aria-labelledby` は維持）。同じ値の手書き（`text-[15px] font-bold text-ink`）も含めて寄せ、
  `persona-settings-form.tsx` のローカル定数 `groupHeadingClassName` も削除した。
  **公開ページ（`/terms`・`/privacy`・`/signup`）は対象外**——アプリ内カードとは別の文書的な
  スケールで、揃える相手が違う。
- 検証: typecheck・lint・単体1,585件 緑／**E2E 45件緑**（heading ロールは維持されるので
  `getByRole("heading")` はそのまま通る）。設定の4タブ・分析・AI設定を1440pxで目視確認した。
- 途中で見つけたこと（別タスクへ）: APIキータブの「Xキーを保存」「保存」が**理由なく薄い**
  （`length < 16` で無効化しているが16文字という条件がどこにも書かれていない）。T-M8-37 と同型。

### T-M8-43: インラインバナーを `Notice` へ集約し、危険色の分裂を解消する `done`
- 参照: 要件06 §2.1、ADR-0006 原則5、デザイン §カラー / 依存: T-M8-42 / サイズ: M
- 症状: 成功・注意・危険・情報のインラインバナーが共通部品なしで45箇所に手書きされていた。
  とくに**同じ「危険」の背景が2系統に分裂**していた。
  - アプリ内: `bg-danger-bg`（`#ffd9dc`・はっきりしたピンク）
  - 認証フォーム: `bg-destructive/10`（`--destructive` は `danger-fg` を指すので**10%＝ほぼ白**）
  同じ深刻さが画面によって違う強さで出るため、**利用者は色から深刻さを測れない**。
  padding も8種（p-2/p-3/p-4/p-5/p-6/px-3 py-2/px-4 py-2/px-4 py-3）、枠線も3種に散っていた。
- 直したもの: `src/components/ui/notice.tsx` を作り、危険色の8箇所を寄せた
  （ログイン・会員登録・パスワード再設定・再設定申請・法務同意・発信設定の検証・投稿生成の失敗・
  X連携エラー）。`tone` の意味づけは `Badge` の TONES と揃える（同じ色が別の意味で使われないように）。
- 再発防止: `notice.test.ts` が **`bg-destructive/*` を使うのはボタンだけ**であることを
  リポジトリ全体で検査する。1箇所戻すと落ちることを確認した。
- 検証: 単体1,586件・typecheck・lint 緑／E2E（auth・password-reset・x-oauth・generation）緑。
  実ブラウザでログイン失敗のバナーが `rgb(255, 217, 220)`（＝アプリ内と同じ `#ffd9dc`）になることを確認。
- **残り（別タスク T-M8-52）**: warn/info/success のバナー約37箇所。危険色ほどの実害はないが
  padding・文字サイズ・枠線が揃っていない。45箇所を一度に置換するとリスクが高いので分けた。

### T-M8-44: 手書きチップを `Badge` へ寄せる（背景色が抜けた3箇所を含む） `done`
- 参照: ADR-0006 原則5、デザイン §形状 / 依存: T-M8-43 / サイズ: S
- 症状: `Badge`（`rounded-chip px-2 py-0.5 text-[11px]` ＋ tone配色）が12ファイルで使われている
  一方、`rounded bg-muted px-2 py-0.5 text-xs` 系の手書きチップが13箇所残っていた。
  角丸（bare `rounded`＝4px vs `rounded-chip`＝6px）・文字サイズ（12px vs 11px）・背景
  （`bg-muted`＝rgba(0,0,0,.03) vs Badge neutral の `bg-black/[0.04]`）がすべてわずかに違い、
  同じ一覧の中で並ぶと**揃っていないことだけが伝わる**。
- **3箇所は背景色そのものが抜けていた**（形が隣のチップと揃わない）。tone を決めて寄せた。
  - ベースmdの変更理由（`base-md-editor.tsx`）→ 分類なので neutral
  - 分析の「計測完了」（`analytics-view.tsx`）→ 完了なので success
  - プロンプトの「カスタム／既定」（`prompt-templates-editor.tsx`）→ 手書きの色分岐を
    `tone={isOverride ? "brand" : "neutral"}` へ（値ではなく意味で選ぶ形にした）
- 改善提案の「生成中…」は info、根拠のメタ情報（軸・metric・計測時点・差）は neutral。
- 対象外: `api-key-settings.tsx` の scope 一覧は `<code>`（チップではなくコード片）なので残した。
- 検証: 単体1,586件・typecheck・lint 緑／E2E（analytics・suggestions・ai-settings・home）緑。

### T-M8-45: `lucide-react` を撤去し、アイコンを1系統にする `done`
- 参照: ADR-0006 原則4、デザイン §アイコン / 依存: T-M8-44 / サイズ: M
- 症状: M8でアイコンを Material Symbols のインラインSVG化（`ui/icon.tsx` ＋ `icons:generate`）
  したが、**6ファイルが `lucide-react` を import したままだった**。`plans/page.tsx` は同一ファイルで
  lucide の `Check` と自前 `Icon` の両方を使っており、しかも `ICON_PATHS` には `check` が
  生成済みで未使用。同じ意味のアイコンが2つの描画系統で並ぶため線幅・グリッドが揃わず、
  クライアントバンドルにアイコンライブラリが1つ余分に載っていた。
- 直したもの: 13種を等価へ置換（Check→check / ExternalLink→open_in_new / Bot→smart_toy /
  ShieldCheck→verified_user / Plus→add / LogOut→output / ImageIcon→image / KeyRound→key /
  Trash2→delete / RefreshCw→refresh / CircleUserRound→account_circle /
  ChevronsUpDown→unfold_more / Clipboard→content_copy）。未収録の3つは
  `scripts/generate-icons.mjs` の一覧へ足して再生成した（41→44個）。
  Tailwind の `size-*` は `Icon` の `size` prop（px）へ移した。`npm uninstall lucide-react` 済み。
- 検証: typecheck・lint・単体1,586件・`npm run build`・**E2E 45件**すべて緑。
  **アイコンの取り違えはテストでは出ない**ため、差し替えた5画面を1440pxの実ブラウザで目視確認した
  （Xアカウント設定・AI用途・アカウント切替・プラン選択・ログアウト）。

### T-M8-46: APIキー保存の「押せない理由」を画面に出す `done`
- 参照: 要件06 §1.2、CLAUDE.md 原則1・2 / 依存: T-M8-45 / サイズ: S
- 経緯: T-M8-42 の目視確認中に見つけた（T-M8-37 と同型で、**同じ形の見落としが別の画面に残っていた**）。
- 症状: `disabled` に `clientId.length < 5` と `aiSecrets[provider].length < 16` が直書きされており、
  **何文字必要かも、Confidential では Client Secret が要ることも、画面のどこにも書かれていなかった**。
  薄いボタンだけが出ている状態は、壊れているのと利用者から区別できない。
- 直したもの: 最小長を `lib/api-keys.ts` の定数（`AI_SECRET_MIN_LENGTH` /
  `X_CLIENT_ID_MIN_LENGTH` / `X_CLIENT_SECRET_MIN_LENGTH`）へ出し、zodと画面で同じ値を使う。
  Xキーは `xSavable`（サーバー検証と同じ条件）で判定し、押せないときは
  「Client ID を入力すると保存できます。」／Confidential では
  「Client ID と Client Secret を入力すると保存できます。」を出す。
  AIキーは入力があって短いときだけ「APIキーは16文字以上です（いま5文字）。」を出す
  （空のときは出さない——まだ何も入れていない状態を叱らない）。
- 検証: 単体1,586件・typecheck・lint 緑／E2E 2件追加（Confidential へ切り替えると案内が
  切り替わる／16文字未満のあいだ必要文字数が出る）。

### T-M8-47: ニュース見出しの受理上限を実測に合わせ、分野ごと全滅を止める `done`
- 参照: プロンプト設計書 §6.10・§7.1（v1.14）、要決定D-12、CLAUDE.md 原則1 / 依存: T-M8-46 / サイズ: S
- **見つけ方**: T-M8-39 で `src/lib/jobs/**` に触れたのでD-10に従い `smoke:live` を回したところ、
  **ニュース取得が「全滅: 取得0件だが4件を規定外で除外」で失敗した**（`title:too_big`×2 /
  `published_at:too_old`×2）。UI監査とは無関係の既存不具合で、私の差分は
  `src/lib/news`・`prompts`・`ai` に一切触れていない（`git diff` で確認）。
- 原因: `title` の受理上限が**30字のまま**だった。D-12（2026-07-28）で `summary` を120→200字へ
  緩めたとき、プロンプト設計書 v1.9 は「titleは30字のまま（**プロンプト明示で守られている**）」と
  書いた。**その前提が実測で崩れていた**——同じv1.8の記録に「英語ソースのため title 38〜56字」と
  あり、30字では原理的に届かない。
- 直したもの: `NEWS_TITLE_MAX_LENGTH = 60` を置き、**プロンプトの指示（30字）と受理の上限（60字）を
  別の数にした**。投稿側の `TARGET_WEIGHTED_LENGTH`(240) と `MAX_WEIGHTED_LENGTH`(280) と同じ形。
  §7.1へ原則として書き足した（**同じ数にすると、指示が守られなかった瞬間に成果物が0件になる**）。
  表示は折り返すだけでレイアウトは壊れない（DB列は `text`、見出しに固定高さなし）。
  **長い見出しが出ることより、ニュースが1件も来ないことの方が害が大きい。**
- 検証: 単体3件追加（48字・57字の英語見出しを受理／61字は落として理由を返す）。
  **同条件で `smoke:live` を再実行し、2件取得・除外は `published_at:too_old`（良性）のみ**に
  なることを確認（$0.3757・全シナリオ成功）。修正前は同じ条件で $0.3394・失敗。
- 別に気付いたこと（未対応）:
  - プロンプト設計書の**変更履歴が v1.9 で止まっていた**（ヘッダは v1.13）。v1.10〜v1.13 の
    記録が無い。今回は v1.14 を足したが、抜けた4件は復元していない。
  - 生成結果に**加重289字のポスト**が出た（PT-FIXが280以下へ収束しなかった）。画面は
    `length_exceeded` 警告で投稿を止めるので黙って壊れてはいないが、収束率は測っていない。

### T-M8-48: push前の点検で見つかった5件を直す（CI赤・E2E flake・docs矛盾） `done`
- 参照: CLAUDE.md 最重要ルール（docs同期）、docs/operations/ci.md / 依存: T-M8-47 / サイズ: M
- 経緯: pushの直前に5観点（CI固有／取り残し／同じ不具合の他箇所／docs同期／変更の正しさ）で
  並列点検し、所見38件を否定側から検証した（確認35／棄却3）。うち**push前に直すべき5件**を修正。
  残り30件は「あとでよい改善」として据え置いた。
- (1) **`npm run audit:check` が落ちていた＝CIが確実に赤**（最重要）。新しい advisory が出たため、
  `fast-uri`（GHSA-7p8r-x3mc-p8w7・<3.1.5）と `ip-address`（GHSA-mwp4-54f8-5fhr・<=10.3.0）が
  本番依存で high 判定になっていた。**この差分が原因ではなく `origin/stg` でも同じ**（lockの版が同一）。
  つまり**stgのCIも今は赤になる**。`release:check` は audit:check が3番目なので build・E2Eへ到達しない。
  → `npm update fast-uri ip-address` で lock だけを更新（3.1.5 / 10.4.0）。**overrides は使わない**——
  親の宣言レンジ内（`ajv` は `^3.0.1`、`express-rate-limit` は `^10.2.0`）なので不要で、
  overrides に寄せると2パッケージを恒久 pin して上流の追随に気付けなくなる（原則3に逆行）。
  `package.json` は無変更、差分は `package-lock.json` のみ。
- (2) **E2Eのflakeの原因を特定して直した**。`x-account-switch.spec.ts:120` の「1つ目へ戻す」だけが
  Server Action の完了を待たずに `page.goto` していた。切替先は cookie ではなく DB列
  （`profiles.active_x_account_id`）なので、in-flightのPOSTが中断されると切替が届かない。
  **CPU負荷をかけて `--repeat-each=8` で4/8失敗を再現**し、1回目と同じトースト待ちを入れて8/8成功にした。
  `retries` や `waitForTimeout` では原因が隠れるだけなので入れない。**既存の欠陥**で、
  この差分は同ファイルへテストを追記しただけ（118-122行は未変更）。
- (3) **ADR-0006 の使用箇所の数が実態と乖離**。「`Badge` は5画面」のまま（実測 18ファイル・8画面）で、
  同じ差分でこのADRの別の行を更新しているのに漏れていた。数字が古いと「小さいと思って触ると広く影響する」
  という警告の役目を果たさない。**この数は増える前提で、正は `rg` の結果**と明記した。
  あわせて「アイコン名の打ち間違いは単体テストで固定する」を実態へ修正（実際は `IconName` 型で
  typecheck が落とす。`as IconName` は0件。動的に渡すナビだけ `navigation-items.test.ts` が検査）。
- (4) **要件04 §12 の日次サマリに `failed` メールが未反映**（T-M8-40 の同期漏れ）。実装は
  `failedEmails` を本文と「気になる点」に出しているのに、正本は「送信待ちメール」のままだった。
- (5) **要件03 §2.2 と要件01:85 の `stripe:portal:setup` が旧仕様**。「未設定のときだけ作成してIDを出力する」
  という**実装に存在しない挙動**（`create` 呼び出しは0件）が残り、`deployment.md` §1.4 と正面から矛盾していた。
  要件01 の「3価格を同一Product配下に置く」も T-M8-32 で否定済みなのに残存していた（要件03 §145 は修正済み）。
- 検証: `npm run release:check` **exit 0**（typecheck / lint / audit:check / test:db / build / E2E 46 passed・1 skipped）。
  `npm ci --dry-run` exit 0。flakeは負荷下 8/8 成功。
- 据え置いた30件のうち目立つもの: warn/info/success バナー約37箇所の `Notice` 移行、
  未使用アイコン11個（`origin/stg` でも未使用＝今回の退行ではない）、プロンプト設計書 v1.10〜v1.13 の履歴欠落。

### T-M8-49: doctorが案内するコマンドがそのまま動くことを機械的に守る `done`
- 参照: CLAUDE.md 原則2（原因が開発知識なしで辿れる）・原則3（記憶に依存させない） / 依存: T-M8-48 / サイズ: S
- **見つけ方**: stagingへ反映後の `npm run doctor -- --base <stg>` の出力。
  ❌ プラン管理（Stripe）の次の一手が `npm run stripe:portal:setup` のままだった。
  T-M8-35 で `--target` を**必須**にしたので、**運営者が言われた通り打つとエラーで止まる**。
- なぜ実害か: `doctor` の `nextAction` は「いま何が壊れていて次に何をすればよいか」を
  非エンジニアへ伝える**唯一の出口**。原則2は示したコマンドが**そのまま通ること**まで含む。
  「コマンドを変えたら案内も直す」を人の記憶に任せていたのが原因（原則3）。
- 直したもの: `portal-status.ts` の案内を
  `npm run stripe:portal:setup -- --target <local|staging|production>` ＋ deployment.md §1.4 への参照へ。
- 再発防止: `src/lib/ops/next-action-commands.test.ts` が `src/lib/ops/**` と `scripts/**` の
  文言から `npm run <script>` を抽出し、(a) **package.json に実在するか**、
  (b) **引数が必須のスクリプトは引数まで含めて案内しているか**を検査する。
  (b) の対象は「既定を持たせず指定漏れで止める」と決めたものだけ（現状 `stripe:portal:setup` の
  `--target` 1件）。旧形式へ戻すと落ちることを確認した。
- 調べたが問題ではなかったこと: stagingで `smoke:live` が「ニュース2件取得」なのに `doctor` は
  「まだ一度も実行されていません」と出る。**両方正しい**——スモークは `researchNews` を直接呼び
  **成果物をDBへ保存しない**（`scenarios.ts:346`）。`doctor` は `news_fetch_outcomes` を見るが、
  定時実行（launchd）はローカル専用でstagingでは動いていない。

### T-M8-50: Stripe Portal設定で足りない値をまとめて示し、候補まで出す `done`
- 参照: CLAUDE.md 原則5（判断はまとめて求める）・原則2・原則3、docs/operations/deployment.md §1.4 / 依存: T-M8-49 / サイズ: M
- **見つけ方**: 利用者にstagingのPortal設定を実行してもらったところ、**3往復した**。
  1回目 `STAGING_STRIPE_PORTAL_CONFIGURATION_ID is required.` → 2回目（鍵を足したら）
  `No such price: 'price_1TvGQZ…'`（生のStripeエラー）→ 3回目でようやく残り1件。
  私のスクリプトが**足りない値を1つずつしか教えていなかった**のが原因で、原則5に反していた。
- 判明した前提の誤り: 「price は同じStripeアカウントなら共通」として接頭辞なしへ落としていたが、
  **staging はローカルと別のStripeアカウント**だった（実測）。落とすと *staging の鍵で手元の
  price を参照して `No such price`* になり、最悪**別環境を書き換える**。
- 直したもの:
  - アカウントに紐づく5値（secret key・price 3つ・構成ID）を `ACCOUNT_SCOPED` として
    **まとめて検証**し、足りないものを全部並べて出す。**接頭辞なしへは落とさない**。
  - `No such price` を運営者に分かる言葉へ翻訳（「別アカウントなので手元の price ID は使えません」）。
  - **構成IDだけが足りないときは、その鍵で見える構成を一覧して候補を示す**（読み取りのみ）。
    1件だけなら doctor が機能名まで出せている事実と合わせて対象だと確定できる。
    **IDの採用は人が決める**——自動採用するとT-M8-35で防いだ「取り違えたまま成功と表示」に戻る。
- stagingの実際の状態: **Stripeが自動生成した既定の構成が1件だけ**（`subscription_update` 無効・
  `default_return_url` 未設定＝このスクリプトが一度も適用されていない）。適用後は両機能が有効になり、
  `doctor` の「プラン管理（Stripe）」が ✅ になった（**stgの ❌ はこれで0件**）。
- 検証: 単体5件追加（`missingEnvNames`。接頭辞なしの値では代用させない／空白だけも足りない扱い）。
  4モードを実測（`--dry-run` / `--target` なし＝エラー / 5件不足 / 1件不足＝候補表示 / 成功）。
  成功時の `valueSources` が5つすべて `STAGING_` 付きであることを確認した。
- 後続への注意: **production も別アカウントである前提で用意する**（`PRODUCTION_` 5件）。
  `.env.example` に枠を用意済み。同じ3往復を繰り返さないよう、まず1回実行して言われた値を貼る。

### T-M8-52: インラインバナー37箇所を `Notice` へ寄せる `done`
- 参照: 要件06 §2.1、ADR-0006 原則5 / 依存: T-M8-51 / サイズ: M
- T-M8-43 で危険色2系統を解消したときの残り。padding 8種・枠線3種・文字サイズ4種に散っていて、
  **同じ重大度が画面によって違う強さで出る**状態だった。
- 対象は「**枠＋背景＋文字色の3点セット**」＝バナーの形をしているもの23箇所。
  **アイコンチップ**（`rounded-full bg-info-bg`）と**App Shell上部の全幅バー**（`border-b`・
  カードではなく画面全幅の帯）は対象外——形が違うものを同じ部品にすると、かえって崩れる。
- `Notice` に `as` を足した（`Card` と同じ考え方）。**見出しを持つ通知は `section`** のまま保つ。
  `div` にすると `aria-labelledby` が指す landmark が消える（ログインの「メール確認が必要です」・
  Checkout後の「お申し込みを受け付けました」の2箇所）。
- 再発防止: `notice-banner.test.ts` が3点セットの手書きをリポジトリ全体で検査する。
- 検証: 単体1,625 / build / E2E 48 passed・1 skipped。AI設定3タブ・Xアカウント・投稿作成・
  ニュースを1440pxで目視確認し、padding と文字サイズが揃ったことを確認した。

### T-M8-53: 「再連携」が対象を指定するようにし、「プランを選ぶ」の跳ね返りを直す `done`
- 参照: 要件05 §3、要件06 §1.2.1、要件03 §2.2、CLAUDE.md 原則1・2 / 依存: T-M8-52 / サイズ: M
- 利用者からの指摘2件（2026-08-04）。**どちらも「押したのに意図と違う結果になる」型**。
- (1) **「再連携」が「Xアカウントを追加」と同じURLへ飛んでいた。** 対象を渡していないため、
  別のXアカウントで認可すると**新しい行が増え、壊れた行はそのまま残る**（押した本人は直った
  つもりになる）。逆に同じアカウントで認可すれば upsert で `active` へ置き換わるので、
  失効の表示は消える——つまり**正しい経路は元から動いていて、取り違えの防止だけが無かった**。
  - `?account=<x_account_id>` を受け、本人所有を確認して `x_user_id` を封緘stateへ載せる。
  - callbackで認可されたX userが一致しなければ**保存せず中断**し、
    `reason=reconnect_account_mismatch` として「新しい連携は作っていません」まで含めて伝える。
  - **再連携はplan上限に数えない**（startも）。上限まで使っていると失効を直せず行き止まりになる
    （callback側の `assertCanLinkXAccount` は元から上限対象外にしていたので、startだけが不整合だった）。
- (2) **「プランを選ぶ」が押すとホームへ弾き返されていた。** 設定＞課金は `stripe_customer_id` の
  有無だけでボタンを切り替えており、**契約は有効（trialing/active）なのに顧客が未紐づけ**のとき
  「プランを選ぶ」を出していた。`/plans` は契約済みを `/app` へ送り返すので、押すと何も起きない。
  webhookの到着順で一時的に起こり得る（ローカルのレビュー用アカウントは常にこの状態）。
  - `canExecuteSubscription()` を公開し、その場合は行き先を出さず**同期待ち**として伝える。
  - 未契約（incomplete等）は従来どおり `/plans` へ送る（そちらは弾き返されない）。
- 検証: 単体8件追加（callback 3・start 2・`canExecuteSubscription` 3）／E2E 2件
  （再連携リンクに `account=` が入り「追加」には入らない／同期待ちで「プランを選ぶ」を出さず、
  未契約なら出す）。ローカルの実ブラウザで両方の実際の挙動を確認した。
- 後続への注意: 失効アカウントを**使うのをやめたい**ときは「連携を解除」が正しい導線。
  再連携は「同じアカウントを直す」操作なので、別アカウントを増やす用途には使わせない。

### T-M8-54: 停止中のXアカウントを畳み、課金の行き止まりを解消する `done`
- 参照: 要件06 §1.2.1、要件03 §2.2、CLAUDE.md 原則1・2 / 依存: T-M8-53 / サイズ: M
- 利用者からの指摘（2026-08-04〜05）。**2回作り直した。1回目の設計は過剰で、2回目で単純化した。**
- (1) **使っていないXアカウントが一覧に並び続けていた**（ローカルで3件のうち2件が不要）。
  - **最終形**: `status = 'disabled'` を `<details>`「停止中のアカウント N件（投稿履歴と実績は
    残っています）」へ畳む。`expired`／`error` は畳まない（再連携というやることが残っており、
    隠すと気付けない）。行は消さない（下書き・履歴・実績が参照する）。
  - **1回目は `disconnected_at` 列を足して「利用者の解除」と「プラン変更による自動停止」を
    区別しようとしたが、取り消した**。理由: (a) 区別しても畳む/畳まないの判断は変わらず
    ラベルが正確になるだけ、(b) **列を足す前に停止された行は畳まれない**（ローカルの2件が
    まさにこれで、指摘の原因そのものだった）、(c) migrationが増えて反映手順も重くなる。
    **既存データで動かない設計は、正しくても採用しない。**
- (2) **同期待ちの説明文が不要だった**（利用者指摘）。T-M8-53 で「跳ね返り」を止めるために
  ボタンを消して説明文にしたのが誤りで、次に説明文＋ボタンの併記にしたが、**カード直下の既存文
  「変更内容はStripeからの通知を受けてこの画面へ反映されます（数十秒かかることがあります）」と
  同じことを言っていた**。同じ内容が2か所に出ると、常時出る注意書きとして読み飛ばされる。
  - **最終形**: 説明文を出さず「プランを選ぶ」だけ。跳ね返りは `/plans` 側で直す
    （**Stripeの顧客が紐づいている契約者だけ** `/app` へ送り返す）。
  - 未使用になった `canExecuteSubscription` も削除した（自分で足した「未使用exportを残さない」
    規約に従う）。
- 教訓を2つ残す:
  - **行き先を消して説明に置き換えるのは解決ではない。** 状況を伝えても進める場所は必ず残す。
  - **説明を足す前に、同じことが既に書かれていないか探す。** 重複した注意書きは読まれなくなる。
- 検証: 単体1,630・E2E 9件（x-oauth）。**migrationは無し**（1回目のものは取り消し、ローカルの
  列と履歴も戻した）ので、stagingへの反映に `--apply` は不要。実ブラウザで確認した。

### T-M8-55: プラン管理が開けない原因を名指しし、変更の結果を押す前に示す `done`
- 参照: 要件03 §2.2、要件06 §1.2、CLAUDE.md 原則2 / 依存: T-M8-54 / サイズ: M
- 利用者からの指摘3件（2026-08-05）。
- (1) **「プラン変更」「解約する」が必ず失敗していた。** 原因は**環境変数の取り違え**で、
  `.env.local` に `STRIPE_PORTAL_CONFIGURATION_ID` が**2回定義**されており（28行＝ローカル、
  70行＝接頭辞を付け忘れた staging の値）、`--env-file` は後の定義が勝つため
  **ローカルの鍵で staging の設定IDを参照**して `No such configuration` になっていた。
  - 直したのは診断側。`doctor` が `resource_missing` を「設定IDがこのStripeアカウントに
    見つかりません。別の環境の値が入っている可能性があります」として **error** で名指しする
    （従来は「確認できませんでした」の warn で、原因に辿り着けなかった）。
    Stripeへ届かなかっただけの場合とは区別する。
  - `.env.local` の重複行は削除した（値は staging のものと同一だったことを確認済み）。
- (2) **プラン変更のUIをブラッシュアップ**。`lib/billing/plan-change-effects.ts` を作り、
  **押す前に「いつから・支払いがどう変わるか」**を4項目で出す（上位／下位／解約／トライアル中）。
  日付は実際の `current_period_end` をJSTで出し、無い・壊れている場合は**日付を作らない**。
  - 途中でMarkdownの `**` を文字列に埋めてしまい**画面に `**` が出た**。強調は
    `headline` / `detail` に分けて要素で表す形へ直し、単体テストで記号の混入を禁止した。
- (3) 利用者の質問「いつからプラン変更になるか／支払いはどう変わるか」への答えは、
  **画面に書くのが正しい**と判断してUIへ入れた（Stripeの設定と1対1で対応させる。
  片方だけ変えると画面の説明と実際の請求が食い違う）。
- 途中で見つけた別の不具合: `e2e/plans.spec.ts` が **T-M8-31 の改名に追随しておらず**
  「プランを管理」を探していた（顧客が無い経路しか通っていなかったので緑のままだった）。
  実態（「プランを変更」「解約する」）へ直し、顧客がある経路も通すようにした。
- 検証: 単体9件追加（`planChangeEffects`）＋3件（設定IDの名指し）／E2E 4件（plans）。
  実ブラウザで1440pxと390pxを確認。Stripeへ実際にPortal Sessionが作れることも確認した。

### T-M8-56: プラン変更・解約が正しい画面に着くようにし、X連携の文言を直す `done`
- 参照: 要件03 §2.2、要件06 §1.2.1、CLAUDE.md 原則1・2 / 依存: T-M8-55 / サイズ: M
- 利用者からの指摘3件（2026-08-05）。
- (1) **「プランを変更」がプラン選択に、「解約する」が解約画面に着かなかった。** 原因は2層。
  - `flow_data` は `profiles.stripe_subscription_id` が null だと組まれず、**黙ってPortalの
    トップを開く**設計だった（「開かないよりトップの方がまし」という以前の判断が、
    実際には「押した先で何もできない」体験になっていた）。
  - ローカルのStripe顧客に**subscription自体が存在しなかった**（seedが紐づけていない）。
  - 直し方: (a) null のときは**Stripeからその顧客の変更できる契約**（active/trialing/past_due・
    新しい順）を引いて補う——webhook同期前でも正しい画面に着く。(b) それでも無ければ
    黙ってトップを開かず `subscription_required` で止める。(c) `seed:review` が
    **本物のStripeテスト契約**（trialing・支払い方法なし・`sk_test_` 限定）を作って紐づけ、
    ローカルで変更・解約まで実際に試せるようにした（何度実行しても同じ契約を再利用）。
  - update / cancel 両方の flow_data セッションがStripeで作れることを実測（Stripeは
    flow_data をサーバー側で検証するので、これが「正しい画面に着く」ことの確認になる）。
- (2) **「状態を更新」が何の状態か読めなかった。** 実体は「Xに問い合わせて、この連携がまだ
  使えるかを確かめる」操作。ラベルを**「接続を確認」**にし、押した結果の状態
  （有効／要再連携…）を**トーストで返す**ようにした（無言で終わらない・原則1）。
- (3) **停止中のダミーアカウントの名前が不自然だった**（「確認用 X アカウント」＝半角スペース
  混じり）。seedの名前を「動作確認用アカウント」へ。
- 検証: 単体4件追加（subscription解決: 正本優先・fallback・無ければ拒否・intent無しは
  問い合わせない）／E2E 1件（「接続を確認」の結果トースト）。seed実行→flow_data実測まで確認。
- 後続への注意: `PortalStripeGateway` に `subscriptions.list` が増えた。route は実SDKを
  そのまま渡しているので追加作業は無いが、モックを書くときは忘れずに。

### T-M8-57: トライアル中の解約が画面へ反映されない問題を直し、予約済みの導線を替える `done`
- 参照: 要件03 §3、要件06 §1.2、CLAUDE.md 原則1 / 依存: T-M8-56 / サイズ: S
- 利用者がPortalで解約 → **設定画面が「解約予定なし」のままだった**（2026-08-05）。
- 原因: 同期は動いていたが、**読む場所が足りなかった**。トライアル中の解約では、Stripeは
  `cancel_at_period_end: true` ではなく **`cancel_at`（=trial_endの日時）だけ**を設定する。
  projection が boolean しか読んでいなかったため、正しく同期して「解約予定なし」になっていた。
  実測で確認（Stripe: `cape=false, cancel_at=2026-08-11T15:50Z`）。
  → `cancel_at_period_end || cancel_at != null` として読む。
- 併せて（利用者の3件目の指摘への対応）: 解約後に「プランを変更」を押すと**Stripeの画面では
  現契約が¥2,980のまま**に見える——これは期間末解約の正しい姿（期間終了までは現プランのまま）
  だが、アプリ側が「解約予定」を出せていなかったので意図が読めなかった。反映を直したうえで、
  **予約済みのときは「解約する」を「解約予定を取り消す」に替える**（Portalトップを開く。
  取り消しはStripeが「プランを続ける」として提供し、`flow_data` に専用の型は無い）。
  effects の解約欄も「2026年8月12日に解約されます／すでに解約が予約されています」へ切り替わる。
- レビュー用アカウントのprofileは実態（解約予約済み）へ合わせ済み。
- 検証: 単体3件（`cancel_at`のみ／booleanのみ／どちらも無し）／E2E（plans）で説明とボタンの
  切り替えを固定。実ブラウザで「期間終了日に解約予定」「解約予定を取り消す」の表示を確認。

### T-M8-58: 登録確認の無言着地・Stripeの英語表示・BYOKキー画面を改善する `done`
- 参照: 要件05 §3、要件03 §2、要件06 §3.2、CLAUDE.md 原則1・2 / 依存: T-M8-57 / サイズ: M
- 利用者からの3点（2026-08-05）。
- (1) **メール確認後の着地が無言だった**。失敗時は「リンクを確認できませんでした」が出るのに、
  成功は黙って料金表に変わるだけで、確認できたのか分からなかった。
  signup成功の着地を `/plans?confirmed=1` にし、「メールアドレスの確認が完了しました。
  プランを選ぶと7日間の無料トライアルを開始できます。」を出す（URL由来の画面状態なので
  トーストではなくインライン・要件06 §2.1）。
- (2) **Stripeの画面の日本語化**。2層あった。
  - セッションの `locale` を `"ja"` に固定（Checkout・Portal両方。ブラウザ言語の推定に任せない）。
  - **商品名がStripe側で英語だった**（Standard／md／Premium。Checkout・Portal・請求書に
    そのまま出る）。`stripe:portal:setup` が商品名もアプリの表示名へ揃えるようにし、
    ローカルへ適用済み（Standard → 通常プラン 等）。対応表と `plans.ts` の一致は
    `portal-configuration.test.ts` が検査する。**staging/productionは次回のsetup実行で揃う**。
- (3) **BYOK（通常/md）のAPIキー画面**。監査（4観点）＋目視で6件直した。
  - 「差し替え準備中」プレースホルダを削除（秘密鍵を貼らせる画面で未完成の印象を与える。
    BACKLOGの素材準備タスクは残っており、素材確定後に画像を足す）。
  - 冒頭に全体像（必要なのは**2つ**: Xキー＋AIキーどれか1社）をNoticeで出す。
  - AI各社カードへ**取得ページへのリンク**＋「従量課金。支払い設定と利用上限を推奨」
    （X側だけ手順があってAI側に無い非対称を解消）。
  - Client種別へ推奨（通常はPublicのまま）を添える。
  - scope 5種を `lib/x/scopes.ts` の共有定数から描画（直書きだと実装と乖離しても検出できない。
    `oauth.ts` は `node:crypto` を含み client から読めないため、純粋モジュールへ分離）。
  - callback URLの表示を `xRedirectUri()` へ一本化（表示と実送信の式が独立に2箇所あり、
    片方だけ変えると「Consoleへ登録した値」と実送信が食い違って連携が全滅する構造だった）。
- 検証: 単体1,650・E2E（auth signup / x-oauth 10件）緑。BYOK画面とメール確認の着地を実ブラウザで確認。
  商品名の変更はStripe APIの返り値で確認（"Standard → 通常プラン" 等がsetup出力に出る）。

### T-M8-59: BYOKキー画面の未検証所見を検証し、確認された10件と利用者指摘4件を直す `done`
- 参照: 要件06 §1.2.2・§3.2、要件05 §4.1・§5、CLAUDE.md 原則1・2 / 依存: T-M8-58 / サイズ: L
- **検証の結果**: 11所見（重複除去後）を否定側から検証し、**10件確認・1件棄却**
  （棄却=「Server Action呼び出しにtry/catchが無い」。現行コードでは全呼び出しが対処済みだった）。
- 確認されたbug 1件: **Client種別が保存済みの種別を無視して常にPublicで初期化**。
  Confidential保存済みの利用者がClient IDだけ差し替えて保存すると無警告でPublic化し、
  以後のtoken交換（Basic認証必須）が全滅する → `displayHint.client_type` から初期化。
- confusing 5件: Xの「形式を確認」削除（何も確認せず「未確認」へ戻すだけだった）／
  zodの具体文言を保存系actionで返す（password型で空白・全角が目視できない）／
  削除確認にprovider別の波及を明示／Xキー保存後に「Xアカウント連携を開く」リンク付きトースト／
  「秘密値」「BYOK」を利用者の言葉へ。
- polish: 手順ガイドへのアンカー／Client ID 1〜4文字時に「いまn文字」／Action層dbテスト3経路追加
  （saveAi・verify(x)・delete がどのテストからも未呼び出しだった）／器の別系統はT-M8-60へ分離。
- 利用者指摘4件も同じ作業単位で対応:
  - **AIキーの説明**: 実装は3社とも文章生成＋リサーチ対応（webSearch実装＋実API契約テスト）。
    「Claudeのみ」はプレミアムの固定表示（運営Claude）との混同 → 対応範囲バッジ＋**縦並び**へ。
  - **X Developer Appの手順が実Consoleと違った**: 「必要scopeを5つ許可」は**Consoleに存在しない
    設定**（scopeは連携時にXの許可画面で承認）。公式docsで確認した実構成
    （アプリタイプ→callback URL→Client ID→credits）へ書き直し、アプリタイプ⇔Client種別の対応を明記。
  - **通知タブの表示名（プロフィール）を削除**: どこにも使われていなかった（grep確認）。
    action・スキーマ・純関数も削除。`profiles.display_name` 列は既存データ保持のため残す。
  - Client ID入力の設計疑問 → 回答のみ（変更なし）。
- 検証: 単体1,649・DBテスト（actions 11件）・E2E（x-oauth 13件・auth）緑。1440px目視確認。

### T-M8-61: X手順を非エンジニア向けに全画面・全入力値まで詳細化し、display_name列を削除する `done`
- 参照: 要件06 §3.2、要件02、CLAUDE.md 原則2 / 依存: T-M8-59 / サイズ: M
- (1) **X Developer Appの手順を画面遷移と入力値まで書き下ろした**（利用者要望）。
  - ①開発者アカウント（同意・利用目的の書き方の例）→②App作成（App名の例・説明の例文）→
    ③アプリタイプとcallback URL（タイプ⇔Client種別の対応、完全一致の注意、Website URL等の
    予期しない必須欄への逃げ方）→④Keys and TokensからClient IDコピー（**並んでいる他の値は
    使わない**ことも明記——API KeyやBearer Tokenを貼る誤りを防ぐ）→⑤支払い。
  - **支払いの解説ボックス**: 前払いクレジット方式・単価の目安（投稿$0.015／URL付き$0.200、
    公式docsで確認・2026年8月時点）・月額の例（1日3投稿で約$1.35）・自動チャージは最初オフ推奨・
    **支出上限は必ず設定**（上限到達でAPIが止まるだけ＝高額請求の安全装置）。
  - UI上のラベルはConsole側の変更があり得るため、断定できない欄は「〜が出た場合は」と条件付きで書いた。
- (2) **`profiles.display_name` 列を削除**（利用者判断: 既存データ不要）。
  migration `20260805000001`。要件02から行を削除し、`schema-doc-sync.db.test.ts` が一致を確認。
  参照していたテスト3本は別のnull許容列へ差し替え。seedからも除去。
  **stagingへの反映には migration 適用が必要**（`release:staging -- --apply`）。
- 検証: 単体1,649・DBテスト・E2E（x-oauth 10件）緑。1440pxで手順ガイドの描画を目視確認。

### T-M8-62: X手順を実機のConsole構成へ直し、Client種別セレクタを撤去する `done`
- 参照: 要件06 §3.2、要件05 §5、CLAUDE.md 原則2 / 依存: T-M8-61 / サイズ: S
- **利用者が実機のDeveloper Consoleを操作して確認した構成**へ手順を修正（正確さの根拠は実機。公式docs由来の旧タクソノミより優先）:
  ①開発者アカウント → ②「App」タブでApp作成（**Environment: Production**。Consumer Key・Bearer Tokenは使わないと明記）→
  ③OAuth 2.0セットアップ（**App permissions: Read and Write**／**Type of App: Web App, Automated App or Bot**／
  Website URLは自分のXプロフィールURLでよい）→ ④Client IDコピー（**Client Secretは使わない**と明記）→ ⑤Creditの支払い。
- **Client種別（Public/Confidential）セレクタとClient Secret欄を撤去**——現Consoleに選択が存在せず、
  利用者に選ばせても答えが無い。保存は常にpublic/PKCE（Client IDのみ）。保存済み表示の「（Public）」表記も削除。
  Server Action／OAuth側はconfidentialの既存行を引き続き扱える（後方互換）。
- **→ 後日訂正（T-M8-63）**: 「Client IDのみで連携できる」は誤りだった。Web App/Bot型はSecret必須で、連携が401で失敗。Secret欄のみ復活（セレクタは戻さない）。
- 検証: 単体1,649緑・E2E x-oauth 10件緑（Client種別・Secret欄が無いことをE2Eで固定）。1280pxで手順の描画を目視確認。

### T-M8-63: X連携の「予期しないエラー」を直す（Client Secret必須の実測反映） `done`
- 参照: 要件05 §4.3、要件06 §1.2.1/§3.2 / 依存: T-M8-62 / サイズ: M
- 利用者報告:「Xアカウントを連携しようとしたら『予期しないエラーで連携を完了できませんでした』」。
- **原因（実測で確定）**: 保存済みClient IDで token endpoint へ交換を試すと `401 unauthorized_client
  ("Missing valid authorization header")`。現Consoleの「Web App, Automated App or Bot」=confidential client
  で、**token交換にClient Secret（Basic認証）が必須**。T-M8-62の「Secretは使わない」は誤りだった。
  XTokenError が internal_error に丸められ、原因が画面に出ていなかった（原則2違反）。
- 修正:
  - **Client Secret欄を復活**（「Client種別」セレクタは戻さない。**Secretの有無から種別を導出**:
    空=public／あり=confidential）。欄に「Web App/Botで作った場合は必須」の注記。
  - **token交換の失敗を原因別に表示**: 401/invalid_client→「Client Secretの保存が必要」（APIキータブへの導線付き）、
    invalid_grant→「やり直せば直る」、その他→X側の通信失敗。internal_errorに丸めない。
  - 手順ガイド④を「Client IDとClient Secretを両方保存」へ（Secretは1回しか表示されない・再発行可も明記）。
- 検証: oauth-callback単体（写像3件追加）・E2E x-oauth 10件緑。**実際の連携成功は利用者の再操作待ち**
  （Client Secretを保存 → Xアカウント連携。こちらではXの認可画面を通せない）。

### T-M8-64: テストが実アカウントへ残す偽ニュース通知を止める `done`
- 参照: 開発とテストの進め方 §DB統合テスト / サイズ: S
- 利用者報告:「通知からニュースへ飛んでもニュースが表示されない」。
- **原因**: `news-digest.db.test.ts` のfan-outは条件が合う**全利用者**へ通知を作るが、後片付けが
  テスト用ユーザーの分しか消していなかった。共有ローカルDBの実アカウントに**未来窓（2027年等）の
  偽ダイジェストが3,436件**残り、押しても常に0件のニュース画面になっていた（ローカル固有。staging/本番には無い）。
- 修正: `newsDigestDedupeKey()` を公開し、3テストの後片付けを**窓のdedupe_keyで全員分削除**へ変更。
  ローカルDBの偽通知3,436件を削除（正当な282件は保持）。修正後にテストを回し汚染ゼロを確認。
- 実装メモ: fan-out系テストの後片付けは「行の所有者」ではなく「イベントのキー」で消す（開発とテストの進め方 v4.10へ追記）。

### T-M8-65: プラン変更画面（Stripe Portal）に各プランの説明を出す `done`
- 参照: 要件03 §課金画面 / サイズ: S
- 利用者要望:「プランを変更を押した後の画面に、簡単に各プランの説明を記載できますか？」
- Portalのプラン選択はStripeホスト画面のため直接は編集できないが、**商品のdescriptionが商品名の下に表示される**。
  `stripe:portal:setup` に `PRODUCT_DESCRIPTIONS` を追加し、名前と同様に冪等に同期するようにした。
  文言は `/plans` のプランカードと揃え、数字（アカウント数・月間上限）は `portal-configuration.test.ts` が
  `plans.ts` との一致を検査（乖離したら落ちる）。ローカルへ適用しAPI読み戻しで反映を確認済み。
- **staging/productionへは `npm run stripe:portal:setup -- --target <env>` の再実行が必要**（別Stripeアカウントのため）。

### T-M8-67: 本番の体感速度を上げる（直列DB往復の解消・タブ応答・取得上限） `done`
- 参照: 要件06 §1/§2/§8、CLAUDE.md 前提（全画面監査 124件のうち perf 31件） / サイズ: L
- 利用者要望:「本番環境になった際に画面遷移に時間がかかりすぎそうなものがあれば改善したい」。
- **直列await→並列化**: layout（5段→2段）・ホーム（約9段→2段）・投稿（4段→2段）・スケジュール
  （3段→1段）・設定（4段→2段）・ニュース（4段→3段）・AI設定（AI用途タブ3段→2段）。
- **リクエスト内メモ化**: `getCurrentUser`（auth往復＋プロフィール確認が毎画面2回→1回）と
  `resolveActiveXAccountForUser` を React cache() でラップ。`ensureUserProfile` はread-first化
  （毎表示のupsert書き込み→正常系は読み取り1回）。
- **タブ切替の無反応解消**: TabNavのラベルに `useLinkStatus` のスピナー（`tab-nav-label.tsx`）。
  **TabNav本体をclient化してはいけない**——`hrefFor`（関数props）が境界を越えられず全タブページが
  実行時エラーになる（typecheckでは検出不能。実際に踏んでE2E10件全滅→切り戻した）。
- **取得上限**: ホーム確認待ち5件＋総数count／履歴タブ直近50件（上限到達は画面に明示）／
  スケジュール画面の下書きカードlimit 5。`listDraftsForAccount` に limit 追加。
- **loading**: /plans に loading.tsx 追加。/app の loading コンテナ幅をページと一致。
- 検証: 単体1,656緑・E2E全54件緑（4.8分。改善前の完走は12.6分だった）。

### T-M8-66: 全画面の説明文を簡潔化する（重複・予防的リスク文の削減） `done`
- 参照: 要件06 v1.57（§1/§1.2.2/§3.2/§3.4/§3.5/§8）、CLAUDE.md 前提 / サイズ: L
- 利用者フィードバック:「説明文章が簡潔ではない＆説明しすぎで分かりにくい。リスク説明は不要（MVP）」。
  全画面監査（124件中 copy 70件）から約45箇所を修正。方針:
  - **同じ情報を2箇所以上で言わない**（例: 挨拶行の次回実行はKPIカードと重複→日付のみ、
    凡例の「確認なしでXへ」はステータス行と重複→ラベルのみ、通知タブのニュース仕様説明を2文へ）。
  - **操作前の予防的リスク説明を削る**（投稿確認の「失敗時は自動削除・復元不能」、破棄の
    「復元できません」、二重申込警告など。**エラー時の原因説明・押せない理由は削らない**）。
  - **ボタンが示すことを文で繰り返さない**（空状態の「〜しましょう」、停止中の操作説明など）。
  - **内部用語を出さない**（スロット・ジョブ・thread・SYS-GEN・時間窓 → 平易な言い換え）。
  - タグラインを `plans.ts` に一元化（ランディングと/plansで文言が食い違っていた）。
- **例外（削らなかったもの）**: プラン変更ボタン下の「いつから・支払いがどう変わるか」dl——
  T-M8-55で利用者自身が明示的に求めた情報のため維持。
- **利用者の手元編集を取り込み**: api-key-settings.tsx に利用者本人がConsole実機の文言
  （英語の利用目的例文・実メニューパス・注意書きの削減）を直接編集していたのを発見。
  編集は正として保持し、壊れていた冒頭文と未使用importだけ修正。scope注記の撤去に伴い
  要件06の「共有定数から描画」要求も撤回。
- 検証: 単体1,656緑・E2E全54件緑。
- 追記（2026-08-08）: 利用者の手元編集の取り込み第2弾（プラン変更の説明dlからStripe言及と
  「差額の返金はありません」括弧書きを削除、portal-buttonの常時注記を削除、x-oauth specの
  不在検査を広い文字列へ）。**返金なしの開示は解約側の文言と利用規約第5条・特商法表記・
  申込前確認事項が引き続き担う**（下位変更の注記からのみ削減）。テストは新文言へ同期済み。

### T-M8-70: タップ対象寸法・コントラスト・iOSズーム・配置を改善する `done`
- 参照: ADR-0007、mobile-layout.spec.ts / サイズ: M
- 利用者要望「ボタン・フォントの大きさ／オブジェクトのサイズや配置を適切に」を受けた実測監査
  （ボタン67箇所・入力38箇所・リンク類）に基づく修正:
  - **Button基準サイズ**を1段引き上げ（sm 28→32px / default 32→36px / lg 36→40px / icon同様）。
    最頻出のsmがWCAG 2.5.8ぎりぎりで「投稿/破棄」の並びの誤タップ余地が大きかった。
  - **16〜23pxしかないテキスト操作**（ホームのカードヘッダリンク・履歴/Xリンク・通知の
    「すべて既読」「メールを再送」・トースト閉じる）を `py-2 -my-2` 等で**見た目を変えず**
    当たり判定24〜36pxへ。素の**checkbox/radio**（通知設定・曜日選択等）は size-4＋ラベル全体を
    min-h-9〜10のタップ対象に（persona-settings-formの既存パターンを横展開）。
  - **ink-3を0.45→0.56**（コントラスト比3.36→約4.6:1、WCAG AA適合。32箇所へ一括で効く）。
  - **iOSズーム対策**: モバイル幅の入力系font-sizeをglobals.cssの無層メディアクエリ1本で16pxに
    （38箇所中37箇所が16px未満でフォーカスのたびに自動ズームしていた）。@layer外に置くのは
    Tailwindのユーティリティ層より優先させるため。e2eが実font-sizeを検査（再発防止）。
  - **配置**: 下書きカードの操作行に flex-wrap（状態テキスト＋ボタン4個が狭い幅ではみ出していた）。
    mobile-layout.spec の巡回に /plans（このspecを生んだ画面なのに漏れていた）と /reset-password を追加。

### T-M8-71: タイプスケールを21段→3段トークンへ統一する `done`
- 参照: ADR-0007、`type-scale.test.ts` / 依存: T-M8-70 / サイズ: M
- フォントサイズ21種（12/12.5/13/13.5/14pxの5段併存・約380箇所）を役割ベースの3段へ:
  **text-caption(12px)／text-body(13px)／text-sm(14px)**。globals.cssの@themeにトークンを定義し、
  46ファイルを機械置換。15px未満の任意値は `type-scale.test.ts` が禁止（装飾11pxはバッジ・
  未読ドット・下部ナビのみ許可リスト）。
- **落とし穴（重要）**: 素のtailwind-mergeは `text-body` を**文字色と誤分類**し、`cn("text-body",
  "text-brand")` でサイズ側が黙って消える（tab-navで実際に発生しテストが検出）。
  `src/lib/utils.ts` で extendTailwindMerge によりfont-sizeグループへ登録して解消。
  今後カスタムの text-* トークンを足すときは必ずここにも登録する。

### T-M8-72: 法務3ページを本番運用版へ書き換える `done`
- 参照: 特定商取引法11条、個人情報保護法（27条・28条・33条以下）、要件06 §11 / サイズ: L
- 利用者要望「法務の部分も本番運用でも使える形にしてください」。3ページ合計168行の草案
  （利用規約6見出し・プライバシー4見出し各1文）を、法定事項を網羅した本番版へ全面改訂した。
- **事業者情報・委託先・Cookie・外部送信先を `src/lib/legal-entity.ts` へ集約**。
  以前は特商法ページに事業者情報を直書きし、問い合わせ先だけ「法務ページはハードコード／
  アプリは env.SUPPORT_EMAIL」の二重管理だった（片方を直すと他方が古くなる）。
- **利用規約**: 16条構成へ。追加した条項＝アカウント登録／BYOKの費用負担（別途課金の明示）／
  無料トライアルは初回のみ（実装 `trialUsedAt === null` に一致）／退会（セルフ削除が無く
  問い合わせ窓口経由であること）／生成物と投稿の責任の所在／自動投稿の明示同意と即時停止／
  学習ソース（第三者投稿）の責任／サービスの中断・変更・終了／規約変更の手続き／
  免責と責任の上限（12か月の支払額上限。消費者契約法により無効となる全部免責にしない）／
  準拠法・管轄（消費者に不利な専属的合意管轄にしない）。
- **プライバシーポリシー**: 11条構成へ。取得項目8分類（DBスキーマ由来）／利用目的8項目／
  委託先9社の表（名称・所在国・用途・取り扱う情報）／外国にある第三者への提供（法28条）／
  Cookie 4件の表／ブラウザからの外部送信3件（CSPの許可先が根拠）／保存期間（40日・24時間・
  削除まで）／開示等の請求手続（窓口・本人確認・2週間・無料）／苦情の申出先。
  **BYOKでは利用者自身のキーで送信されるため、プレミアム（運営キー）と法的位置づけを書き分けた。**
- **特商法表記**: 12→17項目。追加＝商品代金以外に必要な費用（BYOKのAPI従量課金＝法11条の
  「その他負担すべき金銭」）／販売条件（アカウント数・月間利用枠）／申込みの有効期限／
  返品特約（クーリング・オフの適用がない旨を含む）／支払方法と支払時期の分離。
- 版を `2026-07-22-draft` → `2026-08-08` へ。**暫定版バナー3箇所を撤去**し、内部値の `-draft` が
  利用者に露出していた問題（`consentVersionLabel` があるのに未使用）も解消。
- 共通レイアウト `components/legal-document.tsx` を追加（3ページで骨格・版表示・フッタが不統一だった）。
- `legal-pages.test.ts`（53検査）で法定項目の存在・暫定版表示の不在・数値をPLANSから引くこと・
  委託先一覧に実装の外部サービスが漏れないことを固定した。
- **残余リスクは報告済み**（弁護士確認の推奨、越境移転の根拠づけ、Sentry/Gmailのログ保持設定、
  データ所在地の確認）。要決定 D-16〜D-19 として起票。

### T-M8-73: 規約が約束した「改定時の再同意」を実際に機能させる `done`
- 参照: 要件06 §1.3、利用規約第14条 / 依存: T-M8-72 / サイズ: M
- **発見**: `requireExecutionAccess()` は実装・テスト済みだが**どこからも呼ばれておらず**、
  `/app/consent`（同意画面。実装済み）への導線も皆無だった。版を上げても再同意なしで
  生成・投稿・自動実行がそのまま通る状態で、規約に「再同意を求めます」と書くと虚偽になる。
- 修正: `requireLegalConsent(userId)` を追加し、Server Action 共通ガード
  `requireExecutionUserId()` から呼ぶ。実行を**開始する**Action 10本（生成6・スケジュール4）へ配線。
  読み取り・停止・削除・キャンセルは対象外（同意が切れても止められる／閲覧できる必要がある）。
- 契約状態の判定は `execution-prereqs` が既に「何が足りないか」を列挙するため、ここでは
  **法務同意だけ**を見る（同じ条件で二重にエラーを出さない）。判定式は同意画面と共有。
- 落とし穴2件: (1) Supabase adminクライアントは import 時に env 検証を走らせるため、
  helper を読むだけで環境変数必須のモジュールグラフになり単体テストが落ちた → pooled接続へ。
  (2) レビュー用seedが `'2026-07-20'` をハードコードしており、配線後に弾かれる状態だった
  → 現行版を書き込むよう修正し、テストで一致を固定。

### T-M8-74: LP（`/`）を design_handoff_lp のデザインへ刷新する `done`
- 参照: 要件06 §1 SC-01・§11（法務導線）、PRD §6（プラン）、`design_handoff_lp/README.md`（デザイン正本・hifi） / 依存: なし / サイズ: M
- 完了条件:
  - `/` がデザインリファレンス「Exos AI LP v2」の12セクション構成（ヘッダー／ヒーロー／ファクト／01課題／02できること／03しくみ／04安全性／05使い方／06料金／07FAQ／最終CTA／フッター）で表示される
  - 各ボタン・リンクが機能する: 「無料で始める」（ヘッダー・ヒーロー・プランカード3枚・最終CTA）→`/signup`、「ログイン」→`/login`、「料金を見る」とヘッダーnav 4項目→ページ内アンカー（#features/#how/#safety/#pricing、scroll-margin-top付き）、フッター法務3リンク＝`LegalFooter`
  - 価格・プラン名・Xアカウント数・プレミアム月間上限が `src/lib/plans.ts` 由来で、画面表記がハンドオフREADMEの文言と一致する
  - 主CTA直下2箇所にカード登録注記、プランカード直下にBYOK注記（折りたたみなし）が表示される
  - 390px／768px／1180pxで崩れ・横スクロールがない。`prefers-reduced-motion: reduce` で全アニメーションが無効になり全要素が即時表示される
  - ハンドオフREADMEの禁止表現を含まない。ブランドグラデーションの使用が規定3種（ロゴ／生成バー・上端3pxバー／プレミアム上端3pxバー）のみ
- メモ: リファレンスHTML（`Exos AI LP v2.dc.html`）はプロトタイプでありコピーしない。Next.js＋Tailwindで再現実装する。ヒーロー見出しは既定の「課題直撃」案（ネタ探しから投稿、分析まで。／X運用の毎日を自動化。）を採用。スクロール出現はIntersectionObserverの共通フック（クライアント側）で実装し、LPは`force-dynamic`＋nonce CSPを維持する。既存E2E・単体テストがLPの現行文言を固定している場合は新文言へ更新する。図版はすべてCSS/DOMで描く（画像アセットなし）。
- 追記（2026-08-09・利用者の手元編集の取り込み）: LP文言をさらに簡潔化（「（BYOK）」「（運営が用意）」の括弧書き・「Stripeで」「設定画面から、」・料金見出しの「（初回のみ）」を削除）。ハンドオフREADME・参照HTML・`docs/marketing/lp-design-brief.md`も同じ内容へ同期。**「（初回のみ）」を見出しから外した結果、初回限定である旨の開示が申込前確認事項の1行だけになった**ため、その1行を`landing-page.test.ts`で固定した（消すと「無条件で7日間無料」の表示になり2回目以降の申込みで事実と異なる）。実際に消して落ちることを確認済み。
- 実装結果（2026-08-08）: `src/components/lp/`（reveal / hero-mock / figures / pricing / faq）＋`page.tsx`全面書き換え。ロゴは`LogoTile`（brand-logo.tsxへ追加、20/24/28/40px）、法務リンクは`LegalFooterLinks`（legal-footer.tsxへ追加。LegalFooterと正本を共有）。固定文言・禁止表現・plans.ts参照・グラデーション5箇所制限は`landing-page.test.ts`、導線実動作とreduced-motionは`e2e/landing.spec.ts`が固定。図版の極小テキストは11pxに統一し`type-scale.test.ts`の許可リストへ2ファイル追加（参照デザインの10px相当は11pxへ寄せた＝唯一の意図的乖離）。ヘッダーのロゴワードマークは既存BrandLogo（17px）を再利用（参照は16px。単一ロゴ部品を優先）。仕様は要件06 §1.5 に追記。

### T-M8-75: 利用規約・プライバシーポリシーの運営者保護を強化する `done`
- 参照: 要件06 §11、要決定D-17 / 依存: なし / サイズ: S
- 完了条件:
  - 利用規約に次が追加されている: 利用資格（18歳以上・反社会的勢力の排除）／知的財産権の帰属／利用者の賠償責任（規約違反・第三者紛争で当方に生じた損害）／権利義務の譲渡禁止と事業譲渡時の承継／専属的合意管轄（横浜地方裁判所）
  - プライバシーポリシー第9条の回答期限が「原則2週間以内」の自己拘束から「遅滞なく」へ緩和されている
  - 既存の消費者保護の型（上限つき責任制限・消費者契約法セーブ条項・返金なし・トライアル初回のみ）が維持されている
  - 条番号の再採番後も条文間の相互参照（変更手続き・問い合わせ窓口）が正しい
  - `legal-pages.test.ts` が新条項の存在を機械検査する
- メモ: 2026-08-08の法務文言レビュー（LP刷新後）で判明した運営者保護の欠落を埋める。同意version（2026-08-08）は同日中の改訂のため据え置き（公開前でありテスト用アカウントのみ）。作成者は弁護士ではないため、専属管轄・免責上限・賠償条項の有効性はD-17の弁護士レビュー論点に含める。
- 実装結果: 利用規約を16条→19条へ再構成（第2条=利用資格・アカウント登録、第12条=知的財産権、第13条=利用者の賠償責任、第16条=権利義務の譲渡を新設。相互参照は第17条=変更手続き・第19条=窓口へ更新）。管轄は「法令に定める裁判所」→横浜地裁の専属的合意管轄へ。プライバシー第9条は「原則2週間以内」→「遅滞なく」（手数料無料は維持）。`legal-pages.test.ts` 53→59件。**T-M8-73がBACKLOG参照に書いた「利用規約第14条」は当時の番号で、現在は第17条**。

### T-M8-76: LPがJS無効で白紙になる問題を直し、情報量を整える `done`
- 参照: 要件06 §1.5、`design_handoff_lp/README.md`（v2.1へ改訂） / 依存: T-M8-74 / サイズ: M
- **発見（実測）**: LPを `javaScriptEnabled: false` で開くと**ヘッダー以外が完全に白紙**だった。
  出現演出の `Reveal` が初期 `opacity:0` で、IntersectionObserver が解除するまで何も見えない設計。
  JSのロード失敗・CSPブロック・JS無効のいずれでも同じ状態になる。**LPは会員登録の唯一の入口**で、
  サーバーは200を返し単体もE2Eも緑のため、申込みが0件になっても運営者は気付けない（CLAUDE.md 原則1）。
- 修正: 出現演出を**廃止**した。途中 `animation-timeline: view()`（JS不要）へ移したが、画面外を
  `opacity:0` に保つ性質は同じで、印刷が空白になり「ページ全体が読めるか」を一度に検証できないため不採用。
  `Reveal` を削除し `"use client"` はLPから消えた（LPは完全な静的ページになった）。
- 情報量の削減（利用者の「ごちゃごちゃしている」指摘）: 他セクションの再掲でしかない要素を削除
  — ファクトストリップ全体（4項目すべてが後続の再掲）／ヒーローのピルバッジ（h1と同義）／
  01課題のリード文／03しくみの末尾注記（料金のmdプラン説明と重複）とSTEP4のミニ投稿カード図版／
  最終CTAの「7日間、すべての機能を無料で試せます。」（直下の注記と重複）／ヒーローモック下部の注記。
  加えて02できること2枚・03しくみのリード・FAQ4問の回答を、図版や本文と重複する部分だけ短縮。
  **法令必須の文言（カード登録注記2箇所・BYOK注記・申込前確認事項6項目・初回限定の開示）は一切触っていない。**
- アクセシビリティ（実測して修正）: ヘッダーnavのクリック領域が20pxで WCAG 2.5.8（24px）未達 → `min-h-6`。
  navが2つあるのに `aria-label` が片方だけ → 「セクション」を付与。
  h1=1・見出し階層の飛びなし・コントラスト不足0件・aria-hidden内にフォーカス可能要素なしは元から適合。
- 検証: 単体1,732緑／E2E landing 3件・mobile-layout 3件緑／実ブラウザでJS無効時に全内容が読めることを確認。
  **機械検査は実際に壊して落ちることを確認済み**（Revealを opacity:0 に戻す／CSSで `[data-reveal]` を隠す／
  本文要素を1つ透明にする、の3パターン）。
- 後続への注意: `landing-page.test.ts` は「LPのソースに `opacity-0` と `use client` が無いこと」
  「CSSに `animation-timeline` が無いこと」「keyframesが既知の4つだけ」を固定する。
  演出を足したくなったら、**内容を隠さない**方法（transformやcolorのみ）にすること。

### T-M8-77: LPから安全性セクションを外し、できることを4枚の縦積みにする `done`
- 参照: 要件06 §1.5、`design_handoff_lp/README.md`（v2.2） / 依存: T-M8-76 / サイズ: S
- 利用者の指示:「04が不要」「02は4つ縦に並べる形に」。
- **04 安全性を削除**し章番号を詰めた（01課題／02できること／03しくみ／04使い方／05料金／06よくある質問）。
  ヘッダーnavは3項目（できること・しくみ・料金）になり、`#safety` は消えた。
- **削除で行き場を失う記載を先に移した**（ここを見落とすと黙って情報が消える）:
  「勝手に投稿しない」「即座に停止」はヒーローのチェック3点が既に持っていたので維持。
  **APIキーの暗号化・末尾4桁のみ表示・削除可**と**停止で実行待ちもキャンセル**は、
  T-M8-76でFAQから外して安全性セクションに委ねていたため、FAQの回答へ書き戻した。
  この2点が**LP上で唯一の記載**になったので `landing-page.test.ts` が存在を固定する。
- **02 できること**をベントーグリッド（12col・7/5→5/7）から**4枚の縦積み**へ。全幅カードに
  本文を流すと1行が長すぎるので、カード内を本文左・図版右の2カラムにし760px未満で縦積みへ戻す。
  4枚を `FEATURES` 配列に寄せてJSXの重複を解消（図版の `mt-4` は親グリッドの gap へ移した）。
- 検証: 単体1,733緑／E2E landing 3件・mobile-layout 3件緑／390・768・1440で確認。
  a11yは再測定して全項目適合（h1=1・階層の飛びなし・コントラスト不足0・24px未満0・nav2つにラベル）。
  ページ高は1440pxで 6032→5303px、390pxで 9261→7735px（T-M8-74比で約16%短縮）。

### T-M8-78: LP「03 しくみ」の4ステップを同じ形に揃える `done`
- 参照: 要件06 §1.5、`design_handoff_lp/README.md`（03 しくみ） / 依存: T-M8-77 / サイズ: S
- 利用者の指示:「03を改善」「発信定義書（ベースmd）を目立たせる必要はない」。
- **発見**: STEP2だけ器が違う（brand枠1.5px＋浮き影＋カラム幅1.18fr）だけでなく、
  **見出し（h3）を持たない別構造**だった。4ステップのうち1つだけ見出しの並びから抜けており、
  支援技術からもステップとして辿れなかった（a11y監査でh3が3つしか出ないことで判明）。
- 修正: 4枚を `HOW_STEPS` 配列に寄せ、器・構造・幅・高さを揃えた（STEP番号→h3→説明→任意の図版）。
  グリッドは等幅（`1fr 26px 1fr 26px 1fr 26px 1fr`）。上端3pxグラデはSTEP3だけに残す（AIが動く瞬間・デザイン §カラー）。
- 内容の重複も解消: STEP1が「ペルソナ／発信テーマ／トーン＆マナー／NG設定」と列挙し、
  STEP2の図版が同じ4項目を再掲していた → STEP1は「何を渡すか」に絞った。
  STEP4はリード文と「毎回指示を書き直す」が重複していたため、複数アカウントでも定義書ごとに
  一貫する点（新情報）へ差し替えた。
- 等高カードの余白対策: 内容なりの高さ（`items-start`）も試したが、**STEP2が最も高くなり
  かえって強調される**ため却下。等高のまま、md図版の行送りを詰めて全体の高さを下げた。
- 検証: 単体1,733緑／E2E landing 3件・mobile-layout 3件緑／1280・390で確認。
  a11y再測定で **しくみのh3が3つ→4つ**になり、他の項目も全て適合のまま。

### T-M8-79: サービス名をExos AIへ改称し、LPを4つの特徴に沿って整える `done`
- 参照: 要件06 §1.5（v1.64）、`design_handoff_lp/README.md` / 依存: T-M8-78 / サイズ: M
- **改称**: `APP_NAME` を「Space AI」→「Exos AI」。**旧名がコード13ファイル・ドキュメント12ファイルに
  直書きされていた**（メタタイトル・Stripe顧客ポータル・Supabaseのメール件名/テンプレート・doctor出力など）。
  すべて置換し、要件06に「サービス名は `APP_NAME` から描画し画面へ直書きしない」を追記した。
  design_handoff の**フォルダ名とプロトタイプHTMLは凍結した成果物なので旧名のまま**（READMEに理由を明記）。
- LPの改修: 主CTAと副CTAを同寸法（`CTA_SIZE`）へ／ヒーローのモックを「Exos AIでの運用イメージ」とし
  **4つの特徴を上から順になぞる4枚**（ニュース起点の下書き・生成中・下書き/予約/分析・スケジュール投稿）に／
  01課題を実際の課題に即した文章へ書き直し／情報収集の図版を**ニュース一覧の見え方**へ／
  02の見出しを4つの特徴と同じ言葉に／03のSTEP4を「投稿を自動で分析して改善」へ／FAQを非エンジニア向けに平易化。
- **利用者の手元編集で法定開示が4つ落ちていたので戻した**（機械検査が検出）:
  ①BYOKの「月額とは別にX API・生成AI APIの利用料がかかる」（特商法11条の商品代金以外の費用）
  ②申込前確認事項の「自動更新」（無料期間後に自動課金）③同「支払時期」
  ④解約条件の「期間末での解約・日割り返金なし」（規約第5条・特商法ページと食い違っていた）。
  あわせて「高品質な投稿を自動作成」を事実表現へ（禁止表現「生成品質を運営が保証する表現」に該当）。
- **テストの作り方を変えた**: 完全一致だと言い回しを整えるたびに落ち、「直す＝一致させる」だけになって
  **開示ごと消えたときに気付けない**。文言ではなく**開示されている事実**（正規表現）を見る形へ。
- 検証: 単体1,733緑／実ブラウザで名称・法定開示・新文言・重なり解消を確認。
  ヒーローのフロートカードがモックの縦伸びでスケジュール表に重なっていたのを `pb-[46px]` で解消。

### T-M8-80: LPの図版と文章を作り直す（T-M8-79の指示を取り違えた分の作り直し） `done`
- 参照: 要件06 §1.5（v1.65）、`design_handoff_lp/README.md` / 依存: T-M8-79 / サイズ: S
- **前回の反省**: 「**イメージ画像**を入れて」に対して数字を3つ並べた帯を作り、
  「**ニュースが並んでいるような**イメージ」に対して灰色のバーで済ませていた。どちらも
  指示された「見て分かる図」になっておらず、作り直した。
- ヒーローの「下書き・予約・分析」: 数字の帯 → **タブ（下書き3／予約5／分析）と下書き一覧のある「画面」**へ。
- 「02 情報収集」の図版: 灰色のバー → **架空の見出しを文字で書いたニュース一覧**＋「この記事から投稿を作る」チップ。
  ヒーローのモックが既に架空の例文を使っている前例に合わせた（実在の記事・企業名は書かない）。
- 01課題: 「費用が大きく／割に合わない」のような同義の重複と冗長な文末を解消。
  `docs/marketing/lp-design-brief.md` §1 の3つ（作業量／費用／自分らしさ）を正とした。
- **03 しくみの見出しを差し替え**: STEP4を「投稿を自動で分析して改善」へ変えた結果、
  h2「「発信定義書」が、あなたらしさの土台になる」では最後のステップを説明できなくなっていた
  → 「一度設定すれば、学習・生成・分析が回り続けます」。差別化の核である発信定義書はリード文で述べる。
- 用語のずれを解消: プラン説明の「ベース.mdファイル」→「発信定義書（ベースmd）」（03と同じ呼び名）。
- 04使い方: 主語のない「安全に登録。」を削り、「初期設定」に何をするのかを書いた。
- **運営者の判断で戻したもの**: BYOK注記と申込前確認事項の短縮版。法令面の懸念は伝えたうえで、
  記載の範囲は運営者の判断とした。**LPは要約、法定表示事項の全文は特商法ページが担う**という
  整理へ docs を更新（`landing-page.test.ts` もカードの存在だけを固定する形へ緩めた）。
- **並列の案出し（5観点）を回して自分の実装と突き合わせた**。実測に基づく指摘が有効だったので採用:
  - 02の情報収集カードだけ高さ307pxで他（141/173/161）の2倍 → 導線チップの3回反復をフッタ1回へ、
    ヘッダーに収集時間帯、重要度を高/中の2値から**仕様どおりの3段**へ。269pxまで短縮。
  - 見出し「短い動画から文章投稿への揺り戻し」が**LP唯一の「動画」の出現**で、禁止表現
    「動画生成」に隣接していた → 差し替え。
  - ヒーロー③のタブに件数（下書き3／予約5）を残していたのは「意味の無い数字がタブに移っただけ」。
    行の見出しに02の型名を流用していて「型の一覧」に見えていた。ドットも3種類目を増やしていた → いずれも修正。
  - **03に特徴1（ニュース自動取得）が存在せず、STEP4が次へ戻らない一方通行**だった →
    4ステップを「集める→作る→出す→測る」へ組み替え、戻り線を1本追加。
    4枚とも同じ「次へ渡す：〜」の器にして、STEP4だけ図版が無い不揃いも解消。
  - 秒数（60〜90秒）がLP内3箇所に散っていた → 02から落とし、03のスロットとFAQの2箇所へ。
- 見送り: ヒーローのチェック3点を4件へ増やす案（情報量が増える）／モック③④の入れ替え（利得なし）。

### T-M8-81: 屋号「Exos AI」を法務表記に追加する `done`
- 参照: 要件06 §11（v1.67）、`src/lib/legal-entity.ts` / 依存: T-M8-79 / サイズ: S
- 屋号は**サービス名（`APP_NAME`）とは別の項目**なので `LEGAL_ENTITY.tradeName` として分けて持つ
  （いまは同じ文字列だが、片方を変えてももう片方は変わらない）。
- **屋号だけに置き換えていない**: 特商法11条の「販売業者の氏名（名称）」は個人事業者では
  氏名の表示が必要で、屋号のみでは足りない。特商法表記は「屋号」行を足したうえで
  「販売事業者＝松本洸太」を残し、利用規約・プライバシーの冒頭も「松本洸太（屋号: Exos AI）」と併記した。
  `legal-pages.test.ts` に**屋号と氏名が両方あること**の検査を追加（屋号へ置き換えると落ちる）。
- あわせて `.env.example` の `EMAIL_FROM` 例に残っていた旧サービス名を修正。

### T-M8-82: プライバシーポリシーに残った旧名（識別子）を直す `done`
- 参照: 要件06 §11、`src/lib/legal-entity.ts` / 依存: T-M8-81 / サイズ: S
- **利用者の指摘**: プライバシーポリシーに `space-ai` が残っている。
- 原因: T-M8-79の改称は**表示文字列「Space AI」だけ**を置換したため、識別子
  `space-ai-recovery`（`src/lib/auth/recovery.ts` のCookie名）が残っていた。
  プライバシーのCookie表は**実装の実際のCookie名を載せる**ので、そのまま画面に出ていた。
- 修正: Cookie名を `exos-ai-recovery` へ。あわせて内部識別子（Stripeの冪等キー接頭辞など）と
  テストの旧名も一掃した。パスワード再設定のE2E 3件で経路が壊れていないことを確認。
- **改称しなかったもの（意図的）**: `ops/launchd/` のplistラベル・Keychain項目名・ログパス。
  OSに登録される識別子で、変更すると `launchctl` の入れ直しとKeychain項目の再作成が要る。
  かつVercel Cronへの移行対象（`docs/operations/launchd-to-vercel-cron.md`）。必要なら別タスクで。
- **今回の失敗**: 一括 sed が実在するフォルダ名（`design_handoff_space_ai_lp` /
  `design_handoff_spaceai_ui`）への参照と、テストの入出力対応（`SpaceAI` → `spaceai`）、
  launchdのplist名まで書き換えて3件のテストを壊した。**識別子の一括置換は、実体（ファイル名・
  OS登録名・テストの期待値）を先に洗い出してから行う。**

### T-M8-83: ニュース取得の除外を運営者が正しく受け取れるようにする `done`
- 参照: 要件04 §6・§11（日次サマリ）、`src/lib/news-outcome.ts` / 依存: なし / サイズ: M
- **発端**: stagingのスモークで「1件取得・3件除外（published_at:too_old×3）」が出た。
  利用者から仕組みの説明を求められ、調べる過程で4件の問題が見つかった。
- **①本番の不具合（誤通知）**: 日次サマリの抽出SQLが除外理由を見ておらず、
  **その時間帯に新しい記事が無かっただけの日にも「全件破棄されたテーマ」と警告メールを送っていた**。
  T-M7-44 で「直せない理由で赤くすると読まれなくなり本物の異常を隠す」と決めて doctor 側には
  良性判定を入れたのに、通知側には入っていなかった。同じ状況を doctor は「該当なし」、
  サマリは「全件破棄」と**正反対に伝えていた**。新しい記事が無い日は普通にあるため誤報は反復し、
  通知そのものが信用されなくなる経路だった。
- **②本番の観測性の穴**: 「取れてはいるが大半落ちた」がどの経路にも出なかった
  （doctorは `if (o.fetched > 0) continue;` で素通り、サマリの抽出は `fetched = 0`、画面表示なし）。
  **日に30件から3件へ静かに減っても気付けない**（CLAUDE.md 原則1）。
- **③判断材料の不足**: 落ちた記事の日付が残らず、「境界を1〜2時間越えただけ」なのか
  「数か月前の記事しか無かった」のかが区別できず、対策（窓を広げる等）の判断ができなかった。
- **④検証ツールの不足**: スモークが実行時刻と適用された窓を出さないため、
  除外の多さが「窓が短い時間帯だっただけ」なのか判断できなかった。
- 修正: 判定を `src/lib/news-outcome.ts` へ集約（スモーク・doctor・サマリが同じ関数を使う）。
  サマリの誤通知を止め、両方に「取れた数より捨てた数が多いテーマ」を追加（**警告にはせず数字のみ**。
  運営者が直せないことで警告を出すと通知が読まれなくなるため）。`drop_reasons` に古さの範囲を
  `_too_old_min_age_h` / `_too_old_max_age_h` で残す（`_` 始まりは理由として数えない。列追加なし）。
  スモークに「JST◯時に実行 / 取得窓◯時間（◯時間前まで許容）」を表示。
- 検証: 単体 1,735→**1,748件緑**（+13）。**修正を戻すと落ちることを2パターンで確認**
  （良性判定を外す＝修正前の状態／付随情報を理由として数えてしまう退行）。
- 後続への注意: 除外理由マップに情報を足すときは `_` 接頭辞を使う。付けないと良性判定が壊れ、
  「窓より古いだけ」の日に誤通知が復活する。

### T-M8-69: check:providers に各社の models.list 疎通を足す `done`
- 参照: 旧T-M8-60のメモから分離 / サイズ: S
- check:providers は生成呼び出しの受理までを見るが、モデル名の廃止（404）は生成時まで分からない。
  各providerの**単体取得API**（`GET /v1/models/<id>` 等・課金なし）で、モデルカタログの全モデルと
  env既定モデルが実在することを検査する。`provider-contract.live.test.ts` に追加。
- 検証: `npm run check:providers` で 17 passed / 4 skipped（GoogleはAPIキー未設定のため既定で対象外）。

### T-M8-68: 残りの体感速度改善（分析ポーリング・不要refresh・bundle） `done`
- 参照: 監査findings 61-63/98-99/123 / 依存: T-M8-67 / サイズ: M
- (1)(2) は T-M8-91（分析刷新）の実装時に解消済みだった（ポーリングは軽量Server Action、
  `loadSuggestionsForUser` は tweet_ids 絞り込み）。今回は再確認のみ。
- (3) **「不要なrefreshを削除」ではなく「refreshの完了を待たない」が正しい直し方だった。**
  実際に固まっていたのは `prompt-templates-editor` の1箇所だけ。`startTransition` の中で
  `setTemplates` 等の更新と `router.refresh()` を並べていたため、保存が終わって成功トーストが
  出た後もRSC再取得が終わるまで transition が pending のままで、本文欄も再読み込みも
  触れなかった。refresh は残したまま、待ち状態をサーバー処理そのものの間だけに縮めた。
  **同じ形でも transition 内で `setState` を呼んでいない画面（`ai-purpose-settings`）は
  待たされない。** 実測したら固まっていなかったので触っていない（書き方で決まるため画面ごとに測る）。
- (4) `drafts-list` の `DraftEditor` を `next/dynamic` 化。文字数計算の `twitter-text`（1.2MB）が
  下書き一覧を開くだけで落ちてきていた。編集を開いたときだけ読み込む。
- 検証: E2E に「成功が出た時点でもう次の操作ができる」を追加（`ai-settings.spec.ts`）。
  **RSC取得をわざと3秒遅らせる**（手元のDBが速く、遅延なしでは修正前のコードでも通ってしまい
  退行ガードにならなかった）。修正前で落ち、修正後で通ることを実測で確認。
  動的import後も編集→保存が通ることは `toast.spec.ts:58` で確認。

### T-M8-60: デザインの不揃いを統一する（カード器・アイコン・画面幅・フォーム部品） `done`
- 参照: 要件06 §2、`components/ui/card.tsx`、全画面監査（design 23件） / サイズ: M
- **カード器の統一**: 旧系統 `rounded-card border bg-card ... shadow-sm` 18箇所を `cardClassName`
  （bg-surface＋hairline＋カードの影）へ置換。`card-surface.test.ts` に旧系統の禁止guardを追加。
- **ホームのナビアイコン**: "output"（ログアウトと同一の絵）→ 新規生成した "home" へ。
- **画面の骨格**: 分析h1（text-3xl→20px）・ニュースのコンテナ幅（max-w-6xl→1180px）を他画面と統一。
  reset-passwordをlogin/signupと同じカード・ロゴ構成へ刷新（LegalFooter追加）。signupにロゴマーク。
- **ホームのカード内トークン**: recent-results / upcoming-schedule のリンク・行アイテムを
  確認待ちカードと同系（text-brand・border-hairline）へ。
- **フォーム部品**: 下書き編集/再生成/スケジュールのtextarea・時刻select、AI設定の小さすぎる
  select/input（30px→44px）を統一。通知ベルの「もっと見る」・ログアウト・分析のセグメント・
  ランディング副CTA（buttonVariants化）も揃えた。
- 残タスク: ネイティブcheckbox/radioの装飾统一・AI設定の保存ボタンの共有Button化（軽微のため見送り。
  必要になったら起票）。check:providersのmodels.list追加は別途（旧todoから分離）。

### T-M8-33: 要件と実装の突き合わせ（M8の同期漏れを回収する） `done`
- 参照: docs/README.md（ドキュメントマップ）、CLAUDE.md「最重要ルール」 / 依存: T-M8-32 / サイズ: M
- 経緯: 利用者から「要件と実装が違う部分がないか。実装時に要件も変更済みか」（2026-08-03）。
  **答えは「前半はできていなかった」。** M8の39コミットのうち **T-M8-01〜T-M8-20 の22コミットで
  `docs/` を1つも触っていない**（後半は都度更新できていた）。「見た目だけ」の変更でも、
  CLAUDE.md は画面変更を仕様に影響する変更として挙げている。
- 見つけた食い違いと対応:
  | 内容 | 対応 |
  |---|---|
  | **画面の説明が実際より多いポスト数を出していた**（P-1「4〜6」→実際は最大4。P-4「3〜5」→実際は最大2） | 実際の生成上限へ直し、**説明文と `GENERATION_MAX_POSTS` が一致することを単体テストで固定**。要件06 §4.1 を「生成時／編集で許す上限」の2列へ |
  | ホームの指標4カード（T-M8-05）が未記載 | 要件06 §1.4 へ追記（「記録なし」と0の区別も） |
  | 下書きとスケジュールの相互表示（T-M8-10）が未記載 | 要件06 §3.2 として追記 |
  | プラン制限の鍵付き案内（T-M8-20）が未記載 | 要件06 §10 へ行を追加 |
  | 履歴タブの列構成（T-M8-14）が未記載 | 要件06 §8 へ追記 |
  | 「SC-05〜10の6 route」（ナビは7項目になっている） | 「ナビ7項目」へ修正 |
  | 用語「分野」の残り（要件06 SC-05・SC-06、要件02 §3.10、要件04 §232） | 「テーマ」へ統一（T-M8-31の残り） |
  | デザイン基盤（トークン・フォント・アイコン・共通部品）がどこにも無い | **ADR-0006** として記録（要件でもプロンプトでもない技術判断） |
- **ポスト数の食い違いは実害があった**。説明は「押す前に何が作られるか分かる」ためにあるので、
  実際より多い数を出すと逆に害になる。上限を変えたらテストが落ちるようにしたので、次からは
  直し忘れに気付ける。
- 検証: typecheck / lint 緑。単体1,552件緑（+3: 説明とコード上限の一致）。E2E 40件緑（1 skip＝実AI）。
- **突き合わせを自動化した**（`src/lib/db/schema-doc-sync.db.test.ts`）。要件02の各節のカラム一覧と
  実DBの `information_schema` を比べ、**書き忘れた列・消し忘れた列・節が無い表のどれでも落ちる**。
  試しに列を1本足したら落ちることを確認した。文章（画面仕様）は機械では比べられないので、
  これは同期の一部しか守らない。
- 突き合わせの結果（2026-08-03 時点）:
  | 対象 | 結果 |
  |---|---|
  | 要件02 × 実DB | **19表・全カラム一致**（自動テスト化済み） |
  | 要件05 × zodスキーマ（生成job・スロット） | 一致（`x_account_id` はサーバ解決なので文書に無いのが正しい） |
  | プロンプト設計書 × `gen-prompts.ts` | 一致（snapshotテスト14件が常時検知） |
  | 要件04 × ニュース取得（3テーマ・10〜20時2時間おき） | 一致 |
  | PRD・要件03 × `PLANS`（500/1000/2980・上限1/3/3） | 一致 |
  | 要件06 × 画面（ナビ7項目・履歴6列・KPI4カード・法務フッタ・Portal intent・上限バナー） | 一致 |
- 後続への注意: **「見た目だけ」の変更でも要件06は変わる。** M8前半の同期漏れは、まとめて回収する
  方が高くつく（22コミット分を後から突き合わせた）。`/doc-sync` をコミット前に回す運用へ戻す。
  **文章レベルの記述（トーストの例外3種・alertは最大1個など）は機械検証できていない**。
  間接的にはE2Eの `alertIn` が strict mode で落ちることで守られている。

### T-M8-32: 「プランを変更」が押せない原因を直し、通知ベルを押した瞬間に動かす `done`
- 参照: 要件03 §2.2、要件06 §2、CLAUDE.md「外部サービスの設定に依存する画面」 / 依存: T-M8-31 / サイズ: M
- 経緯: 利用者から2件（2026-08-03）。①「プランを変更」でエラー ②通知ボタンの挙動が変。
- **①の原因はアプリではなくStripe側の設定だった**（Turnstileと同じ型・2026-08-01）。連鎖はこう:
  1. 3つのPriceが**別々のProduct**に作られていた（要件03は「同一Product配下」を要求していた）。
  2. そのため `setup-stripe-portal.mjs` が例外で止まり、**`subscription_update` が無効な
     configuration が残ったまま**になっていた（`default_allowed_updates: []`）。
  3. アプリはボタンを出すが、Stripeが `subscription update feature ... is disabled` で拒否する。
- ①の対応:
  - Portalの `subscription_update.products` は**Productごとの配列**を受け取れるので、同一Product
    要求をやめ、**あるがままをグループ化して渡す**（要件03を修正）。
  - setup スクリプトを**IDがあれば更新（update-in-place）**に変えた。毎回 create していたため
    env の書き換えが必要で、書き換え漏れで古い設定を指したままになっていた（原因2の温床）。
    適用後に**読み戻して有効かを確認**し、無効なら終了コード1で落とす。
  - **状態確認（doctor）へ追加**。相手側の設定はコードに現れないので、押して初めて分かる状態に
    しない。無効なら error＋「`npm run stripe:portal:setup` を実行」を出す。
  - テストモードで実際に顧客＋トライアル中のサブスクを作り、**プラン変更・解約の両方でPortalの
    URLが返ることを確認**した（請求は発生しない）。
- ②の対応（通知ベル）:
  - **既読化のサーバ往復を待ってから**閉じて遷移していた（手元で約0.4秒、デプロイ先では1〜2秒）。
    押しても何も起きない時間があると、利用者はもう一度押すか壊れたと思う。**閉じる・遷移を即座に
    行い、既読化は投げるだけ**にした（失敗しても次に開くと未読のまま出るので取り返しがつく）。
  - **リンクの無い通知を押せる形にしない**（押しても何も起きないボタンを出さない）。既読は
    「すべて既読」で行える。
  - 同じ画面へのリンクは `push` では何も起きないので `refresh()` にする。
  - 「すべて既読」の `router.refresh()` を外した（開いたままページ全体を再取得すると重く、
    ポップアップがちらつく。未読数はこの画面のstateが持っている）。
  - **失敗の通知は赤い点**にして、ニュースの通知に埋もれないようにした。
- 検証: typecheck / lint 緑。単体1,549件緑（+6: Portal機能の判定5・設定の組み立て1）。
  **E2E 41件緑**（通知ベルを新規2件。リンクの無い通知がボタンでないこと・未読が減ること・
  DBでも既読になることを固定）。`doctor` に「プラン管理（Stripe）: プラン変更・解約のどちらも
  操作できます」が出ることを確認。
- **同じ作業で見つけた課金の漏れ（重要）**: `smoke:live` の実費を確認するために時間別の集計を見たら、
  E2E全体の実行で**毎回AIが課金されていた**（10回ほどで約$0.7）。T-M8-28 で書いた「生成する」を
  押すテストが原因。押すとServer Actionがjobを作り `after()` が本物のAIを呼ぶ。**`release:check`
  はE2Eを含むので、保存前チェックのたびに課金される**状態だった。`E2E_LIVE_AI=1` で明示的に
  有効化したときだけ走る形へ変え（`check:providers` と同じ）、**E2E全体の前後で
  `external_api_usage_events` の合計が変わらないこと（差分$0.0000）を確認した**。
  再発防止として [開発とテストの進め方](../docs/operations/development-and-testing.md) §E2E へ書いた。
- 後続への注意: **遷移の速さ自体はテストで守れていない**（手元では往復が速く、待っても通ってしまう）。
  守っているのは「リンクの無い行はボタンではない」「未読が減る」「DBが既読になる」の3点で、
  即時遷移は `await` を挟まないというコード上の約束。
  **stg/本番でも `npm run stripe:portal:setup` を1回実行する必要がある**（設定はStripe側にあり、
  環境ごとに別。doctorが無効を検出したら実行する）。

### T-M8-31: プラン管理をやりたいこと別に分け、Xアカウント切替を一覧からできるようにする `done`
- 参照: 要件03 §2.2、要件06 §1.0/§2/§3、PRD A-6 / 依存: T-M8-30 / サイズ: L
- 経緯: 利用者から3件（2026-08-03）。①「プランを管理」から他プランへの変更か解約かを選べる流れに
  ②2つ目のXアカウントを接続したので設定の一覧から切り替えられるように・切替で投稿や履歴も
  入れ替わるか確認 ③用語は「テーマ」で統一（ホームの「履歴で開く」「Xで見る」はそのまま）。
- 実装メモ:
  - **プラン管理**: 「プランを変更」「解約する」の2つに分け、Stripe Portal の `flow_data`
    （`subscription_update` / `subscription_cancel`）で該当画面へ直接入る。1つのボタンだと
    押した先で何ができるのか分からない。`stripe_subscription_id` が不明なときは `flow_data` を
    付けない（Stripeが400を返し「押しても開かない」状態になるため、Portalのトップを開く）。
  - **Xアカウント切替**: 設定の各行に「このアカウントを操作する」を追加。ヘッダーのメニューだけだと
    設定画面で一覧を見ている人が切替場所を探すことになる。
  - **ヘッダーの切替メニューの読み上げ名に操作中のアカウントを入れた。** `aria-label` が中の文字を
    上書きするため、支援技術には「Xアカウントを切り替え」しか伝わらず、**いまどのアカウントを
    操作中かが分からなかった**（要件06 §2 は「誤ったアカウントへの投稿を防ぐため常時表示」を要求）。
    E2Eで名前を引こうとして気付いた。
  - **用語を「テーマ」で統一**。投稿作成・ニュース・通知設定・スケジュール・状態確認・日次サマリの
    表示を揃えた。**プロンプト内部の `分野:` は変えない**（利用者に見えず、変えると全パターンの
    プロンプト再検証＝実費が必要になる）。理由は `lib/post/post-theme.ts` に書いた。
- 検証: typecheck / lint 緑。単体1,543件緑。**E2E 39件緑（全体5回連続）**。
  切替のE2Eは「表示が変わる」で止めず、**2つ目のアカウントに別の下書き・投稿履歴・スケジュールを
  置いて、画面が本当に入れ替わること**まで見る（PRD A-6 のアカウント単位分離）。
  1440px の実ブラウザで課金・Xアカウント一覧を確認した。
- 後続への注意: Portal の `flow_data` は Portal Configuration 側で当該機能が有効である必要がある
  （`subscription_update` / `subscription_cancel` は `scripts/setup-stripe-portal.mjs` で有効化済み）。
  無効な構成へ `flow_data` を送るとStripeが400を返す。

### T-M8-30: 法務3ページへの導線を1か所へ集め、日次サマリのテスト干渉を止める `done`
- 参照: 要件06 §11 / 依存: T-M8-29 / サイズ: S
- 経緯: 利用者から「利用規約・プライバシーポリシー・特定商取引法の位置に違和感はないか」（2026-08-03）。
  確かに2点おかしかった。
  - **設定画面だけが自前でフッタを出していた。** ホーム・ニュース・投稿作成などApp内の他の画面からは
    法務3ページへ辿れない（要件06 §11 は「アプリ設定に配置」としか書いておらず、仕様側の穴）。
  - **内容が短い画面で画面の途中に浮いて見えた**（`<main>` の直後に置いていたため）。
  - ついでに**ログイン画面にだけ無かった**（会員登録にはあった）。ログインから入る人が規約へ辿れない。
- 実装メモ: App Shellを縦flexにして最下部へ `LegalFooter` を1つ置き、設定画面の自前フッタを削除。
  ログイン画面にも追加。**画面ごとに自前で出さない**ことを要件06 §11へ書いた。
- 副産物（テストの干渉を1件解消）: `daily-summary.db.test.ts` が全体実行で稀に落ちていた
  （「1通だけ」が2通になる）。原因は **`jobs/cron.ts` のtickが `deliverDailySummaries` を
  利用者を絞らず現在時刻で呼ぶ**ため、tickを実際に走らせるDBテストと並行すると「今日」の分が
  1通増えること。**製品の不具合ではない**（tickの挙動は正しい）ので、テスト側を日付（dedupe_key）で
  絞るようにした。全体実行8回連続緑を確認。
- 検証: typecheck / lint 緑。単体1,536件緑（8回連続）。E2E 38件緑。1440pxでログイン・設定を確認。

### T-M8-29: 分野を必須にし、パターン選択の見た目を2画面で揃える `done`
- 参照: 要件02 §3.10、要件05 §5/§7、要件06 §1.0/§4/§8 / 依存: T-M8-28 / サイズ: L
- 経緯: 利用者から6件（2026-08-03）。①分野を必須にし「その他（追加指示に記載）」を追加
  ②パターン選択を2画面で同じラジオ形式に・説明文つき・**P番号は出さない** ③ベースmdの変更履歴は
  持っているのか（→持っている。`base_md_versions`・PRD M-1） ④履歴の「内容」は全文で・Xで見るは不要
  ⑤分析の「履歴で開く」は不要 ⑥「お支払い方法・プランを管理」→「プランを管理」で適切な行き先へ。
- 実装メモ:
  - **「指定なし」という選択肢を置かない。** 既定のまま押されると、利用者は分野を選んだつもりで
    選んでいない状態になる。**選ばせるか、明示的に「その他」と言わせる。** DBも NOT NULL ＋
    CHECK（6値＋`other`）で縛った（migration `20260803000002`。既存NULLは `other` へ寄せた）。
  - `other` は `lib/themes.ts` へ足さない。あちらはニュース6分野と1対1で対応しており、対応先の
    無い値を混ぜると `themesToNewsCategories` が壊れる。投稿用の集合は `lib/post/post-theme.ts`。
  - **パターンの定義が3か所に散っていた**（投稿作成の説明つき配列・スケジュールの短縮ラベル配列・
    `pattern-labels.ts`）。ラベルまで違っていて（「自分の考え」/「自分の考え・意見」）、
    **選ぶ画面と表示する画面で名前が違う**状態だった。`lib/post/post-patterns.ts` を単一の正にし、
    表示部品も `components/post/pattern-radio-group.tsx` に共通化した。
  - 履歴の「内容」列は `<details>` の折りたたみと1行切り詰めをやめ、全文を番号つきで並べる。
  - 課金の導線を1つにした。契約前は Portal を作れないので、**押せないボタンを出さず**
    料金プランへのリンクへ切り替える（押せば必ずどこかへ着く）。`/plans` への別リンクは削除。
- つまずき（同種の作業で再発しやすい）:
  - `<label>` で `<select>` を包むと**補足文まで読み上げ名に入る**（「分野 曜日ごとに分野を…」）。
    E2Eの `getByLabel("分野", { exact: true })` が当たらず気付いた。`htmlFor` で結び、
    補足は `aria-describedby` にする。
  - `theme` を NOT NULL にしたので、**直接SQLでスロットを作っている箇所**（E2E 3本・DB統合2本・
    確認用seed）が一斉に落ちた。既定値は付けない方針（必須を必須のままにする）。
  - `page.goto` の直後に `locator.count()` を取ると描画前を見る。先に見出しを待つ。
- 検証: typecheck / lint 緑。単体1,536件緑。**E2E 38件緑**（分野未選択では生成jobが作られない・
  選べば作られることを固定）。1440px の実ブラウザで4画面を確認。
- 後続への注意: 履歴の**状態列の「Xで表示」は残してある**（1行に1つ・実際の投稿を開く導線）。
  ホームの「直近の実績」にも「履歴で開く」「Xで見る」があるが、今回の指摘は分析画面だったので
  触っていない。不要なら合わせて外す。

### T-M8-28: 分野（発信テーマ）を投稿作成とスケジュールで選べるようにする `done`
- 参照: 要件02 §3.10・§4.4、要件05 §5/§7、要件06 §2/§4、プロンプト設計書 SYS-GEN / 依存: T-M8-27 / サイズ: L
- 経緯: 利用者から4件（2026-08-03）。①サイドバーの「料金プラン」は不要 ②週間プレビューの
  「P1・P3・P6」の意味が分からない ③画面名は「スケジュール」でよい ④パターンだけでなく**分野も
  選びたい**。
- 実装メモ:
  - **`P1` のような表記を画面から外した。** 週間プレビューはパターン名（ニュース解説など）を出す。
    **画面の中に答えが無い表記は使わない**——利用者が意味を尋ねた時点で、その表記は失敗している。
  - ナビ・パンくず・h1 をすべて「スケジュール」へ（3つが一致していることが要る・T-M8-23）。
  - サイドバーの料金プランは削除。契約中の行き先は「設定 → 課金・プラン」、未契約は `/plans` に
    留まるので常設リンクは不要。
  - **分野（発信テーマ）**を投稿作成とスケジュールのスロットへ追加。未指定なら従来どおり
    ベースmdの発信テーマからAIが選ぶ（既存スロットの挙動は変わらない）。
    - DB: `schedule_slots.theme`（migration `20260803000001`。CHECK でテーマ選択肢マスタの6値に制限）
    - プロンプト: `<input>` の先頭に `分野: ◯◯` を出し、SYS-GEN に
      「**<input>に「分野」があれば、題材はその分野に限定する**」を追加
    - 画面: 分野をスロット一覧の行にバッジで出し、週間プレビューの `title`/`aria-label` にも入れる
      （編集画面を開かないと分からない状態にしない）
  - **E2Eが実装漏れを捕まえた**。zodスキーマには `theme` を足したのに `buildInputJson()` が
    落としていて、画面で選べてもjobには入っていなかった。「画面で選べる」ことと「AIへ渡る」ことは
    別なので、jobのinputまで見るテストにしてある。
  - **日次上限の数え方の3つ目の写しを見つけて共通化した**（`schedule-enqueue.ts`）。T-M8-26 で
    2つは共通化したがここを見落としていた。同じSQLが散っていると「予約は積まれるのに投稿で弾かれる」
    食い違いが静かに生まれる。
- 検証: typecheck / lint 緑。**単体1,536件**（+6: `composeUserInput` 4・スロットの分野 2）。
  E2E 37件緑（分野がDBとjobのinputへ入ることを固定）。`check:providers` 5件緑。
  **`npm run smoke:live` 全シナリオ成功（$0.2988 / 52秒）**。さらに `theme=investment` で
  実際に1本生成し、**ベースmdの発信テーマ（業務改善・AI・SNS運用）に無い「投資」の内容が
  出ることを確認**（$0.1439。合計 $0.4427 < 上限$0.50）。
- 後続への注意: 分野の語は**ニュース画面の「分野」と同じ6分野**（テーマ選択肢マスタが1対1対応）。
  AI設定では同じものを「テーマ」と呼んでいる。**用語が2つある**のは元からで、統一するなら
  PRD・要件02 §4.4 から直す必要がある（今回は利用者の言葉に合わせて画面は「分野」にした）。

### T-M8-27: 画面確認用アカウントを1コマンドで用意できるようにする `done`
- 参照: CLAUDE.md 原則3（手順を記憶に依存させない）、要件06 全般 / 依存: T-M8-26 / サイズ: S
- 実装メモ:
  - リデザインの確認をローカルでするたび、**中身の入ったアカウントを手で作っていた**。空の画面ばかり
    見ることになり「壊れている」と誤解しやすい（実際、分析画面は実績が無いと空状態しか出ない）。
  - `npm run seed:review` で `review@example.com` / `Review-Local-Pw1` を作る。**何度実行しても
    同じ状態に戻す**（FK順に消してから入れ直す）。プレミアム契約・X連携・発信設定とベースmd（履歴2件）・
    下書き3件（警告あり1）・スケジュール3件（停止1）・投稿履歴3件と実績・フォロワー数31日分・未読通知2件。
  - **接続先が `127.0.0.1` でなければ何もせず止まる**（本番へ確認用アカウントを作らないため）。
- 作る過程で分かったこと（次に同種のスクリプトを書くときに効く）:
  - **ローカルの GoTrue は `GET /admin/users` が 500 を返すことがある**（`Database error finding users`。
    E2Eの利用者が溜まると起きる）。「消してから作り直す」をこのAPIに頼ると止まるので、
    メールアドレスで `auth.users` を直接引く。
  - `tweet_metrics` の形を間違えると**画面は「未取得」と出るだけ**で気付きにくい。正しくは
    `{ [tweetId]: { checkpoints: { 1: {...}, 7: {...} } } }`（`lib/analytics.ts` の `TweetMetricEntry`）。
  - `notification_type` は `draft` ではなく `draft_created`。`base_md_versions` の列は `change_source`。
- 検証: 2回連続実行して同じ状態になることを確認。Playwrightで実際にログインし、ホーム・下書き・履歴・
  スケジュール・分析・ベースmdの6画面が**コンソールエラー0件**で描画されることを確認した。

### T-M8-26: 当日の投稿上限を、投稿を試す前にバナーで知らせる `done`
- 参照: デザイン §補助画面 T-4、要件06 §2・§10、要決定D-15（案A） / 依存: T-M8-25 / サイズ: M
- 実装メモ:
  - 上限（`X_DAILY_POST_LIMIT`・既定50件／Xアカウント単位）は前からあったが、**判定が投稿jobの
    中にしか無く、投稿しようとして初めて分かった**（`daily_limit_reached` で下書きへ戻る）。
    利用者は「なぜ投稿されないのか」を都度エラーで知ることになる（CLAUDE.md 原則1）。
  - **判定と問い合わせをjobと共有する**。`lib/usage/daily-post-limit.ts`（純関数）と
    `daily-post-limit-server.ts`（SQL）へ出し、`jobs/post-publish.ts` の私有関数を差し替えた。
    別々に持つと「バナーは出ないのに投稿は弾かれる」というもっとも分かりにくい食い違いになる。
  - 出すのは**上限に達したときだけ**。残りが少ないだけで出すと毎日出てバナーが読まれなくなる。
  - 文面に「自動実行は下書きの作成まで続きます」を入れた。全部止まったと誤解させないため。
- 検証: typecheck / lint 緑。**単体1,530件**（+16: 純関数8・バナー4・DB統合4）。E2E 35件緑
  （App Shell の常設バナーなので画面を移っても出続けることまで確認）。判定を1つずらすと
  E2Eが落ちることを確認した。1440px の実ブラウザで表示を確認。
- 後続への注意: DB統合テストで分かったこと — `post_create` の `reason` は `usage_events_post_op`
  制約で `consume` に限られるため、**投稿の返却（refund）行はそもそも作れない**。
  `usage_events` はインデックスを張っていないが、日次上限と40日保持で数千行に収まるため
  全走査で足りる（保持期間や上限を大きく変えるときは見直す）。

### T-M8-25: キー登録不要のプランでAPIキータブが行き止まりになるのを直す `done`
- 参照: デザイン §設定、要件06 §3・§10 / 依存: T-M8-24 / サイズ: S
- 実装メモ:
  - プレミアムのAPIキータブは「キー登録は不要です」の一文だけで、**何も操作できず何も分からない**
    行き止まりだった。デザインはここに月間利用枠の残量を置いている（キーの代わりに何が付くのか）。
  - カードは既存の `UsageSummaryCard`（ホーム・課金タブと同じ）を使い、表示の定義を増やさない。
    設定ページの `usage` 読み込み条件に `api-keys` を足しただけ。
- 検証: typecheck / lint 緑。E2E 3件緑（プラン画面のテストへ「行き止まりにならない」を追加）。
  1440px の実ブラウザで確認。
- メモ: デザインのT-4「上限到達バナー」のうち「今月の生成を使い切った」側は、この利用枠カードと
  App Shell の常設バナー（`usageLimitBanner`・T-M6-13）で既に読める。「本日の投稿上限」側は
  **T-M8-26 で実装した**（要決定D-15 案A）。

### T-M8-24: 全画面を実ブラウザで突き合わせ、見つけた欠陥を直す `done`
- 参照: デザイン全体、要件06 §2 SC-08 / 依存: T-M8-23 / サイズ: S
- 実装メモ（1440pxで11画面を撮って1枚ずつデザインと比較した）:
  - **凡例が意味を失っていた（T-M8-23 で自分が壊した）**。週間プレビューの凡例は「自動投稿／
    下書きのみ／停止中」の見本を出すのに、セルと同じクラス文字列を2か所に書いていたため、
    配色をまとめて直したときに凡例だけ取り残されて**3種類が同じ灰色**になった。
    `slotCellClassName()` を1つ作り、**セルと凡例が同じ関数から取る**形にした。
  - **週間プレビューのセルが「ニュ」だった**（`label.slice(0, 2)`）。何が予約されているか読めない。
    デザインと同じ**パターンID（P1〜P6）のチップ**にした。パターン名は同じ画面のスロット一覧と
    `title` / `aria-label` に出る。
  - ニュースの絞り込みチップ（分野・インパクト）の選択中が黒のままだったのでキー色へ。
  - 下書きタブのスケジュール時刻が `09:30:00`（DBの `HH:MM:SS` を素で表示）だったので秒を落とした。
- 検証: typecheck / lint 緑。単体1,514件緑。**E2E 34件 全緑**。
  確認した画面: ホーム・最新ニュース・投稿作成・下書き・下書き（スケジュール）・分析・AI設定・
  設定3タブ・料金プラン・ログイン・新規登録・トップ。

### T-M8-23: リデザインの取り残しを一掃する（トークン・角丸・主操作の色・ナビ名） `done`
- 参照: デザイン §カラー／§形状、要件06 §2 / 依存: T-M8-22 / サイズ: M
- 実装メモ:
  - **呼び出し側を1つずつ直すのをやめ、トークンの中身を寄せた**。shadcn由来の
    `--muted-foreground`（162箇所）・`--card`・`--border`・`--primary` などを新デザインの値へ
    向け、`--radius` を 10px → **8px**（`rounded-lg` 85箇所がカードの角丸と一致する）。
    これで `Button` の既定もキー色になる。
  - `rounded-xl` / `rounded-2xl`（41箇所・19ファイル）を `rounded-card` へ。モーダルは
    もとから `rounded-modal`（16px）なので対象外。
  - **amber / emerald / red / sky / slate のリテラル色（28ファイル）を warn / success /
    danger / info / 中立トークンへ**。デザインの状態色と2〜3種類ずつずれていた。
  - **主操作なのに黒いままだったリンク10箇所**をキー色へ。`<Button>` は Base UI の
    クライアントコンポーネントでサーバー側の `<Link>` に使えないため各画面が長いクラスを
    手書きしていた。`components/ui/link-button.ts` に名前を用意して配る。
  - 選択中のセグメント（分析の計測時点・フォロワー期間）・利用枠のバー・アイコンの下敷きも
    キー色系へ。黒い塗りは主操作と見分けがつかない。
  - **ナビのラベルが本文と食い違っていた**。`/app/ai-settings` を「ベースmd」と表示していたが、
    その画面は5タブを持つ「AI設定」。ヘッダーのパンくずも同じ定義を使うため、ナビとパンくずが
    「ベースmd」・本文が「AI設定」になっていた。デザインの画面分割とこのアプリのルート分割が
    一致しない箇所で文言を機械的に合わせると、かえって分かりにくくなる。
  - **発信設定の `<fieldset>` / `<legend>` をやめた**。`<legend>` はブラウザがカードの上枠の中へ
    描くので枠線が途切れる。`float` で流れへ戻すと中の grid が崩れる（実際に崩して気付いた）。
    `role="group"` ＋ `aria-labelledby` に置き換え、読み上げのグループは保った。
- 検証: typecheck / lint 緑。単体1,514件緑。**E2E 34件 全緑**。1440px で全8画面を撮って
  デザインと突き合わせた（ホーム・投稿作成・スケジュール・分析・AI設定・設定3タブ）。
- 状態チップ（10箇所・5ファイル）は `components/ui/badge.tsx` の `Badge` へ寄せた。色を
  クラス文字列ではなく **tone（意味）** で選ぶ形にしたので、同じ色が別の意味で使われない。
- **prettier を実行しかけて戻した**。このリポジトリは prettier を入れておらず（依存にも
  設定にも無い）、走らせると無関係な575行が書き換わる。整形は eslint に任せ、手で整える。

### T-M8-22: 設定を2カラムにし、チェック色とプラン名の表記を揃える `done`
- 参照: デザイン §設定、要件06 §2 / 依存: T-M8-21 / サイズ: S
- 実装メモ:
  - 通知・プロフィールタブが1カラムで縦に1,460px。**中身は狭いのに縦だけ長い**という、広い画面で
    一番読みにくい形だった（2026-08-02のデスクトップ最適化の決定と矛盾していた）。2カラムにして
    1,010pxへ。高さの近いもので列を分ける（通知 ／ プロフィール＋ニュース通知）。
  - **チェックボックスの色をキー色へ**（`globals.css` の base で `accent-color`）。素のままだと
    OS既定の青が画面で一番強い色になる。個別クラスは付け忘れが出るので一括で揃える。
  - 保存ボタンをキー色へ（黒のままだった）。
  - **T-M8-21 のプラン名変更の取りこぼしを回収**。`displayName` を日本語にした後も、
    「Premiumはキー登録不要です」など**ハードコードされた英語表記が6か所**残っていた
    （設定・AI設定・利用規約・特商法表記）。要件06の記述も揃えた。
- 検証: typecheck / lint 緑。単体1,514件緑。**E2E 34件 全緑**。1440px の実ブラウザで前後比較。
- 後続への注意: プレミアムのAPIキータブに月間上限の使用量メーター（デザイン §設定）は入れていない。
  **新しいデータ取得が必要**で「見た目だけ」を超えるため、別タスクにする。

### T-M8-21: 料金プランを3枚のカード比較へ置き換える `done`
- 参照: デザイン §料金プラン、要件06 §1.1、要件03 §54 / 依存: T-M8-15 / サイズ: M
- 実装メモ:
  - 横スクロールする比較表 → 3枚のカード。**表のセルに置いた読み上げ用テキスト
    （`position:absolute`）がページ自体を横へ伸ばす**という罠（T-M7-26）が構造ごと消える。
  - **プラン名をPRDと揃えた**（`Standard`/`MD`/`Premium` → `通常プラン`/`mdプラン`/`プレミアムプラン`）。
    PRDと設定画面はもとから日本語で、コードの `displayName` だけが英語で浮いていた。
  - カードの件数・月間上限は `PLANS` から導出する（画面へ数値を書き写さない）。
  - BYOKの追加費用の注意はカード直下の常設ブロックへ。要件03 §54の事前開示はCTAより前のまま。
  - **`--gradient-brand` という存在しないトークン名を書いて、プレミアムのタグが白文字＋透明背景で
    消えていた**。typecheck・lint・E2Eはすべて緑で、1440pxのスクリーンショットで気付いた。
    正しくは `--brand-gradient`。CSS変数名の誤りは静的検査を素通りする。
- 検証: typecheck / lint 緑。単体1,514件緑。E2E 5件緑（3プラン名・BYOK注意・申込前の確認・
  390pxで横に伸びない）。1440px の実ブラウザでデザインと突き合わせた。

### T-M8-20: プラン制限の案内を「空」と分けて鍵付きの案内にする `done`
- 参照: デザイン §ベースmd ロック、要件06 §10 / 依存: T-M8-14 / サイズ: S
- 実装メモ: `LockedState` を追加。**「まだ何も無い」と「このプランでは開けない」は別物**で、
  同じ灰色の空状態で出すと利用者は自分の設定不足だと思って設定画面を探しに行く。CTAの金額は
  `PLANS` から引く。行き先は料金プラン1つに絞った。
- 検証: E2E 5件緑（見出し・CTAのhref・プロンプトタブも同扱い）。1440px の実ブラウザで確認。

### T-M8-19: 配信中の退会で全体停止する競合を塞ぎ切る（T-M7-54の積み残し） `done`
- 参照: 要件04 §6・§14、CLAUDE.md 原則1 / 依存: T-M7-54 / サイズ: S
- 実装メモ:
  - **T-M7-54 の修正では足りていなかった。** `insert ... select from profiles where p.id = $1` にしても
    `npm test` が**3回に1回** `notifications_user_id_fkey` 違反で落ち続けていた（2026-08-03 実測）。
  - 真因: **同じ文の中でも、SELECT が見る行と外部キー検査が見る行は別のスナップショット**で決まる。
    SELECT の直後に退会がコミットされると検査時点で親行が無く違反になる。存在確認では防げない。
  - `for key share of p` を足して親行を先にロックした。退会はこの文の完了まで待たされ、
    先に消えていれば0行になる。`jobs/news-digest.ts` と `ops/daily-summary.ts` の両方へ適用（同型のため）。
  - **再現を運任せにしない回帰テストを追加**。別接続で退会トランザクションを開いたまま fan-out を走らせ、
    `pg_stat_activity.wait_event_type = 'Lock'` でロック待ちを確認してから commit する。
    修正を戻すと確実に落ちることを確認済み。
- 検証: 修正前 3回に1回失敗 → 修正後 `npm test` **8回連続緑**（1,510件）。`daily-summary.db.test.ts` 5件緑。
  `/api/cron/scheduler-tick` を実行し200（`dailySummaries: 0`＝JST8時前で未到来の正常経路）。
- 後続への注意: **「存在を確認してから挿入」は競合に対して無力**。親テーブルへ FK を張った挿入で
  親が消え得るなら、`for key share` まで入れる。同じ形の SQL が増えたら横展開する。

### T-M7-54: ニュース配信が「配信中の退会」で全体停止するのを直す `done`
- 参照: 要件04 §6、CLAUDE.md 原則1 / 依存: T-M7-42 / サイズ: S
- 実装メモ:
  - **発見の経緯**: 全体テストが4回に1回ほど落ちるのを追った結果、`fanOutNewsDigest` の `insert into notifications` が例外を投げていた。並列テストが利用者を削除するタイミングで**外部キー違反**になる。
  - **これはテストの都合ではなく実装の欠陥**。対象を選んでから挿入するまでの間に利用者が退会すると、例外で**ループごと落ち、まだ配信していない他の利用者へ届かなくなる**。1人の退会が全員に波及する（T-M7-42 で見ていた「利用者どうしの干渉」そのもの）。
  - `values (...)` を `select ... from profiles where p.id = $1` へ変更。消えていれば0行になるだけになる。**T-M7-43 で日次サマリに入れた修正と同型**で、そのとき横展開していれば防げた。
  - 再現テストを追加（修正を戻すと落ちることを確認）。全体テスト6回連続で緑（1,482件）。
- 後続への注意: **`notifications` へ利用者単位で挿入する箇所は同じ形にする**。`values` で直接入れると同じ壊れ方をする。

### T-M7-53: 人間確認が効いているかを状態確認に出す `done`
- 参照: 要件02（SC-01/02）、CLAUDE.md 原則1・2 / 依存: T-M7-48 / サイズ: M
- 実装メモ:
  - **当初案（アプリ自身で `siteverify` する）は成立しない。** Cloudflare のトークンは**1回しか検証できない**（再検証は `timeout-or-duplicate`。公式ドキュメントで確認）。アプリが先に検証すると、続けて Supabase が行う検証が必ず失敗し**ログインが全滅する**。二重化は原理的に不可能で、どちらか一方しか選べない。
  - Supabase 側に任せる構成自体は正しい。問題は**効いているかが見えない**ことだったので、**見えるようにする**方向へ変更した（`src/lib/ops/captcha-status.ts`）。
  - 判定方法: 存在しない資格情報で、captchaトークンを付けずにログインを試す。有効なら `captcha_failed`、無効なら `invalid_credentials`。**副作用が無い**（アカウントを作らない・メールを送らない・実在ユーザーに触れない）。判断できない応答は `unknown`（有効だと決めつけない）。
  - `npm run doctor` と `/api/cron/doctor` に出る。**無効は `error`**（注意で済ませない）。ローカルで実際にCAPTCHAを切って赤くなることを確認済み。
  - 背景: 2026-08-02、staging が**無効のまま**だった。画面に確認欄は出ており、Cloudflare側のドメイン許可（110200）も直した後だったのに、検証自体が行われていなかった。`TURNSTILE_SECRET_KEY` は preview/production で必須なのに**コードのどこからも読まれていない**（実際の検証はSupabaseが行うため）。
  - 残る限界: 保護そのものはダッシュボードの設定に依存したまま。**外して気付けるようにした**のが今回の到達点。

### T-M7-52: 別のSupabaseプロジェクトへmigrationを流す事故を防ぐ `done`
- 参照: CLAUDE.md 原則3、[デプロイ手順](../docs/operations/deployment.md) §0.0 / 依存: T-M7-35 / サイズ: S
- 実装メモ:
  - `supabase link` は作業ディレクトリに**1つしか保持しない**のに、`release.mjs` は `db push --linked` / `migration list --linked` を**どこに繋がっているか確認せず**使っていた。production に繋いだまま `release:staging -- --apply` を実行すると**本番DBへmigrationが入る**。逆向きだと本番が未適用のまま「全部通りました」と出る。どちらも黙って起きる。
  - 反映先のアプリが**実際に使っている**プロジェクトを、デプロイ先の**CSPヘッダ**から読んで突き合わせる（`projectRefFromCsp`）。認証情報が不要で、refは秘密値ではない。クライアントバンドルを探す方法は当てにならない（認証をServer Actionで行うためログイン画面にSupabaseクライアントが載らない）。
  - **判定できないときは止める**（`parseAppliedRemote` と同じ方針）。接続先が違うと stop が2つになり `onlyMigrationsPending` が false になるので、`--apply` でも進めない。
  - 実機確認: staging に対して「✅ データベースの接続先 uykffujqpsogqffbnsrz（staging のプロジェクト）」が出た。

### T-M7-51: 非productionへStripe本番キーを置けてしまう穴を塞ぐ `done`
- 参照: 要件01 §3.1、`src/lib/ops/outbound-channels.ts` / 依存: なし / サイズ: S
- 実装メモ:
  - 2026-08-02、運営者が staging の動作確認で決済しようとして「本当に課金されないか」と聞いてきたので調べたところ、**X_POSTING_MODE には起動時ガードがあるのに Stripe には無かった**。`outbound-channels.ts` に「production 以外では `sk_test_` しか置かない」と**文章で書いてあるだけ**で、Vercelへ `sk_live_` を貼れば実際に課金される状態だった。方針をドキュメントに書いて済ませてはいけない例（CLAUDE.md 冒頭）。
  - `env-schema.ts` に `appEnv !== "production" && STRIPE_SECRET_KEY.startsWith("sk_live_")` を落とすガードを追加（X_POSTING_MODE と同じ場所・同じ形）。単体4件。
  - 副産物として**運営者の疑問がコマンドで答えられるようになった**: 非productionで起動できているなら `sk_test_` である。
  - 逆（productionにテストキー）は落とさない。実害は「売上が立たない」で、段階的な立ち上げ中に正当にあり得るため。

### T-M7-50: ニュース配信の分離テストが並列実行でflakyになるのを直す `done`
- 参照: [開発とテストの進め方](../docs/operations/development-and-testing.md) §9 / 依存: T-M7-42 / サイズ: S
- 実装メモ:
  - `tenant-isolation.db.test.ts` の「ニュースの配信」が**4回に1回程度落ちていた**（2026-08-02発見）。`news_items` は利用者に紐づかない共有データで、現在時刻の窓を使うと**他テストが挿入した記事と混ざる**。ダイジェスト本文は先頭5件＋「ほかN件」なので、混ざるとこの記事が押し出されて `toContain` が落ちる。製品の挙動は正しく、テスト側の隔離不足。
  - 窓を**遠い過去の一意な1時間**へずらして交わらないようにした（他テストは `now` 付近しか使わない）。窓を専有できたので主張も強め、`toContain` から**「自分の1件だけ」の完全一致**へ変えた（混入すれば行が増えて落ちる）。
  - 教訓: **利用者に紐づかない共有テーブル**（`news_items`・`prompt_templates` 等）を使うテストは、利用者IDで隔離できない。時間窓や一意キーで論理的に隔離する。

### T-M7-49: 検証対象のXアカウントをユーザー名で指定できるようにする `done`
- 参照: CLAUDE.md 原則2、[デプロイ手順](../docs/operations/deployment.md) §0.0・§5 / 依存: T-M7-25 / サイズ: S
- 完了条件: `smoke:live` / `/api/cron/canary` が UUID でも Xのユーザー名でも受ける。解決できないときは候補を出す
- 実装メモ:
  - 発見の経緯: 2026-08-01 に運営者へ `xAccountId` を尋ねたところ **`ai_newinfo`（Xのユーザー名）** が返ってきた。内部UUIDを知るにはDBを直接見るしかなく、原則2に反していた。
  - **自動選択はしない。** 「本番で他人のアカウントを使わないよう対象は必ず呼び出し側が明示する」という `runSmoke` の設計意図は保ち、指定の**表記**だけを人間に扱える形へ広げた。同じhandleが複数あるときも選ばずに止める（誤ったアカウントで生成すると枠と費用を消費する）。
  - 解決は `src/lib/smoke/resolve-account.ts`（単体9件＋実DB4件）。**単体だけでは列名の誤りが見えない**ため実DBテストを併設した（`handle` を `username` に変えると実DB側だけが落ちることを確認済み）。
  - `?xAccountId=` は旧名として受け続ける。

### T-M7-48: 人間確認（Turnstile）の失敗理由を運営者に見えるようにする `done`
- 参照: CLAUDE.md 原則1・2・3、要件02（SC-01/02）、[デプロイ手順](../docs/operations/deployment.md) §4.5 / 依存: なし / サイズ: M
- 完了条件:
  - `error-callback` のエラーコードを捨てず、**設定が原因（再試行では直らない）／利用者の環境／一時的** を区別して文言を出し分ける
  - 設定が原因のときに「もう一度お試しください」と案内しない
  - `npm run check:turnstile -- --base <URL>` でその環境の実際の可否を確認できる
  - `npm run release:staging` / `release:production` の検証に組み込む
- 実装メモ:
  - 発見の経緯: 2026-08-01、staging のログイン画面をブラウザで開いたら**コード110200（ドメイン未許可）でウィジェットが描画されず、ログインと新規登録が両方できない**状態だった。画面には「もう一度お試しください」しか出ないため、運営者は直らない再試行を繰り返すことになる。**Cloudflare側の設定が原因なので、モックした単体テスト・E2Eでは原理的に検出できない**（2026-07-28 の4系統同時不具合と同じ型）。
  - 分類は `src/lib/auth/turnstile-errors.ts`（純粋関数・単体15件）。**未知のコードは `transient` に寄せる**（設定だと断定して「運営者へ問い合わせ」と言い切るより害が小さい）。運営者向けの直し方（`operatorHint`）は**画面に出さない**（利用者に設定手順を見せない）。
  - `scripts/check-turnstile.mjs` は Playwright で実際に `turnstile.render` を1回叩く。headless では「人間らしさ」の判定を通れないことがあるが、**チャレンジまで到達していればサイトキーとドメインは正しい**と判断できるため、その場合は⚠️（成功扱い）にした。`networkidle` は Turnstile が常時通信するため終わらない（60秒で失敗した）ので `domcontentloaded` を使う。
  - サイトキーは `NEXT_PUBLIC_` のため**ビルド時にバンドルへ埋まる**。Vercelで設定しただけでは反映されないので、未検出時は「再デプロイしてください」と案内する。
  - リリース検証は Turnstile（費用ゼロ）→ 実物スモーク（$0.30）の順で走り、**片方が失敗しても両方の結果を出してから終わる**（原則5）。

### T-M7-47: 状態確認コマンドが環境ごとの鍵を使っていない穴を塞ぐ `done`
- 参照: CLAUDE.md 原則2、[デプロイ手順](../docs/operations/deployment.md) §4.5 / 依存: T-M7-35 / サイズ: S
- 完了条件:
  - `npm run doctor -- --base <デプロイ先>` がその環境の鍵（`STAGING_CRON_SECRET` 等）を使う
  - 同じ書き忘れが次の script で起きないことをテストで保証する
- 実装メモ:
  - T-M7-35 で `cronSecretEnvName` を作ったとき `smoke-live.mjs` にだけ適用し、`doctor.mjs` は `CRON_SECRET` を直接読んだままだった。結果、staging 宛の `doctor` が常に「確認用の鍵が一致しません」で止まり、**壊れているのか鍵が違うのか運営者に区別できなかった**。
  - 再発防止は一覧ではなく規則をテストにした（`src/lib/ops/env-secret-usage.test.ts`）。「`--base` を受ける script はすべて `cronSecretEnvName` を通す／環境名の付かない `CRON_SECRET` を固定で読まない」を静的に検査する（`outbound-channels.test.ts` と同じ考え方）。`doctor.mjs` を元の実装へ戻すとテストが落ちることを確認済み。
  - 401時の文言も「その環境の CRON_SECRET を指定してください」から、**鍵の名前と入れる場所**を明示する形へ直した。
  - あわせて `doctor` / `smoke:live` / `release:*` が出していた Node の `MODULE_TYPELESS_PACKAGE_JSON` 警告（5行）を抑制した。運営者向けコマンドの出力に読ませる必要のない警告を混ぜない。

### T-M7-46: リリースゲートが「1つ前のコミットの緑」を自分の緑と誤認する穴を塞ぐ `done`
- 参照: CLAUDE.md 原則1、[デプロイ手順](../docs/operations/deployment.md) §0.0 / 依存: T-M7-35 / サイズ: S
- 完了条件:
  - CIの判定が**いまのコミット（HEAD）に対する実行**を見る
  - そのコミットのCIが無ければ止まる
- メモ: 2026-08-01に発見。`gh run list --limit 1` で**ブランチの最新実行**を見ていたため、push直後にCIがまだ始まっていないと**1つ前のコミットの緑**を自分の緑として読んでいた。そのまま進めると「CIを通っていないコミットが反映される」。実際にHEAD `ab66e3b` に対しCIは `c7fbad5` の結果を返していた。
- 実装結果（2026-08-01）: `headSha` で突き合わせ、HEADに対応する実行が無ければ null（＝止まる）にした。実行中なら「まだ実行中です」と出す。
- 検証（2026-08-01）: 未pushのHEADで実行し「このコミットのCI結果が見つかりません」で止まることを確認。

### T-M7-45: 生成画像のStorage bucketをmigrationで作る `done`
- 参照: 要件02 §6、CLAUDE.md 原則3 / 依存: なし / サイズ: S
- 完了条件:
  - `generated-images` bucket がどの環境でもmigrationで作られる（手動作成に頼らない）
  - private・5MiB・画像3形式が `config.toml` と一致する
- メモ: 2026-08-01のネクストアクション洗い出しで発覚。bucket定義は `supabase/config.toml` にしか無く、**ローカルの `supabase start` でしか作られていなかった**。migrationが作らないため、staging/production では**画像生成の最後（保存）だけが失敗する**。stagingで `supabase storage ls` が0件であることを実測して確認した。手順書に「Dashboardで作る」と書いても忘れる（原則3）。
- 実装結果（2026-08-01）: migration `20260801000003_storage_bucket_images.sql` を追加（`insert ... on conflict do update` で冪等）。RLSポリシーは作らない（読み書きは service_role と署名URLのみ）。DB統合テスト2件で「private・5MiB・3形式・bucket名がアプリ既定と一致」を固定した。
- 検証（2026-08-01）: ローカルとstagingの両方へ適用し、stagingで `{"paths":["generated-images/"]}` を確認。

### T-M7-44: 「取得窓より古い」だけの0件を失敗にしない `done`
- 参照: 要件04 §6、CLAUDE.md 原則1 / 依存: T-M7-40 / サイズ: S
- 完了条件:
  - `published_at:too_old` だけで0件になった場合を「該当なし」として扱う（スモーク・doctorの両方）
  - 契約違反（`title:too_big` 等）が混じる場合は従来どおり「全滅」として失敗にする
- メモ: 2026-08-01、**stagingの初回検証**で5件すべてが `published_at:too_old` になり「全滅（失敗）」と判定された。実際には**その時間帯に新しい記事が無かっただけ**で、運営者に直せるものは無い。ローカルでは同時刻に取得できていたのは、既取得URL（`<known_urls>`）があってモデルが新しい記事を探したため。**新品の環境ほど起きやすい**。
- 実装結果（2026-08-01）: `onlyOutsideWindow` を追加し、除外理由が窓外だけなら成功（件数は必ず出す）。契約違反が1件でも混じれば失敗のまま。`diagnostics.ts` の分野別判定にも同じ区別を入れた（直せない理由で警告を出すと読まれなくなるため）。単体+7件。
- 後続への注意: この区別は「正常な空と失敗による空を分ける」（原則1）の延長。**除外理由を増やすときは、それが運営者に直せるものかどうかで分類する**。

### T-M7-43: DBサイズを状態確認に出す（無料枠の上限に気付けるようにする） `done`
- 参照: CLAUDE.md 原則1・4、[デプロイ手順](../docs/operations/deployment.md) / 依存: なし / サイズ: S
- 完了条件:
  - `npm run doctor` と `GET /api/cron/doctor` にDBサイズが出る（`pg_database_size`）
  - 無料枠（500MB）に近づいたら警告になる（例: 400MB超で ⚠️）
  - 日次サマリにも出す（止まってから気付かない）
- 実装結果（2026-08-01）: `judgeDatabaseSize` を追加し、`npm run doctor` / `GET /api/cron/doctor` / **日次サマリ**の3箇所へ出す。無料枠500MBに対し **80%で注意・95%で異常**（超えると組織内の全プロジェクトが停止するため手前で赤くする）。Proへ上げた場合は `DiagnosticsOptions.dbSizeLimitBytes` で上書きできる。表記はMB/GBを自動で切り替える。
- 検証（2026-08-01）: 単体7件（境界80%/79%・95%・GB表記・上限0でも壊れない）＋日次サマリ2件。実環境で `✅ データベースの使用量 26 MB / 500 MB（5%）` が出ることを確認。
- メモ: 2026-08-01、Supabaseの組織が `DB Size Exceeded` で停止し、**新規プロジェクトのrestoreすら弾かれた**。停止すると使用量が0表示になり原因の特定もできない。現状のdoctorは費用は見せるが容量は見ていない。ローカルDBの実測は26MB（テストで膨らんだ状態）なのでアプリ自体が超える見込みは薄いが、**気付ける経路が無いこと自体が原則1違反**。

### T-M7-42: 利用者どうしの分離（挙動の干渉）を検証する `done`
- 参照: 要件02 §5（RLS）、要件01 §8、要件04 §6 / 依存: なし / サイズ: M
- 完了条件:
  - 他人のデータを読み書きできないことが検証されている
  - **片方の利用者の失敗・満杯・失効・大量投入がもう片方へ影響しない**ことが検証されている
  - 画面に他人のものが出ないことを実ブラウザで確認している
- 調査結果（2026-08-01）: **データの越境は既に検証済みだった**。`src/lib/db/rls.db.test.ts` の8件が、利用者ごとの行分離／system default の可視性／service-role専用表／`authenticated` からの直接書き込み拒否／`active_x_account_id` の所有権トリガー／**全public表でRLSが有効であることの構造検査**／**`authenticated` に書き込みGRANTが無いことの構造検査**を押さえている（後者2つは表を足したときに落ちるので、今回追加した `news_fetch_outcomes` も自動で対象になった）。加えて通知と分析には「他人のものを返さない」テストがある。
  一方で**挙動の干渉は未検証**だった（1人運用では出ないため）。
- 実装結果（2026-08-01）: `src/lib/ops/tenant-isolation.db.test.ts`（7件）と `e2e/tenant-isolation.spec.ts`（1件）を追加。
  - 生成枠: Aが月次上限を使い切ってもBは満額使える（counterは利用者ごと）
  - 同時実行上限（5件）: Aが上限まで抱えてもBの実行中は0のまま
  - 失敗の波及: Aのjobが失敗してもBのjobは変わらない
  - Xトークン失効: Aが `expired` でもBは `active` のまま
  - ニュース配信: 分野設定が違う2人に、それぞれの分野だけが届く（混ざらない）
  - 日次サマリ: Aの失敗件数がBのまとめに出ない
  - 投稿の順番: Aが60件queuedでも、1回目で埋まっても**2回目にBが必ず入る**（遅れるが飢餓しない）
  - 実ブラウザ: 他人の下書きが画面に出ない／Aの破棄操作でBの下書きの `updated_at` すら変わらない／同じブラウザでB へ切り替えても混ざらない
- 検証（2026-08-01）: **検出力を実測**（下書き一覧の絞り込みを一時的に外すとE2Eが落ちることを確認）。release:check 完全通過（1,399件・E2E 30件）。
- 後続への注意: **1起動あたりの上限は全利用者で共有する**（dispatch 50／follower_snapshot 100アカウント／metrics_collector 50アカウント・500件）。選択順序が時刻順なので飢餓はしないが、利用者が増えたらこの上限が先に効く。3人目以降を迎える前に上限の見直しが必要になる。

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

### T-M7-35: 忘れると壊れる手順を1コマンドへ畳む `done`
- 参照: CLAUDE.md「前提：運営者は個人」原則3、[デプロイ手順](../docs/operations/deployment.md) / 依存: なし / サイズ: M
- 完了条件:
  - staging への反映が1コマンドで完了する（CI待ち→migration適用→デプロイ後検証まで）
  - **migration の適用を忘れたら止まる**（忘れても進める形にしない）
  - 本番反映も同様に、順番を守らないと進めない
- 実装結果（2026-08-01）: `npm run release:staging` / `npm run release:production` を追加。判定は純粋関数（`src/lib/ops/release-gate.ts`・単体10件）、実行と表示は `scripts/release.mjs`。順に (1)ブランチ (2)未コミット (3)未push (4)CIの結論 (5)反映先URL (6)未適用migration を確認し、**最初に欠けたところで止まって理由と次の一手を日本語で出す**。
  **未適用migrationは警告ではなく停止**にした（警告だと忘れたときと同じ結果になる）。`-- --apply` を付けたときだけ `supabase db push` まで行い、適用後は「もう一度実行して残りの確認を通す」形にした（適用と反映を1回で済ませない）。すべて通ると続けて `smoke:live --base` でデプロイ後検証まで走る。
- 検証（2026-08-01）: **実際に実行して停止動作を確認**。未コミット・未push31件・CI結果なし・URL未設定・未適用migration11件をすべて検出し、最初の「未コミットの変更」で止まった。Supabase未接続時は「ローカルの全件を未適用として扱った」と明示する。単体10件・release:check 完全通過。
- 未検証（理由）: 成功して最後まで通る経路は**staging環境がまだ無いため未実行**（外部準備の項目）。環境が用意できた時点で1回通す必要がある。
- メモ: `deployment.md` の番号付き手順は24ステップあり、**migration適用（`supabase db push`）を飛ばすとX連携が `internal_error` で壊れる**。この「忘れたら壊れる」を人間の記憶に依存させているのが原則3違反。案: `npm run release:staging` が (1)CIの結果をGitHub APIで確認 (2)未適用migrationの有無を検査 (3)適用 (4)`smoke:live --base` (5)結果を日本語で要約、を順に行い、どこで止まったかを明示する。CIが赤い/未完了なら止める。


### T-M7-27: Server Actionの本番実装テストを主要actionへ広げる `done`
- 参照: [開発とテストの進め方](../docs/operations/development-and-testing.md) §4 / 依存: なし / サイズ: L
- 完了条件:
  - 利用者が触る主要 Server Action が、DBとSupabaseクライアントをモックせずに1本以上のテストで通っている
  - 少なくとも happy path が `internal_error` にならないことを assert する
- 実装結果（2026-08-01）: `src/app/actions/actions.db.test.ts`（10件）を追加。**モックはセッションと Next のリクエストAPI（`revalidatePath`・`after`・`redirect`）だけ**で、DB・Supabaseクライアント・ビジネスロジックは本番実装のまま実DBへ通す。対象は優先7領域: 設定（表示名・通知・ニュース）／Xアカウント（一覧・active切替）／スケジュール（作成・停止・再開。楽観lockを含む）／発信設定（ベースmd初版の生成）／下書き（一覧・破棄）／生成job（前提不足の扱い）／APIキー（premiumは権限エラー・BYOKは暗号化保存）／通知（一覧・既読）。
  **`internal_error` にならないこと**を主眼に置いた。実際、生成jobは前提不足で `persona_required` 系を返すこと、APIキーはpremiumで `forbidden` を返すことを確認できた（どちらも「何をすればよいか分かる」形）。
- 途中で見つけて直した2件:
  - **自テストの後片付け漏れ**: 利用者を毎テスト作って最後の1人しか消していなかった。10人が残ると `follower_snapshot`（全アカウント対象・1起動100件上限）の対象を食い、**無関係なテストが落ちた**。FK順に消す `afterEach` へ修正し、手順書へも「テストごとに作った利用者はそのテストの終わりで消す」を追記した。
  - **日次サマリのFK違反**: 対象利用者を集めてから通知を作る間に、並行するテストがその利用者を削除すると FK 違反が `onCleanupError` へ上がり、`scheduler-tick` の route テストが落ちた。`insert ... select from profiles where id = $1` にして**利用者が消えていたら静かに飛ばす**形へ直した（退会と同時に走った場合も同じ）。
- 検証（2026-08-01）: release:check 完全通過（1,392件・E2E 29件）。**3回連続で緑**を確認（flakeが残っていないこと）。テスト後の残留データも `db:clean-test-data` で0にした。
- メモ: API route 側は `dac6dfc`＋`a35870d` で `*.db.test.ts` 7本（43件）まで整備したが、**Server Action 側は `auth.test.ts` の1本だけ**（しかも本番実装を通していない）。`src/app/actions` はテストを除いて19ファイルあり、`x-accounts`・`drafts`・`generation-jobs`・`schedule`・`api-keys`・`settings`・`persona-settings` が優先。2026-07-26 の `service_role` GRANT漏れは「純粋関数のテストが充実しているほどテスト済みに見える」型の穴で、同じ構造が actions 側に残っている。

### T-M7-28: 外向き副作用チャネルのガード網羅テスト `done`
- 参照: 要件01 §8、要件04 §14 / 依存: なし / サイズ: S
- 完了条件:
  - 外向きチャネル（X投稿・SMTP・Stripe・Storage削除・外部HTTP）を列挙し、各々に非productionガードがあることを1本のテストで検査する
  - 新しいチャネルを足したらそのテストが落ちる
- 実装結果（2026-08-01）: `src/lib/ops/outbound-channels.ts` に**外へ出るファイルの一覧**を持ち（8チャネル: X API・SMTP・AI provider・Stripe・Storage削除・APIキー失効・出典URL検証・自アプリworker）、各チャネルに「何が外へ出るか」と「非productionで実害が出ない仕組み」を日本語で書いた。`outbound-channels.test.ts` が `src/` を静的に走査し、**一覧に無いファイルが外向き呼び出し（`fetch`・nodemailer・AI SDK・Stripe SDK・Storage削除）を持ったら落ちる**。逆に、外向き呼び出しが無くなったファイルが一覧に残っていても落とす（腐った登録を残さない）。
  ガードの振る舞いも同じテストで固定した: SMTPは production 以外でループバック宛のみ／X投稿は `dry_run` でHTTPを1度も呼ばない／`live` は production 以外では起動時のenv検証で落ちる。
- 検証（2026-08-01）: 単体6件。**検出力を実測**（`fetch` を1行含む一時ファイルを置くと `lib/_probe-outbound.ts（http）` を指して落ちることを確認）。走査で `schedule-cleanup.ts` は削除関数を注入されるだけで自分では呼ばないことも分かり、一覧から外した（純粋に保つ設計が確認できた）。release:check 相当（型・lint・単体+DB 1,372件）緑。
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

### T-M7-30: 週次メンテナンス枠（`/maintenance` スキル） `done`
- 参照: [開発とテストの進め方](../docs/operations/development-and-testing.md)、要件01 §7 / 依存: T-M7-25 / サイズ: S
- 完了条件:
  - 週次で `check:providers` ＋ `smoke:live` ＋ 依存監査 ＋ 外部API変更の確認を回す手順がスキルとして存在する
  - 月次でコスト実績・queued/staleの掃除・バックアップ復元テストを回す手順がある
- 実装結果（2026-08-01）: `.claude/skills/maintenance/SKILL.md` を追加。**週次6手順**（doctor → check:providers → smoke:live → audit:check → db:clean-test-data → 未pushの確認）と**月次4手順**（費用の実績・バックアップ復元テスト・外部APIの変更確認・保持cleanupの効き）を持つ。実費が出る手順は金額を伝えてから実行する（週次の想定 約50円）。見つけた不具合はその場で直さず `/add-task` で起票する（点検と修理を混ぜると点検が終わらない）。
  スキル内に「なぜ必要か」の表を置いた（7層はすべて**変更起点**で走るため、外部APIの仕様変更・新しい脆弱性・データの滞留・費用増加はどの層も捕まえない）。手順書 §7.5 と冒頭の索引、CLAUDE.md のスキル一覧へも登録した。
- 検証（2026-08-01）: **週次を1回実際に通した**。doctorが⚠️2件（ニュースの全件破棄・Xトークン期限）、audit は high 1件（allowlist済み）、掃除はテストユーザー609件と送信待ちメール4件を処理、未push 30件。参照先（npmスクリプト名・リンク・スキル名）が実在することも機械的に確認した。
- メモ: 外部APIは予告なく変わる（`allowed_callers` の件）。変更起点の検査（CI）だけでは時間経過による破綻を捕まえられない。`/loop` かクラウドスケジュールで回せる形にする。


### T-M7-31: ローカル由来の古い queued 通知を掃除できるようにする（D-9 案A） `done`
- 参照: 要件04 §14、要決定D-9 / 依存: なし / サイズ: S
- 完了条件:
  - `npm run db:clean-test-data` が「一定期間より古い `email_status='queued'` の通知」を掃除対象に含める（既定はdry-runで件数を表示し、`-- --apply` で実行）
  - **ローカルDB以外へは接続しない**既存のガードが効いたままである
  - 実メールのアカウント（運営者本人のアドレス等）宛の通知も対象になるが、`in_app` の表示は壊さない（`email_status` を `not_requested` に落とすだけで行は消さない、が既定）
- 実装結果（2026-07-31）: `scripts/clean-test-data.mjs` に掃除対象(2)として追加した。`email_status='queued'` を `not_requested` に落とし、`email_available_at` を消す（**行は消さない**ので画面の通知履歴182件はそのまま）。既定はdry-runで「件数・人数・最古の経過時間」を出し、`-- --apply` で反映。`-- --older-than <日数>` で絞れる。
  **既定を「7日より古い」から「送信待ちすべて」へ変更した**。ローカルDBの `queued` はすべてローカル検証で作られたもので（本番は別DB）、スクリプトはローカル以外へ接続しないため期間で絞る意味がない。実際、暫定案の7日だと**53件のうち0件しか掃除されなかった**（最古が148時間＝6.2日前）。「掃除したつもりで残る」形は原則1に反するため既定を変えた。
- 実行結果（2026-07-31）: 送信待ち53件（news 45・draft_created 5・error 3、すべて 運営者本人のアドレス 宛）を送信対象から外した。あわせて滞留していたテストユーザー693件も削除（実アカウント1件は温存）。`npm run doctor` の「お知らせメール」が ⚠️ → ✅ になった。`failed` の1件は残るが、**送信されるのは `queued` だけ**で `failed` は利用者の明示的な再送要求でしか送られないため一斉送信の risk は無い（`notification-email.ts` の抽出条件で確認）。
- メモ: ローカル検証で作られた通知が `queued` のまま49件残っている。T-M7-23 で development からの実送信は止めたが、**このDBを本番へ持ち込むと初回の `scheduler_tick` で一括送信される**。行を消すと画面の通知履歴が欠けるため、`email_status` を落とす方式を既定にする（削除は別オプション）。しきい値の既定は「7日より古い」を暫定とし、実装時に `db:clean-test-data` の既存オプション設計へ合わせる。

### T-M7-32: sharp を 0.35系へ upgrade し依存の high を減らす（D-7 案A） `done`
- 参照: 要件01 §8、要決定D-7 / 依存: なし / サイズ: M
- 完了条件:
  - `sharp` が 0.35系で動き、画像正規化（JPG/PNG/WEBP・5MB以下・16:9）の挙動が変わっていない（`image-normalize` のテストと `smoke:live` の画像シナリオが緑）
  - `scripts/audit-check.mjs` の `HIGH_ALLOWLIST` から `sharp` を外す
  - `postcss` については `overrides` で 8.4.31 を上書きできるか検証し、可否と理由を allowlist の理由文へ反映する
- 実装結果（2026-08-01）:
  - `sharp` を **0.35.3**（libvips 8.18.3）へ上げた。**破壊的変更が1つあった**: `sharp.Metadata` の名前空間型が無くなり、`import sharp, { type Metadata } from "sharp"` へ変更（型のみ・実行時の呼び出しは変更なし）。
  - **nested 版も `overrides` で寄せた**。`next` が `optionalDependencies` で `sharp@^0.34.5` を pin しており、トップレベルを上げるだけでは `node_modules/next/node_modules/sharp` に 0.34.5 が残って CVE群も残っていた。
  - **`postcss` も `overrides` で解消できた**（完了条件3の検証）。8.5系へ寄せて `npm run build` が通ることを実測。next のビルドは壊れなかったため allowlist から外した。
  - `HIGH_ALLOWLIST` は `brace-expansion`（ビルド時のみ到達）の1件だけになった。**本番依存の high は 4件 → 1件**。
- 検証（2026-08-01）: `image-normalize` の単体8件緑。`npm run build` 通過。**実物1周**（`smoke:live`）で画像1.7MBが `ready` になることを確認。release:check 完全通過（1,372件・E2E 29件）。
- 途中で踏んだ落とし穴: `npm install` でネイティブモジュールを差し替えても**動いている dev サーバーは古いバイナリを掴み続ける**。再起動前は画像jobが `job_failed`（理由なし）で落ち、原因が分からなかった。手順書 §11 へ記録した。
- メモ: libvips の CVE群（CVE-2026-33327/33328/35590/35591・GHSA-f88m-g3jw-g9cj）が `sharp<0.35.0` 対象。現在 `^0.34.5`。breaking upgrade なので API 差分を確認してから上げる。`postcss` は next が nested で pin しており upgrade では解消しないため、`overrides` が唯一の手段だが next のビルドを壊す恐れがある（壊れるなら allowlist に残す判断を理由付きで記録する）。`next` は T-M7-10 で 16.2.12 済み、`brace-expansion` はビルド時のみの到達経路で allowlist 継続。


### T-M8-84: Xキー保存の押せる条件をサーバー検証と一致させる `done`
- 参照: 要件06 §2（設定・APIキー）、`src/app/app/settings/api-key-settings.tsx` / 依存: なし / サイズ: S
- **発端**: 2026-08-11 の追加調査（F3 の周辺確認）で見つかった。
- **問題**: 保存可否の判定 `xSavable`（api-key-settings.tsx:160-163）が Client ID の**文字種を見ていない**。
  そのため `bad id` のように空白や記号を含む値でもボタンが押せ、サーバー側
  （`src/lib/api-keys.ts` の `client_id` の正規表現 `^[A-Za-z0-9_-]+$`）で初めて弾かれる。
  同ファイル :156 のコメントは「サーバー検証と同じ条件」と書いており、**ここだけ食い違っている**。
- **なぜ直すか**: 押せてしまってサーバーに弾かれる形は、押す前に理由が分かる形（T-M8-46・T-M8-37）へ
  そろえた設計から外れる。押せない理由の文言はすでに整っているので、条件を1つ足すだけで一貫する。
- **やること**: `xSavable` に文字種の判定を足し、押せない理由に対応する分岐（「Client IDは英数字・
  ハイフン・アンダースコアで入力してください。」）を出す。文言は `src/lib/api-keys.ts` の
  zod メッセージが正本なので二重に書かない。E2E（`e2e/x-oauth.spec.ts` の T-M8-46 のテスト）へ
  1ケース足す。
- **注意**: 画面とサーバーで判定が二重になるのは避けられないため、**同じ条件であることを機械検査で
  固定する**（正規表現そのものを共有するか、画面側の判定を lib へ出す）。

- **実装メモ（2026-08-12）**: 食い違いは文字種だけでなく**3か所**（文字種・Client ID上限200・Client Secret上限512）だった。さらに**AIキー側も同じ問題**（長さしか見ておらず空白入り・上限超えが押せた）。写経をやめ、`xApiKeySaveBlocker`／`aiApiKeySaveBlocker` が**同じスキーマを通して**押せない理由を返す形にした。送るpayloadも同じ関数から作るので「押せたのに弾かれる」が復活しない。文言は件数入りにし、「Confidential client」という内部用語も解消した。画面の判定とスキーマの結果が常に一致することを Client ID 9種 × Secret 6種の直積で固定し、画面に長さ比較・文字種の正規表現が残らないことを走査テストで守る。
### T-M8-85: 要件06 の警告一覧と実装の齟齬を解消する（「引用対象不明」） `done`
- 参照: 要件06 §4.3、`src/lib/post/warning-codes.ts` / 依存: なし / サイズ: S
- **発端**: 2026-08-11 の追加調査（D-23 の周辺確認）で見つかった。
- **問題**: 要件06 §4.3 は警告として「引用対象不明」を挙げているが、**対応する警告コードが実装に無い**
  （実装は `warning-codes.ts` の7コードだけ）。正本と実装の齟齬で、`docs/` は実装の現状と一致して
  いなければならない（CLAUDE.md 最重要ルール）。
- **やること**: どちらが正しいかを決める。(a) P-5（引用投稿）で引用対象が解決できない場合の警告が
  必要なら実装する（`quote_url` から `quote_tweet_id` を解決できなかったときの扱いを確認する）。
  (b) 不要なら要件06 から記述を削る。**先に P-5 の現在の実装を読んで、引用対象が解決できないときに
  何が起きるかを確認する**（黙って引用なしで投稿していると原則1に反する）。

- **実装メモ（2026-08-12）**: 結論は**(b) 要件06 から削る**。調べると `quote_url → quote_tweet_id` の解決処理がコードに1つも無く、**P-5は全体が未実装**だった（入力欄も無く、生成は `drafts.quote_url` を保存しない）。要件06 §5 と要件04 §10 step3 へ「未実装」を具体的に明記し、正本と実装ラベルの**双方向の照合を機械検査**にした（`warning-docs-sync.test.ts`）。あわせて**安全ガード**を入れた（ユーザー承認）——フラグをONにした瞬間に引用先の無い引用ポストが黙って出るため、X APIを呼ぶ前に止めて `draft` へ戻す。
### T-M8-86: ニュース取得の検証失敗の中身を記録できるようにする `done`
- 参照: 要件02 §3.19（`news_fetch_outcomes`）・要件04 §6、`src/lib/jobs/news-research.ts` / 依存: なし / サイズ: M
- **発端**: 2026-08-11 の F4（検証失敗で応答本文を残す）を4経路へ入れたが、**ニュース取得だけ入れられなかった**。
- **問題**: `news_fetch` は `generation_jobs` を持たず、`news_fetch_outcomes` に理由テキストの列が無いため
  **保存先が無い**。経路は route の `onError` → Sentry しかなく、Sentry へ provider の応答本文を送るのは
  要件01 §8 に反するので載せられない。結果、ニュースの検証失敗は「何件落ちた」までしか分からない。
- **なぜ直すか**: 原則1「正常な空と失敗による空を別の値で表す」は件数では満たせても、**原則2「原因が
  開発知識なしで辿れる」を満たせない**。T-M8-83 で古さの範囲（`_too_old_min_age_h`）を足したのと同じ動機。
- **やること**: `news_fetch_outcomes` へ `error_code` / `provider_raw_error` 相当の列を足す migration を書き、
  `applyRecencyPolicy` の後段（検証で落ちた分）で `ai/raw-error.ts` の `RAW_ERROR_MAX` に合わせて保存する。
  **DBスキーマ変更を伴うため `/verify-integration`（`service_role` のGRANT含む）が必須**。
  画面へは出さない（運営者向け）。`drop_reasons` の `_` 接頭辞の規則（T-M8-83）と衝突しない形にする。


- **実装メモ（2026-08-12）**: `news_fetch_outcomes` へ `error_code` / `provider_raw_error` の2列を追加（migration `20260812000001`）。`drop_reasons` へ混ぜる案は却下（型が `Record<string, number>` で9箇所に固定）。**契約違反で落とした候補の中身だけ**（先頭5件）を残し、`published_at:too_old` だけの除外では作らない（良性の空と混ぜない）。**HTTP応答・スモーク・日次サマリへは載せず**、doctor には `error_code` だけ添える。応答へ漏れたら落ちるテストを追加。**読み出し専用コマンド（`doctor -- --news-raw` 等）は今回のスコープ外**（ユーザー判断・2026-08-12）。運営者はいまDBか Claude 経由で読む。
### T-M8-87: 本番の `/signup` と `/reset-password` がCSPでscript全滅し機能していなかった `done`
- 参照: 要件01 §8・ADR-0005（改訂）・`src/app/layout.tsx` / 依存: なし / サイズ: M
- **発端**: 2026-08-14、`main` へのマージで初回の本番デプロイ（exosai.net）を行い、実ブラウザで公開9ページを確認したところ `/signup` と `/reset-password` でNext.jsのJSチャンクが**CSPに拒否**されていた。
- **症状**: 会員登録もパスワード再設定も**できない**。HTTPは200を返し本文も表示されるため、URLを叩くだけでは分からない。
  実測: `/signup` は scriptタグ16本のうちnonce付き**0本**（`x-nextjs-prerender: 1`・`x-vercel-cache: HIT`）。
  対して `/login` は16/16、`/` は34/34 でnonceが一致していた（どちらも動的レンダリング）。
- **原因**: CSPの `script-src` は `'nonce-…' 'strict-dynamic'`。`'strict-dynamic'` はホスト指定（`'self'`）を**無視させる**ため、
  nonceが一致しないscriptは1本も実行されない。nonceはリクエストごとに作るので**静的prerenderされたHTMLへは焼き付けられない**。
  **ADR-0005（2026-07-25）はこの因果を正しく書いていた**が、適用先を「公開コンテンツページ（LP＋法務3ページ）」と
  **手で数え上げていた**ため認証画面が漏れ、列挙と実装の一致を確認する仕組みも無かった。
- **なぜどのテストも緑だったか**: `security-headers.test.ts` はヘッダの文字列だけを見てHTML側を見ない。
  E2Eは `npm run dev` で動き、**dev modeはprerenderしないので原理的に再現しない**。typecheck・lint・build は成功する。
- **やったこと**:
  1. `force-dynamic` をページごとの宣言から **`src/app/layout.tsx` の1箇所へ移した**（ページ側の4宣言を削除）。
     新しいページを足しても既定で動的になり、数え上げる対象そのものが無くなる（原則3）。
  2. **`npm run check:csp-nonce` を追加**し `release:check` の `build` 直後へ組み込んだ。`.next/server/app/**/*.html` を走査し、
     nonceの無いscriptを持つHTMLがあれば落とす。ビルド成果物が無いときは緑にせず終了コード2で止まる。
  3. 判定は `src/lib/ops/prerender-nonce.ts`（純粋関数・importなし）へ出し、**実際に壊れていた `/signup` のHTMLの形を
     fixtureにした単体テスト18件**を付けた（直すと走査対象が0件になり、検出器が死んでも緑になるため）。
  4. 例外は `NONCE_EXEMPT` に理由付きで1件だけ（`/_global-error`＝Next.js既定の500画面。root layoutごと差し替わるため
     `force-dynamic` の対象外で常に静的。本文は静的テキストのみでJSを要さない）。**例外がビルドの実態と合わなくなったら落ちる**。
- **検証**: 修正前のビルド成果物に対して検査が4件（`/signup`・`/reset-password`・`/_not-found`・`/_global-error`）を検出し
  終了コード1で落ちることを確認。修正後は静的0件（32ルート全て `ƒ`）で通過。ローカル本番ビルド（`next start`）で
  `/signup`・`/reset-password`・`/login`・`/` の全scriptにnonceが載りヘッダと一致することを確認。`release:check` 緑。
- **後続への注意**: 静的キャッシュ対象はゼロになった。失うものは無かった（静的だったのは上記3ページのみでLPも法務も既に動的）。
  将来どこかを静的に戻したくなったら、nonceを諦める＝CSPを弱めることと同義なのでADR-0005の改訂が必要。

### T-M8-158: 取得失敗を「正常な空」に見せている箇所を直す `done`
- 参照: 要件01 §2／要件06 §2・§10 / 依存: T-M8-155 / サイズ: M
- 背景: T-M8-155のレビューで、App Shellのprofile取得が失敗を「profile未作成」と同じ`null`へ潰していることが
  確定所見として残った（CLAUDE.md 原則1違反）。調査したところ同型が他にもあり、**App Shellの8依存のうち
  ここだけが非対称**だった（他はすべて`getPool()`直結でrejectする）。
- 完了条件:
  - 単一行の読み出しで「行が無い」と「読めなかった」が別の結果になる
  - App Shellのprofile取得失敗が全バナー消滅ではなく共通エラー画面になる
  - 設定画面で連携済みのまま「Xアカウントを選択してください」が出ない
  - 上記を固定するテストがある
- メモ:
  1. `src/lib/supabase/single-row.ts` に `readSingleRow` を新設。失敗は`AppError('internal_error')`で包む
     （**素の`throw result.error`にしない**——PostgrestErrorはErrorインスタンスではなくstackが残らない）。
  2. `src/lib/app-shell/data-server.ts` のprofile取得を Supabase client から**pooled query へ寄せた**。
     `createSupabaseServerClient`はこのリポジトリでは**Auth専用**で、データ読み出しは全て`getPool()`経由
     （`createSupabaseServerClient`の全参照を確認）。ここだけが例外だった。`_at`列は`::text`を付ける。
  3. **`src/app/error.tsx` を新設。** `src/app/app/error.tsx`は**同一セグメントの`app/app/layout.tsx`の
     例外を受けない**ため、これが無いとApp Shellの取得失敗が`/app`配下の全画面でNext.js既定の
     エラーページになる（原則2違反）。器と文言は`app/app/error.tsx`と共通。
  4. `src/app/app/settings/page.tsx`・`src/app/plans/page.tsx` の握り潰しを`readSingleRow`へ。
     前者は「連携済みなのに未選択の空状態」、後者は「契約中なのに`/plans`に留まる」を作っていた。
  5. 通知Actionのpayload型を`src/lib/notifications.ts`の`NotificationListPayload`／
     `NotificationMutationPayload`へ**単一正本化**した。ベル側へ手書きで複製していたため、
     payloadが全部optionalで**action側の`nextCursor`を改名しても型検査が通り実行時にundefinedを読む**
     状態だった。正本を1つにしたので、改名するとaction側とベル側の両方がコンパイルエラーになる
     （実際に改名して`error TS2561`／`TS2551`が出ることを確認）。依存方向は変えていない
     （ベルは`@/app/actions`をimportしない）。
- 検証メモ（2026-08-20）: 型検査・lint・doc日付／参照検査は成功。実DB全テスト262 files／2296件成功
  （skip 19件は実APIキー必須のlive検査）。`npm run build`＋`npm run check:csp-nonce`成功
  （root直下にclient boundaryを追加したため必須。静的prerenderは増えていない）。
- 未対応（別タスク）: `src/lib/supabase/update-session.ts`のprofile取得も失敗を`null`へ潰し、
  `route-guard`が全員を「未契約」として`/plans`へ送る。**middlewareでthrowすると全リクエストが
  落ちるため、リダイレクトの向き（fail closed）を変えずに記録だけ足す設計が必要**で、
  影響範囲が認証経路全体に及ぶため分けた → T-M8-159。

### T-M8-159: 認証proxyのprofile取得失敗を記録して「未契約」と区別する `done`
- 参照: 要件01 §5・§8（proxyのsession検証）／要件03 §1 / 依存: T-M8-158 / サイズ: S
- 背景: `src/lib/supabase/update-session.ts` の `select("plan, subscription_status")` は
  `result.data`だけを返し`error`を捨てる。`src/lib/auth/route-guard.ts` は `!profile?.plan` で
  `/plans` へ送るため、**DBが読めない間は契約中の利用者も全員「未契約」扱いで`/plans`へ飛ぶ**。
  fail closed 自体は仕様（要件01）だが、記録が無いので運営者には「解約が急増した」ようにしか見えない
  （原則1「失敗は必ず記録する」）。
- 完了条件:
  - リダイレクトの向き（fail closed）は変えない
  - 取得失敗が記録され、運営者が気付ける経路（通知・サマリ・Sentry）に載る
  - 失敗の連続時に記録が溢れない（App Shellと違いproxyは全リクエストで走るため多重記録の抑制が必要）
  - middlewareで例外を投げないこと（全リクエストが落ちるため）を固定するテスト
- メモ: `loadRouteGuardProfile` で `result.error` を判定し、`captureServerException` へ
  `AppError('internal_error')` として記録するようにした。**向き（fail closed→`/plans`）は変えていない。**
  proxyは`/app`配下の全リクエストを通るため、記録はモジュールスコープの時刻で**60秒に1回へ間引く**
  （DB障害中に記録先が溢れて他の異常が埋まるのを防ぐ）。`update-session.test.ts` に
  「throwせず・`/plans`へ送り・1回記録する」を同時に固定するテストを追加（10件成功）。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト成功。docs 要件01 §5 を更新。

### T-M8-161: 実DB全テストの「flaky」1件は決定的な失敗だった（follower_snapshot） `done`
- 参照: `src/lib/jobs/follower-snapshot.ts`／`src/lib/jobs/follower-snapshot.db.test.ts` / 依存: なし / サイズ: S
- 背景（2026-08-20）: 実DB全テストが**5〜6回に1回**だけ1件落ちる状態を観測した。
  10回連続実行で捕まえたところ、常に同じ1件だった:
  `follower-snapshot.db.test.ts > writes today's snapshot for an active account`
  （`expected 0 to be greater than or equal to 1`）。
- **原因（flakyではない）**: `executeFollowerSnapshot` は「今日の分が無い active アカウント」を
  **全アカウントから** `created_at asc, id asc` 順に `FOLLOWER_ACCOUNT_LIMIT`（=100）件だけ選ぶ。
  テストが作るアカウントは**必ず最も新しい**ので、ローカルDBに他テスト・E2Eの active アカウントが
  100件以上残っていると**このテストのアカウントが上限で切り落とされ**、`snapshotsWritten` が 0 になる。
  観測時のローカルDBは **active 101件**で、閾値をまたいだ瞬間から落ち始めていた。
  つまり**溜まった件数で決まる決定的な失敗**で、実行のたびに変わる「flaky」ではない。
  E2Eを何度も回して active アカウントが増えた結果、途中から再現し始めたのが「間欠的」に見えた理由。
- **なぜ既存の対策で防げなかったか**: テストは `getAccessToken` が自分以外へ `null` を返す形で
  「他テストのアカウントの巻き込み」を既に意識していた。しかしそれは**選ばれた後**の話で、
  **選定そのもの（LIMIT で切られる）は防げない**。
- 対応: `mockDeps` に `limits: { accounts: 100_000 }` を渡し、選定上限に依存しないようにした。
  他アカウントは従来どおり token=null で即skipされるので外部呼び出しは増えない。
  **DBに101件残った状態で、修正前は落ち・修正後は通ることを実際に確認した**（決定的であることの裏取り）。
- 副次の気付き: ローカルDBに**テスト・E2E由来の active アカウントが100件以上滞留**していた。
  `npm run db:clean-test-data` があるので定期的に流す。滞留自体が他の「全アカウント対象」の
  ジョブテストにも同種の閾値問題を作りうる。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト成功。

### T-M8-177: LP微調整（コンセプトの埋め込み図・成長グラフの軸/密度・半額の強調） `done`
- 参照: 要件06 §1（LP） / 依存: T-M8-172 / サイズ: M
- 完了条件:
  - 01コンセプトが画像（JPEG）ではなくページに溶け込む埋め込み図（CSS/SVG・デザイントークン準拠）になる
  - 03しくみのグラフが縦軸「アカウントの成長」・横軸「運用時間」になり、点が増えて細かくなる。グレーの薄い注釈文は消す
  - 05料金の「リリース記念で全プラン半額」がもう少し大きく表示される
  - landing系テスト・実ブラウザ確認が緑
- メモ: 運営者の指示（2026-08-21）。コンセプト図の置き換えで「LP図版はCSS/DOMのみ」の原則へ戻る
  （要件06の例外記述を撤回。docs/lp/コンセプト.pngはデザイン参照として残す）。

### T-M8-178: プロンプト集の投稿プロンプトにプレースホルダーを表示 `done`
- 参照: 要件06（/prompt-templates）・要件02 §3.21 placeholders / 依存: T-M8-175 / サイズ: S
- 完了条件: 投稿プロンプトのカードに、その型が差し込みに使うプレースホルダー名（例: {自分の考え}）がチップで並ぶ（公式・利用者作成の両方。無い型には出さない）
- メモ: 運営者の指示（2026-08-21）。公式分は既定パターンのseed値と同じ定義をギャラリー側に持つ（SQLからimportできないため。変えるときは両方揃える）。

### T-M8-179: 友達招待ページのレイアウトを他ページと揃える `done`
- 参照: 要件06 SC-12・§2（App Shell） / 依存: T-M8-174 / サイズ: S
- 完了条件: /app/invite が他のapp画面と同じ器（`max-w-[1180px] px-4 py-[26px]` のmain）で描画され、幅・余白のズレが無い
- メモ: 運営者の指摘（2026-08-21）。素のdivで返していたためmax-widthとpaddingが効いていなかった。

### T-M8-180: T-M8-168〜179範囲のリファクタリングとdocs総同期 `done`
- 参照: CLAUDE.md（doc同期）・/refactor / 依存: T-M8-177〜179 / サイズ: M
- 完了条件:
  - 重複コードの集約（posts/scheduleページのimageProvidersFor重複 等）と、振る舞いを変えない整理
  - 今回範囲のdocs（PRD・要件01〜06・プロンプト設計書・運用メモ）と実装の突き合わせで漏れゼロ
  - 全ゲート（typecheck/lint/単体/build/csp/E2E）緑
- 実装メモ（2026-08-21）:
  - リファクタ: posts/scheduleページに重複していた `imageProvidersFor` を
    `lib/ai/image-providers-server.ts` へ集約（実行側と同じ判定基準である旨をコメントで固定）。
    未使用importの掃除。JSTオフセットの局所定数は既存モジュールも同じ流儀のため据え置き。
  - docsの突き合わせで見つけた同期漏れを修正: 要件05のwebhook対象イベント一覧に
    charge.refunded が無かった／deployment.mdのwebhook登録行から購読イベント一覧への参照が
    無かった／プロンプト設計書にPT全文が公開ページへ表示される旨が無かった。
  - 全ゲート緑: typecheck・lint・単体/DB 2,383件・build・csp・E2E 94件。

### T-M8-175: プロンプト集に利用者作成プロンプトを掲載（タブ・検索・導線マーク） `done`
- 参照: 要件06（/prompt-templates）・プロンプト設計書 / 依存: T-M8-173 / サイズ: M
- 完了条件:
  - プロンプト集が「アカウント.md／投稿プロンプト／画像プロンプト」のタブ切り替えになる
  - 各タブに運営テンプレート（公式バッジ）に加え、**一般ユーザーが作成したプロンプト**が題名・説明つきで並ぶ（匿名。ハンドル・氏名等の識別子は出さない）
  - ワード検索で題名・説明・本文を絞り込める
  - プロンプト集への導線（LPヘッダー・appナビ）にページ遷移が分かるマークが付く
  - 利用規約・プライバシーポリシーに匿名掲載の開示を追加（版は未デプロイの2026-08-20のまま）
- メモ: 運営者の指示（2026-08-21。D-32の案Bを自動掲載・匿名の形で採用）。投稿プロンプトは
  自作パターン（seed_key null・題名/説明あり）、画像はアカウント上書き（題名は自動生成）、
  アカウント.mdは主テーマから題名を導出。掲載停止はお問い合わせ窓口で受ける旨を規約に書く。
- 実装メモ（2026-08-21）: `prompt-gallery-server.ts`（各タブ新しい順50件・識別子なし）＋
  `GalleryExplorer`（クライアント検索・0件明示）。開示は利用規約第7条とprivacy利用目的へ追記
  （版は未デプロイの2026-08-20のまま）。導線マークはLPヘッダー・appナビにopen_in_new。E2E更新済み。

### T-M8-176: 友達招待の表示調整・受取可能の締め挙動・振込オペレーション手順書 `done`
- 参照: 要件06 SC-12・要件03 招待プログラム・docs/cp/invite_cp.md / 依存: T-M8-174 / サイズ: S
- 完了条件:
  - 招待ランクの段が「現在の報酬率」の直下に小さく入る（独立カードをやめる）
  - KPI「受取可能」が振込（翌月末まで）の完了時点で0になり、報酬履歴へ「支払済み」で並ぶ（月初の締め時点では減らない）
  - docs/operations に運営者の銀行振込オペレーション（月次の流れ・コマンド・例外時）を記載し、docs/READMEの一覧へ載せる
- メモ: 運営者の指示（2026-08-21）。受取可能の集計から「未束ね」条件を外す（束ねただけでは減らさない）。
- 実装メモ（2026-08-21）: ランク段はヒーローカード内の小型表示へ（独立カード削除）。
  実装中に**0人時の「次のランク」が同率20%を指すバグ**を発見し修正（率が上がる段を次とする）。
  運用手順書 docs/operations/affiliate-payouts.md（月次の流れ・コマンド・例外表・会計分離）を追加。

### T-M8-171: 料金表示の刷新第2弾（全機能表示・差分色付け・1日あたり価格・プロモ帯） `done`
- 参照: 要件06 §1.1・要件03 §54 / 依存: T-M8-169 / サイズ: M
- 完了条件:
  - 各プランカードに全機能リストが載り、下位プランから変更・追加された行だけ色付きで強調される
  - 各カードに1日あたりの概算価格が出る（月額÷30・切り上げ・「約」表記）
  - /plansの申込前確認テキストと「スタンダードプランのご注意」が消え、代わりに半額＋無料トライアル実施中のプロモ帯がやや目立つ形で出る
  - LPの「05 料金」が/plansと同じカード部品になり、下部の注意書き（APIキーの費用について・お申し込み前にご確認ください）が消える
  - E2E（plans/landing）と landing-page.test が新表示で緑
- メモ: 運営者の指示（2026-08-21）。**特商法系の常時表示テキストの削除は運営者の決定**（法定事項は
  フッタの特商法ページ・利用規約が引き続き担う。スタンダードのAPI実費はカード内の
  「APIキーの用意：自分で用意」とFAQに残る）。1日あたりは切り上げで安く見せすぎない（景表法）。
  dev環境の新Price 3本は金額・Product名をStripe実APIで確認済み（1,480/3,980/14,800・2026-08-21）。
  STAGING_/PRODUCTION_のPrice環境変数は _MD_→_EXPERT_ へ改名済み（値は運営者が未投入）。
- 実装メモ（2026-08-21）: 比較表（plan-comparison-table.tsx）は未使用になり削除。差分強調は
  色＋太字＋sr-only文の3経路（WCAG・色だけに頼らない）。「初回のみ」「カード登録が必要」の開示は
  CampaignCallout が唯一の常時表示で landing-page.test が固定。E2E（plans/landing）緑・実ブラウザ確認済み。

### T-M8-172: LPセクション刷新（コンセプト画像・成長グラフ・フロー図・並び順） `done`
- 参照: 要件06 §1（SC-01 LP） / 依存: T-M8-171 / サイズ: L（分割すると途中状態でLPの並びが崩れるため一体で行う）
- 完了条件:
  - ヒーロー右のモックが「ニュース解説→プロンプト作成→投稿作成→スケジュール→結果分析・プロンプト改善」の並びになり、「自分の考え・意見」の表記が「投稿作成」へ変わる
  - 「02 できること」が同じ並び順の5枚になり、図版がよりリッチになる
  - 「01 課題」が「01 コンセプト」になり docs/lp/コンセプト.png を表示する
  - 「03 しくみ」が「使うほどプロンプトもアカウントも成長する」成長グラフの図になる（提案は自動反映しない旨の開示は残す）
  - 「04 使い方」が「04 初めかた」になりフロー図で表示される
  - 実ブラウザ（1440/768/390）で崩れ・横スクロールなし、landing系テスト緑
- メモ: 運営者の指示（2026-08-21）。LPの図版は従来CSS/DOMのみだったが、コンセプト画像はPNGを
  public/ へ配置して使う（運営者提供の完成画像のため）。重量対策で幅を縮小して配置する。
- 実装メモ（2026-08-21）: コンセプト画像は1600px幅のJPEG（156KB）へ変換して配置。02は5枚
  （PromptEditorFigure・PostComposeFigure新設）、03はSVGの成長グラフ（GrowthChartFigure。
  y軸は「プロンプトの完成度」に限定し、反映は利用者が選ぶ開示を維持）、04はカード＋矢印の
  フロー図。ブランドグラデは2本へ減（landing-page.testの規定数を更新）。単体・E2E・実ブラウザ
  （1440/390）確認済み。

### T-M8-173: プロンプトテンプレートページと導線（LPタブ・appナビ） `done`
- 参照: 要件06 §1（LP）・プロンプト設計書（PT-P1〜P6・PT-IMG・アカウント.md） / 依存: なし / サイズ: M
- 完了条件:
  - 公開ページでアカウント.mdテンプレート・投稿プロンプト（6種）・画像生成プロンプトの一覧と全文確認ができる
  - 各プロンプトの「このプロンプトを利用する」ボタンで新規登録（/signup）へ遷移する
  - LPヘッダーのタブとappナビに導線がある
  - プロンプト本文はコードの正本（gen-prompts等）から描画し、ページへ書き写さない
- メモ: 運営者の指示（2026-08-21）。「ユーザー達が作成しているプロンプト」は現状DBに公開許諾の
  仕組みが無く、実ユーザーのアカウント.md公開はプライバシーポリシー上できないため、
  **本文はアプリが実際に使うテンプレート（システム既定）を正本から表示する**形で実装する。
  利用者投稿型のテンプレート共有（オプトイン）は要決定D-32として分離。
- 実装メモ（2026-08-21）: /prompt-templates（公開・8件全文＋/signupへのCTA）。本文は
  prompt-template-gallery.ts が正本から引き、同名testが同一性を固定。導線はLPヘッダーnavと
  appナビ第7項目（navigation-items.testのh1突き合わせを公開ページ対応へ拡張）。E2E 2件追加。

### T-M8-174: 招待プログラム（docs/cp/invite_cp.md の実装） `done`
- 参照: docs/cp/invite_cp.md（正本）・要件03（Stripe）・要件02（DB） / 依存: なし / サイズ: L
- 完了条件:
  - /r/[code] で30日Cookieが付き、新規登録時に招待者へ紐づく（Last Click・自己招待禁止・登録後変更不可）
  - invoice.paid で紹介報酬が作成される（実支払額×ランク別率・Trial中なし・初回課金から最大6ヶ月・解約で終了し再開しない・Refundで取消）
  - /app/invite で招待リンク・実績・報酬率・進捗・報酬・振込予定・銀行口座登録が完結する
  - 月末締め・翌月末支払・手数料980円・最低5,000円のPayoutが作成される
  - migration・RLS・webhook・cron・テストを含む
- メモ: 運営者の指示（2026-08-21・「質問なしで最良の仮説で最後まで」）。仕様の正本はinvite_cp.md。
  パスは既存構成に合わせ /dashboard/invite ではなく **/app/invite**。銀行口座は外部Payout Provider
  未契約のため、**口座番号はAES-256-GCMで暗号化して保存し画面は末尾4桁のみ表示**（provider='internal'。
  振込は運営者が手動で行うため全桁が必要。将来Provider移行時に置き換え）＝要決定D-33として記録。
  Payout作成は月初のscheduler_tick相乗り（定時トリガーは増やさない・原則3）。
- 実装メモ（2026-08-21）:
  - DB 5表（要件02 §3.22〜3.26・migration 20260821000001・RLSはselfのselectのみ）
  - 帰属: /r/[code]→30日Cookie→signUp成功時にbest-effortで紐づけ（登録は止めない）
  - 報酬: invoice.paid のevent claim transaction内で作成（率snapshot・冪等・6ヶ月窓・
    subscription.deletedで終了・charge.refundedで取消←**Stripe webhookの購読イベント追加が必要**）
  - 確定/締め: scheduler_tick相乗り（settle:日次・payout:月次・cron_runsで冪等）
  - UI: /app/invite（SC-12）＋ナビ「友達招待」（モバイル7枠に収めるためプロンプト集はmobileHidden）
  - 運営者: `npm run affiliate:payouts`（一覧／--show=口座全桁を復号／--paid=支払記録）
  - テスト: config 6件・store.db 6件・webhook配線 統合1件・E2E 2件（画面登録での帰属含む）緑
- コミット後の敵対的レビュー（多面workflow・2026-08-21）で検出し修正したもの:
  - **critical**: `charge.refunded` のinvoice参照が現行Stripe API（2026-06-24.dahlia）に存在せず
    （basilで削除）、**Refund取消が一度も動かない**状態だった → `payment_intent`→InvoicePayments
    APIで解決（prepare層を実際に通す単体テストを追加。旧テストはprepared注入でこの層を素通りしていた）
  - **major**: stale判定の早期returnで、配送順の逆転時に**invoice.paidの報酬が恒久に作られない**
    → 報酬作成・請求失敗通知（ともに冪等）をstaleと独立に実行（staleが守るのはprofilesの投影だけ）
  - **critical/major**: Refundで未払いPayoutの束ねが減っても金額が引き直されず**運営者が過払い**
    → `recalcCreatedPayout`（取消時・束ね直後・支払記録直前の3点で突き合わせ。手取り0以下はPayout取消）
  - **major**: claim先行コミットで月次Payoutが1回の失敗で翌月まで飛ぶ＋束ねが非トランザクション
    → claimと本処理を同一トランザクションへ（失敗はclaimごとロールバック→次tickが再試行）
  - **major**: 部分返金でも全額取消していた → 残額×snapshot率で減額（仕様の「減額」を実装）
  - **major**: 利用規約に招待プログラム条項が無かった → 第19条を追加（条件の骨子・不正無効化・
    変更終了権・譲渡不可・税務は受領者責任。版は未デプロイの2026-08-20のまま）
  - **major**: 口座フィールドの制御文字で運営者ターミナルの表示を偽装できた → zodで拒否＋script側でも除去
  - minor: Trial中（未課金）解約での恒久終了をやめ初回課金後に限定／ensureAffiliateAccountの
    user_id競合／招待表のReact key重複／トライアル消化済みへの「7日間無料」表示（/plans）／
    キャンペーン終了後のプロモ帯文頭／docsの取り残し（README・要件06の旧再掲記述）を修正
  - 受容（コード変更なし・記録のみ）: 別メールでの実質自己招待は機械検知しない（振込前に運営者が
    確認・要件03へ明記）／締めは「実行時点のpayable全件」で仕様§9より前倒し方向に広い（同）

### T-M8-170: /plansでNextのchunkがnonce無しで注入されCSPに弾かれる（コンソールエラー） `todo`
- 参照: 要件01 §CSP・ADR-0005（nonce付きCSP） / 依存: なし / サイズ: S
- 完了条件:
  - 本番ビルドの実ブラウザで /plans を開いたとき、CSP violation のコンソールエラーが出ない
  - 再発検知の形を1つ残す（公開ページのコンソールエラーを見るE2Eまたはスモーク）
- メモ: T-M8-169の検証中に発見した**既存事象**（カード化の変更をstashしても再現・2026-08-21実測）。
  streaming境界（`src/app/plans/loading.tsx`）を持つページで、next/link系のchunk
  （`useMergedRef`）がnonce無しの`<script src>`として注入され、strict-dynamicに弾かれる。
  **機能は壊れていない**（Next自身のローダーがnonce付き経路で再取得するため画面・操作は正常。
  E2E 89件緑）。`check:csp-nonce` はprerender済みHTMLの検査なので、この動的注入は原理的に
  見えない。Next.js側の既知問題の可能性が高く、まずNextの新しいpatchで直るかを確認する。

### T-M8-169: 料金ページ（/plans）をカード型レイアウトへ刷新（TweetHunter参考） `done`
- 参照: 要件06 §1.1（/plans）・PRD §プラン / 依存: T-M8-168 / サイズ: M
- 完了条件:
  - /plans が3枚のプランカードで表示される（各カード: プラン名・1行説明・価格・CTA・Xアカウント数バンド・機能リスト）
  - プレミアムに推奨バッジが付き、CTAが視覚的に強調される
  - 機能リストは「下位プランの全機能」＋追加分の形で、可否・数値は `lib/plan-comparison.ts`／`PLANS` から描画される（画面へ直書きしない）
  - キャンペーン表示は既存規約どおり（取り消し線＋「キャンペーン終了後」ラベル。「通常価格」の語を使わない・景表法）
  - エキスパートの利用上限は「無制限」とだけ表示され、内部ガードの数値が出ない
  - 未契約ログイン時のCTAはCheckoutへ、キャンペーン注記・BYOK追加費用・申込前の確認事項が申込ボタンより前に読める（既存E2E plans.spec が通る）
  - モバイル幅でカードが縦積みになり横スクロールが発生しない
- メモ: 運営者の指示（2026-08-21）で https://tweethunter.io/pricing の構成に似せる。**T-M8-125
  「機能を行見出しにした表」を/plansでは置き換える**（新指示が優先）。LPの料金セクションは明示指示が
  /plansのみのため表のまま維持し、数値の単一ソース（plan-comparison.ts/PLANS）は共通のまま保つ
  （要件06の「LPと/plansで同じ部品」の記述は実態へ更新する）。配色はダーク固定を写さず、
  既存のデザイントークン（ライト/ダーク対応）で構造を再現する。
- 実装メモ（2026-08-21）: `components/billing/plan-pricing-cards.tsx` を新設。機能リストは
  `PLAN_COMPARISON_ROWS` のセル比較で「下位プランとの差分行」を機械的に列挙（書き写しなし）。
  CTAは各カード内（推奨=brand・他=subtle）。検証: 1440/768/390で実ブラウザ確認・E2E緑・
  本番ビルドでコンソール確認（既存のCSP注入事象を発見→T-M8-170へ分離起票）。

### T-M8-168: プラン全面再編（旧standard撤廃・エキスパート新設・価格改定） `done`
- 参照: PRD §プラン/§6.1 / 要件01 §3.3 / 要件02 §2 / 要件03 §2・§7 / 要件06 / 依存: なし / サイズ: L
- 運営者の指示（2026-08-20）:
  - 旧standard（500円・上限1・md編集不可）を**完全撤廃**（コード・DB・Stripeとも）。
  - 新構成: **スタンダード 2,960円（半額1,480円）**＝旧mdと同内容／**プレミアム 7,960円（半額3,980円）**＝旧premiumと同内容／
    **エキスパート 29,600円（半額14,800円）**＝「利用枠無制限」。全プラン7日間無料トライアル。
  - Xアカウント上限は**スタンダード・プレミアム1、エキスパート3**（利用枠は合算）。
  - エキスパートは表向き無制限だが**内部ガード**（AIクレジット5000・通常投稿1,000件・URL付き投稿100件）を持ち、
    到達したら「連続的な使用が検知されたため一時的に停止しております。お待ちください。」とだけ表示する
    （エラーコード`usage_paused`・429）。**枠名・数値・「上限」の語をカード・バナー・通知・エラーdetailsのどこにも出さない**
    （80%/100%の閾値通知も作らない）。
  - **「無制限」は注記なしで表示**（景表法の優良誤認リスクは提示のうえの運営者判断。利用規約第3条に一時停止があり得る旨を記載）。
- 実装の要点:
  - DB: `plan_type` enumを `standard/premium/expert` へ入れ替え（migration `20260820000003`。旧md→standard、
    旧standard→**NULL＝未契約**。`profiles.plan` はnullable・defaultなしへ。新規登録trigger は plan を設定しない）。
  - プラン判定は `isOperatorManagedPlan()`（=利用枠を持つ）・`concealsUsageLimits()`・`usageLimitsForPlan()` に集約。
    `plan === "premium"` 比較は全廃（プランが増えると漏れる）。
  - md/プロンプト編集は**全プラン可**。旧standard向けの出し分け（画面のロック・分析提案の非表示・
    `prompt_override`の実行時無視）を撤去し、未契約(NULL)だけを弾く形へ。
  - Stripe: `STRIPE_PRICE_MD_MONTHLY`→`STRIPE_PRICE_EXPERT_MONTHLY`。Product名・説明も3プランへ更新
    （`stripe:portal:setup`が同期）。
  - 法務3ページ・LP・/plans・比較表・FAQ・特商法・利用規約を更新し、規約・privacyのversionを2026-08-20へ
    （全利用者へ再同意バナーが出る）。
- 過程で見つけて直した既存バグ:
  - `applyStandardAccountLimit` が「1件だけ残す」を**ハードコード**しており、上限3のプランへ下げても
    2件を黙って無効化する状態だった → `applyXAccountLimit(遷移先プランの上限)` へ汎用化。
  - 新規登録triggerを書き直す際、`news_config` を初期6分野で写してしまい **T-M7-55（3分野）を巻き戻す退行**を
    `auth.local.test` が検出 → migrationを修正。
  - `analytics` の「AIキー未登録」表示が `plan !== 'premium'` 判定で、エキスパートにも出る状態だった →
    `isOperatorManagedPlan` へ。
- 原価メモ: エキスパートは内部ガード満額で原価約14,900〜15,300円 vs キャンペーン価格14,800円＝**満額使用時は約±0**
  （PRD §6.1）。通常価格29,600円なら黒字。単価は実測で監視する。
- コミット前の敵対的レビュー（多面workflow・2026-08-21）で検出し修正したもの:
  - **critical**: `execution-prereqs.ts` が `plan === "premium"` 判定のまま3箇所残り、**expertがBYOK扱いに
    なって生成・投稿・学習が全滅する**状態だった → `isOperatorManagedPlan` へ（回帰テスト追加）。
    同型の直比較を全廃: `ai-purpose-config-store`（expertがAI設定を保存できない）、
    `posts/schedule page の imageProvidersFor`（expertで画像生成がUIから消える）、
    `suggestion-jobs` のSQL（expertに毎朝の分析が起票されない）、`api-key-store`／
    `api-key-verification-store`（expertがBYOKキーを登録できてしまう）。
  - **major**: expertの内部ガード数値が**設定画面のRSC（Flight）ペイロードでブラウザへ届いていた**
    → `computeUsageSummary` がconcealedでは数値をゼロ埋めして返す形へ（漏れ口を関数の外に作らない）。
  - **major**: 実行は「AIクレジット残が1回分の見積もり未満」で止まるのに、停止表示は「残り0」まで
    出ず、**止まっているのに画面が何も言わない期間**があった → `summary.paused` を実行側と同じ
    条件で立て、バナー・カードはこのフラグだけを見る形へ。
  - minor: expert画面の「プレミアムプラン」固定文言、モデル選択の「約Nクレジット/回」表示
    （内部計量を悟らせる）、`planForUser` がNULLを'standard'へ潰し未契約ロックをすり抜ける経路、
    migrationに「契約中の旧standardが居たら止まる」ガードが無い点、事実と逆のコメント2箇所を修正。
- 検証メモ（2026-08-21）: typecheck・lint・単体/DB 2,357件緑（268ファイル）。migrationはローカル適用済み
  （enum入れ替え・trigger・NOTICE件数・ガードの発火/通過を確認）。build＋check:csp-nonce緑。
  E2E 89件緑。本番ビルドの実ブラウザでLP・法務3ページのコンソールエラーなし・新価格表示を確認。
  Stripe実操作は運営者作業リストを参照。

### T-M8-167: 原価試算を実測へ合わせ、枠外費用を明示する `done`
- 参照: PRD §6.1 / 依存: なし / サイズ: S
- 背景: 運営者への原価説明のため本番の原価台帳（`external_api_usage_events`）を実測したところ、
  PRD §6.1 に3つのずれがあった。
- 直したもの:
  1. **「枠で上限が決まる部分の合計 約2,120円」だけを示していた。** X読み取り・毎朝の投稿分析AI・
     決済手数料は枠の外で、合計すると**1ユーザー約3,020〜3,240円**。**キャンペーン価格2,980円では
     枠を使い切られると赤字**（通常価格5,960円なら黒字）。行を分けて両方を出すようにした。
  2. **ニュース基盤の見積もりが実測より高かった。** 台帳71件の実測は1回$0.173（最大$0.253）＝
     **月$93（約14,900円）**。staging見積もり$0.24〜0.50（月$130〜270）を置き換えた。
     あわせて**「入力tokenが費用の主因」は誤り**だったので直した——台帳の`input_tokens`は139で、
     効くのは**出力token数（3,451）と検索回数（5回×$0.010）**。削減の効く順も書いた。
  3. **投稿分析AIの「約$0.02/回（実測）」は根拠が確認できなかった。** 台帳の記録は0件（本番で一度も
     成功していない）。入力2〜3.5万token・出力3〜6千tokenから**$0.10〜0.15と推定**へ改め、
     未実測であることと `npm run check:suggest` で測れることを明記した。**推定は実測の5〜7倍。**
- メモ: 台帳に記録が0件なのは「安い」ではなく「動いていない」ことのサインだった。
  数値をdocsへ書くときは、実測か推定かを必ず区別する。
- 検証メモ（2026-08-20）: doc日付・参照検査は緑。振る舞いの変更なし（docsのみ）。

### T-M8-166: 写しで陳腐化したdocs・skillsを正本への参照へ畳む `done`
- 参照: `docs/README.md` §2（所有ルール）・§3（ズレを止める仕組み） / 依存: T-M8-165 / サイズ: M
- 背景: 全mdファイル（約6,700行）を多角監査し、削除候補を1件ずつ反証にかけた。**大半は「事故の記録」
  として正当**だったが、**写して片方だけ古くなった箇所**が実害を出していた。
- 直したもの（実害が大きい順）:
  - **`AGENTS.md`（58→18行）**: 49行中44行が`CLAUDE.md`と一字一句同一。写した後に`CLAUDE.md`側だけ
    更新され続け、「DB17テーブル」（実際21）・存在しない`old/`・**Definition of Doneから
    「必須の検証をすべて実行した」の欠落**まで生じていた。**欠落は最悪で、これを読んだだけでは
    検証を飛ばして完了扱いにできた。** ポインタへ畳んだ。
  - **`.agents/skills/` 4本（134→48行）**: `.claude/skills/`の書き換え前の旧版が取り残されていた
    （古いdescription・`npm test`のままの検証手順。実測で46〜96行の差分）。ポインタへ畳んだ。
  - **`README.md`（45→33行）**: 「アプリ本体は未作成でM0から実装開始」＝M8進行中なのに**読み手を
    誤らせる**表記。スキル一覧も`/add-task`（入口）が欠落した劣化コピー。存在しない`old/`へのリンク。
    ステータスはBACKLOGへの参照にした（`check:doc-refs`は`docs/**`と`CLAUDE.md`しか見ないので、
    リポジトリ直下のREADMEのリンク切れは機械では出ない）。
  - **`プロンプト設計書`**: 「利用上限の統一ルール」5項目が**回数制のまま**（生成100回／画像20枚）で
    T-M8-108/109のAIクレジット制と食い違い。要件03 §7への参照へ。
  - **`要件02`**: §5 RLS表（20行）は各節末の写しで、後から足した3表が抜けていた。§6 seedの通知設定は
    `summary`が抜けていた。どちらも正本への参照へ。
  - **`要件06`**: T-M8-104で廃止済みのsupportタブの表示仕様。
  - **`ci.md`**: 「branch protectionが無いので本番デプロイをブロックしない」＝**前提が逆**（D-14で
    解決済み・実際に有効）。E2E「13ファイル」＝実測27で、同文書354行の「本数を他へ写さない」に反していた。
  - `PRD`（回数制の単価前提・§11の当時の進捗表明）／`deployment.md`（同一節での重複）／
    `requirements/README.md`（DB18→21）／`CLAUDE.md`（スキル地図との重複2行）。
- **消さないと判断したもの**（誤削除の害が大きい）:
  - `playwright-cli/SKILL.md`（420行）は**上流の`@playwright/cli`同梱ファイルと1バイトも同じ**
    （`diff`でexit 0）。編集すると上流更新で上書きされ差分が失われる。
  - `refactor`のDoDは`CLAUDE.md`と1項目しか重複せず、「外部挙動を変えていない」は**CLAUDE.md側に無い**。
  - `ui-polish`と`verify-e2e`のT-M7-22重複は、**2スキルが独立に起動されどちらか一方しか読まれない**ため両方必要。
  - 事故の記録（日付・タスクID付き）は規則が存在する理由そのもの。`CLAUDE.md`原則1〜5の番号は
    `src/`の20箇所以上のコメントが参照しているため変更不可。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト268 files／2349件成功。doc日付18件・参照241件。
  **230行削除／67行追加**（差し引き約163行減）。振る舞いは変えていない。

### T-M8-165: 見張り方を1か所へまとめ、doctorの検査項目をコードと機械同期する `done`
- 参照: 要件01 §2・§8／`docs/operations/monitoring.md` / 依存: T-M8-162/163/164 / サイズ: S
- 背景（2026-08-20 運営者の質問）: 「doctorは何を見ているのか」「Sentryでは何が分かるのか」が
  **docsのどこにも一覧されていなかった**（doctorへの言及は8ファイルに散在）。運営者が把握できない。
- 対応:
  - `docs/operations/monitoring.md` を新設し、**経路3つ（毎朝の運営者メール／doctor手動／Sentry）の
    役割分担**、doctorの検査項目一覧、Sentryに入るもの・入らないもの、環境ごとの届き方をまとめた。
    `docs/README.md` のマップへ登録。
  - **検査項目の表はコードと機械的に突き合わせる**（`src/lib/ops/doctor-doc-sync.test.ts`）。
    `collectDiagnostics` をスタブDBで走らせて実際の項目名を取り、**表に無い項目**と
    **表に残っているが出ない項目**の両方向を検出する。表を消して落ちることを確認済み。
    手で数え上げた一覧は必ず古くなる（ADR-0005が因果を正しく書きながら適用先を手で列挙し、
    本番の`/signup`が18日間動かなかったT-M8-87と同じ形を作らない）。
  - **Sentryの送信箇所は列挙しない**（増減するため写した一覧が古くなる）。方針だけを正本にした。
  - 委託先一覧のSentryの国を「米国」→「米国（データ保存先: EU・ドイツ）」へ修正。
    本番・stagingのDSNがいずれも`ingest.de.sentry.io`＝EUリージョンで、**法28条の情報提供は
    「移転先の国」を示すもの**なので法人の登記国だけでは足りない（要決定D-18は案A＝本人の同意で決着済み）。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト成功。doc日付／参照検査も緑。

### T-M8-164: doctorの結果を運営者へ「届ける」（自分で叩かないと分からない状態をやめる） `done`
- 参照: 要件04 §14（日次サマリ）／`src/lib/ops/diagnostics.ts`／`src/lib/ops/daily-summary.ts` / 依存: T-M8-163 / サイズ: M
- 背景（2026-08-20 運営者の質問で判明）: **判定は揃っているのに、運営者へ届いていない。**
  - `diagnostics.ts` の判定と文言（T-M8-163で「クレジット残高が不足しています」まで出せるようにした分を含む）は
    **`/api/cron/doctor` からしか使われず、それを叩くのは `npm run doctor` だけ**。
  - `vercel.json` の cron は `news-fetch`・`scheduler-tick`・`metrics-collector`・`follower-snapshot` の4本で、
    **`doctor` は定期実行されていない**。
  - 毎朝の日次サマリ（`daily-summary.ts`）は diagnostics から `judgeDatabaseSize` だけを使い、
    **providerの失敗分類・設定の異常（Sentry未設定・X_POSTING_MODE）は入っていない**。
  - つまり **2026-08-19 10:00 JST から1.5日間ニュースが全滅していたのに、運営者へ何も届かなかった**
    （運営者が自分で `doctor` を叩いて初めて分かった）。原則1「運営者が気付ける経路（通知・サマリ）へ載せる」に反する。
- 完了条件:
  - `doctor` の判定結果のうち **`error` と `warn` を運営者へ届ける**（毎朝の日次サマリへ同梱、または異常時のみ通知を作る）
  - **同じ異常を毎日送り続けない**（`dedupe_key` で1日1回に集約。読まれなくなるのを防ぐ・T-M7-44の教訓）
  - 通知本文に T-M8-163 の「直せる言葉」と次の一手を載せる（`http_400` を出さない）
  - **providerの応答本文は載せない**（要件01 §8）
  - 異常が無い日は送らない（正常を毎日送ると異常が埋もれる）
- 要決定: 届け先を (案A)毎朝の日次サマリに同梱（追加の定時実行が不要・最大24時間遅れる） /
  (案B)`doctor` を cron に足して異常時だけ通知（気付きは早いが定時トリガーが1本増える） のどちらにするか。
  **推奨は案A**（原則3「手順を増やさない」。1.5日気付かなかった今回も、翌朝に届いていれば十分早い）。
- 決定・実装（2026-08-20）: **案A相当**（新しい定時トリガーを作らず `scheduler_tick` に相乗り）。
  毎朝8時JST以降の最初のtickで `collectDiagnostics` を実行し、`error`/`warn` があった日だけ
  `SUPPORT_EMAIL` へ送る。重複は `cron_runs('operator_alert', 'operator-alert:{環境}:{日付}')` で止め、
  **異常なしで送らなかった日も窓は確保**（同日に何度も判定を走らせない）。
  文面は `operator-alert.ts`（純粋層・テスト6件）で作り、送信は `email/operator-mail-server.ts`。
  **日次サマリには混ぜていない**（あれは全利用者向けで、運用の内情を利用者へ届けてしまう）。
- 実装中に既存のガード2つに正しく止められた: (1) `cron.ts` が env 依存モジュールを module scope で
  importすると**テストの module 読込で env 検証が走って落ちる**（ファイル冒頭に同じ理由が書かれていた）→
  型だけを取り実体はrouteから注入する形へ直した。(2) `outbound-channels.test.ts` が
  **新しい外向きSMTP経路の未登録**を検出 → `smtp` チャネルへ登録した（ガードは `canSendViaSmtp` を共有）。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト267 files／2346件成功。
- メモ: **クレジット残高そのものの事前警告は作れない**（AI提供元が残高APIを公開していない）。
  切れる前に気付く唯一の手段は提供元側の自動チャージ・残高アラート設定で、これは運営者の作業。
  このタスクは「切れた後に確実に届く」ところまでを担う。

### T-M8-163: providerの失敗理由を`http_400`で終わらせず、運営者が直せる言葉で出す `done`
- 参照: 要件01 §8／`src/lib/ops/diagnostics.ts`／`src/lib/jobs/news-fetch.ts` / 依存: なし / サイズ: S
- 背景（2026-08-20 実際に踏んだ）: 本番の `doctor` が
  「取得に失敗したテーマ: ai（http_400）・investment（http_400）・sns（http_400）」と出し、
  次の一手は**「Claudeに「ニュース取得の失敗記録を見せて」と伝えてください」**だった。
  実際の原因は `news_fetch_outcomes.provider_raw_error` に入っていた
  **「Your credit balance is too low to access the Anthropic API」＝運営者のAnthropicクレジット切れ**。
  **`http_400` からは何も分からず、運営者が自力で辿れない**（原則2「ログを読ませない」に反する）。
  しかも原因は運営者が5分で直せるもの（クレジット購入）だった。
- 完了条件:
  - providerの応答から**運営者が直せる型**を分類して出す。少なくとも次を区別する:
    クレジット/残高不足・レート制限・キーが無効/期限切れ・モデル名が不正・その他
  - `doctor` の `nextAction` が型ごとに具体的な操作を出す（例: 「AnthropicのPlans & Billingでクレジットを購入してください」）
  - **応答本文そのものは画面・HTTP応答へ出さない**（要件01 §8。DBに残す方針は変えない）
  - 分類は純粋関数に置き、実際に記録された文言をfixtureにした単体テストで固定する
    （実物の文言を持たない分類器は空振りする）
- メモ: 同じ分類は生成・画像・投稿分析の失敗表示にも効く（`last_post_error` や job の失敗理由）。
  まずニュースの経路で入れて、他へ広げるかは別途判断する。
- 実装（2026-08-20）: `src/lib/ai/provider-failure.ts` に `classifyProviderFailure`（純粋関数）と
  `PROVIDER_FAILURE_GUIDE`（型→日本語の説明＋操作）を置き、7種へ分類する。
  **応答本文は分類にだけ使い、戻り値へ含めない。** `diagnostics.ts` は `provider_raw_error` を
  selectして**その場で型へ落とし生文字列を捨てる**（以前は「selectしない」ことで守っていたが、
  そのために原因を出せなかった）。漏れないことは `diagnostics.test.ts` が応答文字列を走査して固定。
  **全分野が同じ型のときだけ操作を断定**し、混ざっていれば記録を見る案内へ戻す——違う原因に同じ操作を
  勧めると案内自体が信用されなくなる。
- テストの作り: **本番に実際に記録された文言をfixtureにした**
  （`Your credit balance is too low to access the Anthropic API…` の全文）。作った文言で試す分類器は
  本物が来たときに当たらない。クレジット切れとレート制限の取り違え（どちらも429で来る）も固定した。
  単体10件＋diagnostics 5件を追加。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト266 files／2338件成功。

### T-M8-162: Sentryが実際にイベントを受け取っているかを運営者が確認できるようにする `done`
- 参照: 要件01 §2・§8（監視）／要決定D-19 / 依存: なし / サイズ: S
- 背景（2026-08-20 D-19の確認中に判明）: **記録先が沈黙していても誰も気付けない。**
  - 手元の `.env.local` は `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` が `__TODO_sentry_dsn__` のまま。
  - `initServerSentry`（`src/lib/observability/sentry.ts`）は不正・未設定のDSNを
    **no-op＋`console.warn` だけで黙って無効化**する（ローカル開発を止めないための設計で、それ自体は妥当）。
  - **`doctor` も `config-status.ts` もSentryを検査していない**（見ているのは APP_ENV / APP_BASE_URL /
    X_POSTING_MODE / STRIPE_SECRET_KEY / SMTP_USER の5つ）。
  - つまり**本番のDSNがプレースホルダのままでも、全画面が正常に見え全テストが緑になる**。
    T-M8-147 の `X_POSTING_MODE` が既定のままだった件と同じ型（原則1・原則2）。
- なぜ急ぐか: **T-M8-159 で「proxyのprofile取得失敗をSentryへ記録する」を入れたばかり**で、
  記録先が無ければあの変更は成立しない。同様に Stripe webhook・cron の例外も宛先なしになる。
- 完了条件:
  - `config-status.ts` が `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` の**種別**（未設定／プレースホルダ／有効な形式）を
    判定し、`doctor` に出す。**秘密値そのものは応答へ載せない**（既存方針どおり種別・有無だけ）
  - production で未設定またはプレースホルダなら**警告**として出す（ローカル・previewでは正常扱い）
  - あわせてSentryのデータリージョン（DSNのホスト）を種別として出す → D-19 と D-18 の判断材料になる
  - 判定は純粋関数に置き、単体テストで固定する（`config-status.test.ts` に追加）
- メモ: これが緑になってから D-19（保持期間をプライバシーポリシーへ書くか）を決める。
  順序を逆にすると「保持期間を書いたが実は何も送られていない」状態になる。
- 実装（2026-08-20）: `config-status.ts` に `classifySentryDsn`（**値ではなく種別とホストだけ**を返す純粋関数）と
  `sentryCheck` を追加し、`judgeConfig` の4項目目にした。判定条件は `initServerSentry` の `isUsableDsn` と揃えた
  ——ここが緩いと「doctorは緑なのにSentryは無効」という食い違いができる。`__TODO…` を `placeholder` として
  **未設定と区別**する（空でないので「設定済み」に見えてしまうため）。production で `usable` 以外なら `error` ＋
  直し方（どちらの環境変数か）を出し、production以外は `ok`（ローカルで常に赤いと読まれなくなる）。
  受け先ホストも出すのでデータリージョンの手がかりになる（D-18/D-19の判断材料）。
  既存の「3項目すべて正常」テストは**項目名で固定する形へ直した**（件数だけだと1本消えて別の1本が
  増えたときに気付けない）。単体10件追加。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト265 files／2323件成功。

### T-M8-156: アカウント.mdの履歴を1アカウント最大5件までに制限する `done`
- 参照: 要件02 §3.4（`base_md_versions`）／要件05 §「アカウント.md更新」・§304／要件06 §「アカウント.md」 / 依存: なし / サイズ: M
- 背景（2026-08-20 運営者の指示）: `base_md_versions` は**追記のみで削除経路が1つも無い**
  （`grep` で確認。`src/lib/base-md.ts:116,156`・`src/lib/persona-settings-store.ts:111`・
  `src/lib/jobs/md-merge.ts:270` が insert し、prune するコードは存在しない）。
  `content` はアカウント.md**全文**を毎版まるごと持つため、1アカウントあたり無制限に増える。
  しかも `md_merge` ジョブが**自動で**版を積むので、利用者が何もしなくても増え続ける。
  Supabase Free/Proのストレージ費用が読めなくなるため上限を掛ける（運営者原則4「費用が見える」）。
- 完了条件:
  - 1つの `x_account_id` につき `base_md_versions` は**最新5件だけ**を保持する
  - 版を積む3経路（`settings`／`learning`／`manual`／`rollback`）すべてで、**同一transaction内で**古い版を削除する
    （別ジョブに任せない。忘れたら効かない形にしない・運営者原則3）
  - 履歴画面に出る件数と、`rollback` で選べる版が保持分と一致する（消えた版を選べる導線を残さない）
  - **正常な空と失敗による空を混同しない**: 削除で履歴が減ったことと、初版未生成（`base_md_version = 0`）を
    画面で区別できる
  - 既存データの刈り込み migration を含む（適用前の件数と適用後の件数を出力する）
  - `/verify-integration`（migration・RLS・GRANT）と `*.db.test.ts` が通る
- メモ: `src/lib/base-md-history.ts` に `BASE_MD_HISTORY_LIMIT = 5` と `pruneBaseMdVersions` を置き、
  **版を積む4経路すべての同一transaction内**で呼ぶようにした（`settings`＝persona-settings-store、
  `learning`＝jobs/md-merge、`manual`／`rollback`＝base-md）。別ジョブに寄せると「忘れたら効かない手順」
  になるため（原則3）。既存データは migration `20260820000001_base_md_history_limit.sql` で刈り込み、
  **適用前後の件数を NOTICE で出す**（黙って行が消えないように・原則1）。ローカル適用は
  before=4 deleted=0 after=4。
  `listBaseMdVersions` は元々全件を version 降順で返すので、履歴画面と `rollback` の選択肢は
  保持分と自動的に一致する（選べない版への導線は出ない）。
- 決定: **6版以上前へは戻せなくなる**（上限値5は運営者の指示 2026-08-20）。要件02 §3.4 と
  要件05 に明記した。`rollbackBaseMd` に保持外の版を渡すと従来どおり `not_found`（`version_not_found`）。
- 検証メモ（2026-08-20）: 型検査・lint成功。実DB全テスト263 files／2298件成功。
  履歴上限のDBテストを追加（手動編集で8版まで積み、残るのが 8/7/6/5/4 の5件であること、
  `x_accounts.base_md_version` は刈り込みの影響を受けないこと）。migrationはローカルへ適用済み。

### T-M8-157: 下書きに日時を指定して投稿予約できるようにする `done`
- 参照: 要件02 §3.x（`drafts`）／要件04（定時トリガー・`scheduler-tick`）／要件05（下書きのServer Actions）／要件06 §投稿作成・スケジュール / 依存: なし / サイズ: L
- 背景（2026-08-20 運営者の指示）: 現在の予約は `schedule_slots`（曜日＋時刻の**繰り返し枠**）だけで、
  枠は「投稿を生成する」トリガーとして働く。**既にある下書きを、特定の日時に投稿する経路が無い**
  （`drafts` に `scheduled_at` 相当のカラムが無いことをDBで確認。`draft_status` enum も
  `draft | posting | posted | discarded | failed` で予約状態を持たない）。
- 完了条件:
  - 下書きに投稿日時（JST）を設定・変更・解除できる
  - 指定日時になったら投稿される（`scheduler-tick` が期限到来分を拾って publish へ流す。**新しい定時トリガーを増やさない**）
  - 予約済みの下書きが一覧で予約済みと分かり、予約日時が表示される
  - **過去日時・上限超過・未連携アカウントは押す前に理由が分かる**（押すまで分からない失敗にしない）
  - 予約が失敗したら理由が保存され、画面と通知に出る（黙って投稿されないままにしない・運営者原則1）
  - 日次投稿上限（要決定D-15）と予約分の関係を決めて実装する
  - migration＋RLS／GRANT、`*.db.test.ts`、E2E（予約→到来→投稿）が通る
- 決定（2026-08-20）: **`scheduled_at` の有無で表す**（`draft_status` に値を足さない）。enumへ足すと
  `status = 'draft'` で絞っている画面・集計・遷移すべてに波及し「予約済みだけ一覧から消える」類の退行を
  作りやすい。不変条件は**「`scheduled_at is not null` かつ `status = 'draft'` ⇒ 予約済み」**の1つだけ。
  要件02 §3.9 に明記した。
- メモ:
  - migration `20260820000002_draft_scheduled_at.sql`（列追加＋**部分index**。予約は例外的な操作なので
    予約していない大多数の下書きをindexへ載せない）。
  - 判定は純粋層 `src/lib/draft-schedule.ts`。過去・1分未満・90日超・投稿済み・連携解除を**日本語の理由付き**で
    弾き、**画面とServer Actionが同じ判定を通す**（押す前に理由が分かり、画面をすり抜けても投稿されない）。
  - 投稿は既存の `post_publish` job に委ねた（`enqueueDueScheduledDrafts` → `ensureAutoPostPublishJob`）。
    自動投稿同意・日次上限・阻害警告・`last_post_error` の記録はhandlerが持つため、判定を二重化しない。
    **冪等keyはdraft単位を共用**するので手動投稿・スロット連鎖と同時でも二重投稿しない。
  - `scheduler_tick` の (2') として due slot enqueue の直後に置いた。**新しい定時トリガーは増やしていない。**
  - 期限到来時に `scheduled_at` は消さない（投稿後は `status=posted` で対象条件から外れる。nullへ戻すと
    失敗時に予約の記録が消えて原因を辿れない）。activeでないアカウントの予約は `skippedInactive` として
    **0件とは別の値で数える**（原則1）。
  - UI: 一覧に「予約 <日時>」バッジ（開かずにいつ投稿されるか分かる）＋`ScheduleDraftControl`（予約・変更・解除）。
- 検証メモ（2026-08-20）: 型検査・lint成功。実DB全テスト265 files／2313件成功。build＋`check:csp-nonce`成功。
  単体9件（判定の全分岐と日本語理由）、DB統合4件（期限到来のみ拾う／二重に流さない／非activeを別に数える／
  投稿済み破棄済みは拾わない）、**E2E 1件を実ブラウザで通した**（過去日時で理由が出て押せない → 予約 →
  DB反映 → 一覧にバッジ → 解除 → DB反映）。
- 未対応: 日次投稿上限（要決定D-15）との関係は既存 `post_publish` handler の判定に委ねており、
  **予約分を上限計算に先取りして数えることはしていない**。上限に達していれば投稿時点で止まり理由が残る。
  「予約時点で上限超過を警告する」ところまでは実装していない → 必要なら別タスク。

### T-M8-155: 共通App Shellの密結合と画面間の逆依存を解消する `done`
- 参照: 要件01 §2／要件06 §2・§2.2／ADR-0006 / 依存: T-M8-154 / サイズ: M
- 完了条件:
  - App Shellの表示が通知・Xアカウント・profile・利用量の個別server adapterを直接参照しない
  - App ShellのClient ComponentがServer Actionを直接importせず、明示的なAction契約を受け取る
  - 画面横断のブランド部品と状態操作スタイルをApp Shellではなく共通層が所有する
  - 依存方向を固定するテスト、単体、型、lint、build、主要E2E、ドキュメント同期が通る
- メモ: `lib/app-shell/`を表示model・依存注入可能な組み立てcore・production server adapterへ分割し、
  `app/app/layout.tsx`から6つの個別データ取得依存とバナー組み立てを除いた。通知ベル・Xアカウント切替・
  ログアウトはServer Actionをpropsで受ける契約へ変更。LP／認証／Appで共用するロゴは
  `components/brand/`へ移し、課金UIがApp Shellの状態カードから借りていた操作classは既存の
  `components/ui/link-button.ts`へ集約した。依存境界テスト9件と組み立てcoreテスト4件を追加。
- 検証メモ（2026-08-20）: 型検査・lint・doc日付／参照検査・audit・build・CSP nonce検査は成功。
  実DBの全テストは262 files／2291件成功（skip 19件はいずれも実APIキー必須のlive検査で、
  `PROVIDER_CHECK` / `SUGGEST_LIVE` の env gate による意図的な未実行）。E2Eは最終形で
  **92件成功・1件skip（実AI）・0件失敗を連続2回**（7.5分／8.3分）。propsで注入したActionのうち
  通知既読・一括既読・メール再送・アカウント切替・ログアウトは既存E2Eが実ブラウザ＋DB確認で通る。
  唯一未カバーだった`listNotificationsAction`（通知ベルの「もっと見る」）は一時specで実ブラウザ検証し、
  25件投入して2ページ目が実際に追加されることを確認した（確認後に一時specは削除）。
- 検証の落とし穴（2026-08-20）: (1) `check:doc-refs`は`git ls-files`で実在を判定するため、
  **新規ファイルをstageするまで移動先のロゴを「実在しない」と報告する**（stage後は209件すべて成功）。
  (2) `src/**`を編集した直後の初回E2Eは、`page.goto("/app/ai-settings?tab=base-md")`が
  **devサーバのroute初回コンパイルで60s timeout**になり得る（`ai-settings.spec.ts:39`が3回連続で
  これに当たった）。同じ木で編集を挟まず再実行すると全件緑になる。**失敗を「flaky」と呼ぶ前に
  編集直後かどうかを見る**。(3) `npm run release:check ... | tail`はパイプで終了コードを捨てるため、
  **失敗したゲートが成功に見える**。出力はファイルへ落として終了コードを別に確認する。
- 追加修正（2026-08-20）: 依存境界テストに**検出器の生存確認**が無く、
  開発とテストの進め方 §「検出器が死んでいても緑になる」に反していた。`"use client"`判定が
  単一引用符・先頭コメント・先頭空行で外れ、import検出も`from"..."`（空白なし）・相対パス・動的import・
  サブディレクトリ移動を取りこぼす状態で、**Server Actionの直接importを戻しても5件緑のまま**だった
  （実ファイルを変形して再現確認）。検出器ごとの肯定側アンカー、走査対象ファイルの明示、再帰走査、
  先頭コメント許容の判定へ直し、coreの禁止依存に`@/lib/db/pool`・`next/headers`・`process.env`を追加した。

### T-M8-154: 全体の画面遷移で重複通信を削り、意図時先読みを追加する `done`
- 参照: 要件01 §5・§8／要件03 §1／要件06 §2 / 依存: T-M8-67 / サイズ: M
- 完了条件:
  - proxyが検証した利用者を同一リクエストのServer Componentで安全に再利用し、通常表示時の重複Auth・profile通信を削る
  - 主要ナビとURLタブは移動意図が出た行き先だけfull prefetchし、押下後の待機状態を即時表示する
  - 認証・主要ナビのローカル統合／E2E、production build、CSP検査、ドキュメント同期が通る
- メモ: proxyで`auth.getUser()`により検証した最小userをHMAC署名付き内部request headerへ載せ、後段の
  `getCurrentUser()`は署名検証後に再利用する。header欠落・改ざん時だけSupabase Authへfallbackし、正常な
  Server Component描画からAuthとprofileの直列2往復を削除した。profile欠損修復はsignup／login／plansへ限定。
  主要ナビ・URLタブはNext.js既定の部分prefetchを保ち、hover／focus／touch時だけfull prefetchへ昇格し、
  現在地は除外。ナビは`useLinkStatus`で行き先アイコンをスピナーへ切り替える。root `loading.tsx`はdev時の
  nonce付きchunkでconsole errorを確認したため採用せず、既存`/app`・`/plans`境界を維持。認証／ナビE2E 8件、
  単体2273件（環境条件skip 19件）、認証実DB統合2件、typecheck、lint、production build、CSP検査が成功。
  ローカル確認中に旧`post_pattern`列へ依存していたレビュー用seedも現行`post_patterns.id` FKへ追従し、実行成功を確認。

### T-M8-152: Stripe画面への全遷移で接続待ちを短縮する `done`
- 参照: 要件01 §8／要件03 §2／要件06 SC-04・SC-11 / 依存: なし / サイズ: S
- 完了条件:
  - CheckoutとCustomer Portalの全入口で、Session作成中にStripe画面originへの接続準備を並行する
  - 短寿命のStripe Sessionを押下前に作成・再利用せず、未使用Sessionを増やさない
  - CSPとブラウザ外部送信の開示を実通信に同期し、単体・統合・E2Eが通る
- メモ: `startBillingRedirect` がCheckout／Portalの固定originへ押下直後にReactの`preconnect`を出し、
  同一origin APIの認証・DB読込・Stripe Session作成とDNS／TCP／TLSを並行する。CSPの`connect-src`と
  プライバシーポリシーの外部送信一覧も同期した。Stripe公式どおりPortal Sessionはオンデマンド作成のまま。
  単体87件、Stripe route実DB統合14件、料金・課金E2E 5件、typecheck、lint、docs検査が成功。

### T-M8-153: 未確認ログインを6桁コード入力へ切り替えてコードを自動再送する `done`
- 参照: 要件05 §4.0／要件06 SC-03 / 依存: T-M8-151 / サイズ: S
- 完了条件:
  - 未確認アカウントでログインすると、黄色枠で「メール確認が終わっていません」と表示して6桁コード画面へ切り替わる
  - ログインで消費したTurnstile tokenを再利用せず、新しいtoken取得後に確認コードを自動再送する
  - Mailpitを使うローカルE2Eで、自動再送されたコードによる確認完了まで通る
- メモ: `email_not_confirmed`時はログインフォームを`EmailCodeForm`へ切り替え、黄色のNoticeで指定文言を表示する。
  再送用`interaction-only` widgetのtoken通知を受けて`requestSubmit()`を1回だけ行い、Action完了後は
  widgetをresetするため手動再送も常に新しいtokenを使う。E2Eは画面signupで未確認利用者を作り、
  ログイン→黄色案内→Mailpitの別メール受信→6桁確認→`/plans`まで実証。単体30件、認証実Supabase統合2件、
  認証E2E 5件、typecheck、lint、docs検査が成功。

### T-M8-151: 認証の待ち時間と6桁コード再送のTurnstile設定を直す `done`
- 参照: 要件05 §4.0／要件06 SC-02・SC-03 / 依存: T-M8-149 / サイズ: S
- 完了条件:
  - 通常ログインでprofileの存在確認upsertを毎回行わず、欠損時だけ修復する
  - 6桁コード画面の再送用Turnstileが公式対応optionを使い、画面の場所を取らずtokenを取得できる
  - 登録済みメールのエラー、新規登録→6桁確認、ログイン／ログアウトをローカルE2Eで確認する
- メモ: ログイン成功後のprofile処理を`upsert → select`から`maybeSingle → 欠損時だけupsert・再読込`へ変更し、
  正常系のDB往復を1回削減した。ウォーム状態の同一E2EトレースでログインPOSTは約0.86秒→約0.63秒
  （ローカル比較値）。profile読込／修復失敗時は作成済みsessionを破棄する。6桁コード再送はCloudflareで
  無効な`size=invisible`を廃止し、公式の`appearance=interaction-only`へ変更。単体2262件、認証DB統合2件、
  認証E2E 4件、typecheck、lintが成功（単体19件は環境条件によるskip、必須DB/E2Eのskipは0）。

### T-M8-150: 会員登録直後の `/plans?confirmed=1` が500になる `done`
- 参照: 要件05 §`/auth/confirm`・`verifySignUpCode`／要件06 SC-03 / 依存: なし / サイズ: S
- 完了条件:
  - 会員登録→6桁コード入力の直後に `/plans?confirmed=1` が正常に描画され、確認完了の案内が出る
  - 同じ経路をE2Eで再現し、落ちたら失敗するテストがある
- メモ: **2026-08-19 未解決。原因未特定のまま起票しない方針だが、再現条件が絞れていないので調査結果を残す。**
  運営者の報告（2026-08-19）: 登録直後に `https://exosai.net/plans?confirmed=1` へ遷移し
  「This page couldn't load」＝**Next.js既定の500画面**（`_global-error`。`prerender-nonce.ts` の例外一覧に記録あり）。
  調べた範囲: Vercelのランタイムログに当該時刻の500は残っていなかった（`/plans` は info で成功、
  同時刻に `/`・`/terms`・`/privacy`・`/legal/commercial-transactions` のprefetchが出ているので**一度は描画されている**）。
  未認証で `/plans?confirmed=1` を叩くと307（ログインへ）で再現しない。
  ローカルのE2E（`e2e/auth.spec.ts` の6桁コード経路）は同じ遷移を通っていて緑。
  経路上の分岐は精査済みで、`Notice tone="success"`・`subscriptionAccessFor`・`ensureUserProfile`（read-first）に
  落ちる要素は見つからなかった。**次の一手**: 再現するかを確認し、するなら Sentry の該当イベントか
  `vercel logs` を発生直後に取る（ログの保持が短く、後追いでは消えている）。
- 進捗（2026-08-20・T-M8-158/159 の作業中に判明した分）:
  1. **症状の正体が確定した。** 「This page couldn't load」は `_global-error`＝**error boundaryが無い**ときの
     Next.js既定画面。当時 `src/app/error.tsx` は**存在しなかった**ため、`/plans`・`/login`・`/signup` など
     **root直下のrouteで起きた例外はすべてこの画面**になっていた（`/app` 配下だけ `app/app/error.tsx` があった）。
     T-M8-158 で `src/app/error.tsx` を追加したので、**同じ例外は共通エラー画面＋再試行として出る**。
     これは症状の改善であって原因の修正ではない。
  2. この経路上に残っていた握り潰しを解消した。`ensureUserProfile` の存在確認が `const { data }` で
     `error` を捨てており、**読み取り障害が upsert 経路へ落ちて `initialProfileForUser` の
     「email が必要」例外に化ける**形だった（原因追跡を妨げる）。`readSingleRow` を通すようにした。
     `/plans` 最終読み取りと proxy の profile 取得も同様に修正済み（T-M8-158/159）。
  3. **E2Eは既に当該経路を通している。** `e2e/auth.spec.ts` が 会員登録→6桁コード→`/plans` 遷移→
     「メールアドレスの確認が完了しました」の可視まで確認しており、完了条件2つ目は既に満たされている。
- **2026-08-20 close（運営者確認）**: その後**再発していない**ため運営者判断でcloseした。症状の受け皿（`src/app/error.tsx`）と経路上の握り潰しは修正済みなので、**再発しても既定500画面ではなく共通エラー画面が出て、原因がSentryへ `AppError` として残る**。
- 当時 `todo` を維持した理由（記録として残す）: ローカル・E2E・型検査ではいずれも再現せず、
  **本番で実際に落ちた原因が特定できていない**。再現していない不具合を `done` にはしない。
  次に発生したら `src/app/error.tsx` が出る＋例外が Sentry へ AppError として届くので、
  そのイベントで原因を確定できる。**運営者への依頼**: 再発したら画面の文言（既定500画面か
  共通エラー画面か）を教えてほしい。共通エラー画面なら Sentry に原因が残っている。

### T-M8-149: 登録済みアドレスでも登録できたように見える経路を塞ぐ `done`
- 参照: 要件05 §4（`signUp`）／運用メモ §症状表 / 依存: なし / サイズ: S
- 完了条件:
  - 登録済みのアドレスで登録すると「既に登録されています」とログイン導線が出る（コード入力画面へ進まない）
  - 未確認アドレスの再登録は従来どおりコード入力へ進む（Supabaseが毎回再送する）
- メモ: **ホスト版のSupabaseは列挙対策で、登録済みでも成功と同じ形の応答を返しメールを送らない**
  （`identities` が空配列）。**ローカルのSupabaseは `user_already_exists` を返す**ため、
  T-M8-127 でエラーコードを見るようにしても**本番でだけ通り抜けていた**（来ないコードを待つ画面へ送り込む）。
  判定は `classifySignUpUser`（`identities` が空／`email_confirmed_at` が入っている）。
  文言は `SIGNUP_ALREADY_REGISTERED` に集約し、エラー経路と成功経路で同じものを使う。
  **列挙について**: 明示は運営者の指示（2026-08-18・T-M8-127）どおり。Turnstileと
  `rate_limit_anonymous_users`（5分30回）が自動列挙を抑える。

### T-M8-148: 決済を受け付けられない状態を、押す前に運営者へ見せる `done`
- 参照: 要件03 §6（Checkout/Portalのエラー契約）／運用メモ §症状表 / 依存: なし / サイズ: S
- 完了条件:
  - `npm run doctor`／`GET /api/cron/doctor` が「決済の受付（Stripeアカウント）」を出す
  - production で `charges_enabled=false` なら ❌ ＋ 次の一手（Stripeダッシュボード）が出る
  - 「待っても直らない失敗」に「時間をおいて再度お試しください」と言わない
- メモ: 2026-08-19、本番で「7日間無料で利用」が必ず失敗した。原因は**Stripeアカウントの本番有効化が
  未完了**（`Your account cannot currently make live charges.`／`card_payments = inactive`／
  `details_submitted = true` なので提出済みで有効化待ち）。**コードの不具合ではない。**
  問題は「気付ける経路が無かった」こと——鍵は本番・Priceの金額も一致・ポータルも有効なので、
  `doctor` も `release:check` も全部緑で、押した利用者だけが行き止まりになっていた。
  判定は `src/lib/ops/stripe-account-status.ts`（純粋関数・単体9件）、
  失敗の振り分けは `src/lib/stripe/stripe-errors.ts`（`isLiveChargesDisabled`・単体4件）。
  画面は固定文をやめ、サーバが返した文言（`USER_MESSAGES`）を出す。

### T-M8-147: 「設定が本番へ反映されていない」を状態確認で検出する `done`
- 参照: 要件04 §6（定時トリガー）／運用メモ §症状表／CLAUDE.md 原則1・2 / 依存: なし / サイズ: S
- 完了条件:
  - `npm run doctor`／`GET /api/cron/doctor` が「Xへの投稿」「アプリのURL設定」「決済（Stripe）の接続先」を出す
  - 本番が `dry_run` のままなら ❌ と次の一手（環境変数名）が出る
  - `APP_BASE_URL` が実際の配信元と違えば ❌ が出る（`localhost` と `127.0.0.1` は同一視）
  - 「メール確認が終わっていない登録」に**送信元と同じアドレス**が含まれるとき、届かない理由を名指しする
- メモ: **必須の環境変数は起動時検証（`env-schema.ts`）が落とすので気付けるが、既定値を持つ設定は
  欠けても起動する。** そのため画面は全部正常に見えたまま機能だけが止まる。`release:check`・全テスト・
  既存の `doctor` はいずれも env を見ていなかった。
  判定は `src/lib/ops/config-status.ts`（純粋関数・単体20件）。**秘密値は入力に取らない**——診断はHTTPで
  返るため、鍵そのものが応答へ混ざる経路を作らない（種別・有無だけを渡す）。
  あわせて2026-08-19に本番を横断点検し、**設定側の不一致は0件**だった（下の「本番設定の点検結果」）。

### T-M8-143: 自動投稿が下書きを作るだけで投稿されない（連鎖1本が未実装） `done`
- 参照: 要件04 §10 手順6/7（未実装注記あり）、要件02 §3.10 / 依存: なし / サイズ: M
- **これは機能の欠落**。2026-08-18の監査で発見し、要件04へ未実装注記を入れた（実装は未着手）。
- **症状**: `mode=auto` の予約枠は定刻に生成され下書きはできるが、**Xへ投稿されない**。
- **原因**: `post_publish` jobを作っているのは (1) 画面からの手動投稿（`generation-jobs.ts`・
  trigger=`manual`）と (2) **画像jobがstale/最終失敗したときの回収**（`terminal.ts`・trigger=`system`）
  の2箇所だけ。`post-generation.ts` も `image-generation.ts` も**成功時は `draft_created` 通知で終わっている**
  （`post-generation.ts` 冒頭に「auto時の post_publish 子job作成はM4で追加する」と書かれたまま残っている）。
- **足りないのは連鎖1本**。予約の作成・同意ゲート・enqueue・日次上限・`post_publish` handler 自体
  （警告での停止・部分失敗の自動削除・枠の記帳）はすべて実装済み。
- 完了条件:
  - 画像OFFのautoスロット: 生成成功時に `post_publish` 子jobが作られ、投稿される。
  - 画像ONのautoスロット: 画像確定後に `post_publish` が作られる（`terminal.ts` の失敗経路と二重にならない）。
  - draftモードの挙動は変わらない（通知のみ）。
  - 冪等: 同じdraftに対して `post_publish` が2件作られない（決定的 `request_key`）。
  - 異常系: 阻害警告があるときは投稿せず、理由が画面と通知に出る（`threadBlocksAutoPost`）。
- メモ: 連鎖は `src/lib/jobs/publish-chain.ts` の `ensureAutoPostPublishJob` に集約し、
  **terminal.ts の回収経路も同じ関数へ寄せた**（写しを消した）。
  **冪等keyは `job:{draft_id}:post_publish:auto`（draft単位）**が要点——
  本文生成の成功・画像生成の成功・画像失敗の回収の3経路が同じ下書きで投稿へ進もうとするため、
  経路ごとのkey（`parent:...`）にすると**同じ下書きが2回投稿されうる**。
  画像ONでは親が子jobのinputへ `mode` を引き継ぐ（子は親のinputを見られない）。
  auto では `draft_created` を出さない（投稿されるので「下書きができました」は誤った案内）。
  阻害警告と同意の確認は既存の `post_publish` 側に任せた（判定を2箇所に置かない）。
- **外向き副作用の確認（変更影響表）**: `X_POSTING_MODE` の既定は `dry_run` で、
  **`live` は `APP_ENV=production` 以外では env検証が拒否する**（`env-schema.ts:216`）。
  ローカルは `dry_run`。よって非productionで実投稿は起きない。
- 検証: 単体2,209件緑（新規10件）／**実DBで連鎖を確認**（post_publishが1件だけ・trigger=system・
  request_keyがdraft単位・draft_createdは0件）／`auto` 分岐を無効化すると落ちることを確認済み。

### T-M8-146: 画面の重複を共通部品へ寄せる（認証の外枠・h1・実行モード名） `done`
- 参照: 要件06 §1.0/§2/§3.5/§11、ADR-0006 / 依存: なし / サイズ: M
- **認証3画面の外枠**（ページ背景・カード・ロゴ＋アプリ名・h1・法務フッタ）が逐語で重複していた。
  T-M8-60 で見た目を揃えたが揃え方がコピーだったので、**片方だけ直すと再びトーンがずれる**
  （reset-passwordだけ旧デザインで残っていたのがT-M8-60の発端）。
  `components/auth/auth-page-shell.tsx` へ集約し、3画面 148行 → 96行。
- **App画面の`h1`のclass**が7箇所へ直書き。`cardTitleClassName` と同型の集約がh1だけ抜けていた。
  `pageTitleClassName` を追加。
- **予約の実行モード名**が5ファイルで別々に書かれ、`draft` が「下書きのみ」「下書き」「下書きまで」の
  3通り（文中を数えると4通り）。**同じ設定が画面ごとに違う名前で出ると同じものだと分からない**。
  `slotModeLabel` を正本にし、要件06 §3.5 の凡例が使う**「下書きのみ」**へ揃えた。
- 完了条件:
  - 認証3画面が同じ外枠を使い、法務導線が3画面すべてに出る。
  - App画面6つのh1の計算スタイルが同一。
  - 実行モード名が5箇所で `slotModeLabel` 由来。
  - 異常系: 1画面だけh1を直書きに戻すとE2Eが落ちる／横スクロールが出ない／focusが見える。
- メモ: **`/ui-polish` の実ブラウザ検証を実施**。1440・768・390 で認証4状態
  （login・signup・reset・forgot-password）を確認し、**コンソールエラー0件・横スクロール無し・
  法務導線あり**を実測。h1は6画面すべて `20px/700/rgba(0,0,0,0.9)` で一致。
  キーボードは9要素すべてfocusリングあり・タブ順も妥当。
  検査は `e2e/ui-consistency.spec.ts` として恒久化し、**h1を1画面だけ戻すと落ちる**ことを確認済み。
  あわせて会員登録の案内文を6桁コード方式へ直した（リンク追跡を促す旧文言が残っていた）。

### T-M8-145: 使われていない `asks_user_opinion` を全レイヤから撤去する `done`
- 参照: 要件02 §3.21、要件06 §4.2 / 依存: T-M8-132 / サイズ: S
- **経緯**: T-M8-132 で「自分の考え」の固定入力欄をやめ、**毎回入れる項目はパターンの
  `placeholders` が決める**形へ一般化した。その時点でこの列は**どこからも読まれなくなった**が、
  列・`pattern_spec_of()` の出力・seed関数・TSの型（`PatternOption`／`PatternSpec`）に残り続けていた。
  死んだ属性は「まだ意味がある」と読ませる——監査で実際に「これは何に使われているのか」を追う手間が出た。
- 完了条件:
  - 列が `post_patterns` から消え、`pattern_spec_of()` の出力にも含まれない。
  - `seed_default_post_patterns()` が列を指定しない（既定6件の投入と復元が動く）。
  - TSの型・SELECT列・toOption・parsePatternSpec から消える。
  - 要件02 §3.21 の行を削除する（`schema-doc-sync.db.test.ts` が突き合わせる）。
  - 異常系: 想定外の関数が参照していたら migration が例外で止まる（検算を先に置く）。
- メモ: migration `20260818000010`。**`pattern_spec` は生成時のsnapshot**なので、
  過去のjobのJSONに残っていても誰も読まない（`parsePatternSpec` から外した）。
  作業中に自分の正規表現が `includeNewsDigest` の行を誤って消したのを typecheck が捕まえた
  （型のある場所を機械的に削るときは1件ずつ確認する）。
  検証: 単体2,216件緑 ／ **`supabase db reset` でクリーン適用**（migration 10本）→ `test:db` 緑 ／
  関数の定義本文に参照が残らないことをDBで確認。

### T-M8-144: 2026-08-18監査のドキュメント乖離35件を解消する `done`
- **high の3件は解消済み（2026-08-18）**: 要件03 §8 の残量JSONをAIクレジット制へ／
  法務同意versionの具体値を docs から外し `src/lib/legal.ts` 参照へ（`-draft` 接尾辞も撤去）／
  deployment.md の認証メール手順を6桁コード方式へ（確認メールはコード・再設定はリンクと**方式が違う**
  ことを明記）。**残り32件（medium 21・low 11）が未着手。**
- 参照: [監査記録 2026-08-18](AUDIT_2026-08-18.md)（未着手一覧の doc_drift 行） / 依存: なし / サイズ: L
- **内容**: 確定した乖離35件（high 3・medium 21・low 11）。**docsのみの修正で振る舞いは変えない。**
  各項に根拠と直し方が書かれているので、領域単位（認証・課金／jobs／画面／運営コマンド／投稿パターン）で
  分けて着手する。high の3件は次のとおり。
  - 要件03 §8 の残量JSONが回数制のまま（実装はAIクレジット制）。同じ文書の §7.1 と矛盾
  - 要件03 §1 の法務同意versionが `2026-07-22-draft`（実装は `2026-08-08`・draft接尾辞は廃止）
  - deployment.md の認証メール手動手順がリンク＋token_hash前提（実装は6桁コード）
- 完了条件:
  - 35件それぞれについて「更新した」または「実装を直した」を記録する（黙って閉じない）。
  - `npm run check:doc-dates` / `check:doc-refs` が緑。
  - 実装が正しくdocsが誤っている場合はdocsを直し、逆なら別タスクへ切る（振る舞い変更はここでやらない）。
- メモ: **L のまま置かず、着手時に領域単位へ割る**。1コミットで35件は検証できない。
- 2026-08-20 の棚卸し: **35件すべてについて現在の状態を実ファイルで確認した**（監査は2026-08-18時点で、
  以後 T-M8-144〜159 の作業で自然に解消したものが多い）。**黙って閉じないため1件ずつ記録する。**
  - **今回直した（10件）**: #18 PRDの原価試算・リスク表を3枠へ／#23 `generation_jobs.input`の例を実キー
    （`pattern_id`・`theme`・`placeholder_values`・`prompt_override`）へ／#24 deployment.mdの`release:check`
    構成にdoc検査2本を追加／#27 要件01 §4の認証メールを種類別（登録=6桁コード／再設定=リンク）へ／
    #31 要件06 §4.2の「p2のみ 自分の考え」を`placeholders`由来の毎回入力欄へ／#33 要件06 §1.1の
    「3枚のカード横並び＋ご登録の流れ4ステップ」を比較表＋「お申し込み前の確認」へ／#47 要件05 §2.2の
    失敗例messageを実装の文言（「今月の利用上限に達しています。」）へ／#49 `landing-page.test.ts`の
    テスト名「5箇所」を4箇所へ／#54 自作パターンの`max_posts_edit`既定を`min(8, max_posts+2)`へ
    （`PATTERN_MAX_POSTS_LIMIT`＝8）／#56 要件06 §2の「ナビ7項目」を6項目へ
  - **既に解消していた（16件・確認のみ）**: #15（§2.2は現在intent有無で正しく書かれている）／#16
    （「契約状態を先に判定」の記述は既に無い）／#17（deployment.mdに`type=signup`は残っていない）／
    #19（要件04に回数制の記述なし）／#20（`{{hours}}`は14時間/3時間でコードの`newsLookbackHours`と一致）／
    #25／#26／#28／#29（`SMTP_*`は表にある）／#30（該当コメントは撤去済み）／#32／#34／#35（変更履歴の
    表ヘッダは復活し履歴も最新）／#48／#50（launchdメモは10〜20時の2時間おき）／#52（ci.mdから本数記述が消え、
    開発とテストの進め方は2026-08-20に実測へ更新）／#55（§3.10は`pattern_id`。残る`kind in ('p1'…)`は
    `prompt_templates`の実際のCHECKで、同節が「行は作られない」と説明済み）／#57（signup画面の文言は修正済み）
  - **docsではなく実装側の課題として切り出す（残り）**: #21 news取得結果の分類が`news-outcome.ts`へ
    完全には集約されておらずcron応答の判定が別（`news-fetch.ts:188`は「同じ考え方で揃える」と書くだけ）／
    #22 workerがlease時にcanceledにした期限切れ予約は`schedule_missed`が作られない（`schedule-recovery`
    経路のみが通知を作る）／#51 doctorの検査項目一覧と層8の説明の細部／#53 要件05 §8の
    `validation_error`理由一覧と画面側の死んだ分岐。**いずれも「docsを直す」では閉じない**（振る舞い変更か
    コード整理が必要）ため、T-M8-144 の完了条件どおり別タスクへ切る → T-M8-160。
- 検証メモ（2026-08-20）: `check:doc-dates` / `check:doc-refs` 緑（参照219件すべて実在）。
  実DB全テスト・型検査・lint成功。**振る舞いは変えていない**（変更はdocsと`landing-page.test.ts`のテスト名のみ）。

### T-M8-160: 監査#21/#22/#51/#53 を実装側で解消する `done`
- 参照: [監査記録 2026-08-18](AUDIT_2026-08-18.md) #21・#22・#51・#53 / 依存: T-M8-144 / サイズ: M
- 背景: T-M8-144（docs乖離35件）の棚卸しで、**docsを直すだけでは閉じない4件**が残った。
  いずれも「正本の記述と実装が違い、実装側を直すべき」もの。
- 完了条件:
  - #21 news取得結果の分類を`news-outcome.ts`の1箇所へ集約し、cron応答も同じ判定を使う
  - #22 workerがlease時にcanceledにした期限切れ予約でも`schedule_missed`が作られる（黙って投稿されない状態を作らない・原則1）
  - #51 doctorの検査項目一覧を実装と機械的に突き合わせる（手書き列挙をやめる）
  - #53 要件05 §8の`validation_error`理由一覧を実装と一致させ、画面側の到達しない分岐を消す
- メモ: #22 は**利用者に見える不具合**（予約が消えたのに通知が出ない）なので先に着手した。
- 結果（2026-08-20）:
  - **#22 直した（実装）**: `worker.ts` の lease 経路が期限切れ予約を canceled にするとき、
    **自分で `schedule_missed` 通知も作る**ようにした（`insertMissedNotification` を export）。
    以前は「通知は scheduler_tick が担う」とコメントして cancel だけ行っていたが、tick の
    `cancelExpiredJobs` は `status='queued'` しか拾わず、`notifyUnenqueuedMissed` は当該
    `schedule_run_key` の job が在る窓を除外するため、**この経路で見送られた予約はどちらからも
    永久に外れて利用者へ何も届かなかった**。通知は `dedupe_key`（`slot:{id}:{date}:{hh:mm}:missed`）で
    slot定刻ごと1件に集約されるので tick と重なっても二重にならない。
    `worker.db.test.ts` にテストを追加し、**通知作成を無効化すると落ちることを実際に確認した**
    （検出器が空振りしていないことの確認）。
  - **#21 対応不要（既に集約済み）**: `src/lib/news-outcome.ts` は `news-fetch.ts`・`news-research.ts`・
    `ops/daily-summary.ts`・`ops/diagnostics.ts`・`smoke/scenarios.ts` から使われており、
    `classifyNewsOutcome` は daily-summary と diagnostics の両方が呼んでいる。監査時点の
    「1箇所に集約されていない」は解消済み。
  - **#51 直した（docs）**: 層8の説明に `stripe-account-status.ts`（本番決済を受け付けられるか・T-M8-148）と
    `config-status.ts`（デプロイ先が実際に使っている設定値・T-M8-147）が抜けていたので追記した。
  - **#53 対応不要（一致していた）**: 要件05 §8 の `validation_error` 理由13件を実装と1件ずつ照合し、
    すべて実際に投げられていることを確認した（`empty`／`too_long`／`last_pattern` も
    `post-patterns-store.ts` が投げる）。`prompt_template_changed` は `job_conflict` なので
    この一覧に無いのが正しい。**画面側の死んだ分岐も見つからなかった**（`pattern-fields.tsx` の
    各 case は対応する reason が実在する）。
- 検証メモ（2026-08-20）: 型検査・lint・実DB全テスト成功。docs検査緑。

### T-M8-142: ナビラベルと画面h1の一致を実際に検査する `done`
- 参照: 要件06 §1.2/§2 / 依存: なし / サイズ: S
- **見つけ方**: 多角監査で「空振りしている機械検査」として確定。**実際に食い違っていた。**
- **問題**: 要件06 §2 は「ナビのラベルはその画面のh1と一致させる（パンくずも同じ定義から作るため、
  ずれるとナビ・パンくず・本文で違う名前が出る）」と定めているが、
  `navigation-items.test.ts` は**ラベルの一覧を書き写すだけで h1 を1文字も読んでいなかった**。
  その結果 `/app/news` がナビ「最新ニュース」／h1「ニュース」で**食い違ったまま緑**だった。
- 完了条件:
  - 各routeの `page.tsx` から h1 を読み、ナビラベルと一致することを検査する。
  - `/app/news` の食い違いを解消する。
  - 異常系: h1 が見つからない／走査0件でも落ちる（検査の空振りを見逃さない）。
- メモ: 名前は**「最新ニュース」へ揃えた**——docs内で12箇所が「最新ニュース」を使っており
  （§2のナビ項目一覧を含む）、SC-06の表だけが「ニュース」だったため、表側を直した。
  走査の基点は `import.meta.url`（§11の規約）。**h1を元の不一致へ戻すと落ちる**ことを確認済み。

### T-M8-141: 請求額と表示額のズレを検出する（Stripeとの突き合わせ） `done`
- 参照: 要件03 §2、要件01 §3.6 / 依存: なし / サイズ: M
- **見つけ方**: 多角監査で「空振りしている機械検査」として確定。
- **問題**: `plans.ts` は「Stripe Price の金額と必ず一致させる（`constants.test.ts` が突き合わせる）」と
  書いていたが、**そのテストは定数とリテラルを比べるだけでStripeを見ていない**。
  つまり**請求額と表示額のズレを誰も検出していなかった**（CLAUDE.md 原則4「費用が見える」違反）。
  ズレると「画面は1,000円と言うのに2,000円請求される」という、利用者の申告でしか気付けない事故になる。
- 完了条件:
  - `npm run doctor` がStripeの実Price金額と `monthlyPriceJpy` を突き合わせ、違えば error。
  - 通貨違い（jpy以外）と無効な価格（`active=false`）も error にする。
  - 異常系: 鍵やPrice IDが無い／Stripeへ届かない場合は warn（赤の常態化を避ける）。
  - 誤解を招くコメント（「constants.test.ts が突き合わせる」）を実態へ直す。
- メモ: `src/lib/ops/price-status.ts`。既存の `portal-status.ts` と同じ注入パターンで、
  読み取りのみ・費用なし。**ローカルで実際に走らせて一致を確認済み**
  （通常 ¥500 / md ¥1000 / プレミアム ¥2980）。単体6件で4つの失敗形（金額違い・通貨違い・
  無効な価格・届かない）を固定した。

### T-M8-140: 画像プロンプト画面の「再読み込み」で投稿パターンが壊れる不具合を直す `done`
- 参照: 要件05 §8、ADR-0008 / 依存: T-M8-129 / サイズ: M
- **見つけ方**: 多角監査（92エージェント）で確定。**利用者のデータが壊れる**型。
- **再現**: 設定＞プロンプト＞画像プロンプトで「再読み込み」を押す。
  一覧の先頭が `p1` になるため画面が「ニュース解説」の編集画面へ変わり、
  **そのまま保存すると投稿パターン（p1）のプロンプトを画像プロンプトの本文で上書きする**。
- **原因**: ADR-0008・要件05 §8 は「`prompt_templates` は画像専用。型プロンプトは扱わない」と
  書いていたが、**実装は `PROMPT_TEMPLATE_KINDS`（p1〜p6＋image）を走査し続けていた**。
  記述だけが移行済みで、コードが追いついていなかった。
- 完了条件:
  - `listPromptTemplates` が `image` だけを返す（`post_patterns` を引かない）。
  - 型プロンプトがこの経路へ来たら `validation_error` で落ちる（Actionの`kind`も`image`のみ）。
  - 画像プロンプト画面で「再読み込み」しても見出し・本文が変わらず、`post_patterns` が汚れない。
  - 異常系: 画面の `selectedKind` も `image` 固定にして二重に防ぐ。
- メモ: 既存の単体・DBテスト5件は**壊れた挙動（p1をこの経路で読み書きできること）を固定していた**ため、
  正しい契約（image専用）へ書き換えた。「post_patterns を引かない」ことを見るテストも足した。
  副産物として `quotePostEnabled` の受け渡しと `visible` memo が不要になり撤去（p5の出し分けが不要になった）。
  検証: 単体2,191件緑 ／ **E2Eで実ブラウザ確認**（再読み込み後も見出しは「画像プロンプト」・
  本文不変・`p1.prompt` が null のまま）。

### T-M8-139: 既定パターンを保存しただけで分量が8へ跳ね上がる不具合を直す `done`
- 参照: 要件02 §3.21、要件06 §3.8/§4.3 / 依存: T-M8-132 / サイズ: S
- **見つけ方**: 2026-08-13以降の未監査分に対する多角監査（6領域・92エージェント）で確定した
  76件のうち最も重いもの。**利用者の設定が黙って書き換わる**型。
- **再現**: 設定＞プロンプト＞パターン管理で既定パターンを**何も変えずに「保存」**を押す。
  `max_posts` が seed 値（ニュース解説=4・自分の考え=1・週次まとめ=5）から **8** へ跳ね上がり、
  `max_posts_edit` も `greatest` で8へ広がる。以後その型は毎回8ポストまで作られる。
- **原因**: 保存時に `maxPostsFromPrompt`（読めなければ全体上限8）の結果をそのまま書いていた。
  ところが**既定プロンプト（PT_P1〜P6）は「1ポスト目=…」という語彙で `Nスレッド目` を含まない**ため、
  既定パターンでは必ず読み取り不能になる。三項 `input.prompt ?? (isSystemDefault ? "" : "")` も
  両分岐が同じ空文字で無意味だった。
- 完了条件:
  - 既定パターンを無変更で保存しても `max_posts` / `max_posts_edit` が変わらない。
  - 既定パターンでプロンプトを既定へ戻したら、その型の既定値（`GENERATION_MAX_POSTS`）へ戻る。
  - 自作パターンで読み取れない本文に変えても今の値を保つ。
  - 異常系: 新規作成は保つべき現在値が無いので全体上限（8）のまま。
- メモ: `resolveMaxPosts()` に3段の優先順位（プロンプトから読む → 既定へ戻したら既定値 → 今の値を保つ）を
  集約した。**本番から参照されていなかった `GENERATION_MAX_POSTS`（要件06 §4.3 の既定表）を正本として使う**
  ので、死んだ定数も1本生きた。**3分岐すべて「戻すと落ちる」ことを確認済み**（8→5→4と段階的に詰めた）。
  検証: 単体2,190件緑（新規2件＋既存1件を強化）／`npm run test:db`。

### T-M8-138: 「パターンを追加」の色を揃え、コード入力画面からCloudflareを消す `done`
- 参照: 要件06 §1.0/§3.1、要件03 §1 / 依存: T-M8-135 / サイズ: S
- **運営者の指示（2026-08-18）**: ①スケジュール画面の「パターンを追加」の色が投稿作成画面と違う
  ②新規登録の6桁コード入力時のCloudflareは不要。
- **①**: 投稿作成は `variant="subtle"`、スケジュールは `ghost` だった。`subtle` へ揃え、
  `disabled={pending}` も合わせた。実ブラウザで計算値が一致することを確認
  （背景 `rgb(244,232,243)` / 文字 `rgb(125,31,117)` / 高さ36px が両画面で同一）。
- **②**: ウィジェットが出ていたのは**「コードを再送」**の側だった（コード検証自体は
  以前から人間確認を求めていない）。**ただし外すのではなく不可視にした**——
  Supabaseの `resend` はプロジェクトでcaptchaを有効にしているとトークン無しを拒否するため、
  消すと再送が黙って壊れる。`size: "invisible"` にすると通常は何も見えず、
  疑わしいときだけCloudflareが割り込む。
- 完了条件:
  - 両画面の「パターンを追加」の計算スタイルが一致する。
  - コード入力画面にCloudflareの表示枠が出ない。
  - 再送用のトークンは（不可視でも）入る＝再送が動く。
- メモ: E2Eの判定は**確保された表示枠（`min-h-16`）**で見る。ローカルはTurnstileのテストキーで
  Cloudflareのiframeを描かないため、iframeの有無では可視/不可視を見分けられない（実測どちらも0件）。
  `invisible` を外すと落ちることを確認済み。
  **残る論点**: 再送の乱用対策はSupabaseの `rate_limit_email_sent`（30通/時）だが、
  これは**プロジェクト全体の上限**なので、悪用されると正規の登録まで止まる。
  不可視captchaが残っているので現状は緩和されている。

### T-M8-137: docsの更新日の置き去りを直し、忘れたら止まる形にする `done`
- 参照: docs/README.md（運用ルール）、docs/operations/development-and-testing.md §11 / 依存: なし / サイズ: S
- **見つけ方**: 全docsの冒頭「更新日」と、その文書を最後に変えたコミットの日付を突き合わせたところ、
  **9本で更新日が置き去り**になっていた（PRD／プロンプト設計書／要件01／deployment／release-checklist／
  local-development／database-backup-restore／launchd-to-vercel-cron／lp-design-brief）。
  いずれも T-M8-129・T-M8-133・T-M8-88 と doc-sync の各コミットで内容だけ変えて日付を忘れたもの。
- **なぜ起きたか**: 「docs/ は常に実装の現状と一致する」はこのリポジトリの最重要ルールだが、
  **更新日を直す手順だけが人の記憶に預けられていた**（CLAUDE.md 原則3違反）。
  日付がずれていると読む側は「この記述はいつの実装のものか」を判断できず、正本としての価値が落ちる。
- 完了条件:
  - 9本の更新日が、最後に内容が変わったコミットの日付に一致する。
  - `npm run check:doc-dates` が置き去りを検出して落ちる（`release:check` に含む）。
  - 更新日の行だけを変えたコミットは内容の変更として数えない（日付を直すコミット自身が落ちない）。
  - 異常系: 検査対象が0件のときも落ちる（書式変更で検出器が空振りしたのを見逃さない）。
- **あわせて参照先の実在も検査した**（`npm run check:doc-refs`）。**`src/lib/post/post-patterns.ts` が
  T-M8-129 で消えたあとも、要件06 §1.0 と ADR-0006 が「これを単一の正とする」と案内し続けていた**。
  要件06 は実装の現状（`post_patterns` テーブルが正・表示は `post-patterns-store.ts`・
  バッジは `drafts.pattern_name`）へ直し、ADR-0006 は判断本文を残したまま生きた参照だけを現在のファイルへ向けた。
  除外リストは置かない（リスト自身が腐って検査を空振りさせるため）。旧名を書き残すときは地の文にする。
- メモ: `scripts/check-doc-dates.mjs`。更新日を持たない文書（README・ADR）は別書式なので対象外。
  git の `core.quotepath=false` を必ず付ける（付けないと `docs/プロンプト設計書.md` が
  8進エスケープで返りファイルを開けない。実際に踏んだ）。
  **3通りの壊し方で落ちることを確認済み**: ①日付を古くする ②検出器の文字列を壊す（0件→落ちる）
  ③（②により）checked===0 のガードも作動。

### T-M8-136: 新規登録メールが届くか・誰から届くかを1コマンドで分かるようにする `done`
- 参照: 要件01 §3.6/§8、docs/operations/deployment.md §2-5 / 依存: なし / サイズ: M
- **運営者の質問・報告（2026-08-18）**: ①ローカルで新規登録メールが届かない ②「Exos AI」から届くか ③迷惑メールに入りにくいか。
- **①の答え: 壊れていない。** ローカルのSupabaseは確認メールを**Mailpit**（`http://127.0.0.1:54324`）が
  全部受け取り、実際のメールボックスへは送らない。実測で44通・件名「Exos AIのメールアドレス確認」・
  本文に6桁コードが入っていることを確認した。**知らないと「壊れている」と見える**ので、
  `npm run doctor` がローカルでは必ず行き先と件数を出すようにした（原則2）。
- **②の答え: なっていなかった。** (a) 通知メールは `EMAIL_FROM` の素のアドレス（個人のGmail）が
  そのまま差出人になっていた → コード側で「Exos AI <アドレス>」を付ける（envの書式に委ねない・原則3）。
  (b) 認証メールの差出人名は `auth:templates` が**SMTP未設定のときだけ**設定していたため、
  一度別の名前で設定された環境は永久に直らなかった → 毎回そろえる。
  さらに `doctor` が**差出人名**と**カスタムSMTPの有無**を検査するようにした
  （内蔵送信のままだと2通/時・組織メンバー宛のみで、**画面は「送信しました」と出るのに
  利用者には永久に届かない**。自分のアドレスで試すと成功するので見逃す型）。
- **③の答え: 部分的。** 1クリック購読解除（RFC 8058 `List-Unsubscribe` /
  `List-Unsubscribe-Post`）と自動送信の明示（RFC 3834 `Auto-Submitted`）を通知メールへ追加した。
  2024年以降 Gmail/Yahoo がこれを要求するため、無いと迷惑メール判定が厳しくなる。
  **残る根本要因は独自ドメインが無いこと**（個人Gmailが差出人／送信上限約500通日）→ **要決定D-27**。
- 完了条件:
  - `npm run doctor` がローカルで確認メールの行き先（Mailpit）と件数を出す。
  - `npm run doctor` がデプロイ先でカスタムSMTP未設定と差出人名の不一致を error にする。
  - `npm run auth:templates -- --target <環境>` が差出人名の差分を報告し、`--apply` で直す。
  - 通知メールの差出人が「Exos AI <…>」になり、購読解除ヘッダが付く。
  - 異常系: Mailpitに繋がらないときは error（6桁コードを読む手段が無いため）／URL不明時は購読解除ヘッダを付けない。
- メモ: 差出人名の正本は `EXPECTED_SENDER_NAME`（`src/lib/ops/auth-url-status.ts`）1箇所。
  doctorの検査と反映コマンドが同じ値を使う。**本番/stgの実設定は権限ゲートで読めなかった**ので、
  運営者が `npm run doctor` と `npm run auth:templates -- --target production` を実行して確認する必要がある。
  検証: 単体2,185件緑（新規11件）／ローカルMailpitの実データで往復確認／`npm run doctor` 実行。

### T-M8-135: 予約にも投稿作成と同じ生成入力・パターン追加・プロンプト編集を入れる `done`
- 参照: 要件02 §3.10、要件04 §7.1、要件05 §7、要件06 §3.5 / 依存: T-M8-134 / サイズ: L
- **運営者の指示（2026-08-18）**: スケジュールにも投稿作成と同様のパターン追加・
  生成プロンプトの確認・編集を入れ、並び順をテーマ→パターン→パターンを追加→
  生成に使うプロンプト→参考URL→プレースホルダー→追加指示→曜日→時刻→モードにする。
- 完了条件:
  - 予約フォームが指定の並び順で表示される。
  - 予約画面でパターンを追加でき、追加直後に選択される。
  - 生成プロンプトを確認・編集でき、「この予約にだけ使う」「パターンに保存して他でも使う」を選べる。
  - 参考URL・プレースホルダーの値を枠に保存でき、実行時に生成へ渡る。
  - 異常系: standardにはプロンプト欄を出さない／参考URLはhttpsのみ／最後の1件の削除は出さない。
- メモ: migration `20260818000009`（`source_url`・`placeholder_values`・`prompt_override`）。
  **多角レビュー（4観点＋敵対的検証・29エージェント）で自分の欠陥を4件見つけて直した**:
  ①Server Actionのキー名を `content` ではなく `prompt` で送っており「パターンに保存」が必ず失敗していた
  （Actionの引数が `unknown` なので型検査を通り、E2Eも「この予約にだけ」しか通していなかった）
  ②追加直後のパターンへ保存すると楽観ロックで必ず衝突（自作パターンは `prompt` が非nullなのに
  `expectedUpdatedAt=null` を送っていた。**投稿作成画面にも同じ潜在不具合があり両方直した**）
  ③参考URLが `http://` を通り、投稿作成（httpsのみ）と食い違っていた
  ④`prompt_override` にプラン境界が無く、standardへ下がると画面から消えるのに生成では効き続けた。
  ②は `applyCreatePattern` が `promptUpdatedAt` を返す形にして解決（`toIso` で
  ミリ秒へそろえる——`::text` のマイクロ秒だと `date_trunc('milliseconds', …)` と一致しない）。
  検証: 単体2,185件緑 ／ `npm run test:db` ／ **E2E 6件（新規）** ／
  実ブラウザで並び順を実測（1440・390）。各修正は「戻すと落ちる」ことを確認済み。

### T-M8-134: 削除をパターンのカード内へ移し、暗幕の抜けと再同意の行き止まりを直す `done`
- 参照: 要件06 §1.0/§2/§3.8、要件02 §3.21 / 依存: T-M8-133 / サイズ: M
- **運営者の指摘（2026-08-18）**: ①削除ボタンを各ボタン内に置けるか ②削除の確認画面で
  全体は暗くなるのに**ヘッダーだけ明るいまま** ③**スケジュール保存が
  「スケジュールを保存できませんでした 利用規約等の更新内容をご確認ください。」で必ず失敗する**。
- **③の原因**: 不具合ではなく**正しい判定**だった。`CURRENT_TERMS_VERSION`（2026-08-08）に対し
  運営者のprofileが `2026-07-22-draft` のままで再同意が必要な状態。ところが
  **同意画面 `/app/consent` への導線がコード上どこにも無く**（`rg` でも定数定義しか出ない）、
  生成・投稿・スケジュール保存が全部止まったまま利用者に打つ手が無かった。
  規約の版を上げるたびに全利用者がこの行き止まりに入る（CLAUDE.md 原則2違反）。
- **②の原因**: このダイアログの暗幕だけ `z-index` が無かった（他5箇所は `z-50 bg-black/55`）。
  ヘッダーが `sticky z-20` なので暗幕が下に回る。**要素の存在検査では通ってしまう**種類で、
  ブラウザで重なりを実測しないと出ない。
- 完了条件:
  - 投稿作成画面で各パターンのカード内に削除（ゴミ箱）があり、押しても選択が動かない。
  - スケジュール画面にはカード内削除を出さない（編集中の予約の足元が崩れるため）。
  - 確認ダイアログの暗幕がヘッダー・サイドバーまで覆う。
  - 再同意が必要なとき常設バナーが出て `/app/consent` へ行け、同意すると消える。
  - 実行系の失敗メッセージが行き先（画面上部の案内）を伝える。
  - 異常系: 最後の1件は削除ボタン自体を出さない／同意済みならバナーを出さない。
- メモ: 同意直後にバナーが残る**別の不具合も見つけて直した**——レイアウトがキャッシュから返るため
  `revalidatePath("/app", "layout")` が要る（E2Eで redirect直後=1件・再読込後=0件 を実測して特定）。
  暗幕の検査は `elementFromPoint` で最前面の要素を拾う形にした。`z-50` を外すと落ちることを確認済み。
  検証: 単体2,168件緑 ／ `release:check`（typecheck・lint・audit・test:db・build・csp-nonce）／
  **E2E 81件緑** ／ 実ブラウザで1440・768・390を確認し、**暗幕の効きをピクセルで実測**
  （ヘッダー 255→115・サイドバー 255→115・本文 246→111）。
  AI providerもDBスキーマも触っていないため `smoke:live` と migration は不要。

### T-M8-133: 「自分の考え」の入力手段を復旧し、呼び名と削除導線を揃える `done`
- 参照: 要件02 §3.21、要件06 §1.0/§3.8、プロンプト設計書 §4.1/§6.3 / 依存: T-M8-132 / サイズ: S
- **運営者の指摘・指示（2026-08-18）**: 追加指示はAIへ反映されているか／「名前」ではなく
  「プレースホルダー名」にする／投稿作成画面でもパターンを削除できるようにする。
- **調べて分かったこと**: 追加指示は `<input>` の `追加指示: …` 行として渡っており、
  **実APIで指示どおりに従うことを確認した**（冒頭に「検証:」を付ける指示が守られた）。
  一方で **T-M8-132 の私の不具合を発見**——「自分の考え」の固定入力欄をやめたのに
  既定パターン側へプレースホルダーを入れ忘れ、**意見を入力する手段が失われていた**
  （プロンプトは「本人の考えを述べる」と言うのに利用者が渡せない）。
- 完了条件:
  - 既定の「自分の考え・意見」に `自分の考え` プレースホルダーがあり、`PT_P2` に `{自分の考え}` が入る。
  - 呼び名が「プレースホルダー名」「プレースホルダーを追加」に揃う。
  - 投稿作成画面で選択中パターンを削除でき、削除後は先頭のパターンが選ばれる。
  - 異常系: 最後の1件は削除できない（サーバーが拒否し、理由が出る）。
- メモ: 使われなくなった `user_opinion` の経路（job入力・`composeUserInput` の行）を撤去した。
  同じことをする仕組みが2つあると、どちらが効いているのか分からなくなる。
  検証: `npm run test:db` 2,164件緑 ／ `npm run build` ／ **E2E 76件緑** ／
  **実APIで追加指示とプレースホルダーの両方が反映されることを確認**。

### T-M8-132: パターンの設定欄を名前と説明だけにし、プレースホルダーを作れるようにする `done`
- 参照: 要件02 §3.21、要件05 §8、要件06 §1.0/§3.8、プロンプト設計書 §4.1 / 依存: T-M8-131 / サイズ: M
- **運営者の指示（2026-08-18）**: 設定は名前と説明だけでよい。分量・Web検索・参考URLは
  プロンプトの中に自分で書く（雛形を指定の形にする）。プレースホルダーを自分で作れるようにし、
  プロンプト内の `{XXX}` へ入るようにする。
- 完了条件:
  - パターンの編集欄が 名前／説明／毎回入力する項目／生成プロンプト だけになる。
  - 雛形が「# 投稿内容／# 手順・Web検索有無／# 構成と分量とスレッド数／# 語り口」。
  - 分量はプロンプトの `Nスレッド目` から読み、読み取り結果が画面に出る。
    「メインポスト：」だけなら単発。読み取れなければ全体の上限（8）まで許す。
  - プレースホルダーを作ると投稿作成画面に入力欄が出て、入力が `{名前}` へ差し込まれる。
  - 異常系: `{名前}` をプロンプトに書いていない項目は保存できない（理由が出る）。
- メモ: `updatePattern` は画面から聞かない列（Web検索・参考URL・ニュース・引用）を**触らない**
  ——保存のたびに既定値へ戻してしまわないため。プレースホルダーの差し込みは正規表現を使わず
  分割・結合で行う（名前に正規表現の特殊文字が入りうる）。
  検証: `npm run test:db` 2,163件緑 ／ `npm run build` ／ **E2E 76件緑** ／
  **実APIで `{対象読者}` に入力が差し込まれ1ポストで生成されることを確認**。

### T-M8-131: パターンの設定を生成プロンプトへ反映し、参考URLの呼び名を揃える `done`
- 参照: プロンプト設計書 §4.1/§6、要件02 §3.21、要件06 §1.0/§4.1 / 依存: T-M8-130 / サイズ: M
- **運営者の指摘（2026-08-18）**: スレッド数・Web検索・出典URLが投稿作成画面やプロンプトに
  反映されている様子がない。出典URLは「必ず付ける」なのに投稿作成画面は「参考URL（任意）」のまま。
- **調べて分かった実態（指摘は正しかった）**:
  - スレッド数: **プロンプトに一言も渡していなかった**。生成後に `capPostCount` で切り詰めるだけで、
    既定プロンプト本文の「全体4〜6ポスト」等の数字は設定を変えても変わらず**食い違っていた**。
  - Web検索: providerのツール設定としては効いていたが、本文の「最大4回」等と食い違いうる状態。
  - 出典URL: **プロンプトに渡していなかった**。生成後に「通過出典0件なら1回再生成→警告」だけ。
  - 「参考URL（任意）」（投稿作成の入力）は題材として渡すURLで、設定の「出典URL」とは別物だった。
- 完了条件:
  - 設定（分量・Web検索・参考URL）が `<pattern_rules>` として毎回プロンプトへ渡る。
  - 既定プロンプト本文から分量・検索回数の数字を外し、数字の正本を1か所（設定）にする。
  - 設定の呼び名を「参考URL」にし、投稿作成の入力は「参考にするURL」として別物と分かる。
  - 投稿作成画面に、選択中パターンの設定が1行で出る。
  - 実APIで設定どおりに生成される（実測: 週次まとめ 上限5→ちょうど5ポスト・切り詰め0・参考URL4件）。
- メモ: 数字を2か所に書かない（T-M8-33 と同じ型の事故）。分量はAIへ伝えたうえで生成後にも
  同じ値で切り詰める——**伝えずに切り詰めると締めが落ちた形になる**。
  検証: `npm run test:db` 2,158件緑 ／ `npm run build` ／ **E2E 76件緑** ／
  `npm run check:providers` 17件 ／ **`npm run smoke:live` 全シナリオ成功（$0.1970）**。

### T-M8-130: パターンの設定を「スレッド数」で表し、投稿作成画面からも追加できるようにする `done`
- 参照: ADR-0008、要件02 §3.9/§3.21、要件06 §1.0/§4.1/§9 / 依存: T-M8-129 / サイズ: M
- **運営者の要望（2026-08-18）**:
  1. 設定を「ポスト数」ではなく**スレッド数（0〜7。0はメインポストのみ）**にする。
  2. パターンを追加したときの生成プロンプトに**フォーマット（雛形）を最初から入れておく**。
  3. **投稿作成画面からもパターンを追加できる**ようにする。
- 完了条件:
  - パターン管理と投稿作成の両方で、設定欄が「スレッド数」で 0〜7 を選べる。0 は「メインポストのみ」と読める。
  - 保存した値で実際に作られるポスト数が変わる（スレッド数3 → 最大4ポスト）。既定6件の挙動は変わらない。
  - 「パターンを追加」を押すと、プロンプト欄に雛形（見出しと書く内容の指示）が入っている。空欄から書き始めさせない。
  - 投稿作成画面でパターンを追加でき、追加直後にそのパターンが選択された状態になる。
  - 異常系: スレッド数の範囲外・名前の重複は、直す場所が分かる文言で拒否される。
- メモ: DBは総ポスト数（`max_posts`）のまま持ち、**画面が「スレッド数 = max_posts - 1」で見せる**。
  `max_posts` はスレッド配列の上限としてコード全体で使われており、意味を変えると解釈が全箇所でずれる。
  総ポスト数の上限は 7 → 8 へ広げた（スレッド数 0〜7 に対応・migration `20260818000006`）。
  入力欄は `components/post/pattern-fields.tsx` へ切り出し、**設定＞パターン管理と投稿作成で同じ部品**を使う。
  検証: `thread-count.test.ts` 5件（往復・上限・既定6件の表示）＋ `npm run test:db` 2,152件緑 ＋
  `npm run build` ＋ `npm run check:csp-nonce` ＋ **E2E 76件緑**
  （雛形が入っていること・スレッド数0で総1ポストになること・投稿作成画面で追加して選択済みになることを実ブラウザで確認）。

### T-M8-129: 投稿パターンを利用者が作成・編集・削除できるようにする `done`
- 参照: ADR-0008、要件02 §3.21／§3.8-3.10／§3.20、要件06（設定＞プロンプト）、プロンプト設計書 §5.1／§7.4（PT-SUGGEST） / 依存: なし / サイズ: L（5単位に分割）
- **運営者の要望（2026-08-18）**: 投稿作成の「パターン」を自分で複数作成／削除でき（**既定のものも削除可能**）、
  それぞれに名前とプロンプトを設定したい。「設定 > プロンプト > 投稿作成プロンプト」は
  **プルダウンをやめて全プロンプトを最初から並べ**、追加・編集・削除できる形にする。
  **画像生成プロンプト画面のプルダウンも不要。**
- **なぜLのまま分けるか**: `post_pattern` は enum で `drafts`／`schedule_slots`／`generation_jobs` が参照し、
  47ファイルがパターンを参照している。一度に置き換えると途中状態で動かなくなるため、
  各単位が単独で動く形へ分割する（設計の全文は ADR-0008）。
- 完了条件（単位ごと）:
  - **U1 `done`**: `post_patterns`（アカウント別マスタ）を新設し、参照列を追加する。**アプリコードは1行も変えない**
    （fillトリガが旧enum経路から新列を埋める）。Xアカウント作成で既定6件が自動投入され、
    パターンを削除しても①下書きは名前が残る②予約は設定を残して停止する③実行中jobは完走する。
    既存のDBテストが1件も変わらず緑。
  - **U2 `done`**: 生成の型判定と型プロンプトを `post_patterns` から引く。`prompt_templates` を画像専用へ。
    `generation_jobs.pattern_spec` に必須CHECKを追加（`not valid`＝これから作る行を守る）。
    **画面の形は無変更**（保存先だけ `post_patterns.prompt` へ移し、既存の上書きはmigrationで写した）。
    検証: `npm run test:db` 2,125件緑 ／ `npm run check:providers` 17件緑 ／
    **`npm run smoke:live` 全シナリオ成功（実費 $0.2077・上限$0.50内）**——生成5ポスト（P-6の上限5が効いた）・
    画像2.0MB・ニュース1件取得。下書きに `pattern_name`／`max_posts` の写しが入ることもDBで確認した。
  - **U3a `done`**: 上限・枠の見積りをパターンの属性にする。`PATTERN_MAX_POSTS`（編集上限＋日次枠）を
    `post_patterns.max_posts_edit` へ、`ROLLBACK_SAFE_BUDGET`（予約の投稿枠）を要件03 §7.4 の式から導く
    `scheduledPostSlots()` へ。下書きは写した `max_posts_edit` で編集を検証する。
    予約のenqueueは `pattern_spec` を凍結し、**パターンが読めない枠は黙って飛ばさず記録する**。
  - **U3b `done`**: 画面と改善提案から内部ID（`p1`）を消した。`POST_PATTERN_LABELS`／
    `POST_PATTERN_OPTIONS` を削除し、選択肢は `post-patterns-store.ts` からDB経由で得る
    （＝**自作パターンが投稿作成・予約の画面に出る**）。表示は写した名前（`drafts.pattern_name`）と
    予約の join 名。旧レポート（2026-08-18より前）の内部IDだけ `legacyPatternLabel` で当時の名前へ直す。
    旧 `pattern` 列を nullable にし、自作パターンでは null を書く（嘘の値を入れない）。
    検証: `npm run test:db` 2,133件緑 ／ `npm run build` ／ `npm run check:csp-nonce` ／
    **E2E 73件緑（自作パターンが予約画面の選択肢に出て保存され、画面に内部IDが1つも出ないことを実ブラウザで固定した）**。
  - **U4 `done`**: パターンCRUD（作成・編集・削除・既定の復元）と管理画面。
    **設定＞プロンプト＞投稿作成プロンプトを「パターン管理」へ**——プルダウンをやめ全件を並べる。
    **画像プロンプトの区分もプルダウンを撤去**（対象1件のselectは「他に何かある」と思わせるだけ）。
    最後の1件は削除させない。削除の確認で「過去は残る／予約は停止する／既定は復元できる」を先に示し、
    停止した予約の件数をトーストで伝える。検証: `post-patterns-crud.db.test.ts` 9件 ＋
    `npm run test:db` 2,147件緑 ＋ `npm run build` ＋ **E2E 75件緑**
    （追加・編集・削除・名前重複の理由表示・プルダウンが無いことを実ブラウザで確認）。
  - **U5 `done`**: enum `post_pattern` と旧 `pattern` 列（`drafts`／`schedule_slots`／
    `generation_jobs`／`x_timeline_posts`）を撤去した。撤去前に取り残しを検算し、
    名前の写しが無い下書き・specの無い生成job・パターンの無い有効枠があれば例外で止める。
    改善提案（PT-SUGGEST）は**そのアカウントのパターン名**を選択肢として渡し、
    出力もその名前に限る（実行できない型を推奨させない）。旧レポートの内部IDは
    `legacyPatternLabel` で当時の名前に直す。ニュースから作るときは既定の「ニュース解説」を使い、
    **消されていたら黙って別の型で作らず理由を返す**。
    検証: `npm run test:db` 2,147件緑 ／ `npm run build` ／ **E2E 75件緑** ／
    `npm run check:providers` 17件 ／ **`npm run smoke:live` 全シナリオ成功（$0.1965）** ／
    `npm run check:suggest`（実AIで改善提案を1周）。
- メモ:
  - **U1で実バグを1件検出した**: `schedule_slots` の fillトリガを `before insert or update` で
    無条件に動かすと、削除時のdetach（`pattern_id = null`）を書き戻して**既定パターンを一切削除できない**
    （FK違反）。UPDATEは「旧 `pattern` が変わり、かつ呼び出し側が `pattern_id` を触っていないとき」だけ引き直す。
  - fresh apply（新規DBへの適用）はCIの `supabase start` が検証する。ローカルは既存データを消さないため
    `supabase db reset` を実行していない（冪等な再適用は2回成功を確認済み）。

### T-M8-128: ローカルでプラン管理・決済が開けない（Originとプラン管理の原因追跡） `done`
- 参照: 要件03 §3（Checkout/Portal）、要件01 §8（記録） / 依存: なし / サイズ: M
- **運営者の報告（2026-08-18）**: ローカルで「プランを変更」「解約する」を押すと
  「プラン管理画面を開けませんでした。時間をおいてもう一度お試しください。」になる。
- **原因(1)・Origin検証**: ローカルの `APP_BASE_URL` は `http://127.0.0.1:3000`（X OAuthが
  `localhost` を許さないため）。ブラウザで **`localhost:3000` を開くと Origin が一致せず 403**。
  実測で確認（`localhost` → 403 forbidden / `127.0.0.1` → 401 unauthorized）。
  決済（Checkout）も同じ検証なので同様に失敗する。`CLAUDE.md` に「`localhost` ではなく
  `127.0.0.1`」と書いてあったが**手順を記憶に依存させていた**のが誤り（原則3）。
  → `hasExactAppOrigin` で **127.0.0.1 ⇄ localhost を開発時だけ等価**にした。
  **本番の守りは変えない**（両方がループバックのときだけ等価。ポートとスキームは区別）。
  実装中に**末尾スラッシュ付きOriginが通る回帰**を作りかけ、既存テストが捕まえた
  （`new URL().origin` で正規化してしまうため）。厳密一致を壊さない形に直した。
- **原因(2)・原因が辿れない**: `apiError` は `internal_error` だけを記録し、
  **`provider_error` は理由を捨てていた**。「外部サービスとの通信に失敗しました」と返るだけで
  Stripeの応答が どこにも残らず、切り分けに時間がかかった（原則2違反）。→ 記録対象に加え、
  `at` に種類を残す（`api-route:provider_error`）。
- **原因(3)・doctorが止まる**: `npm run doctor` は「プラン管理画面の設定を確認できませんでした」と
  出していたが**次にやることが無く**、運営者はそこで止まる。→ 「STRIPE_SECRET_KEY が読めていない
  可能性」＋「あるのに出るなら `npm run dev` を再起動（envは起動時に読む）」を出すようにした。
- **未解決**: 実ブラウザでは修正後もまだ `provider_error` が出た。**アプリのコードを直接実行すると
  成功する**（同じenv・同じ引数で status 200）ので、動いている dev server のenvが古いのが濃厚
  （`.env.local` は起動時にしか読まれない）。**dev serverを再起動して再確認が必要**。
  再発時は上記(2)で理由がログに残るようになったので辿れる。
- 検証: 単体2,080件（Originのループバック7件・provider_errorの記録・doctorの次の一手3件）。
  実測でOriginの403→401を確認。

### T-M8-126: 申込ボタンを「無料で試せる」と分かる文言にし、ヘッダの設定の行き先を直す `done`
- 参照: 要件06 §1.5（LP料金）・SC-10 / 依存: T-M8-125 / サイズ: S
- **運営者の指示（2026-08-18）**:
  - LPの「通常プランで始める」等は、無料で始められる旨が分かるボタンにしたい
  - 右上の「設定」を押すと「設定＞課金・プラン」ではなく「設定＞設定」へ行くようにしたい
- ボタンは「7日間無料で試す」を主文にし、プラン名を副文へ（3つ並ぶのでどれを選ぶかは残す）。
  **`opacity` で副文を弱めない**——LPは「JSが動かなくても読める」ことを `landing.spec.ts` が
  opacityまで見て固定しているため（旧実装で白紙になった事故の再発防止）。文字サイズだけで弱める。
  「無料で試す」と言い切るので、無料の条件（初回のみ・カード登録・期間中の解約で無料）を
  同じ場所に添えた（景表法・要件03 §54）。
- ヘッダの「設定」は `/app/settings`（先頭＝設定タブ）へ。`?tab=billing` を指していたため、
  ヘッダの設定から課金画面が開いて行き先の予想と食い違っていた。
- 検証: E2E `landing.spec.ts` 4件（ボタン3本・無料条件の明示・JS無効でも読める）。

### T-M8-127: 登録済みメールでの再登録に、原因が分かる文言を出す `done`
- 参照: 要件03 §1、要件06 SC-02 / 依存: T-M8-121 / サイズ: S
- **運営者の報告（2026-08-18）**: 同じメールで登録すると「登録を完了できませんでした。入力内容を
  確認し、時間をおいて再度お試しください。」と出る。原因が分かる文言にしたい。
- **原因**: captcha以外のすべてを1つの汎用文へ丸めていた。**登録済みは待っても直らない**ので
  この文言は嘘で、利用者は同じ操作を繰り返す（原則1・2）。
- **ローカルSupabaseで実応答を確認**（作文で作らない）:
  - 確認済みメールで再登録 → 422 `user_already_exists`
  - **未確認**メールで再登録 → エラーにならずコードが再送される（成功で扱ってよい）
  - 短時間の連続・送信上限 → 429 `over_email_send_rate_limit`
- `signup-errors.ts` で言い分ける。登録済みは「既に登録されています。ログイン、または
  パスワードをお忘れの場合は再設定してください」＋ログインへの導線（行き止まりにしない）。
  レート制限は「数分おいて」とだけ言い、**入力を直せと言わない**（入力は正しい）。
  未知のエラーは従来の汎用文へ落とす（勝手に断定しない）。`code` と `error_code` の両方を見る
  （経路で名前が違い、片方だけだと取りこぼす）。
- **アカウント列挙のトレードオフ**: 「登録済み」と明示すると第三者が任意アドレスの登録有無を
  判別できる。運営者の指示で明示する。文言をログイン・再設定への案内に寄せ、得られる情報を
  実質増やさないようにした。自動列挙はTurnstileと `rate_limit_anonymous_users`（5分30回）が抑える。
- 検証: 単体9件＋E2E1件（**fixtureは確認済みで作られる＝運営者が踏んだ状態と同じ**。
  「既に登録されています」が出て「時間をおいて」が出ないこと、ログイン導線があることを固定）。

### T-M8-125: プランの違いを比較表にし、/plans の重複を削る `done`
- 参照: 要件06 SC-04・§1.1 / 依存: T-M8-118 / サイズ: M
- **運営者の指示（2026-08-18）**: `/plans` の「お申し込み前の確認」と初期設定2セクションは不要。
  3プランの違いをもっと分かりやすく、機能を行見出しにして✓/−が付く表にしたい。LPも同様に。
- **表にした理由**: 箇条書きカードは「mdプランの全機能」という入れ子の言い方になり、
  上位プランに何が積まれるのかが読み取れなかった。表なら差がその場で見える。
  行と可否は `lib/plan-comparison.ts` が持ち、**画面に✓/−を書き写さない**
  （以前カードの箇条書きを画面ごとに持っていて `/plans` とLPで内容が食い違った）。
  ✓は色だけでなく読み上げ用の文字も持つ（WCAG: 色以外の手がかり）。
- **削ったもの**: 申込前確認の定義リスト（6項目）・初期設定（BYOK）・初期設定（プレミアム）。
  `/plans` は372→160行、LPの料金は122→59行になった。
- **法務上の判断**: 申込前確認を**全部は消していない**。要件06 §1.1・要件03 §54は
  「申込ボタンより前に重要事項を再掲し折りたたまない」と定めており、特商法・消費者契約法の
  趣旨でもある。**無料期間・カード登録・自動更新・解約＋特商法ページへのリンクを1段落で残した**
  （法定事項の全文はそのページが担う）。BYOKの追加費用の注記（要件03 §54）も残している。
- 検証: 単体2,062件（LP構造検査を比較表へ向け直し、グラデ本数を5→4へ実態合わせ）。
  E2E 9件（LP・/plans）。実ブラウザで1440/768/390を確認——**3幅ともページ横スクロール0**で、
  390では表が自分の中でスクロールする（T-M8-60でLPの比較表がページを183px伸ばした形を回避）。

### T-M8-123: 本番のメールが届かず、コードの桁数も合っていなかった `done`
- 参照: 要件03 §1、`scripts/push-auth-templates.mjs` / 依存: T-M8-121 / サイズ: S
- **利用者の報告（2026-08-18）**: メールが届かない。6桁コードの入力欄も画面に無い。
- **原因3つ**:
  1. **`rate_limit_email_sent` が 2通/時**（Supabaseの既定）。登録＋再送で使い切り、以降は
     画面に「送信しました」と出るのに何も届かない（原則1違反）。30へ引き上げた。
  2. **`mailer_otp_length` がリモートだけ 8**（`config.toml` は6）。画面は6桁前提なので
     **桁数が合っていなかった**。6へ揃えた。
  3. **入力欄が無いのは反映順序の誤り**（私の判断ミス）。テンプレートだけAPI経由で本番へ
     入れて、コード入力のUIを未デプロイのままにした。デプロイで解消する。
- **どちらも「コードに現れない設定」**でテストでは原理的に見えない。`auth:templates` が
  テンプレートに加えて `mailer_otp_length` / `mailer_otp_exp` / `rate_limit_*` も
  `config.toml` の値へ揃え、反映後に読み直して確認するようにした。
  ローカルの `config.toml` も `email_sent = 30` へ（2では動作確認すら通らない）。
- 反映: 本番・staging とも設定を揃えた（6桁・30通/時）。

### T-M8-124: 確認コードの総当たり対策（利用者のストレスにしない） `done`
- 参照: 要件03 §1 / 依存: T-M8-121 / サイズ: S
- **運営者の指示（2026-08-18）**: DoS・総当たり対策を簡易的かつストレスになりにくい形で。
- **二段構え**:
  - **本体はSupabaseのIPごとのレート制限**（`rate_limit_verify` 5分30回・
    `rate_limit_anonymous_users` 5分30回・`rate_limit_email_sent` 30通/時）。
    6桁＝100万通りに対して現実的な時間では当たらない。**画面には何も足さない**ので
    正しく入力できる人は一切損をしない。
  - IPを変えて回されると上をすり抜けるため、**宛先アドレスごとにも失敗を数える**
    （`code-attempts.ts`・上限10回・1時間で自然に消える）。
- **ストレスにしない設計**: 打ち間違いの数回では何も起きない／残り回数は3回を切ってから
  初めて出す（最初から出すと急かすだけ）／上限でも**行き止まりにしない**（再送で数え直す）／
  画像認証も待ち時間も入れない。コード入力画面ではTurnstileを求めない（登録時に通っている）。
- 検証: 単体7件（打ち間違いで止まらない・上限で止まる・再送で戻る・アドレスごとに独立・
  大文字小文字と空白の同一視・1時間で消える）。E2Eで登録が通ることを確認。

### T-M8-121: メール確認をリンクから6桁コードへ変える `done`
- 参照: 要件03 §1、要件05（Server Actions）、要件06 SC-02 / 依存: T-M8-120 / サイズ: M
- **運営者の指示（2026-08-18）**: メール認証が面倒で離脱しそう。6桁コード認証にしたい。
- **リンク方式は壊れ方が多い**: (1)メールクライアントがURLを先読みして**1回きりのトークンを
  使い切る**（利用者が押すと「使用済み」）(2)スマホでメールを開くと登録した端末と別のブラウザに
  なる (3)リモートのテンプレートが既定のままだと `token_hash` が付かず必ず失敗する（T-M8-120で
  2回踏んだ）。コードなら**画面を離れずに終われる**のでどれも起きない。
- 実装: テンプレートを `{{ .Token }}` へ。`verifySignUpCode`（`verifyOtp({type:'signup'})`）と
  `EmailCodeForm` を追加し、signup成功で同じ画面がコード入力へ切り替わる。
  **全角数字・空白・ハイフンを吸収してから検証する**（メールからのコピーで混ざる。正しく写して
  いるのに弾かれる形を作らない）。6桁そろうまで送信を押せず、あと何桁かを画面に出す。
  コードが違う／期限切れは**断定しない**文言にした（Supabaseが同じ系統で返すため）。
  captchaはこの画面では要求しない（到達できるのは直前に登録した本人だけで、登録時に通している。
  求めると詰む経路が増える・T-M8-87の教訓）。
- **パスワード再設定はリンク方式のまま**（コード化は別途。`/auth/confirm` は recovery で使い続ける）。
- `doctor` の検査を `token_hash` から `{{ .Token }}` へ変更。`auth:templates` は種別ごとに
  必要な目印（Confirm=Token / Reset=TokenHash）を見るようにした。
- 反映: 本番・stagingのテンプレートを更新済み（Management API経由・デプロイ不要）。
- 検証: 単体7件（`email-code.test.ts`）＋29件（`auth-url-status`）。E2E `auth.spec.ts` を
  コード方式へ書き換え、**ローカルで実際にメールから6桁を取り出して登録完了まで通した**。
  password-reset のE2E 3件も引き続き緑。

### T-M8-120: 本番の新規登録が完了できない（確認メールのリンクが必ずエラー） `done`
- 参照: 要件03 §1、`docs/operations/deployment.md` §2-5.5 / 依存: なし / サイズ: M
- **利用者の報告（2026-08-18）**: 本番で新規登録してメール認証すると
  「リンクを確認できませんでした／有効期限が切れているか、すでに使用されています」になる。
- **原因は2段**:
  1. **本番のメールテンプレートが既定（`{{ .ConfirmationURL }}`）のまま**で、アプリの
     `/auth/confirm` が要求する `token_hash` がリンクに付いていなかった。`supabase/config.toml` の
     `[auth.email.template.*]` は**ローカル専用**で、`db push` でも `link` でもリモートへ行かない。
  2. テンプレートを変えようとすると Management API が拒否した——**Freeプラン＋内蔵送信では
     テンプレートを変更できない**（`Email template modification is not available for free tier
     projects using the default email provider`）。**本番にカスタムSMTPが未設定だった。**
     内蔵送信は2通/時・組織メンバー宛のみなので、本番運用そのものに耐えない。
- **同じ失敗の2回目**（2026-08-02・T-M7-45と同型）。`deployment.md` に手順を書いてあったが
  **人の記憶に依存していたので忘れられた**。回避策をドキュメントに書いて済ませたのが誤りだった。
- **直したもの**:
  - `npm run auth:templates -- --target <env> [--apply]` を新設。SMTPが未設定なら `SMTP_*` から
    先に設定し、`supabase/templates/*.html` を反映し、**反映後に読み直して確認する**。
    project ref は URL の CSP から自動特定（`doctor` と同じ作法。envを増やさない）。
  - `judgeAuthUrls` に **`token_hash` の有無**の判定を追加し、`doctor` から渡すようにした。
    URLの許可リストが正しくても登録できない状態を、これまで誰も見ていなかった。
    許可漏れより先に出す（登録が必ず失敗する方が重い）。
- 反映: 本番はSMTP（Gmail・運営者が許可）＋テンプレート2件、stagingはテンプレート2件。
  反映後にManagement APIで読み直し、リンクが `?token_hash={{ .TokenHash }}&type=...` になったことを確認。
- 検証: 単体29件（`auth-url-status.test.ts`）。`doctor` が両環境で緑になることを確認。
  **運営者による実際の新規登録での確認が残っている。**

### T-M8-119: Stripeの商品説明が古い仕様のままだったのを直す `done`
- 参照: 要件03 §2、`scripts/setup-stripe-portal.mjs` / 依存: なし / サイズ: S
- **運営者の指摘（2026-08-17）**: ホームページとStripeの画面に現仕様（AIクレジット1000等）を反映してほしい。
- **アプリ側（LP・`/plans`・設定）は既に現仕様だった**（`plans.ts` から描画しているため）。
  古かったのは**本番Stripeの商品説明**で、mdプランが「ベースmd」（T-M8-105で改称済み）、
  プレミアムが回数制の「文章生成100・画像20」（T-M8-109で金額制のAIクレジットへ移行済み）のまま。
- **原因**: `PRODUCT_DESCRIPTIONS` はプレミアムだけ既に直っていたが、**スクリプトを本番へ
  再実行していなかった**ためStripeに古い文字が残っていた。mdの「ベースmd」はスクリプト側も未修正。
  Stripeの説明はCheckoutとカスタマーポータルで利用者が読むので、古いと契約内容の誤認になる。
- 直したもの: スクリプトの md 説明を「アカウント.md」へ。`portal-configuration.test.ts` に
  **廃止した呼び名のガード**を追加（数字は既に見ていたが、呼び名は誰も見ていなかった）。
  `npm run stripe:portal:setup -- --target production`／`staging` を実行して両環境へ反映。
- 検証: 反映後にStripe APIで3プランの name/description を読み直して確認。単体2,042件緑。

### T-M8-118: リリース記念キャンペーン（半額表示）と解約時の追加割引 `done`
- 参照: PRD §6、要件03 §2 / 依存: なし / サイズ: M
- **運営者の指示（2026-08-17）**: 通常価格を 1,000／2,000／5,960円とし、リリース記念で
  期間限定半額（実際の請求は 500／1,000／2,980円＝現行のまま）に見せる。解約しようとした
  利用者にはさらに半額を3ヶ月提示する。
- **請求額は変わらないため Stripe Price の作り直しは不要**（当初プレミアムを2,480円と誤解し、
  新Price作成が必要だと報告したが、運営者の訂正で2,980円据え置きとなった）。
- `PLANS[].regularPriceJpy` を追加し、表示の分岐は `RELEASE_CAMPAIGN` 1箇所に集約
  （`active: false` で全画面から消える＝消し忘れる場所を作らない）。反映先はLP・`/plans`・
  利用規約・特定商取引法表記・設定＞課金の5箇所。`/plans` の「税込月額500円〜2,980円」の
  直書きは定義から生成する形へ変えた。
- **景品表示法の注意**: 取り消し線に「通常価格」と書いていない。二重価格表示は通常価格として
  示すなら実際にその価格で相当期間販売した実績が必要で、この3プランにその実績が無い
  （500／1,000／2,980円でのみ販売してきた）。将来価格として「キャンペーン終了後」と示す形にし、
  `landing-page.test.ts` で「通常価格」の語が入らないことを固定した。**条項の有効性の確認は
  D-17（弁護士レビュー）の対象に含める。**
- **解約時の追加割引はStripeダッシュボードでのみ設定できる**（`billing_portal.Configuration`
  APIに該当フィールドが無い。当アプリのポータル設定は `is_default: true` なのでダッシュボードの
  設定が効く）。50%オフ・3ヶ月・適用後 250／500／1,490円。金額と根拠は `RETENTION_DISCOUNT` に記録。
  **プレミアムはフル利用だと原価（約2,120円）を下回る**（月700円程度の損失）。3ヶ月限定なので
  1人あたり最大2,100円程度で止まる。運営者が承知のうえで決定。実績を見て見直す。
- 検証: 単体2,041件（価格ガード2件・LP検査1件を追加）／E2E（LPのバッジと終了後価格・
  「通常価格」不使用／設定＞課金の月額表示）／実ブラウザでLP・利用規約・特商法の3ページを確認。

### T-M8-116: 分析の日次起票が、1人の連携解除で全員ぶん止まるのを直す `done`
- 参照: 要件04 §12（定時トリガー）、T-M8-19（同型の修正） / 依存: なし / サイズ: S
- **発見**: 2026-08-17、stg の CI で `scheduler-tick` の実DBテストが落ちた（手元では緑・並列実行で顕在化）。
  `[scheduler_tick cleanup] daily_suggestions error: insert or update on table "generation_jobs"
  violates foreign key constraint "generation_jobs_x_account_id_fkey"`。
- **原因**: `enqueueDailySuggestions` の `insert ... select` に行ロックが無く、
  **SELECT が見る行と外部キー検査が見る行が別のスナップショット**だった。SELECT の直後に
  Xアカウントの連携解除（や退会のcascade）がコミットされると、検査時点で親行が無く違反になる。
  `news-digest.ts`・`daily-summary.ts` は T-M8-19 で同じ修正済みだったが、後から足した
  この起票だけ漏れていた。
- **影響**: tick は cleanup の例外を捕まえて先へ進むため落ちない。しかし
  **1人の連携解除で、その日の分析が全利用者ぶん黙って起票されなくなる**（原則1違反）。
- **修正**: `for key share of xa` を足す。解除はこの文の完了まで待たされ、先に消えていれば0行になる。
- 検証: `suggestion-jobs.db.test.ts` に競合を決定的に再現するテストを追加
  （別トランザクションで削除を開始→起票中にcommit）。修正前は外部キー違反で落ち、修正後は通る。

### T-M8-115: 通知が指す下書きが無いとき、どこへ行ったのかを出す `done`
- 参照: 要件06 §2.1（通知）・§7（投稿タブ） / 依存: なし / サイズ: S
- **確認のきっかけ**（2026-08-17 運営者）: お知らせ機能とタップ後の挙動が適切か。
- **調べた結果、通知そのものは概ね適切だった**: 11種の通知を投入して実ブラウザで確認し、
  リンクの無い通知だけが押せない形になっていること、9種のリンク先がすべて正しい画面へ
  着くこと（`?tab=api-keys` 等の旧slugもエイリアスで解決）、ニュース通知は期間の説明と
  「すべてのニュースを表示」の逃げ道を持つこと、メールは `APP_BASE_URL` で絶対URL化される
  ことを確認した。設定リンクの実在は `src/app/app/tabs.test.ts` が既にガードしている。
- **見つけた穴**: 通知が指す下書きが**押した時にはもう無い**場合（投稿されて履歴へ移った・
  破棄された）、**説明なくただの一覧が出るだけ**だった。通知を押すのは数時間〜数日あとなので
  普通に起きる。利用者からは「押しても何も起きなかった」に見える（原則1・2）。
  `locateDraft` で行き先を調べ、「履歴に移っています／履歴を開く」または
  「見つかりませんでした。破棄されたか、別のXアカウントのものです」を出す。
  タブの振り分けは `listDraftsForAccount` と同じ条件を使う（案内した先に無い、を作らない）。
- 検証: E2E 2件（別タブへ移った／消えた）を `notifications.spec.ts` へ追加。実ブラウザで
  投稿済み下書きを `?tab=drafts` で指して案内とリンク先を確認。

### T-M8-114: 分析レポートを日本語で読めるようにし、良かった投稿とレポートの構成を整える `done`
- 参照: 要件06 §8（SC-09）、プロンプト設計書 §6.15 / 依存: T-M8-94 / サイズ: M
- **利用者の指摘**（2026-08-16）: (1)`impressions` や `p1` が読めない (2)「この投稿を開く」だけでは
  どの投稿か分からない (3)結論→良かった投稿→設定の順は良いがUIとして整っていない。
- **(1) 原因はAIの本文**。渡す投稿データの項目名は英語、型は内部IDなので、AIがそのまま書き写す。
  実際に出ていた文: 「6月8日のスレッド（冒頭41impressions）」「スレッド型（p1）」
  「速報系（2045460385856377140等）」。`humanizeReportText`（`src/lib/analytics/humanize-report.ts`）で
  表示前に日本語へ直す（表示41回／ニュース解説／ある投稿）。型名を入れた結果重複する括弧は畳む。
  **貼り付けて使う成果物（アカウント.md改訂案・生成プロンプト全文）には掛けない**——利用者が保存する
  内容を書き換えないため。プロンプト側にも表記ルールを足したが、**守られない前提で画面側を最後の関門にする**。
- **(2)** 良かった投稿に本文冒頭・表示回数/いいね/リポスト/返信・投稿日時・型/テーマのバッジを出し、
  「Xで開く」を右上のボタンへ独立させた（`x_timeline_posts` から1クエリでまとめて引く・N+1にしない）。
  保存済みタイムラインに無い投稿は本文を出さずリンクと理由だけにする（欠けても他を巻き添えにしない）。
- **(3)** ①まとめ ②良かった投稿 ③近づけるための設定 に番号付きの見出しを付けた。
  貼って使う2つの提案は共通の器（`ProposalBlock`）へ寄せた。
- **副産物**: `icon-source.test.ts` のガードが `<Icon name={条件 ? "a" : "b"}` を書くと壊れる穴を修正
  （`[\s\S]*?` がタグを越え、無関係な `<input name="terms_version">` にマッチして落ちていた）。
- 検証: 単体（humanize 10件）／E2E `suggestions.spec.ts`（実DBの投稿を描画し、英語の項目名が
  画面に出ないこと・見出し3つ・「Xで開く」を検査）／**実ブラウザで本番アカウントの実レポートを描画**
  （1440/768/390で横スクロールなし）／**`npm run check:suggest`（実Claude 1周）2回連続で成功**（実費 約$0.06）。

### T-M8-113: E2E実行中にまれに出る Hydration mismatch の出所を突き止める `done`
- 参照: `release:check` のE2Eログ・React hydration / 依存: なし / サイズ: S
- **出所**: 投稿作成画面の「経過 0:06」の秒カウンタ。クライアントコンポーネントの
  `useState(() => Date.now())` は**サーバー描画時とhydration時の2回**評価されるため、
  その間に秒が変わると表示が食い違う。**生成中に画面を開き直したときだけ**出るので
  再現が難しかった。回線が遅いほど起きやすい。
- **直し方**: サーバーが測った時刻を props で渡す（`src/lib/time/server-now.ts` の
  `serverNowMs()`）。両者が必ず一致し、しかも初回描画から正しい経過秒が出る。
  同じ形だった参考ソースの滞留判定（60秒しきい値・`learning-sources-manager`）も揃えた。
- **直さないもの**: `follower-chart` の `nowMs` は「30日前」の日境界の絞り込みにしか使わず、
  食い違うにはデータ点の 00:00 JST がサーバー描画とhydrationの数百ミリ秒の隙間に
  ちょうど入る必要がある。実質起き得ないため触っていない。
- 検証: E2E `generation.spec.ts` に再現テストを追加。**JSの到着を2秒遅らせて秒を必ず跨がせる**
  （遅らせないと手元では同じ秒に収まり、修正前のコードでも通ってしまう）。
  修正前は実際に「server rendered text didn't match the client」で落ち、修正後は通る。
- メモ: 2026-08-16のrelease:checkで観測（1〜2件/回・毎回ではない）。**11画面（/app・投稿作成・下書き・設定・スケジュール・投稿分析・ニュース・LP・login・signup・plans）を実ブラウザで個別に確認したが再現しなかった**。ロゴの画像化（T-M8-111）以降のログで見えているが、mismatchの対象は`text`でありロゴ（画像）とは種類が違う。テストデータの状態に依存する時刻表示（相対時刻・日付境界）が疑わしい。Reactはクライアント再描画で回復するため実害は限定的だが、原因不明のまま放置しない。

### T-M8-112: アカウント設定のNG入力欄の高さを揃え、参考ソースの入力欄を種別ごとに分ける `done`
- 参照: 要件06 §3.6（アカウント設定フォーム）・§9（参考ソース） / 依存: なし / サイズ: S
- 完了条件:
  - NG設定の3欄（NGワード・NGトピック・自由ルール）の縦幅が、他の複数行入力（投稿作成の追加指示など）と揃った自然な高さになる
  - 参考アカウントと参考投稿の入力欄が分かれ、種別selectを選ばずに入力できる（それぞれ上限と残数、URL例が独立して分かる）
  - 上限到達時に「なぜ押せないか」が各欄で分かる（T-M8-37の方針を維持）
  - 実ブラウザで3幅・上限到達・追加成功を確認する
- **やったこと**: NG3欄を`min-h-28`（112px固定）→`rows={3}`（投稿作成の追加指示と同じ高さ・共通の`inputClassName`のみ）。参考ソースは種別selectを廃し、参考アカウント／参考投稿それぞれに「残数(n/上限)＋学ぶ内容の一言＋URL例＋追加ボタン」を持つ独立した欄へ。上限到達時は欄ごとに理由と対処（一覧から削除）を出す。
- **検証**: 実ブラウザで3欄の高さ一致・種別selectの不在・欄ごとのplaceholder/残数・片方入力時にもう片方の追加ボタンが無効のまま・1440/390pxで横スクロールなし・コンソールエラー0。
- メモ: 運営者の指示（2026-08-16）。現状はNG欄が`min-h-28`（112px）で他より背が高く、参考ソースは種別select＋URL1本の共用フォーム。

### T-M8-111: ロゴを運営者提供の画像（public/logo.png）へ差し替える `done`
- 参照: `src/components/brand/brand-logo.tsx`・要件06 §2（画面共通）・`src/app/globals.css`（--brand-gradient-logo） / 依存: なし / サイズ: M
- 完了条件:
  - アプリのヘッダー／サイドバー・LPヘッダー・ヒーローモック・フッター・最終CTAの5箇所すべてが新ロゴになる
  - favicon（`src/app/icon.png`）とAppleアイコン・OGP画像が新ロゴになる（従来はNext.jsのひな形のまま）
  - 提供画像は**透過なし・余白過多・763KB**のため、トリミング＋透過化＋リサイズを行い、薄グレー背景（LPフッター`bg-page`）でも白い四角が出ないこと
  - 実ブラウザで5箇所＋favicon＋3幅を確認する
- **やったこと**: `LogoTile`/`BrandLogo`を画像へ。**認証3画面はコンポーネントを使わずロゴを直書きしていた**ため（当初の調査で漏れていた）合わせて統一＝表示は計8箇所。サイズ指定は高さのみ・幅autoで比率非依存に。favicon/Appleアイコン/OGPを新設し、`favicon.ico`（Next.jsのひな形）を削除、`metadataBase`を`APP_BASE_URL`から設定（本番モードで`https://exosai.net/opengraph-image.png`と解決されることを確認）。未使用になった`--brand-gradient-logo`を削除。**差し替え用に`npm run logo -- <元画像>`を新設**（自動透過・自動トリミング・4ファイル生成。原則3）。
- **実機で見つけた問題2件**: ①提供画像は透過なし・余白過多（1254角に対し絵柄は867×558）→ 自動トリミングと白背景の逆算透過で解決 ②Next.js Imageの**最適化経由だと縦横比が誤解釈されマークが正方形に潰れる**（naturalが124×124になる）→ `unoptimized`＋高さ120pxの軽量素材（36KB）で解決。
- **検証**: 実ブラウザで8箇所すべての描画（要素の存在ではなく`naturalWidth>0`と描画ボックスの比率）・favicon/Appleアイコン/OGPの配信・`favicon.ico`が404・コンソールエラー0・LP 1440/390pxの横スクロールなし。単体2027件・build成功。
- メモ: 運営者が2026-08-16に`public/logo.png`（1254×1254・RGB・マークのみ）を配置。従来はCSSのグラデーションタイル＋文字「S」で描画していた（画像ファイルではなかった）。

### T-M8-110: AIモデル設定の表記を「約N円（クレジット）/回」へ改め、目安の誤りを直す `done`
- 参照: `src/lib/ai/model-catalog.ts`・`src/lib/usage/ai-credits.ts`・要件06（AIモデル設定） / 依存: T-M8-109 / サイズ: M
- 完了条件:
  - Claude Sonnet 4.6 を選択肢から外す（Sonnet 5より高単価$3/$15で性能も下＝下位互換。保存済み選択はカタログ外→env既定へフォールバックで安全）
  - 「$X/$Y per MTok」表記を廃止し、premiumは「約Nクレジット/回」・BYOKは「約N円/回」の1回あたり目安へ
  - **目安の誤りを修正**: 画像が全モデル一律「約32クレジット/回」だったのをモデル別実額（GPT Image 2=31・NB Pro=24・NB2=11・mini=5等）へ。文章もFable 5「約80」→実測ベース55等、単価倍数ではなく実費構造（検索固定費＋モデル比例部）で再計算
  - reserve見積もりも同じ数値を使う（表示と仮押さえの正本を1つに）
- **やったこと**: カタログを`estimateCredits`（1回あたりの想定実費円）へ一本化——表示とreserve見積もりの正本が同一に。文章は実費構造（検索固定費＋モデル単価比例部）で算出（Fable 5=55〔実測$0.33≒53円〕・Opus 5/Sol=30・Sonnet 5/Terra=16・Haiku=10等）。**画像の一律32表示を廃止**しモデル別実額（GPT Image 2=31・NB Pro=24・NB2=11・mini=5・Lite=4＝概算単価表×160円と一致、テストで機械検査）。おまかせ見積もりは文章16・画像12（既定モデルが低コスト帯のため）。表記はpremium=「約Nクレジット/回」・BYOK=「約N円/回」。Sonnet 4.6削除（保存済み選択はカタログ外→env既定へフォールバック）。旧`creditMultiplier`/`priceNote`/倍数方式は削除。
- **検証**: 単体2027件・実ブラウザ（premium/BYOK両表記・per MTok不在・Sonnet 4.6不在）。要件03/06同期。
- メモ: 運営者の指示（2026-08-16）。

### T-M8-109: 生成・画像クレジットを「AIクレジット」（金額制・1000=1000円分）へ統合する `done`
- 参照: 要件03 §7〜8・要件02 §3.13/§3.14・PRD §5.5 O-4/§6・`src/lib/usage/` / 依存: T-M8-108 / サイズ: L
- 完了条件:
  - 生成クレジット・画像クレジットが**AIクレジット**1本（月1000）になる。内部的に1クレジット=1円相当（UIに円換算は出さない）
  - 消費は回数ではなく**実費ベース**: 開始時にモデル別の見積もり額を押さえ（上限チェック）、成功時に実費（推定原価×160円/ドル・切り上げ）で精算、失敗時は全額返還
  - 表示の名称と並びは**AIクレジット → 通常投稿クレジット → URL付き投稿クレジット**（X投稿の2枠は改名のみ・回数制のまま）
  - 80%/100%通知・上限バナー・LP・プラン表が追随
- **やったこと**: `usage_counters`を`ai_credits_used`1本へ（旧回数列は単位が違うため移行せず削除・migration 20260816000001。enumへ`ai_credit`追加・delta±100000へ）。消費フロー: reserve（見積もり=文章16/画像32×モデル倍数）→settle（実費=推定原価×160円切り上げ・最低1。差分をconsume/refundイベントで調整・冪等キー`job:{id}:{type}:settle`）→失敗時全額refund。settle配線は成功パス4箇所（post-generation・image-generation・learning-analysis・単独md-merge）。**画像の1枚あたり概算単価表**（`IMAGE_FLAT_RATES_USD`）を導入し従来の原価null記録も解消。表示は**AIクレジット→通常投稿クレジット→URL付き投稿クレジット**の順（利用枠カード・バナー・通知・LP・プラン表・規約・特商法・Stripe商品説明）。モデル選択肢は「目安 約Nクレジット/回」表示へ。**ログイン中のアカウント表示を課金タブ→設定タブ先頭へ移動**（運営者の指示）。
- **既知の近似**: 学習job内MD-MERGEの実費（数円）は親の精算に含まれず過小方向（md-merge.tsに明記）。画像実費は概算単価（サイズ・品質で実請求と差が出る）。
- **検証**: 単体2026件・DB統合（可変reserve/settle/refund・80%通知・схема同期）・実ブラウザ（並び順・メール位置・目安表示・旧表記の不在）・E2E緑。docs4本（PRD v1.18・要件02 v1.38・要件03 v1.24）。
- メモ: 運営者の指示（2026-08-15）。精算の追加消費は上限チェックしない（既に発生した実費は拒否できない）。

### T-M8-108: プレミアムの利用枠をクレジット制にし、上位モデルは倍数消費にする `done`
- 参照: 要件03 §7〜8（利用枠）・PRD §6（料金・原価試算）・`src/lib/usage/`・`src/lib/ai/model-catalog.ts` / 依存: T-M8-107 / サイズ: L
- 完了条件:
  - 「生成枠」「画像枠」が「生成クレジット」「画像クレジット」になる（UI・LP・docs）
  - 基準モデル（文章=Claude Sonnet 5相当・画像=GPT Image 2/Nano Banana Pro）=1クレジット、上位モデルはコスト比の倍数を消費する（例: Fable 5=5・Opus 5=3・Sonnet 4.6=2）
  - reserve/refundが可変量に対応し、上限判定・返還・80%/100%通知が倍数消費でも正しく動く
  - AIモデル設定の選択肢にクレジット消費数が表示される（premium）
  - クレジット数と価格の組（黒字条件）は数値根拠付きで要決定D-30へ
- **やったこと**: reserve/refundを可変量へ（`amount`・上限判定は「現在値+消費数>上限」でちょうど埋まる量は通す・refundは元reserve行のdeltaと同量＝対称）。DB制約をdelta±1固定→±1〜±10へ（migration 20260815000004）。倍数はカタログ`creditMultiplier`（Fable 5=5・Opus 5=3・Sonnet 4.6=2・基準/下位=1。コスト比の切り上げ）。`reserveIfPremium`が選択モデルを読んで消費量を決める。表示: 生成枠→**生成クレジット**・画像枠→**画像クレジット**（利用枠カード・バナー・80%/100%通知・LP・プラン表）。モデル選択肢に「Nクレジット/回」を表示。
- **黒字計算**: フラッグシップ基準ではフル利用時の原価上限≒$21.5（¥3,440）で現行¥2,980を超過。**生成200は¥5,980への改定とセットが必要**。数値と価格の組は**D-30**（案A: 200+¥5,980／案B: 60+現価格／案C: 現状維持+実測監視・当面の推奨）。
- **検証**: 単体2027件（倍数計算・伝播・可変reserve/refund・ちょうど埋まる境界）・DB統合・実ブラウザ。docs4本更新（PRD v1.17=原価試算をフラッグシップ基準へ・要件03 v1.23・要件02 v1.37）。
- メモ: 運営者の指示（2026-08-15）。倍数消費により**モデル選択が運営原価上限を動かさない**（クレジット総量×基準単価が上限のまま）。

### T-M8-107: 「AI用途」を「AIモデル設定」にし、プロバイダに加えてモデルも選択できるようにする `done`
- 参照: 要件02 §4.1（ai_purpose_config）・要件06（設定タブ）・プロンプト設計書 §5（provider解決）・`src/lib/ai/resolve-provider.ts` / 依存: T-M8-104 / サイズ: M
- 完了条件:
  - タブ名・画面文言が「AIモデル設定」になる
  - 文章生成・画像生成それぞれで、プロバイダに加えてモデルを選択できる（選択肢は公式ドキュメントで確認した代表的なモデル 各プロバイダ5つ程度・最上位モデルを含む）
  - 選択したモデルが実際の生成（GEN/LRN/SUGGEST/MD-MERGE・画像）で使われる。未選択・無効値は従来どおりenv既定へフォールバック
  - premiumは文章プロバイダ固定（運営Claude）のままモデルだけ選択できる。画像は従来どおりプロバイダ＋モデル
  - 原価台帳の推定単価が**モデル別**になる（provider一律だとOpus系とHaiku系で実費が10倍ずれる・原則4）
- **やったこと**: モデルカタログ`src/lib/ai/model-catalog.ts`新設（text: Anthropic/OpenAI/Google各5・image: 各3。最上位=Claude Fable 5/GPT-5.6 Sol/Gemini 3.7 Flash/GPT Image 2/Nano Banana Proを含む・単価の目安付き）。`ai_purpose_config`へ`text_model`/`image_model`（保存時カタログ照合・provider外れでモデルも外す）。解決（resolve-provider）は選択優先→env既定フォールバック（カタログ外の未知IDを実APIへ送らない）。premiumは文章provider固定のままモデル選択可。**推定原価をモデル別単価（pricing.ts MODEL_RATES・公式価格）に**——provider一律だとFable 5とHaiku 4.5で10倍ずれる（原則4）。UIは各用途にモデルselect（「おまかせ（運営の既定モデル）」既定・provider変更でリセット）。
- **検証**: 単体2019件・DB統合（store保存/剥がし・resolve選択/フォールバック）・**カタログ全21モデルIDを実APIのメタデータエンドポイントで実在確認（無料）**・check:providers緑・**実物1周**: @ai_newinfoにFable 5を設定→smoke:live（生成+画像+ニュース $0.49）→台帳に`claude-fable-5`と正しいモデル別原価（Web検索付き生成$0.33）を確認→設定を戻した。実ブラウザ（タブ名・5択+おまかせ・保存がDBへ）。docs4本更新（PRD v1.16・要件02 v1.36・要件06 v1.79・プロンプト設計書 v1.23）。
- **注意**: premiumのモデル選択は**運営実費に直結**（Fable 5はSonnet 5の約5倍）。月間利用枠（生成100回）は回数制のため、全員がFable 5を選ぶと理論上限が上がる。実測は台帳・doctorで見える。
- メモ: 運営者の指示（2026-08-15）。モデルID・単価は公式docs（platform.claude.com / developers.openai.com / ai.google.dev）で確認済み。

### T-M8-102: 「発信設定」を「アカウント設定」、「ベースmd/ベース.md」を「アカウント.md」へ改名する `done`
- 参照: 要件06 §3.6/§9（SC-10）・PRD L-5/P系・LP（src/app/page.tsx・plans・pricing） / 依存: なし / サイズ: M
- 完了条件:
  - 利用者に見える全文言（タブ名・見出し・説明・トースト・通知・LP・プラン表）で「発信設定」→「アカウント設定」、「ベースmd」「ベース.md」→「アカウント.md」になる
  - コード識別子（base_md等）・DBカラム・プロンプト内部タグ（<base_md>）は変えない（要件06 §1.0の方針と同じ）
  - E2Eの文言主張が追随して緑
- **やったこと**: src/e2e 36ファイル・docs 71行を置換。**除外**: コード識別子・DBカラム・タブslug・プロンプト本文（SYS-GEN/PT-MD-MERGE内の「ベースmd」・`<base_md>`。変えると全パターン再検証が必要＝「分野:」と同じ理屈）・docs変更履歴行。ヘッダー右上の既存ボタン「アカウント設定」は「設定」へ改名（新タブ名との衝突回避・統合後の名称と一致）。方針は要件06 §1.0に明記。
- **検証**: 単体2021件・E2E（ai-settings/home/generation 13件）緑。プロンプトスナップショット不変。
- メモ: 運営者の指示（2026-08-15）。

### T-M8-103: 「自分の過去投稿から学習」を廃止し、参考ソース追加をアカウント設定タブへ移す `done`
- 参照: PRD L系・要件04（learning_analysis）・プロンプト設計書 LRN（PT-L3）・要件06 §9 / 依存: T-M8-102 / サイズ: M
- 完了条件:
  - 学習ソースUIから「自分の過去投稿から学習」（取り込み/再取り込み・30日制御表示）が消える
  - own_posts の学習を起動する経路（action・enqueue・PT-L3・handler分岐）が削除され、既存の own_posts 行はDBから片付く（migration）
  - 参考ソース追加（参考アカウント/参考投稿）はアカウント設定タブの一番下に置かれ、従来どおり動く
  - 参考ソース（ref_account/ref_post・PT-L1/L2・MD-MERGE）は影響を受けない
- **やったこと**: own_posts一式を削除——UI（取り込み/再取り込み・30日表示）・`reimportOwnPosts`(action/コア/30日制御)・PT-L3・handler分岐・own_posts行（migration 20260815000003。enum値は残置）。廃止typeが残っていた場合は`invalid_source`で止める防御を追加。参考ソース（LearningSourcesManager）はアカウント設定タブの一番下へ移設し、**学習ソースタブ自体を廃止**（旧`?tab=learning`リンク・DB保存済み通知リンクは不正slug→先頭タブ丸めでアカウント設定に着地）。通知/ニュース画面のリンクは`?tab=persona`へ更新。
- **注意**: 過去にown_posts知見がアカウント.mdセクション5へ反映済みの場合、その文章は次のMD-MERGE（参考ソース追加/削除時）まで残る（migrationコメントに明記）。
- **検証**: 単体2014件・E2E（ai-settings 5件＋実ブラウザで配置/旧リンク着地/廃止UI不在）緑。docs5本更新（PRD v1.13・要件04 v1.32・要件05 v1.34・要件06 v1.75・プロンプト設計書 v1.21）。
- メモ: 運営者の指示（2026-08-15）。投稿分析（毎朝の自動実行）が自分の投稿の分析を担うため重複機能になった。

### T-M8-104: 設定とAI設定を1つの「設定」に統合する `done`
- 参照: 要件06 §3（SC-08）・§9（SC-10）・要件05（該当action） / 依存: T-M8-102, T-M8-103 / サイズ: L
- 完了条件:
  - /app/settings のタブが「設定（Xアカウント＋APIキー＋通知）／課金・プラン／アカウント設定／AI用途／プロンプト（アカウント.md＋投稿作成プロンプト＋画像生成プロンプト）」になる
  - 問い合わせタブと問い合わせ先の表示が消える
  - 旧タブslug（x-accounts等）と /app/ai-settings?tab=... は新タブへ**エイリアス/リダイレクト**され、DB保存済みの通知リンクや外部ブックマークが壊れない
  - ナビから「AI設定」が消え、全リンク元（約40箇所）とE2Eが追随して緑
  - /ui-polish（3幅・主要状態・実ブラウザ）
- **やったこと**: /app/settings をタブ5つ（general設定＝Xアカウント＋APIキー＋通知／billing課金・プラン／accountアカウント設定＋参考ソース／purposes AI用途／promptsプロンプト=`?sec=`でアカウント.md・投稿作成・画像生成）へ統合。AI設定の部品5つを settings/ へ移動。/app/ai-settings はリダイレクト専用に（旧タブ→新タブ対応表）。旧slugは `normalizeSettingsTab` のエイリアス（supportは契約切れガードとの整合でbillingへ）。問い合わせタブ・error.tsxの問い合わせ文言を削除（**決済保留時の連絡先案内は行き止まり防止のため残した**）。ナビからAI設定を削除（6項目）・未使用アイコン削除。tabs.test は新slug＋エイリアス＋`sec=`検査へ。
- **検証**: 単体2013件・E2E（x-oauth10・ai-settings5・suggestions3・plans4・settings-account1・mobile-layout）緑・実ブラウザ（5タブ構成・generalの3領域・プロンプト区分・旧URL/旧slug着地・3幅崩れ0・コンソールエラー0）。
- メモ: 運営者の指示（2026-08-15）。通知テーブルに旧URLが保存済みのためエイリアスは必須。

### T-M8-105: 投稿作成の「生成に使うプロンプト」でアカウント.mdを一番左のタブにする `done`
- 参照: 要件06 §4.2 / 依存: T-M8-102 / サイズ: S
- 完了条件: タブ順が「アカウント.md → 投稿の型 → 画像生成」になり、既定選択もアカウント.mdになる。E2E（3タブ切替）が追随して緑
- **やったこと**: タブ配列と既定stateを変更。E2Eはタブ順の明示的な主張（toHaveText）を追加。要件06 §4.2更新。
- メモ: 運営者の指示（2026-08-15）。

### T-M8-106: 投稿分析を「アカウント.md編集提案＋投稿作成プロンプト編集提案」の2本立てにする `done`
- 参照: プロンプト設計書 §6.15（PT-SUGGEST）・要件02 §4.11・要件06 §8（SC-09） / 依存: T-M8-102 / サイズ: L
- 完了条件:
  - PT-SUGGESTが現行アカウント.md（x_accounts.base_md）も入力に取り、adviceに (a)アカウント.mdの編集提案（そのまま貼れる全文・5,000字以内=保存上限） (b)推奨の型の投稿作成プロンプト（従来どおり8,000字以内）の2つを返す
  - zod検証・evidence保存形（format=3等）・レポートUI（2つのコピー導線と保存先リンク）・旧formatの縮退表示が揃う
  - 実アカウントで1周し、両提案の品質を確認する
- **やったこと**: PT-SUGGESTへ`{{account_md}}`（現行`x_accounts.base_md`・未作成なら"none"）を追加し、advice.account_md（全文改訂案＋reason）を出力。**zodで保存時と同じ検証**（`validateManualBaseMd`＝## 1.〜## 6.構造＋5,000字）を通す——貼った先で保存できない構造を許さない。evidenceはformat=2のまま追加フィールド（旧レポート互換・account_mdはnullish）。UIは「アカウント.mdへの編集提案」（理由＋全文＋コピー＋設定＞プロンプト＞アカウント.mdリンク）と「投稿作成プロンプト」の2ブロック。
- **検証**: 単体・DB統合（<account_md>がプロンプトへ入る/提案がevidenceへ/未作成でnone）・E2E3件・check:suggest（md無し=null提案パス実Claude）・**実アカウント1周**（@ai_newinfo・現行md309字→空だったセクション2/5へ観察された強みを反映した全文改訂案・6見出し構造維持・$0.14）。docs4本更新（PRD v1.15・要件02 v1.35・要件06 v1.78・プロンプト設計書 v1.22）。
- メモ: 運営者の指示（2026-08-15）。standardにはどちらの全文も出さない（貼り先が無い）現行方針を踏襲。

### T-M8-100: テーマの選択肢を最新ニュース画面の運用分野と一致させる（投稿作成・分析レポート） `done`
- 参照: 要件02 §4.4/§6（テーマ・news_category）・要件06（SC-04投稿作成・ニュース画面）・プロンプト設計書 §6.15（{{themes}}）・`src/lib/themes.ts`・`src/lib/post/post-theme.ts` / 依存: なし / サイズ: M
- 完了条件:
  - 投稿作成画面のテーマ選択肢が、最新ニュース画面のテーマ（運用分野 `NEWS_FETCH_CATEGORIES` 由来＝現在 AI・投資・SNS運用）＋「その他」になる（運用分野を変えれば選択肢も追随する単一の導出元）
  - 投稿分析レポートの推奨テーマ（PT-SUGGESTの選択肢とzod）も同じ運用分野に限定される
  - 保存済みの旧テーマ値（web3・business・business_ops）を持つ下書き・スケジュール・過去レポートは従来どおり表示できる（語彙は残し、選択肢だけ絞る）
  - スケジュール等、テーマを選択できる他画面があれば同じ選択肢になる
- **やったこと**: `themes.ts`に`OPERATED_THEME_OPTIONS/IDS`（`NEWS_FETCH_CATEGORIES`由来＝ニュース画面と同じ導出元）を新設。投稿作成・スケジュールのselectは`selectablePostThemeOptions()`（運用テーマ＋その他。編集中の運用外テーマは「（現在の設定）」として残し、開いただけで値が変わらない）。PT-SUGGESTの`{{themes}}`とzodも運用テーマへ限定。**語彙（`POST_THEME_IDS`・DB CHECK・表示ラベル）は変えない**——旧値の既存データは表示・編集できる。発信設定L-5の6テーマはPRD §8.3の決定どおり維持。
- **検証**: 単体2021件（post-theme導出・保全ヘルパ6件追加）・実ブラウザE2E（両画面の選択肢・運用外テーマ枠の保全・3幅崩れなし・コンソールエラー0）・既存E2E15件緑。docs4本更新（PRD v1.11・要件02 v1.33・要件06 v1.73・プロンプト設計書 v1.19）。要件02 §4.2と要件06 §3.4のnews_config既定「6分野」の同期漏れ（T-M7-55時）も修正。
- **やったこと**: 入力並びを「テーマ → パターン → プロンプト → 参考URL → 自分の考え(p2) → 追加指示 → 画像 → 生成ボタン」へ。要件06 §4.2に並びを明記（T-M8-100と同コミットでdocs更新済み）。
- **検証**: 実ブラウザでDOM座標の前後関係を確認（テーマ<パターン）・3幅スクショ崩れなし・generation/schedule/mobile-layout E2E緑。
- メモ: 運営者の指示（2026-08-15）。ニュース画面は記事が来ない分野を出さない（T-M7-55）ため運用3分野のみ表示しており、投稿作成の6テーマ＋その他と食い違って見えていた。「その他」は2026-08-03の運営者決定（選択必須の逃げ道）のため残す。

### T-M8-101: 投稿作成画面でテーマを一番上に、その下にパターンを置く `done`
- 参照: 要件06（SC-04投稿作成） / 依存: なし / サイズ: S
- 完了条件:
  - 投稿作成画面のセクション並びが「テーマ → パターン → （以降は従来どおり）」になる
  - E2E・UI検証（/ui-polish）が並び変更後も緑
- メモ: 運営者の指示（2026-08-15）。

### T-M8-98: 投稿分析の質を上げ、前回のレポートを参照して分析する `done`
- 参照: プロンプト設計書 §6.15（PT-SUGGEST）・要件02 §4.11（evidence）・要件04 §12 / 依存: なし / サイズ: M
- 完了条件:
  - 分析時に同アカウントの直前のレポート（format=2）の総評・推奨・プロンプトがLLMへ渡り、前回の提案の効果検証（前回以降の投稿の反応）と「何を残し何を変えたか」が読み取れる形で出力される
  - 前回レポートが無い初回でも従来どおり動く
  - evidence に参照した前回レポートのid（無ければnull）が残る
  - 分析品質の底上げ: 本文をより長く渡す・率（反応÷表示）も見る・一般論の禁止強化・プロンプト全文の要件具体化
  - 実アカウントで1周し、前回参照が実際に機能したレポートを確認する
- **やったこと**: ①`loadPreviousSuggestion`（format=2の直前レポート）を読み `<previous>`（created_at_jst・new_posts_since_previous・summary・advice）としてPT-SUGGESTへ。evidenceへ`previous_id`を記録。②品質強化: 本文200→300字・反応率（表示に対するいいね等）の考慮・一般論の禁止明文化・プロンプト全文の要件具体化（構成／書き出しの型／語り口・分量／避ける表現・1200〜3000字）。③**前回以降の新規投稿数はコードで数えて渡す**——LLMに日付比較をさせると新規投稿が無いのに「大量に追加された」と誤認する（実アカウントで2回連続観測。数値で渡したら正しく「前回以降の新規投稿は無く、効果検証は次回」と書いた）。
- **検証**: 単体2016件・DB統合（前回参照がsystemへ入る/previous_id/初回null）・check:suggest（初回パス実Claude）・実アカウント2周（前回参照パス・チェーン確認）・release:check緑。実費 AI約$0.23（2周）＋X$0（増分0件）。
- メモ: 運営者の指示（2026-08-15）。「質を向上させたい」「一つ前の分析結果やプロンプト提案も参照するように」。出力スキーマ（zod）は変えない（UI互換）。

### T-M8-99: フォロワー数の推移が記録されない原因を特定し、ローカルの空を説明できるようにする `done`
- 参照: 要件04 §6/§13（follower_snapshot）・`docs/operations/local-development.md` / 依存: なし / サイズ: S
- 完了条件:
  - 原因が特定され、運営者に説明されている
  - ローカルで今日のフォロワー数が1点記録され、投稿分析画面のグラフに表示される
  - local-development.md に「ローカルでは定時トリガーが動かない」ことと手動起動コマンドが明記されている
  - ローカル開発中の定時トリガー自走は要決定（D-29）として起票されている
- **実施（2026-08-15）**: ローカルで follower-snapshot を1回実行し @ai_newinfo の今日の点（42人）を記録（グラフに表示される）。local-development.md §5.4 に定時トリガーの手動起動を明記。自走化は D-29 へ。
- メモ: 運営者の質問（2026-08-15）。調査結果: コードの不具合ではない。フォロワー記録は毎時cron `/api/cron/follower-snapshot`（Vercel Cron設定済み・本番のみ）が行うが、ローカルには定時トリガーが無く `cron_runs` に実行履歴ゼロ＝一度も走っていない。さらに8/3〜8/15はXトークン失効（T-M8-96）でどのみちスキップされる状態だった。X APIは過去のフォロワー数を提供しないため、記録開始日より前の推移は遡れない。

### T-M8-97: 投稿分析の取得を「初回は直近30日」から「最新100件」にする `done`
- 参照: PRD v1.9（K-2）・要件04 v1.30（§12）・要件02 v1.31（§3.20）・プロンプト設計書 v1.17（§6.15）・要件06 v1.72（SC-09空状態） / 依存: なし / サイズ: M
- **発端**: 運営者の指示（2026-08-15）。@ai_newinfoが直近30日に投稿0件で、実行しても仕様どおり「レポートなし」になったこと。
- **やったこと**: `timelineFetchStart`を「初回=`start_time`なし（期間で区切らず最新`TIMELINE_FETCH_MAX`件）／2回目以降=保存済み最新-48h（30日の足切りも廃止）」へ。`TIMELINE_BACKFILL_DAYS`削除。PT-SUGGESTへ「impressionsがnull=不明（0ではない。Xは30日超の投稿に表示回数を提供しないため）。likes等で判断」を明記（スナップショット更新）。空状態文言を「Xに投稿が1件も無い場合は作られません」へ。X読取費用の上限は従来どおり100件=$0.50/回。
- **実挙動の確認（X公式docsに明記が無かった点）**: 30日超の投稿を含む`non_public_metrics`要求は**リクエスト失敗にならない**。それどころか60日超の投稿にもimpressionsが返る場合がある（@ai_newinfoで実測。100件中16件に値・残りはnull）。null許容設計はそのまま保険として維持。フォールバック実装は不要だった。
- **実アカウント検証**: @ai_newinfoで本物を1周——最新100件（2026-04-05〜06-08）取得・保存→実Claude分析→レポート保存まで成功。実費 X読取$0.52（103リソース）＋AI$0.096。レポートはローカルの投稿分析画面で閲覧可能。
- **後続への注意**: ページングの端数で読取が上限を数件超えることがある（100件目標で103リソース＝$0.515。上限は「概ね$0.50」）。初回のAI費用は投稿数に比例（100件で$0.096。以後は増分のみで$0.02〜）。

### T-M8-91: 分析・改善を刷新する（Xタイムライン全投稿×自由分析×実行可能なアドバイス） `done`
- 参照: PRD §5.6 K-2（v1.7）・プロンプト設計書 §6.15（v1.15）・要件04 §12（v1.27）・要件02 §4.11（v1.28）・要件06 §8（v1.70） / 依存: なし / サイズ: L
- **発端**: 運営者の要望（2026-08-15）。「Exos AIで作成したものかに依らず過去30日間の投稿を分析し、良かった投稿の特徴を簡潔・具体的・効果的に提示。評価軸は固定しない。パターン・テーマ・画像有無・プロンプトをどうすればよいかの明確なアドバイスを返す。プロンプトはそのままAI設定に入れられる形。1日1回でコストコントロール」。
- **やったこと**:
  1. **データ源を差し替え**: 保存済みcheckpoint実績 → `GET /2/users/:id/tweets`（直近30日・リポスト/返信除く・メトリクス付き・**最大100件**）。本サービス経由の投稿は`drafts.tweet_ids`突合で型/テーマを付与、外部投稿はnull。
  2. **PT-SUGGESTを全面書き換え**: 固定軸・「3投稿以上/差20%」廃止。出力は summary＋good_posts（1〜3件・`<posts>`内IDのみ）＋advice{pattern(p1-p4/p6)・theme(6分野のみ)・image・prompt(kind=pattern・≦8,000字)}をzodで固定。
  3. **ゲート変更**: `no_new_metrics`廃止（外部投稿のみのアカウントが永久に実行できなくなるため）。`already_today`（1日1回）は維持＝X読取・AI費用の上限を兼ねる。X取得失敗は`x_fetch_failed`で保存・通知。
  4. **X読取単価の導入**（前提の誤り修正）: 要件04は「読取は課金されない」としていたが、現行pay-per-usageは**応答1件ごとに$0.005（ポスト）/$0.010（ユーザー）課金**。`X_COST_POST_READ_USD`/`X_COST_USER_READ_USD`を導入し`read-client`全読取（metrics_collector・学習・follower・改善提案）の台帳記録へ配線。**既存の読取が台帳に0円で載っていた穴（原則4）も同時に塞がった**。
  5. **UI刷新**: 総評／良かった投稿（リンク＋理由）／設定アドバイス3枚（画面表記）／プロンプト全文＋コピー＋AI設定リンク。standardには全文を出さず案内のみ（貼り先がmd+のため）。旧形式evidenceは縮退表示。
- **コスト（運営者の質問への回答）**: 1回=X読取 最大$0.50（実際は件数比例）＋AI $0.01〜0.05。1日1回×毎日でも最大$15/月/アカウント、典型$1〜3。取得上限は**未回答のため推奨の100件で実装**（`SUGGEST_TIMELINE_MAX`1定数で変更可）。台帳とdoctorの「今月かかった費用」に実測が載る。
- **検証**: 単体（suggestion-input 11件・gen-prompts 14件・pricing/read-client）・DB統合（suggestion 7件・suggestion-jobs・analytics）・E2E（suggestions 2件）・UI実描画390/1280px横あふれ0。
- **後続への注意**: `SUGGEST_TIMELINE_MAX`を変えるとX費用上限が変わる（テストが100を固定）。p5をfeature flagで有効化したらPT-SUGGESTの選択肢とスキーマ（`SUGGESTABLE_PATTERNS`）へ追加が要る。旧形式の提案行は次の実行で置き換わるまで縮退表示。

### T-M8-96: 失効したX連携が「連携済み」のまま表示され続ける不具合を直す `done`
- 参照: 要件02 §通知（v1.29）・要件05 §OAuth（v1.33）・`src/lib/x/token-refresh.ts` / 依存: なし / サイズ: S
- **発端**: 実利用で発見（2026-08-15）。運営者のローカル環境で、8/3に失効したXトークンの
  アカウント2件が**画面では「連携済み（active）」のまま**で、refreshは`400 invalid_request`で
  失敗し続けていた。運営者は「現在すでに接続されています」と認識——画面が実態と食い違っていた（原則1）。
- **原因**: 要再連携（`status='expired'`）への遷移条件が`invalid_grant`だけだった。**Xは失効・
  ローテート済みrefresh tokenに`invalid_request`を返すことがある**（実アカウント2件で確認）。
  このケースは一時エラー扱いのままleaseを解除して戻るため、statusが変わらず、
  (a)画面が連携済みのまま (b)毎朝の投稿分析が失敗通知を出し続ける、の両方が起きる。
- **修正**: token endpointの**4xx全般**を要再連携へ（`invalid_grant`→従来どおり、それ以外の4xxは
  `reason='invalid_request'`）。network/5xxは従来どおり一時エラー。再連携通知の発火条件も同じ。
- **検証**: 単体（400 invalid_request → expired遷移＋onExpired発火）。実アカウント2件で
  refresh試行→両方`expired`へ遷移し、設定画面が「要再連携」を表示することを確認。

### T-M8-95: 分析の登録導線と設定画面のメールアドレス表示を追加する `done`
- 参照: 要件06 v1.71（§1.2 SC-11・§10 空状態） / 依存: T-M8-94 / サイズ: S
- **発端**: 運営者の指示（2026-08-15）。①BYOKでX/AIキー未登録なら登録導線へ誘導 ②設定画面でメールアドレスを確認できるように。
- **やったこと**:
  1. **分析レポートの空状態に登録導線**: BYOKでvalidなAIキーが無い場合、毎朝の分析jobはそもそも作られない（起票ゲート）。「待っていれば出る」ように見せず「分析にはAIのAPIキーが必要です」＋設定＞APIキーへのリンクを出す（原則1）。あわせて起票ゲートのキー判定を **AIキーに限定**（`provider <> 'x'`）——Xキーだけ登録した利用者を対象にするとprovider解決で毎朝失敗し続けるため。
  2. **設定＞課金タブの先頭に「ログイン中のアカウント: {email}」**を表示（確認メール・領収書の宛先の確認手段を兼ねる）。
- **確認した事実（コード変更なし）**: X読取のクレデンシャルは既に指示どおり——`x_accounts.auth_type` で解決し、premium=`managed`（運営App＝運営の課金）、standard/md=`byok`（利用者のX App資格情報 `user_api_keys provider='x'` ＝利用者の課金）。`token-refresh.ts` が正本。
- **検証**: E2E 2件（メール表示・AIキー未登録の導線）。suggestion-jobs.db.test はゲート限定後も6件緑。

### T-M8-94: 投稿分析を毎朝8:00の自動実行にし、増分取得・全投稿分析・DB整理・改名を行う `done`
- 参照: PRD v1.8（K-2/O-4/フロー4）・要件02 v1.29（§3.20 `x_timeline_posts`）・要件04 v1.28（§12）・要件05 v1.33（§9）・要件06 v1.71（SC-09）・プロンプト設計書 v1.16 / 依存: T-M8-91 / サイズ: L
- **発端**: 運営者の指示（2026-08-15）。①「分析・改善」「改善提案」の改名とUI整理（投稿分析を上・フォロワー推移を下）②100件超の扱いの明確化 ③2回目以降は追加分だけ取得 ④手動ではなく毎朝8:00に自動取得・分析（取得は増分・分析は過去の全投稿）⑤DB構成のブラッシュアップと未使用カラムの削除 ⑥機能テスト。
- **やったこと**:
  1. **自動化**: 手動の`refreshSuggestions`（action・パネルのボタン・ポーリング・拒否文言）を削除。`scheduler_tick`に`enqueueDailySuggestions`を追加——JST8時以降のtickで対象アカウント（active・契約有効・BYOKはvalidキーあり）ぶんを`trigger='schedule'`・request_key `sug-daily:{xid}:{JST日付}`で冪等作成（日次サマリと同じゲートの形）。dispatchは既存のtickフェーズが拾う。
  2. **増分取得＋保存**: 新テーブル`x_timeline_posts`（unique(x_account_id,tweet_id)・RLS所有者select/write server only・GRANT service_role）。取得窓は保存済み最新投稿の**48時間前**から（`suggestion-timeline.ts`）——重なり分をupsertでメトリクス追い直し（無いと直近投稿の実績が取得した朝の値で凍結される）。初回30日・1回最大100件。型/テーマはdrafts突合で付与し**一度付いたら保持**（coalesce）。
  3. **全投稿分析**: 分析対象を保存済み全投稿（新しい順に最大300件=`SUGGEST_ANALYZE_MAX`・AI入力上限）へ。evidenceは`post_count`/`analyze_limit`に変更。**premiumの生成枠消費を廃止**（自動実行で利用者の操作なしに枠が減るため。PRD O-4）。
  4. **DB整理**: 全19テーブル×全カラムの使用状況を監査。**完全に死んでいた2列だけ削除**——`stripe_events.processed_at`（コード参照ゼロ）・`schedule_slots.last_run_at`（書き込み専用・冪等はschedule_run_keyが担う）。台帳系の書き込みのみ列は運営者がDBで直読する監査記録のため残す（監査結果はコミットに記録）。スキーマ↔要件02の一致は`schema-doc-sync.db.test.ts`が検査（新テーブルの節漏れ・削除列の文書残りを実際に検出→修正）。
  5. **改名・UI**: ナビ/h1/title「分析・改善」→**「投稿分析」**、パネル「改善提案」→**「分析レポート」**。並びを**レポート→投稿ごとの実績→フォロワー数の推移**へ。ボタン撤去（「毎朝8時ごろ自動で取得・分析します。操作は不要です」を明示）。通知文言・LP文言（「提案を更新」→毎朝レポート）も更新。
  6. **テスト**: 単体（timeline窓決定8件・gen-prompts14件）・DB統合（enqueue6件=JSTゲート/冪等/対象絞り込み・store4件=upsert/タグ保持/新しい順・suggestion11件）・E2E（表示2件）・**実AI 1周**（`npm run check:suggest`新設・現実的な12投稿→実Claude→zod検証→保存。実測$0.023/回・レポート品質良好）。
- **コスト**: 毎朝1アカウントあたり X読取$0.01〜0.05（増分）＋AI約$0.02 ≒ **$1〜2/月**。初回のみ+最大$0.50。
- **実アカウント実行（2026-08-15）**: matsubuz.10@gmail.com の @ai_newinfo で本物を1周し、2件の不具合を発見・修正。①投稿タグのSQLが存在しない列 `drafts.input` を参照（テーマの正しい在処は `generation_jobs.input`。実DBを通らない箇所だったためテスト緑のまま実行時に落ちた→`loadDraftTagRows`としてstoreへ移し実DB回帰テスト追加）②X読取の0件応答を最低1件分（$0.005）で台帳に過大計上（制約を`quantity >= 0`へ緩和し quantity=0・$0で正直に記録。migration 20260815000002）。実行結果自体は「@ai_newinfo は直近30日に投稿0件（最新2026-06-08）→LLMを呼ばずレポートなしで正常終了」で仕様どおり。
- **後続への注意**: `x_timeline_posts`は削除する仕組みが無く蓄積する（1投稿1行・text500字なので個人利用では年間でも数百KB。問題になったら40日cleanupと同じ枠組みへ）。`SUGGEST_ANALYZE_MAX`（300）を増やすとAI費用が比例して増える。旧形式evidenceの行は翌朝の自動実行で置き換わる。

### T-M8-93: 投稿作成画面のプロンプトにベースmdと画像プロンプトを加える `done`
- 参照: 要件05 §5（createGenerationJob）・要件06 §4.2・要件04 §9・プロンプト設計書 §4.1/§4.2 / 依存: T-M8-92 / サイズ: M
- **発端**: 運営者の要望（2026-08-15）。「投稿作成画面にはプロンプトとしてベース.mdや画像生成のプロンプトも加えてください」。
- **やったこと**: プロンプトセクションを3ブロックのタブ（投稿の型／ベースmd／画像生成）へ拡張。共通部品 `PromptBlock` に編集UI（この生成にだけ／保存・元に戻す・字数上限）を集約。
  - **ベースmd**: AI設定＞ベースmdと同じもの（≦5,000字）。保存は `updateBaseMdManualAction`（新version・履歴に残る・楽観ロック）。「この生成にだけ」は `base_md_override` として渡し、**保存版と同じ見出し検証を中核で通す**（通さないと画像のセクション3抽出が黙って空になる）。GENの`<base_md>`と画像のトーン抽出の両方に効く。未作成（発信設定未保存）なら導線を出す。
  - **画像生成**: PT-IMG（kind "image"・≦8,000字）。保存はAI設定と同じ上書き。「この生成にだけ」は `image_prompt_override` として渡し、**画像ONのとき `image_generation` 子jobのinputへ引き継ぐ**（子はPT-IMG解決と保存版base_mdを飛ばす）。手動の画像再生成へは引き継がない。
  - base_md_override 使用時はその回だけsystemが別バイト列になりプロンプトキャッシュが効かない（意図した挙動・プロンプト設計書 §4.1に明記）。
- **検証**: 単体（image-generation: overrideでprompt_templatesを読まない・トーンがoverride側から取れる）・DB統合（base_md_overrideがsystemへ入る・子jobのinputへ両overrideが引き継がれる）・E2E（3タブの切替・ベースmd表示・編集破棄）・UI実描画390/1280px横あふれ0。

### T-M8-92: 投稿作成画面でプロンプトを表示・編集できるようにする（standard非表示） `done`
- 参照: 要件05 §5（v1.32）・要件06 §4.2（v1.70） / 依存: T-M8-91 / サイズ: M
- **発端**: 運営者の要望（2026-08-15）。「投稿作成画面ではプロンプトが表示・編集できるように（ただしスタンダードは表示されない）」「1回だけか保存するかを選択できる」。
- **やったこと**: パターン選択の下に折りたたみで選択中の型の解決済みプロンプトを表示（md/premiumのみ。standardはセクションごと非表示）。編集すると「**この生成にだけ使う**」（既定・`createGenerationJob`の新入力`prompt_override`≦8,000字として渡す。`post-generation`が通常解決を飛ばして使う。**保存しない**）か「**保存して以後の生成にも使う**」（`updatePromptTemplateAction`でAI設定と同じ上書きへ保存。楽観ロック・競合時は再読み込み案内。保存後はoverrideを送らない）を選べる。型切替と「元に戻す」で編集破棄。超過中は生成ボタン無効＋理由表示。
- **仕様判断**: 「この生成にだけ」は**再生成へ引き継がない**（`regenerateDraft`は新しいinputを組む。要件05に明記）。
- **検証**: DB統合（`prompt_override`が`<pattern>`へ入り既定テンプレが使われない・**prompt_templatesに行が増えない**）・E2E 2件（premium表示/編集/型切替破棄・standard非表示）・UI実描画。

### T-M8-90: Supabase Auth のURL設定の食い違いを検出できるようにする `done`
- 参照: `src/lib/ops/captcha-status.ts`（同じ動機の先例）・`scripts/doctor.mjs` / 依存: なし / サイズ: M
- **発端**: 2026-08-14、本番で会員登録すると**確認メールのリンクが localhost を指していた**（運営者が発見）。
  アプリは正しく `https://exosai.net/auth/confirm` を渡していたが、Supabaseは許可リストに無いリダイレクト先を
  無視して Site URL（既定の localhost）へ差し替えるため。**登録の最後の一歩が踏めない**＝実質使えない。
- **なぜ検出できなかったか**: 相手側（Supabase）の設定はコードに現れない。しかも
  **Supabaseはこれをエラーにしない**（黙って差し替える）ので、`signUp` の応答は成功で返る。
  公開エンドポイント `GET /auth/v1/settings` は `external`・`disable_signup`・`mailer_autoconfirm` 等を返すが
  **`site_url` を含まない**（2026-08-14 実測）ため、`captcha-status.ts` のような無認証の探査は成立しない。
- **これで3件目**: staging のTurnstile許可ドメイン未登録（2026-08-01・T-M7-48）→ `check:turnstile` を作った。
  本番のCAPTCHA無効（2026-08-14）→ `captcha-status.ts` が検出した。今回のSite URL → **検出手段が無い**。
- **やること（案）**: Supabase Management API（`GET /v1/projects/{ref}/config/auth`）で `site_url` と
  `uri_allow_list` を読み、`APP_BASE_URL` と一致するかを `doctor` の1項目にする。
  **トークンが無い環境では「確認できません」で出す**（`PRODUCTION_CRON_SECRET` が無いときと同じ振る舞い。
  黙って✅にしない）。トークンは `SUPABASE_ACCESS_TOKEN`（`.env.local`）から読む。
- **判断（2026-08-15・運営者）**: **トークンを手元に置く形でよい**。したがって Management API 案を採った。
- **実装結果**: `src/lib/ops/auth-url-status.ts`（純粋関数・importは型のみ）に判定を置き、`scripts/doctor.mjs` が
  Management API（`GET /v1/projects/{ref}/config/auth`）から `site_url` と `uri_allow_list` を読んで渡す。
  プロジェクトrefは**反映先のCSPヘッダ**から取る（`projectRefFromCsp`。`release:*` のゲートと同じ手なので、
  別環境を見に行く取り違えが起きない）。判定は3段——確認URLが許可リストに無ければ **error**（メールが
  Site URL へ差し替わる＝登録が完了できない）、許可はされているが Site URL のオリジンが違えば **warn**
  （行き先を明示しない経路が別の場所へ向く）、両方合っていれば ok。
  **`SUPABASE_ACCESS_TOKEN` が無い環境では「確認できません」の warn** にする（✅にしない・原則1）。
  **ローカル宛では実行しない**——`supabase/config.toml` がリポジトリにあり設定はコードから読めるので、
  この層の問題（コードに現れない設定）が起きない。
- **テスト（25件）**: 2026-08-14 の本番の状態（Site URL=localhost・許可リストもlocalhostのみ）をfixtureにした。
  ワイルドカードは緩く判定しないことを個別に固定する（`*` はパス区切りを越えない・ドットをワイルドカードに
  しない・部分一致で許さない・スキームの違いを見分ける）。**緩い判定はこの検査を無意味にする**ため。
  `uri_allow_list` はカンマ区切りの1本の文字列で返るので、空文字を要素として数えないことも固定した。
- **後続への注意**: `confirmRedirectUrl()` は `app/actions/auth.ts` の `confirmationRedirectUrl()` と
  **同じ組み立てにしておくこと**。片方だけ変えると、実際に渡す値ではないURLを検査することになる。

### T-M8-89: AI設定の「アップグレード」が押しても何も起きない導線だった `done`
- 参照: 要件06 §ロック状態のCTA・`src/app/app/ai-settings/page.tsx` / 依存: なし / サイズ: S
- **発端**: 運営者の指摘。「mdプランにアップグレード（¥1,000/月）」ではなく「プランをアップグレード」にし、
  遷移先を適切なStripeのプラン選択ページにしてほしい。
- **調べて分かったこと（指摘より重い）**: CTAは `/plans` へのリンクだったが、**`/plans` は契約が有効で
  Stripe顧客が紐づいた利用者を `/app` へ送り返す**（T-M8-54 の判定）。つまり standard プランの契約者が
  押すとホームへ戻るだけで**何も起きない**。文言だけの問題ではなく行き止まりだった。
- **なぜE2Eで見えなかったか**: `ai-settings.spec.ts` はこの導線を検証しており `href="/plans"` まで
  assertしていたが、**fixture（`e2e/fixtures/account.ts`）が `stripe_customer_id` をNULLのままにする**ため
  `/plans` の送り返しが起きなかった。実際の契約者は必ず顧客が紐づいているので、**テストが再現できない
  状態でだけ不具合が出る**形になっていた。「行き先をassertしている」ことが安心の根拠にならない例。
- **やったこと**:
  1. `UpgradePlanButton`（`src/components/billing/upgrade-plan-button.tsx`）を追加。契約者は
     **Stripe Customer Portal のプラン選択画面**（`intent="update"`。設定＞課金の「プランを変更」と同じ経路）へ
     直接入る。Portalセッションはサーバーで作るため `href` を先に決められず、リンクではなくボタンにした。
     失敗時はトーストで理由を出す（黙って何も起きないボタンにしない）。
  2. Stripe顧客が未紐づけのあいだ（webhook到着待ち等）だけ `/plans` へ送る。この状態では Portal を作れず、
     `/plans` 側も送り返さない（T-M8-54 で例外にしてある）。`PortalButton` と同じ判定。
  3. `LockedState` に `action?: ReactNode` を追加し、主操作の見た目を `stateActionClassName` として
     リンクとボタンで共有した（別々に書くと片方だけ直したときに同じ位置の操作が違う見え方になる）。
  4. **E2Eを実利用者の状態で検証する形に直した**——テスト内で `stripe_customer_id` を入れ、
     ボタンであること／アップグレードのリンクが存在しないことをassertする。`/plans` へのリンクに
     戻したら落ちる。
- **後続への注意**: この導線が実際に機能するには **Stripe側のカスタマーポータル設定が必要**
  （`npm run stripe:portal:setup -- --target production`）。2026-08-14 時点で本番は未設定で、
  `npm run doctor -- --base https://exosai.net` が「プランを変更: 押すと失敗します」と出している（P-1）。
  **コードを直しても相手側の設定が済むまで動かない**。
  fixtureが `stripe_customer_id` をNULLにしているのは T-M8-54 のテスト（顧客未紐づけでも進める行き先がある）
  が依存しているため。必要なテストの中で個別に入れる。

### T-M8-88: 本番の定時実行（Vercel Cron）を有効にする `done`
- 参照: 要件04 §6（定時トリガー4本）・[launchd→Vercel Cron](../docs/operations/launchd-to-vercel-cron.md) §3〜§5 / 依存: なし / サイズ: S
- **発端**: 2026-08-14 の本番反映後、`npm run doctor -- --base https://exosai.net` が「定時実行: まだ一度も動いていません」を出した。
- **事実**: `vercel.json` が無く Vercel Cron は未設定。`ops/launchd/` の4本は `http://127.0.0.1` 向けで `launchctl` にも未登録。
  **本番では予約投稿・通知メール・ニュース取得・実績収集・日次サマリが1つも動かない**（アプリ自体は応答している）。
- **移行条件は満たされている**: 同ドキュメント §3 の「外部ユーザーへ安定提供を開始し、個人Macを単一障害点にできなくなった」。
- **やること**: §4 の手順どおり `vercel.json` へ4 scheduleを追加して production へデプロイし、Dashboard で4本の登録を確認、
  手動HTTP呼び出しで2xxと `cron_runs` の受付・処理結果まで見る。**cron/job を触るので `/verify-integration` ＋
  該当cronを実際に1回叩いて結果の中身（保存件数・失敗分野）まで確認する**（CLAUDE.md 変更影響表）。
  ```json
  { "crons": [
    { "path": "/api/cron/news-fetch",        "schedule": "0 1-11/2 * * *" },
    { "path": "/api/cron/scheduler-tick",    "schedule": "*/5 * * * *" },
    { "path": "/api/cron/metrics-collector", "schedule": "0 * * * *" },
    { "path": "/api/cron/follower-snapshot", "schedule": "10 * * * *" }
  ] }
  ```
- **着手前に確認すること（プラン依存）**: `*/5 * * * *` は **Vercel Hobby では使えない**（cronは1日1回・2本まで）。
  Pro なら分単位で40本まで。CLIからプランを読めなかったため Dashboard で確認する。Hobbyのままなら
  (a) Pro へ上げる (b) launchd を本番URL向けに設定して常時稼働Macで回す（§2・単一障害点が残る）のどちらかを選ぶ判断が要る。
- **注意**: `news-fetch` はAI費用が発生する（3分野×1日6回）。有効化した時点から課金が始まる。
  `/api/cron/canary` は cron へ登録しない（D-11・2026-07-28決定）。

- **実装結果（2026-08-14）**: 運営者の回答でVercelは既に **Pro** と確認できたので `*/5` をそのまま採用し、
  `vercel.json` に4本を登録した（要件04 §6 のUTC列どおり）。**schedule の一致を機械検査にした**
  ——`src/lib/ops/vercel-crons.test.ts` が (a)4本あること (b)各scheduleが要件04 §6 の表と一致すること
  (c)`news_fetch` のUTC→JST換算が10/12/14/16/18/20時になること (d)登録したpathのrouteが実在すること
  (e)カナリアを登録していないこと を検査する。**4種の意図的な破壊**（間隔を`*/15`へ・JSTのまま書く・
  1本消す・存在しないrouteを足す）で落ちることを確認した。定時実行は**止まってもアプリは200を返し
  画面に何も出ない**ので、正本との突き合わせを人の目に任せない。
- **後続への注意**: `ops/launchd/` の4本は移行前の構成として残してある（ロールバック先）。
  **launchdとVercel Cronを長期間併用しない**。`news_fetch` は有効化した時点からAI費用が出る（3分野×1日6回）。

## 要決定・外部準備(ユーザー作業)

開発はモック・dry_run・ローカルSupabaseで先行できるが、以下が済むまで該当タスクは実環境検証ができず `blocked` になり得る。

**D-32: プロンプトテンプレートページに「実ユーザーの作成物」を載せるか（起票 2026-08-21・T-M8-173）** — 運営者の要望は「ユーザー達が作成しているアカウント.md・投稿プロンプト・画像生成プロンプトの一覧」。現状DBに公開許諾の仕組みが無く、実ユーザーのプロンプト公開はプライバシーポリシー（利用目的）の範囲外。暫定実装は**アプリが実際に使うシステム既定テンプレートを正本から表示**。要決定: (案A)現状のシステム既定のみで運用（追加開発なし・**推奨**） / (案B)利用者が明示的に「公開する」を選んだテンプレートを載せる共有機能を作る（公開フラグ・審査・削除導線・規約改定が必要）。

**D-33: 招待報酬の振込先口座の保持方法（暫定決定 2026-08-21・T-M8-174）** — invite_cp.md は「機密情報は可能な限り外部Payout Providerで管理」とするが、Provider未契約。振込は運営者の手動振込のため全桁が必要。**暫定: 口座番号はAES-256-GCM（既存のAPIキーと同じ鍵運用）で暗号化してDBに保存し、画面は末尾4桁のみ表示（provider='internal'）**。要決定: このまま運用するか、Payout Provider（例: Stripe Connect等）を契約して移行するか。移行するまで運営者は復号コマンドで全桁を確認して振り込む。

**P-1（本番の未整備・2026-08-14 `npm run doctor -- --base https://exosai.net` で検出）** — 本番へ反映して初めて分かった、コードではなく**環境側の未整備**。doctorが挙げたものをそのまま残す（4件のうち3件が人の操作を要する）。

1. **定時実行が一度も動いていない（最重要）** — `vercel.json` が存在せず Vercel Cron が未設定。`ops/launchd/` の4本のplistは**ローカル（`http://127.0.0.1`）向け**で、`launchctl list` にも登録されていない。つまり**本番では予約投稿・通知メール・ニュース取得・実績収集・日次サマリが1つも動かない**。→ **2026-08-14 解決（T-M8-88）**。Vercelが Pro と確認できたため `vercel.json` に4本を登録した。[launchd→Vercel Cron](../docs/operations/launchd-to-vercel-cron.md) §3 の移行条件のうち「外部ユーザーへ安定提供を開始し、個人Macを単一障害点にできなくなった」が本番稼働で満たされた。→ **T-M8-88** で対応する。**要確認**: `*/5 * * * *`（5分間隔）は Vercel の Hobby プランでは使えない（cronは1日1回・2本まで）。Dashboard でプランを確認してから入れる。
2. ~~**人間確認（CAPTCHA）が本番Supabaseで無効**~~ → **2026-08-14 解決**（運営者が設定。`doctor` が「有効です」を返すことを確認）。以下は経緯 — 画面にはTurnstileの確認欄が出るが、**サーバー側が検証しないため素通りできる**。Supabase → 本番プロジェクト（`hvjizoahdqfvasiqzzkv`） → Authentication → Attack Protection → CAPTCHA を有効化し、Cloudflare の Secret Key を設定する。stagingで同じ設定漏れが2026-08-01に起きている（T-M7-48）。
3. ~~**Stripe カスタマーポータルの設定が本番に合っていない**~~ → **2026-08-14 解決**（運営者の了解を得て `npm run stripe:portal:setup -- --target production` を実行。`bpc_1TvFJXE811f4DP4qdNAIneA3` を `updated-in-place` で更新し、`doctor` が「プラン変更・解約のどちらも操作できます」を返すことを確認。`.env.local` へ `PRODUCTION_STRIPE_*` 5件を置いた）。以下は経緯 — 「プランを変更」のボタンは出るが押すと失敗する。`npm run stripe:portal:setup -- --target production` を実行する（外部サービスの設定を書き換えるため実行前に運営者の了解が要る。IDは変わらない）。手順は `docs/operations/deployment.md` §1.4。
4. Xアカウント未連携・定時実行の実績なしは、上記1と運営者の初回セットアップで解消する（doctorは⚠️で出す）。

4.5. ~~**Stripeアカウントが本番決済を有効化されていない**~~ → **2026-08-20 解決**（運営者）。T-M8-148 で検出した状態（`Your account cannot currently make live charges.`・`card_payments = inactive`）。**この状態はアプリからは何も見えない**——鍵は本番キー、Priceも金額も一致し、画面も正常に見えるのに「7日間無料で利用」を押すと必ず失敗した。検出手段は `src/lib/ops/stripe-account-status.ts`（`doctor` が見る）。

5. **確認メールのリンクが localhost へ飛ぶ**（人の操作・2026-08-14 運営者が発見） — 本番で会員登録すると、確認メールのリンクが `exosai.net` ではなく `localhost` を指す。**アプリ側は正しい**——`src/app/actions/auth.ts` の `confirmationRedirectUrl()` は `new URL("/auth/confirm", env.APP_BASE_URL)` で、本番の `APP_BASE_URL` は `https://exosai.net`。原因はSupabase側で、**許可リストに無いリダイレクト先はSupabaseが無視して Site URL へ差し替える**ため。本番プロジェクトの Site URL が既定の localhost のままだった。パスワード再設定メール（`auth.ts:181` の `redirectTo`）も同じ経路なので同時に直る。
   → 本番プロジェクト（`hvjizoahdqfvasiqzzkv`）→ Authentication → **URL Configuration** で **Site URL** を `https://exosai.net` にし、**Redirect URLs** へ `https://exosai.net/**` を追加する。
   **`supabase config push` を本番へ実行してはならない**——`supabase/config.toml` はローカル用で `site_url = "http://127.0.0.1:3000"`・`additional_redirect_urls` もlocalhostのみ。押すとこの不具合が再発する（CAPTCHAは `enabled = true` なので押し戻さないが、Site URLは戻る）。
   **これで「相手側の設定がコードに現れない」不具合は3件目**（2026-08-01 stagingのTurnstile許可ドメイン・T-M7-48／2026-08-14 本番のCAPTCHA／今回のSite URL）。→ 検出手段は **T-M8-90**。

**運営者向けの確認手段**: `npm run doctor -- --base https://exosai.net`（読み取りのみ・費用なし）。`.env.local` に `PRODUCTION_CRON_SECRET` を入れた（2026-08-14。無いと「確認用の鍵が見つからない」で本番の中身を見られない）。

**D-27: 新規環境へ seed（既定プロンプト7件）を入れる手順がコマンドに畳まれていない（解決済み 2026-08-17: 案A・T-M8-117）** — **2026-08-17、本番反映で `db push` が「ローカルに無い版がリモートにある」と言って止まったため、案Aで解決した。** `supabase/migrations/20260813999999_seed_prompt_templates.sql` としてファイルを復元し、本番のリモート履歴と版番号を揃えた（本番は適用済みなのでスキップされ、未適用の環境では実際に入る）。`on conflict do nothing` で冪等。`seed.sql` は `db reset` 用にそのまま残す。以下は経緯（旧記載）。 — — `supabase/seed.sql`（`prompt_templates` の system default 7件・`x_account_id is null`）は **`supabase db reset` でしか適用されない**。`supabase db push`（＝`release:staging` / `release:production` が使う経路）はmigrationしか流さないため、**新しい環境ではDBが空のまま「生成が必ず失敗する」状態になる**。2026-08-14 の本番構築では、これに気付いた後に一時migration（`20260813999999`）を作って投入し、そのファイルを削除した。結果、**本番のリモートmigration履歴にだけ `20260813999999` が残っている**（ローカルに対応ファイルが無い。`release:*` のゲートは「ローカルにあってリモートに無いもの」を見るので通る）。CLAUDE.md 原則3（手順を人間の記憶に依存させない）に反しており、次に環境を作るとき同じ手順を思い出す必要がある。要決定: (案A)**seedを冪等なmigrationとしてリポジトリへ入れる**（`insert ... on conflict do nothing`。`db push` で自動的に入り、stgにも同じ版番号が流れる。残っている `20260813999999` と版番号を合わせれば本番の履歴の食い違いも解消する。**推奨**） / (案B)`release:*` のゲートに「seed行の有無」の確認を足す（入れるのは手動のまま。忘れたら止まる形にはなる） / (案C)現状維持＋`deployment.md` に手順を書く（**非推奨**——手動の回避策は忘れられる、とCLAUDE.mdが明示している）。**影響**: いま本番は投入済みなので実害は出ていない。次に環境を作るとき（または本番DBを作り直すとき）に効く。

**D-30: プレミアムのクレジット数と月額価格の組（**解決 2026-08-16: T-M8-109の金額制AIクレジットで自然解消**。AI原価の上限が1000クレジット=1000円で固定され、フル利用時の原価合計は X書込$7.00＋AIクレジット$6.25≒**約¥2,120 < 手取り約¥2,600で黒字**。「生成200回相当」の議論もクレジット制では不要——重い生成は多く・軽い生成は少なく減るため）** — T-M8-108でクレジット制＋倍数消費（基準モデル=1・上位はコスト比の切り上げ倍数）を実装した。倍数消費により**運営原価の上限は「クレジット総量×基準モデル単価」で固定**される。基準をSonnet 5（文章・Webリサーチ込み最大$0.10/クレジット）・GPT Image 2/Nano Banana Pro（画像・最大$0.20/クレジット）とすると、フル利用時の原価上限は: X書込$7.00＋X読取・投稿分析$2.5＋生成100×$0.10＋画像20×$0.20＝**約$21.5（¥3,440）**で、**月額¥2,980（手取り約¥2,600）では赤字**。生成200へ増やすと約$31.5（¥5,040）。要決定:
(案A)**生成クレジット200・画像20のまま月額を¥5,980へ改定**（手取り約¥5,220 ≒ $32.6 ≧ 原価$31.5。「通常投稿200と生成200が揃う」運営者の意向に合致。Stripe Price変更＋LP改定が必要・既存契約者への通知も）
(案B)現行価格¥2,980のまま**生成クレジット60・画像10へ縮小**（原価上限 7+2.5+6+2=$17.5 ≒ ¥2,800 ≈ 手取りと均衡。マージンほぼゼロ。既存プレミアム契約者の上限縮小は不利益変更のため告知が必要）
(案C)現行の生成100・画像20を維持し、**実測（台帳・doctor）で監視**しながら判断を先送り（フル利用時は最大約¥800/人の赤字リスク。現在プレミアム契約者が少ない間の暫定として現実的）
推奨: 当面**案C**（実利用はフル上限に達しにくく、倍数消費で上限は固定済み）→ 契約者が増える前に案Aへ。数値は`src/lib/plans.ts`の1箇所で変更できる。

**D-29: ローカル開発中も定時トリガー（cron）を自走させるか（解決済み 2026-08-20: 案B＝現状維持）** — **2026-08-20 運営者判断: 案B（現状維持＋手動起動）。** 本番はVercel Cronが動いており実運用に支障はない。費用ゼロ。手動起動の手順は `docs/operations/local-development.md` §5.4。以下は起票時の内容。 — ローカルには定時実行が無く、毎朝8:00の投稿分析・毎時のフォロワー記録・metrics収集・スケジュール投稿のいずれも**自動では一度も動かない**（`cron_runs` に履歴ゼロ・T-M8-99で判明）。本番はVercel Cronが担うため実運用に支障は無いが、ローカルで動作確認する期間は「画面は毎朝作られると約束するのに永久に作られない」状態になる（原則1に反する見え方）。要決定: (案A)`npm run dev` 起動中のみ5分おきに scheduler-tick／毎時 follower-snapshot・metrics-collector をローカルで自動起動する仕組みを入れる（**news-fetchは対象外**＝ニュースAI費用が毎時発生するため。X投稿は `X_POSTING_MODE=dry_run` で外へ出ない。毎朝の投稿分析はAI実費 約$0.02〜0.10/日が運営者のキーで発生する） / (案B)現状維持＋手動起動コマンドを docs に明記（T-M8-99で実施済み。費用ゼロだが手動） / 推奨: 本番運用へ移行済みなら案B、ローカルでの動作確認を続けるなら案A。

**D-28: `stg` と `main` の履歴が分かれた（解決済み 2026-08-17: 案B＝`main` の直線履歴要求を外す）** — **2026-08-17、運営者の判断で案Bを採る。** `main` の `required_linear_history` を外し、以後 `stg` → `main` は Merge commit で入れる。これで `stg` が常に `main` の祖先であり続け、分岐しなくなる（保護そのもの＝PR必須・CI必須・force push禁止・管理者も迂回不可は維持）。

**案Aは一度試したが不十分だった。** 2026-08-16 に `stg` を `main` の直系子孫へ force push して揃えたが、その後の `stg` → `main` を **Rebase and merge** で入れた時点で GitHub がコミットを書き換え、**同日のうちに再分岐した**（`git diff origin/main origin/stg` は0ファイル＝内容は同一、SHAだけ相違）。翌日 `feat` → `stg` のPRがコンフリクトし、GitHub がマージ結果を作れずCIが起動しないため、`main` へ直接PRを出して本番反映した（T-M8-117〜119・LP文言）。**直線履歴を要求する限りリリースごとに再分岐するため、案Aは恒久策にならない**と分かった。残作業: 設定変更後に `stg` を `main` へ揃え直す（`main` が `stg` の子孫になるので通常のpushで済む）。以下は経緯（旧記載）。 — **2026-08-16、`stg` を作業ブランチ（`origin/main` の直系子孫・マージコミット0）へ force push して揃え直すことにした（案A）。** `git cherry HEAD origin/stg` で stg の201コミットが**すべてHEADへ取り込み済み（未取り込み0件）**であることを確認済みで、内容は失われない。以後 `stg` は `main` の直系子孫であり続けるため、PRのコミット一覧は実際の差分だけになる。以下は経緯（旧記載）。 — `main` のブランチ保護が `required_linear_history: true` のため、GitHub上でマージコミットが作れず PR #7 を **Rebase and merge** で入れた。GitHubのrebaseはコミットを書き換えるので、`stg` の207コミットと `main` の201コミットは**内容が同一なのにSHAが別**になった（`git diff origin/main origin/stg` は0ファイル、`git cherry` の未取り込みも0）。実害はいま無いが、次の `stg` → `main` のPRでも同じ200件超が「新規コミット」として並び、毎回rebaseで複製されていく。要決定: (案A)`stg` を `origin/main` の内容へ強制更新して履歴を揃え直す（ツリーは同一なので内容は変わらない。force pushが必要）/ (案B)`main` の `required_linear_history` を外し、以後はマージコミットで入れる（履歴が枝分かれするが `stg` が `main` の祖先であり続ける）/ (案C)現状維持（PRのコミット一覧が毎回長くなるのを許容する）。

**D-2: ローカルDBランタイム(Docker)の方針（解決済み 2026-07-20: colima導入）** — この開発マシンにDocker/Supabase CLIが未導入。T-M0-03〜07（DBマイグレーション群）とDB統合検証を含む後続タスクの検証に必須。選択肢: (a)colima+docker CLIをbrewで導入（GUI・ライセンス不要のヘッドレス実行。推奨。ただし初回はSupabaseの各種Dockerイメージ数GBをpull） / (b)Docker Desktopを人間が導入（GUI・ライセンス確認あり） / (c)当面ローカルDB検証をスキップしSQLの記述のみ進める。**未決の間はDB群がblockedで先へ進めないため、ここが連続開発の律速。**

**D-5: runJob汎用finalizerの中央化（解決済み 2026-07-26: 案A・T-M7-02/T-M7-07で実装。refundの共通化のみM6へ残す）** — `runJob`（worker.ts）はhandlerを`withTransaction`で包み、throw時はhandler txをロールバックして`status='failed'`（`finished_at`のみ）に更新する。error jsonb・usage・retry/backoff差し戻し・失敗通知を一切書かない。T-M3-05のpost_generation handlerは暫定対応として、失敗系のerror/usage/通知をpool（handler txとは別）で確定保存してからthrowしている。しかし「retryable(429/5xx/timeout)のbackoff付きqueued差し戻し」「pause_turn <30秒でのretryable差し戻し＋reduceWebSearchMaxUses適用」は**runJob側にretry分類（retry.ts `shouldRetry`/`backoffMs`は現状未配線）と差し戻し（stale.ts §84-93が参照実装）を中央実装しないと成立しない**。要決定: (案A)runJobを拡張し、handlerが構造化結果（succeeded/failed(error,usage)/retry(delay)）を返せるようにして中央でstatus/error/usage/backoff/通知を処理する（全handler共通化・推奨） / (案B)各handlerが個別にpoolで失敗確定＋差し戻しを行う（重複増）。M3のimage_generation/post_publish handler着手前に決めると重複実装を避けられる。

**D-6: 生成ごとの画像provider指定の扱い（解決済み 2026-07-26: 案B・T-M7-08で実装）** — `createGenerationJob`/`createDraftFromNews`は`image_provider`を受け取り（要件05 §5・作成フォームでも選択）、`regenerateImage`も当初は`provider`引数を想定していた。しかし画像job（`executeImageGeneration`）は`resolveImageProvider`（T-M0）でアカウント設定`ai_purpose_config.image`からproviderを解決し、**per-jobのimage_provider選択を使っていない**。premiumでユーザーが生成ごとにopenai/googleを選んでも、保存済み設定と異なると選択が反映されない。要決定: (案A)per-jobの`image_provider`を`resolveImageProvider`へ渡して尊重する（作成フォームの選択を活かす。`resolve-provider`にpreferred引数追加が必要） / (案B)providerは常にアカウント設定を正とし、作成フォーム/actionのper-job provider選択・引数を廃止する（UI簡素化）。暫定: 現状はアカウント設定解決（案B寄り）で動作。T-M3-16では`regenerateImage`引数を`(request_key, draft_id)`に確定し要件05 §5を更新済み。作成フォームの`image_provider`選択を活かすなら案Aで別途対応。

**D-4: 失敗provider callのusage/原価記録の責務（解決済み 2026-07-26: 案A・T-M7-09で実装）** — `runTextGeneration`（pipeline.ts）は`generate()`が成功returnした後にのみ`usage.calls`へ積むため、provider callが例外throw（`PauseTurnIncompleteError`・timeout・5xx等）した場合、`status:"failed"`/`error_code`付きの`ProviderCall`が記録されない。一方プロンプト設計書 §5.6は「全provider callを保存」、要件04 §10は「成功・失敗を問わず原価台帳へ記録」とする。M0では原価台帳（external_api_usage_events）連携自体が後続MS送りのため実害は潜在。要決定: 失敗callの記録を(案A)pipelineがtry/catchで`ProviderCall(status=failed)`を積む／(案B)worker/台帳MSが失敗時にexternal_api_usage_eventsへ直接記録する、のどちらにするか。※throw時はSDKがusageを返さないことが多く、記録できるのはrequest ID・error_code・発生事実に限られる点も考慮。`ProviderCallMeta`は既に`status`/`errorCode`を受け取れる（normalize.ts）。**T-M6-09時点の状態（2026-07-25）**: 原価台帳への記録は全AI job（GEN/LRN/SUGGEST/MD-MERGE/GEN-IMG）＋NEWSへ配線済み。ただし記録対象は`usage.calls`に現れるcall（`generate()`が返却した成功call＋status=failed返却call）に限られ、**provider例外throwのcallは依然として`calls`へ積まれず未記録**（pipeline.ts `callOnce`はgenerate成功後にのみpush）。案A（pipelineがtry/catchで`ProviderCall(status=failed)`を積む）か案Bかは未決のまま。

**D-14: `main` 保護（CIが緑でないと本番を更新しない）をどう実現するか（解決済み 2026-08-02: 案B）** — **2026-08-02、リポジトリを public にした（案B）ことでブランチ保護が無料で使えるようになり、設定を投入して解決した。** `main` は PR 必須・必須チェック `型・lint` と `release:check（DB・build・E2E）`・**管理者も迂回不可**（`enforce_admins`）・force push と削除を禁止。`gh api repos/:owner/:repo/branches/main/protection` で確認できる。以下は経緯（旧記載）。 — **2026-07-31 ユーザー判断: いまは現状のまま**（GitHub Proへの課金もpublic化も実施せず、リポジトリ内の個人メールもそのまま）。したがって当面は**案E相当（運用で担保）**＝`main` へ反映する前に人／エージェントがCIの緑を確認する。**本番公開の前に再判断する**（それまでは赤いまま反映することが技術的に可能な状態が残る）。以下は判明した経緯と選択肢。 D-8で案A（ブランチ保護）を決めたが、**private × GitHub Free ではブランチ保護もRulesetも使えない**ことが判明した（APIが403で `Upgrade to GitHub Pro or make this repository public` を返す）。目的は「CIが赤いあいだ本番が更新されないこと」。要決定: (案A)**GitHub Pro へ課金**（個人 $4/月）。決定どおりのブランチ保護が即使える。実装作業ゼロ。**推奨**（リリース時にはVercel Proも契約する前提なので、月$4は許容範囲。外部準備7と同時に判断できる） / (案B)リポジトリを public にする（無料で保護が使えるが、事業内容・プロンプト設計・要件が公開される。**非推奨**） / (案C)Vercelの Ignored Build Step でCIの結果を見てビルドをスキップする（無料。ただしVercelのビルドはpush直後に始まりCIより早いため、緑になった後に**手動で Redeploy** する運用になる。GitHubトークンをVercelの環境変数へ置く必要もある） / (案D)Vercelの Git 自動デプロイ（production）を止め、**CIが緑になった後にGitHub Actionsから `vercel deploy --prod`** する（保証は最も固い。ただしVercelトークンをGitHub Secretsへ置くことになり、「秘密情報をCIに置かない」現方針の変更を伴う。実装もそれなり） / (案E)当面は運用で担保（`main` へ push する前にCIの結果を人／エージェントが確認する。`.githooks/pre-push` で機械化も可能だがローカル設定なので回避できる）。
**時期**: production はまだ公開していない（独自ドメイン・Vercel Pro が未契約）ため、**この決定は本番公開の直前まで先送りできる**。それまでは案Eで足りる。

**D-7: 依存の脆弱性の解消方針（解決済み 2026-07-30: 案A）** — `npm audit` に high 3件（`sharp`＝libvips CVEでsharp<0.35.0、`next`／`postcss`＝next同梱）とmoderate 4件がある。いずれも修正には breaking upgrade（`sharp@0.35.x`・`next` minor）が必要で、画像正規化（image-normalize）とApp全体の再検証を伴う。T-M6-20 の release ゲート（`scripts/audit-check.mjs`）はこの3 high を **package名 allowlist（next/postcss/sharp）** で通し、critical と allowlist外 high は失敗させる暫定運用。要決定: (案A)次の保守枠で `sharp`/`next` を計画的に upgrade しフルスイート＋build＋画像テストで検証してから allowlist を外す（推奨） / (案B)現状維持しリリース後に対応。リリース前チェックリスト（T-M6-21）で判断する。**2026-07-26 決定: sharp/postcss は据え置き（案B）・next は先行upgrade（T-M7-10）**。ただし同日の再調査で前提が変わった: (1) `next` は 16.2.10→**16.2.12 のパッチ**で high 4件・moderate 5件が解消する（`>=16.0.0 <16.2.11` が対象。当初想定した minor upgrade は不要）。(2) `sharp` は依然 `<0.35.0` が対象で 0.35 系への breaking upgrade が必要（libvips CVE-2026-33327/33328/35590/35591・GHSA-f88m-g3jw-g9cj）。(3) high の `postcss` は **next が pin する nested の 8.4.31**（hoisted の 8.5.20 は無害）で、`next@16.2.12` も 8.4.31 を pin するため **next を上げても解消しない**。sharp/postcss の扱いは保守枠で再判断する。**2026-07-30 決定: 案A**。`sharp` を 0.35系へ計画的に upgrade し、画像正規化を再検証してから allowlist から外す（T-M7-32）。`postcss` は next が nested で 8.4.31 を pin しているため upgrade では解消せず、`overrides` の可否検証も同タスクに含める。`next` は T-M7-10 で 16.2.12 済み。

**D-10: dev-loopが実AI APIを自動で叩いてよいか・1周あたりの上限額（解決済み 2026-07-28: 案A）** — CLAUDE.md「変更影響 → 必須の検証」で、AI provider・プロンプト・出力schemaに触れた変更は「実物を1周」させることを必須にした。これは**実費が発生する**（P-6のWeb検索付き生成が約$0.10〜0.21、画像1枚が約$0.05）。`/loop /dev-loop` で自動連続実行するとタスクごとに積み上がる。要決定: (案A)差分が `src/lib/ai/**`・`src/lib/jobs/**`・`src/lib/prompts/**` に触れたときだけ自動実行し、1周あたり上限$0.50・超過時は停止して報告（推奨。検証の実効性と費用制御を両立） / (案B)常にユーザー確認を挟む（安全だが自動ループが止まる） / (案C)自動実行しない（今日と同じ見落としが再発する）。**2026-07-28 決定: 案A**。差分が `src/lib/ai/**`・`src/lib/jobs/**`・`src/lib/prompts/**` に触れたときだけ `npm run smoke:live` を実行し、1周あたり上限$0.50・超過時は停止して報告する。実測は1周 約$0.30（検索あり生成$0.13＋画像$0.008＋ニュース$0.16）。上限は provider 側でかけられないため**事後測定・超過したら停止**になる。パス判定は取りこぼしうるので「表に無くても provider へ送る内容・受け取る内容に影響しうるなら実行」を併用する。

**D-11: 実物検証をどこまで自動化するか（解決済み 2026-07-28: 手動のみ実装）** — 「実物を1周」は現状**手動**（jobを1件作って `/api/jobs/run` を叩き、DBの成果物を確認）。自動化すると開発時のゲートと運用時の劣化検知の両方に使える。要決定: (1)`npm run smoke:live` を作るか（各job種別を実APIで1周し、成果物＝ポスト数・providerマークアップ非混入・画像ready・ニュース0件の理由まで検証） (2)同じ判定を staging の日次カナリア（`/api/cron/canary`）として常設するか（AI費用が継続発生。月$3程度の想定） (3)CIに実キーを置いて自動化するか（現在の「秘密情報をCIに置かない」方針を崩す。**非推奨**。代わりにstagingカナリアで代替する案を推す）。背景: 2026-07-28 の4件は、いずれも実物を1周させれば検出できたが、手動である限り忘れられる。**2026-07-28 決定: (1)を実装し、(2)は route だけ用意して cron へ登録しない（手動起動のみ・叩いたときだけ課金）、(3)はCIへ実キーを置かない方針を維持して不採用**。定期実行へ切り替えたくなったら `vercel.json` に crons を1行足すだけで済む形にしてある（T-M7-25）。


**D-12: ニュース要約の120字上限をどう守らせるか（解決済み 2026-07-28: 案B＋published_atの正規化）** — `smoke:live` が `ai` 分野の全滅を2回連続で検出した（5件すべて `summary:too_big`）。T-M7-24 のプロンプト修正でタイトル（30字）は守られるようになったが、**要約（120字）は守られない**。プロンプトで頼む方式の限界で、放置すると分野単位でニュースが0件になり続ける。要決定: (案A)検証時に120字へ丸める（`stripProviderMarkup` と同じく「指示ではなく仕組みで保証する」。文末（。）優先で切り、無ければ末尾に…。itemを失わない。推奨） / (案B)上限を緩める（例200字。UIは`line-clamp-2`なので表示は破綻しないが、プロンプト設計書 §6.10 の仕様変更） / (案C)現状維持（分野が空になる頻度を許容し、smokeの警告で気付く）。**2026-07-28 決定: 案B**（`summary` 200字へ緩和。プロンプト設計書 v1.9）。実APIで確認したところ `summary:too_big` は解消したが、**それに隠れていた別の原因が2つ露出した**: `published_at:invalid_format`×5 と `title:too_big`×4。前者は「**任意項目なのに形式違いでitem全体を捨てていた**」設計の誤りだったため同時に修正（`normalizePublishedAt` で日付のみ・タイムゾーン無しを正規化し、解釈できなければフィールドだけ落としてitemは残す）。結果、実APIで **3件取得（除外1件）** となり全滅から回復した。**残件: `title` 30字はまだ時々超える**（1/4件）。全滅にはならず取りこぼしに留まるため、緩和するかは D-13 で別途判断する。

**D-13: ニュースtitleの30字上限を緩めるか（解決済み 2026-07-30: 案A・現状維持）** — `summary` を200字へ緩め `published_at` を正規化した結果、ニュースは全滅しなくなった（実測3件取得）が、**`title:too_big` で毎回1件前後を取りこぼす**。titleはSC-06一覧とホームの重要ニュースカードで1行表示され、30字はUI都合の制約。要決定: (案A)現状維持（取りこぼしは1件程度で全滅はしない。まずはこれで運用し、smokeの警告で頻度を見る。推奨） / (案B)45字程度へ緩める（プロンプト設計書 §6.10 の変更。英語の固有名詞が入るとすぐ超えるため） / (案C)検証時に丸める（一覧の見た目は安定するが、途中で切れたタイトルが出る）。**2026-07-30 決定: 案A（現状維持）**。全滅はせず取りこぼしが1件程度に留まるため変更しない。`smoke:live` の警告（`title:too_big×N`）で頻度を観測し、恒常的に増えるなら案Bを再検討する。コード変更なし。

**D-9: 溜まった queued 通知メールの扱い（解決済み 2026-07-30: 案A）** — ローカル検証で作られた通知が `email_status='queued'` のまま49件残っている。T-M7-23 で development からの実送信は止めたが、**production で初めて `scheduler_tick` が回ると宛先に一括送信される**（本人宛だが、古い内容が大量に届く）。要決定: (案A)本番移行前にローカル由来の古い通知を `not_requested` へ落とす／削除する（`npm run db:clean-test-data` の対象へ加える。推奨） / (案B)そのまま送る（内容は本人の下書き作成・投稿完了通知なので実害は小さい） / (案C)一定期間より古い queued は tick 側で送らず落とす仕様にする（要件04 §14 の変更を伴う）。なお本番DBはローカルとは別なので、影響するのは「このローカルDBを本番へ持ち込む場合」に限る。**2026-07-30 決定: 案A**。`npm run db:clean-test-data` の対象へ「ローカル由来の古い queued 通知」を加えて掃除できるようにする（T-M7-31）。

**D-8: CIを本番デプロイのブロック条件にするか（解決済み 2026-07-30: 案A）** — `.github/workflows/ci.yml` は push / PR で `npm run release:check` を実行するが、**`main` への push ではCIとVercelのproductionビルドが並行して走るため、CIが赤でもデプロイは進む**。CIは「壊れたことを事後に知る」までしか担保しない。要決定: (案A)GitHub の branch protection で `main` を保護し `static`/`verify` を required status check にして、直push禁止・PR経由マージのみにする（緑でないと `main` に入らない＝productionビルドも始まらない。推奨。ただし1人開発でもPRを切る手間が増える） / (案B)現状維持（CIは通知用。デプロイ後に赤に気付いたら revert して再デプロイ）。**2026-07-30 決定: 案A**。`main` を branch protection で保護し、`型・lint` と `release:check（DB・build・E2E）` を required status check にして、`main` への直pushを禁止・PR経由マージのみにする。これにより **CIが緑でないと `main` に入らない＝productionビルドも始まらない**。リリースの流れは「`stg` へ push → CI緑 → `stg` → `main` のPRを作る → 緑を確認してマージ」に変わる（[デプロイ手順](../docs/operations/deployment.md)・[開発とテストの進め方](../docs/operations/development-and-testing.md) §7 を更新済み）。**2026-07-30 追記: 現プランでは設定できない。** GitHub APIで確認した結果、`branches/main/protection` と `rulesets` の両方が `403 "Upgrade to GitHub Pro or make this repository public to enable this feature."` を返す（リポジトリは private・アカウントは Free プラン）。**private × Free ではブランチ保護もRulesetも使えない。** 案Aの目的（CIが緑でないと本番が更新されない）をどう実現するかは D-14 で決める。

**D-3: news_fetchの時間窓欠落対策（解決済み 2026-07-21: 案I・3時間ラップ取得）** — 「時間窓の欠落を許容しない」要件を、案I（§2維持）で解決。`news_fetch`は各回が直近3時間分を重ねて取得し、1時間ごと起動の窓の重なりで「3回に1回成功すれば取得漏れなし」の回復性を持たせる。稼働は9:00〜20:00・12回/日を維持（コスト現状維持）、前日18:00以降の夜間・稼働終了間際分は当日9:00/10:00/11:00の起動が延長ルックバック15/16/17時間で補完（20:00始点だと19時台発行分が1回しか取得機会を得ず欠落し得るため18:00始点）。重複は`source_url` canonical unique＋`<known_urls>`で排除。`cron_runs`受付は並行/重複起動の抑止のみ、欠落回復はラップ取得側が担う。NEWSを永続job化する案II（§2改定）は不採用。反映先: PRD N-1/N-2・§8.3、プロンプト設計書 §6.10（`{{hours}}`=12-20時3／9-11時15-17）、要件04 §6、要件06 SC-06（既定7日表示）、ADR-0003。受け入れ条件はT-M4-10/11へ反映済み。

**D-15: 投稿の日次上限（50件/日）を事前に知らせるか（解決済み 2026-08-03: 案A・T-M8-26で実装）** — `X_DAILY_POST_LIMIT=50` の判定は投稿jobの中にあり、**上限に達していることは投稿しようとして初めて分かる**（`daily_limit_reached` で下書きへ戻る）。デザインのT-4は画面上部の固定バナーで事前に知らせる形。要決定: (案A)ホーム／投稿作成の上部に「本日の投稿が上限に達しました。翌日0:00（JST）に再開します」を出す（**当日の投稿件数を画面表示時に数える新しいデータ取得が必要**。1クエリ。CLAUDE.md 原則1「黙って壊れない」に沿う。推奨） / (案B)現状維持（投稿時のエラーで知る。自動実行は下書き作成まで続くので実害は小さいが、利用者は「なぜ投稿されないのか」を都度エラーで知る） / (案C)日次上限そのものを見直す。**2026-08-03 決定: 案A**。App Shell の常設バナーとして実装した（T-M8-26）。判定と問い合わせは投稿jobと共有する。

**D-16: `stg` にもブランチ保護を掛けるか（解決済み 2026-08-20: PR必須なしの保護）** — **2026-08-20 実施**: 調べたところ ruleset `protect-stg` は**2026-08-04 に既に作成済み**で（削除禁止・force-push禁止・PR必須・必須チェック2本）、起票文の「`stg` は未保護のまま」は古かった。運営者の指示により **PR必須を外し**、履歴を守る2件（`deletion`・`non_fast_forward`）だけ残した。**必須チェック（`required_status_checks`）も併せて外した**——PR経路が無い状態でこれを残すと、検査結果が付いていない直接pushが拒否されて `stg` へ push できなくなる（GitHubの必須チェックはPRのマージ時に効く仕組み）。**したがって「CIが赤でもstagingが更新される」問題はブランチ保護では解決しない。**解決したいなら案C（Vercel の Ignored Build Step でCIの結果を見てビルドを止める）を別タスクで入れる。以下は起票時の内容。 — `main` は D-8/D-14 で保護したが、**`stg` は未保護のまま**。Vercel は push と同時にビルドを始めてCIの結果を待たないため、**CIが赤でも staging が更新される**。2026-08-03、UIリデザインのマージで実際に起きた（E2E 1件のタイムアウトでCIが赤 → その間 staging は新コードで公開済み。再実行で緑になり実害は無かった）。要決定: (案A)`main` と同じ branch ruleset を `stg` へも掛け、PR必須＋必須チェック（`型・lint`／`release:check`）にする（**推奨**。public リポジトリなので追加費用なし。1人開発でもPRを切る手間が増えるが、今回のように40コミット単位で入れるなら妥当） / (案B)`stg` は「壊れてもよい場所」と割り切って現状維持（staging が壊れた状態で残り得るが、production は `main` の保護で守られる。stagingで検証する前提が崩れるのが難点） / (案C)Vercel の Ignored Build Step でCIの結果を見てビルドをスキップする（無料。ただしVercelのビルドはpush直後に始まりCIより早いため、緑になった後に手動 Redeploy する運用になる）。**時期**: 本番公開の前に決める。それまでは案B相当（人が気付いて再実行する）で動いている。

**D-17: 法務文書を専門家に確認してもらうか（解決済み 2026-08-20: 案B＝レビュー不要）** — **2026-08-20 運営者判断: 弁護士レビューは行わない**（案B）。現状のまま公開し、指摘があれば都度直す。以下は起票時の内容。 — T-M8-72 で3ページを法定事項を網羅した本番版へ書き換えたが、**作成者は弁護士ではない**。項目の網羅性・実装との一致・消費者契約法上の無効リスク（免責の上限条項）は機械検査（`legal-pages.test.ts` 53件）と実装突き合わせで担保しているが、**法的有効性の判断はしていない**。要決定: (案A)公開前に弁護士のレビューを受ける（**推奨**。消費者向けサブスクリプションで個人事業主が事業者になるため、免責条項・管轄・返金不可の有効性は個別判断が要る。スポット相談で数万円規模） / (案B)現状のまま公開し、指摘があれば都度直す（費用ゼロだが、免責条項が無効と判断されると責任範囲が無限定になる） / (案C)公開範囲を限定して開始し（招待制など）、有料の一般公開前にレビューを受ける。**時期**: 一般公開の前。追記（2026-08-08・T-M8-75）: 運営者保護の条項（利用資格18歳以上・反社排除・知的財産権・利用者の賠償責任・権利義務の譲渡・専属的合意管轄=横浜地裁）を追加済み。レビュー時は特に **専属管轄と免責上限の消費者契約法10条リスク、賠償条項の範囲** を確認してもらう。

**D-18: 外国にある第三者への提供（個人情報保護法28条）の根拠づけをどちらにするか（解決済み 2026-08-20: 案A＝本人の同意）** — **2026-08-20 運営者判断: 案A（本人の同意）で行う。** 現行プライバシーポリシーがこの前提なので追加作業なし。あわせてSupabaseのDBリージョンが **`ap-northeast-1`（東京）**と確定した（下記調査）。以下は起票時の内容。 — 委託先9社すべてが米国事業者で、個人データが国外で取り扱われる。法28条の要件を満たす方法は2つある。要決定: (案A)**本人の同意**で行う（現在のプライバシーポリシーはこの前提。同意取得時に「移転先の国名・当該国の制度・移転先が講じる措置」の情報提供が必要で、国名は表に記載済み、制度と措置は各社の公表情報を参照＋窓口で個別提供する形にしてある。追加作業は少ない） / (案B)**規則16条の基準に適合する体制整備**で行う（各社のDPA／標準契約条項を締結済みであることを根拠にする。同意は不要になるが、**各社のDPAを実際に受諾しているかの確認が必要**。Vercel・Supabase・Stripe・Anthropic・OpenAI・Google・Cloudflare・Sentry の各ダッシュボードでDPAの締結状況を確認する作業が発生する）。**いずれにせよ確認したいこと**: Supabase のDBリージョンと Sentry のデータリージョン（DSN依存）。→ **2026-08-20 調査済み（Supabase側は確定）**: Management API（`/v1/projects`）で全4プロジェクトが **`ap-northeast-1`（東京）**と確認できた（稼働中の本番は `hvjizoahdqfvasiqzzkv` = x-system-prd・ACTIVE_HEALTHY）。**つまりDBの個人データは日本国内に保存されている**（Supabase Inc. が米国法人なので委託先としては米国のまま）。Sentry 側は下の D-19 の前提（そもそも設定されているか）が未確定のため保留。**時期**: 公開前。案Aのままなら追加作業は無し。

**D-19: Sentry と Gmail のログ保持期間を実際に設定するか（解決済み 2026-08-20: 90日を記載）** — **2026-08-20 運営者確認: Sentryの現行プランは保持90日固定で短縮できない。90日で運用する。** プライバシーポリシーへ「委託先（Sentry）の設定により90日を経過したものが自動的に削除されます」を追記し、要件01 §9 の「各サービス設定で30日以下とし」を実態へ直した（**設定できない値を要件にしていた**）。Gmailは送信済みメールの控えで保持期間の設定機構が無いため対象外とする。以下は起票時の内容。 — 要件01は「Sentryとメールproviderのlog保持期間は各サービス設定で30日以下とし、秘密値・投稿前入力を送信しない」と定めているが、**後者はコードで強制済み（`redactEvent`）、前者は各サービスの管理画面で設定する運用項目でコードから検証できない**。プライバシーポリシーには保持期間として書いていない（書くと未設定なら虚偽になるため意図的に省いた）。要決定: (案A)Sentryのデータ保持設定を確認・調整し、確認できた期間をプライバシーポリシーへ追記する（**推奨**。書けると説明が具体的になる） / (案B)記載しないまま運用する（現状。虚偽にはならないが、保持期間の説明が委託先について空白になる）。**時期**: 公開前。

→ **2026-08-20 追記: 決める前に前提の確認が必要**。手元の `.env.local` は `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` が **`__TODO_sentry_dsn__`（プレースホルダ）**のままで、`initServerSentry`（`src/lib/observability/sentry.ts`）は不正なDSNを **no-op＋`console.warn` だけで黙って無効化**する。本番のVercel環境変数が実DSNかどうかはここからは読めない。**`doctor` も `config-status.ts` もSentryを検査していない**（見ているのは APP_ENV / APP_BASE_URL / X_POSTING_MODE / STRIPE_SECRET_KEY / SMTP_USER の5つ）。**Sentryが受け取っていなければ保持期間を決めても意味が無く、さらに T-M8-159 で入れた「proxyのprofile取得失敗を記録する」も本番では記録先が無いことになる**（原則1が成立しない）。→ 先に T-M8-162 で「Sentryが実際にイベントを受け取っているか」を運営者が確認できるようにする。

**D-20: アカウント削除（退会）の手順をどう用意するか（クローズ 2026-08-20: 対応しない）** — **2026-08-20 運営者判断: 課題から除外**（削除依頼が来た時点で考える。事前の手順化はしない）。以下は起票時の内容。 — 利用規約第6条とプライバシーポリシー第9条で「お問い合わせ窓口へご連絡いただければ、ご本人確認のうえ削除します」と約束したが、**削除を実行する手順書もスクリプトも無い**請求が来てから手順を考えることになる。

**2026-08-14 の調査で判明（重要・当初の想定と逆）**: 起票時は「`profiles` の `on delete cascade` は定義済みなので削除自体は1文で可能」と書いていたが、**実際には `auth.users` を消しても削除はブロックされる**。`usage_events` / `usage_counters` が `profiles` を `on delete restrict` で参照し、`base_md_versions` / `follower_snapshots` が `x_accounts` を同様に参照しているため、**Supabase Studio の Delete user が外部キー違反で失敗する**。連鎖するのは9テーブル（`x_accounts`・`drafts`・`generation_jobs`・`schedule_slots`・`learning_sources`・`user_api_keys`・`notifications`・`improvement_suggestions`・`prompt_templates`）だけ。`external_api_usage_events` は `set null` で行が残る（原価台帳として意図的）。つまり請求対応には **`restrict` の4テーブルを先に手で消す**か、利用実績を残す設計と削除要求をどう両立させるかの判断が要る。**手順書は作らない判断（2026-08-14・運営者。「削除依頼をされた時に考える」）** だが、この事実は請求が来たとき必ず当たるので残す。
要決定: (案A)運用スクリプト（`npm run account:delete -- --email <addr>`）を用意し、削除対象テーブルと確認手順を運用メモへ書く（**推奨**。原則3「手順を人間の記憶に依存させない」に沿う。Stripe側の顧客削除・Xトークンの失効も同時に行う必要がある） / (案B)請求時に手作業で対応する（頻度は低いが、削除漏れ＝法令違反のリスクが残る） / (案C)セルフサービスの退会機能を実装する（PRD §3.2で「MVPでやらないこと」と決めたため、スコープ変更の判断が必要）。**時期**: 公開後、最初の請求が来る前。

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


**D-21: 未使用のServer Action 2本（docs にAPIとして記載）をどうするか（**解決済み 2026-08-11: 案A（削除＋docs更新）**。呼び出し元0件の2本を削除し、要件05 §9 の表から行を削って「読み取り専用なのでServer Componentから読む」を文で明記した。到達性検査（`server-action-reachability.test.ts`）を同時に入れ、削除前に赤・削除後に緑を確認した。作成時に検出器が静的importしか見ておらず動的importで使う3本を誤検出したため、両方を見る形へ直した）** — `getAnalyticsSummaryAction`（src/app/actions/analytics.ts:25）と `listSuggestionsAction`（src/app/actions/suggestions.ts:61）は repo 全体で呼び出し元・テストが0件で、画面はどちらもRSC側（app/page.tsx:111 の `getAnalyticsSummaryForUser`、analytics/page.tsx:50 の `loadSuggestionsForUser`）から読んでいる。ただし docs/requirements/05_api_server_actions.md:229,231（§9 の表）と 06_screens_onboarding_posting.md:332 が仕様として明記しているため、削除は**文書化されたAPI表の変更**にあたる（`"use server"` の export は外から叩けるPOST受け口として残る）。**なお docs は全Action名から `Action` 接尾辞を落とす規約**（同文書に `...Action` の記載は0件・`refreshSuggestions` も同じ形）なので、表の `getAnalyticsSummary` / `listSuggestions` がこの2本を指す。命名のドリフトではない（2026-08-11 `/doc-sync` で確認）。案A: 実装を削除し要件05 §9 と要件06 §8 の該当行を同じ作業単位で更新する（推奨。受け口が減り、analytics.ts の狭い `BaseResult` 重複＝R15の据え置き例外も同時に消える）。案B: docs を正として実装を残す（現状維持）。

**D-22: globals.css の `.dark` パレットと未参照トークン約60行を消すか（**解決済み 2026-08-11: ダークモードは持たない（PRD §3.2 v1.6）**。`.dark` パレットと参照0件のトークン計50行を削除。削除前後のビルド済みCSSを比較し `:root` の値が1つも変わらず新しい値も現れないことを確認。`@custom-variant dark` の1行は残す（消すとTailwind既定へ戻り、OSダークの閲覧者だけ `dark:*` が発火する）。再発は `design-tokens.test.ts` と `e2e/dark-color-scheme.spec.ts` が止める）** — `.dark` を付ける箇所は repo に存在せず（layout.tsx:56 の html className は `${notoSansJp.variable} ${inter.variable} ${geistMono.variable} h-full antialiased` のみ）、`prefers-color-scheme` も globals.css・shadcn の tailwind.css に1つも無い。`--color-sidebar-*` 8本・`--color-chart-*` 5本・`--chart-1..5`・`--sidebar*` 8本・`--font-heading`・`--motion-fast` も参照0件。約60行が永久に描画されない状態で、色を触る人が「ライトとダークの2組を直す必要がある」と誤解する。案A: ダークモードの予定が無いなら削除（`/ui-polish` と実ブラウザ確認が必要。button.tsx の `dark:*` ユーティリティも同じ理由で発火しない）。案B: 導入予定があるなら残し、その旨をコメントに書いて誤解を消す。

**D-23: 下書きの警告バッジに欠けている2コードの日本語ラベルを足すか（**解決済み 2026-08-11: ラベルを追加**（「長め」「ポスト数を調整」）。あわせて**下書きバッジが止まらない警告でも「自動投稿は停止します」と名乗っていた問題**も直した。ラベル表は `lib/post/warning-labels.ts` へ移し `satisfies` でコード追加時に typecheck が止まる形にした（R37 も同時に消化））** — drafts-list.tsx:34-50 の表に `length_over_target` / `post_count_trimmed`（generation-validation.ts:19-29 の正本にある）が無く、その警告が付いた下書きではバッジに生の英語コードが出る。文言追加＝振る舞い変更なので R37 では触らず、`/add-task` で別タスクにするのが正しい扱い（暫定案: 「長め」「ポスト数を調整」相当の日本語ラベル＋DETAIL を足す）。

**D-24: 送信失敗メールの数え方が doctor と日次サマリで非対称（**解決済み 2026-08-11: 日次サマリも7日窓へ揃えた**。窓の定数は `ops/check.ts` の1つだけを使う。窓より前の失敗は警告にせず数字だけ出す（黙って落とすと届かなかったメールの存在が見えなくなる・原則1））** — diagnostics.ts:292 は FAILED_EMAIL_WINDOW_DAYS=7 の窓で区切る（T-M8-51「赤の常態化を避ける」）が、daily-summary.ts:232-236 のSQLは `email_status = 'failed'` を全期間で数えるため、7日より前の失敗しか無い状態でも日次サマリが毎日「気になる点」を出し続ける。閾値が片方にしか入っていないので、揃えると通知の件数が変わる（＝振る舞い変更）。dev-loop 側で扱う。暫定案: 日次サマリ側も7日窓に揃える。

**D-25: APIキー設定の「Client IDとClient Secretを入力すると保存できます。」が現仕様と食い違う（**解決済み 2026-08-11: 「Client IDを入力すると保存できます。」へ変更**。暫定案の「Client Secretは任意」は採らなかった——手順ガイドが指示するApp種別は confidential client で Secret 無しの token 交換は401で拒否される（T-M8-63）。代わりに Secret 欄が空のあいだだけ「空のまま保存すると、Xアカウントの連携時にXから拒否されます」を出す）** — は Client Secret 任意という現仕様（T-M8-63・保存可否の式は :160-163 で Secret 空を許している）と読み合わせると両方必須のように読める。文面変更＝振る舞い変更なので別タスク。暫定案: 「Client IDを入力すると保存できます（Client Secretは任意）。」

**D-26: Server Action の zod メッセージを画面に出すか（流儀が2つ併存）（**解決済み 2026-08-11: 作者が書いたzodメッセージだけを出す（sentinel方式）**。先頭issueをそのまま出す案は却下——zod 4 の既定文言は英語かつ内部語で47箇所へ広げると要件06 §8違反になる。素の `safeParse` が残らないことを検査で守り、英語しか無かった5規則へ日本語も付けた）** — `toUserFacingError`（observability/errors.ts:75-84）は `USER_MESSAGES[code]` を返し AppError の `message` を見ないため、`parsed.error.issues[0]?.message`（例「テーマを1件以上選択してください」）は計算されるだけで画面には常に「入力内容を確認してください。」が出る。api-keys.ts:36-40 は `{ ...base, message: first }` で正しく出しており流儀が2つ併存している。R26 では出力不変のまま `first` を削除する。**本来の意図どおり zod メッセージを見せるか**は振る舞い変更なので判断が必要（暫定案: api-keys と同じ形に揃えて具体的な理由を出す）。

**D-27: メール送信を独自ドメインの配信サービスへ移すか（迷惑メール対策の根本）** — 現状は**個人のGmail**（`smtp.gmail.com` / `EMAIL_FROM` が個人アドレス）を、通知メールと認証メール（Supabase Auth のカスタムSMTP）の両方で使っている。T-M8-136 で表示名「Exos AI」と 1クリック購読解除・自動送信ヘッダは入れたが、**残る根本要因は独自ドメインが無いこと**: ①差出人が個人のGmailアドレスなので、受信者からはサービスからのメールに見えない ②Gmail送信の上限は**約500通/日**で、利用者が増えると**確認メールが黙って送れなくなる**（登録できない） ③`exosai.net` の SPF / DKIM / DMARC を自分で持てないため、なりすまし耐性と到達率を運営側で改善できない。**判断が要るのは費用と手間**なので勝手に決めない。
- **案A（推奨）**: Resend か Amazon SES を契約し、`noreply@exosai.net` から送る。DNSに SPF / DKIM / DMARC を設定し、`SMTP_*` と Supabase の カスタムSMTP を差し替える。費用は Resend が月3,000通まで無料・以降 $20/月程度、SES は 1,000通あたり $0.10。**到達率と上限の両方が解決する**。
- **案B**: Google Workspace（`exosai.net` のメールアカウント）を使い、SMTPは今のままにする。月額 約￥800/1ユーザー。差出人は独自ドメインになるが**送信上限（約2,000通/日）は残る**。
- **案C**: 現状のまま運用し、登録数が増えてから移す。**確認メールが上限で止まると新規登録が全て失敗する**（しかも画面は「送信しました」と出る）ため、上限に達した瞬間に気付ける仕組みが別途必要。
- 影響するタスク: 未起票（決定後に `/add-task` で起票する）。`npm run doctor` はカスタムSMTPの有無と差出人名を見るようになったが、**上限に近づいていることは検知できない**。


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
- 実装結果: ローカルSupabaseのみを対象に、合成テストデータを依存順（external_api_usage_events→notifications→user_api_keys→usage_counters→usage_events→x_accounts→auth.users）で削除。内訳は `handle='h'` の x_accounts 4件＋その依存、UUID合成メール等の auth.users 2457件（`%@example.com` かつ UUID形式/tm10*/verify-*/e2e-* のみを対象）。**実メールアカウント（運営者本人のアドレス）とその通知83件は対象外として保持**。削除後 x_accounts/generation_jobs/drafts/schedule_slots はいずれも0件、`npm test` 1154件緑（fixture前提を壊していない）。再発防止調査: 残骸を作り得る *.db.test.ts 19ファイルはいずれも `delete from auth.users` の後片付けを持っており、コード上の欠落ではなく2026-07-24のテスト中断・失敗時の取り残しと判断（コード修正は不要）。

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
