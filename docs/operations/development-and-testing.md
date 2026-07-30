# 運用メモ: 開発とテストの進め方

| 項目 | 内容 |
|---|---|
| バージョン | v1.0 |
| 更新日 | 2026-07-30 |
| 関連 | [ローカル開発](./local-development.md)／[CI](./ci.md)／[デプロイ手順](./deployment.md)／[リリース前チェックリスト](./release-checklist.md)／[ドキュメントマップ](../README.md)／`CLAUDE.md` |

このリポジトリで1つの変更を完了させるまでの流れと、テストの層ごとの役割・限界をまとめる。**「テストが緑なのに実際には動かない」を繰り返さないこと**が目的。

> **必須の検証の対応表は `CLAUDE.md`「変更影響 → 必須の検証」を正本とする。** 二重管理を避けるため、この文書は表を再掲せず、各層の意味・実行方法・見えない範囲を説明する。

---

## 1. 最初にやること

環境構築は [ローカル開発](./local-development.md) が正本。要点だけ:

```bash
supabase start          # ローカルSupabase（未起動だと *.db.test.ts が静かにskipされる）
npm run dev             # http://127.0.0.1:3000（X OAuth が localhost を許さないため 127.0.0.1 を使う）
```

仕様は必ず `docs/` を読んでから実装する。何を作るかは [PRD](../PRD.md)、画面・DB・処理は [要件詳細](../requirements/README.md)、AIの動かし方は [プロンプト設計書](../プロンプト設計書.md)。**ドキュメントに無い仕様判断を実装したら、同じ作業単位で正本へ書き戻す**（`/doc-sync`）。

---

## 2. テストの7層と、それぞれの盲点

この構成の要点は**どの層も単独では不十分**で、層ごとに「原理的に見えないもの」があること。バグの種類から逆算して層を選ぶ。

（内訳: `src` 配下のテストファイル183本 = 単体124 ＋ `*.db.test.ts` 58 ＋ provider契約 `*.live.test.ts` 1。`npm test` の実行結果は 1,277 passed / 6 skipped。skipは既定で無効な実APIテストの分。）

| # | 層 | コマンド | 守るもの | **見えないもの** |
|---|---|---|---|---|
| 1 | 型・lint | `npm run typecheck` / `npm run lint` | 型の整合、握りつぶした例外の禁止 | 実行時の振る舞い |
| 2 | 単体（124ファイル） | `npm test` | 純粋関数・注入モックでの分岐と境界値 | **モックした境界の向こう側すべて** |
| 3 | DB統合（58ファイル `*.db.test.ts`） | `npm run test:db` | 実DBでのRLS・制約・**ロール権限**・route/actionの本番実装 | 外部API・ブラウザ描画 |
| 4 | E2E（8ファイル14件） | `npm run test:e2e` | 実ブラウザでの操作・遷移・CSP・署名URL・描画（**画像・グラフの描画は現状のspecでは未カバー** → T-M7-26） | AI生成の中身（費用と不確定性のため実行しない） |
| 5 | provider契約 | `npm run check:providers` | **送っているリクエストが実APIに受理されるか** | 応答をアプリが扱えるか。**Googleは既定でskip**（`PROVIDER_CHECK_GOOGLE=1` で有効化・T-M7-17） |
| 6 | 実物スモーク | `npm run smoke:live -- --account <xAccountId>` | **応答をアプリが扱えて成果物が正しいか**（下書き・画像・news item）。引数なしはニュースのみで生成・画像はskip | 本番固有の環境差（→ §6）・ブラウザ描画（ブラウザを起動しない） |
| 7 | CI | push / PR で自動 | 1〜4 の実行そのものを強制 | 5・6（実キーが必要でCIへ置かない） |

### なぜこの分け方なのか

2026-07-28、**Web検索付き生成・画像生成・ニュース取得・画像プレビューの4系統が同時に壊れているのを、利用者の手動操作で初めて発見した**。当時 単体1,261件・E2E13件・CI はすべて緑だった。原因の型が層ごとに違っていた:

| 不具合 | 実際の症状 | 検出できる層 |
|---|---|---|
| Web Search tool の `allowed_callers` 欠落 | API が 400 | 5（受理されない） |
| PT-IMG schema の `additionalProperties` 欠落 | API が 400 | 5（受理されない） |
| 検索の前置き文でJSON検証が落ちる／`<cite>`が本文へ混入 | API は 200。**アプリ側で落ちる** | **6のみ** |
| 応答が字数上限に触れて全件破棄され分野が常に0件 | API は 200。**黙って0件になる** | **6のみ** |
| 生成画像プレビューがCSPで表示されない | 画面が壊れるだけ。エラーなし | **4のみ**（実データを描画したとき）。**現状のspecは画像を描画しておらず、この回帰は層2の `security-headers.test.ts` でしか押さえていない**（T-M7-26で解消する） |

**5と6は別物**。「受理される」ことを確かめても「返ってきたものをアプリが扱える」ことは分からない。逆も同じ。

---

## 3. 1つの変更を完了させる流れ

```
仕様を読む → 実装＋単体テスト → CLAUDE.mdの対応表で検証手段を決める
          → 検証 → /doc-sync → BACKLOG更新 → コミット
```

- 検証手段は**その場の判断で選ばない**。触った層で機械的に決める（`CLAUDE.md`）。該当行が複数あればすべて実行し、実行しなかった行は理由を報告する。
- エージェント（`/dev-loop`）で回す場合も同じ。Definition of Done は `CLAUDE.md`。
- 1タスク = 1コミット。メッセージにタスクIDを含める。`git add -A` は使わず対象ファイルを明示する。

### 実APIを叩く層の扱い

5・6 は**実費が発生する**。実測値（2026-07-28）:

| 対象 | 実測 |
|---|---|
| 生成 P-6（Web検索あり） | $0.09〜0.16 |
| 生成 P-2（検索なし） | $0.011〜0.015 |
| 画像1枚（`gpt-image-1-mini`） | $0.003〜0.008 |
| ニュース1分野 | $0.16〜0.20 |
| **`smoke:live` 1周（生成＋画像＋ニュース）** | **$0.27〜0.34 / 40〜90秒** |

`/dev-loop` が自動実行してよい条件は要決定D-10で決めてある（差分が `src/lib/ai/**`・`src/lib/jobs/**`・`src/lib/prompts/**` に触れたときのみ・1周上限 $0.50）。上限は provider 側でかけられないため**事後測定**になる。

**400 で弾かれる型の不具合はトークン課金されない**ので、リクエスト形状の検証は実質無料（実測: 3シナリオ失敗で合計 $0.0114・10秒）。

---

## 4. テストを書くときの規約

### 単体テスト（層2）

- 実装詳細ではなく、公開される入出力・状態遷移・エラーを検証する。カバレッジ率をテスト品質の代わりにしない。
- 不具合修正では、**修正前に失敗する再現テストを先に**書く。
- **実際に観測した応答・エラー文字列をそのまま回帰テストにする**。今日の修正はいずれも実測値をテストへ固定した（`parse.test.ts` の前置き文2形、`gen-output.test.ts` の `<cite>` 実例、`news-research.test.ts` の字数と `published_at` 形式）。想像で書いたケースは同じ穴を防げない。

### DB統合テスト（層3・`*.db.test.ts`）

- **DBとSupabaseクライアントをモックしない。** モックすると層2と同じものを二重に検証するだけになる。
- **route / action の本番実装を通す。** 依存注入で純粋化した中核は層2で覆えるが、`route` が渡す本番実装（DBクエリ・外部呼び出しの配線）は無検証になりやすい。参考実装: `src/app/api/x/oauth/start/route.db.test.ts`（セッションだけをモックし、Supabaseクエリは実際に走らせる）。
- **静的importのhoistingに注意。** `@/lib/env` は import 時に検証するため、`.env.local` を流し込む前に読まれると落ちる。route は `beforeAll` 内で `await import()` する。
- 作成データは一意IDで作り、**自分が作った分だけ**をFK順に削除する。他者データを上書きしない。
- **skipを成功と数えない。** `npm run test:db`（`REQUIRE_DB=1`）はSupabase未起動ならテスト前に落ちる。skipを許すと58ファイル分の検証が黙って消える。

### E2E（層4）

- **生成物は実データで描画する。** 画像・グラフ・ニュースカード・分析表を表示する画面は、本物のデータを載せて実際に描画するところまで見る。要素の存在ではなく**読み込めたこと**（画像なら `naturalWidth > 0`）を確認する。CSP違反・署名URL失効・デコード失敗はここでしか出ない。
- **「生成する」ボタンは押さない。** 実AI呼び出しは費用・不確定性・1分待ちをE2Eへ持ち込む。job の状態は `generation_jobs` を直接seedして表示契約だけを検証し、生成そのものは層6に任せる。
- `getByRole("alert")` は使わない。Next.js の route announcer も `role="alert"` を持つため必ず2要素に当たる。`alertIn(page)`（`e2e/fixtures/test.ts`）を使う。
- job はローカルで自動進行しない。worker（`/api/jobs/run`）や該当cron routeを明示的に叩き、完了は**期限付きで**pollする。
- 安全ゲート `e2e/fixtures/guard.ts` が `APP_ENV=development`・`X_POSTING_MODE=dry_run`・ローカルSupabase・ローカルbaseURLを起動前に検査する。外れたら1件も実行しない。
- retry は 0。flakyを無条件retryで隠すと「動いているつもり」になる。

### provider契約テスト（層5）

- **本番のファクトリとschemaをそのまま使う。** テスト側で「正しいペイロード」を書くと、検証しているのが本番の形でなくなる。2026-07-27、テスト側の最小schemaがたまたま正しかったためにPT-IMGのschema不備を見逃した。
- 構造化出力を使う実行を追加したら `PRODUCTION_SCHEMAS`（`provider-contract.live.test.ts`）へ登録する。
- **Googleは既定で検査しない**（運営キーのquota枯渇と画像404のため。T-M7-17）。Geminiアダプタを触ったら `PROVIDER_CHECK_GOOGLE=1 npm run check:providers` で明示的に有効化する。忘れると何も検査されないまま緑になる。
- 応答内容は検証しない（モデル出力は不定）。受理されることと正規化が壊れないことだけを見る。

### 実物スモーク（層6）

- 判定は `src/lib/smoke/scenarios.ts` の1か所に集約する。ローカル（`npm run smoke:live`）とデプロイ先（`GET /api/cron/canary`）が**同じ判定**を使うため。
- 作成した job・draft はシナリオ側で必ず削除する（成果物を残さない）。
- `/api/cron/canary` は **cron へ登録していない**（手動起動のみ。D-11で2026-07-28に決定）。定期実行へ切り替えるなら `vercel.json` に `crons` を追加する。

### スナップショット

`gen-prompts.test.ts` のスナップショットは**プロンプト設計書とのドリフト検知**。落ちたら「更新して通す」のではなく、正本（`docs/プロンプト設計書.md`）とコードの両方を更新したかを先に確認する。

---

## 5. このリポジトリ固有の落とし穴

実際に事故になった順に並べる。

### DBへの2経路（直結pg と PostgREST）が非対称

アプリは2つの経路でDBへ触る。

| 経路 | 接続ロール | GRANTの影響 |
|---|---|---|
| 直結pg（`DATABASE_URL`） | `postgres`（superuser） | **回避してしまう** |
| Supabaseクライアント（PostgREST） | `service_role` | **受ける** |

そのため**直結pgのテストだけが緑で、PostgREST経由の経路だけが `42501 permission denied` で落ちる**。2026-07-26、`service_role` に18テーブル中17テーブルのDML権限が無く、X連携が `internal_error` になった。テーブルを追加したら `service-role-grants.db.test.ts` が既定権限（`alter default privileges`）まで見る。

### 例外を握りつぶすと原因が消える

`catch {}` は eslint で禁止（`src/app/actions/**`・`src/app/api/**`・`src/lib/**`）。未知の失敗は共通出口で `recordUnexpectedError` が記録する（Server Action / API route / job）。

`onRequestError`（`src/instrumentation.ts`）は **throw された**例外しかSentryへ送らない。共通出口は catch して値を返すので、そこは自分で記録しないと何も残らない。

### 「正常な空」と「失敗による空」を必ず別の値で表す

今日の不具合の多くは**成功として記録される失敗**だった。

- 修復callが `{"items":[]}` を返す → 「該当ニュースなし」と区別できない
- 除外4件を `console.warn` にだけ出す → 記録に残らない
- CSPブロック → 画像が出ないだけでエラーなし

`researchNews` は `dropped` と `dropReasons` を返し、スモークは「0件かつ除外あり＝全滅」を失敗、「0件で除外も0＝該当なし」を成功として区別する。**新しい処理を書くときも、空になった理由を呼び出し側が説明できる形にする。**

### 任意項目のために本体を捨てない

`published_at` は任意項目なのに、厳密なISO 8601を要求していたため**日付だけ（`2026-07-28`）の記事5件すべてを失っていた**。任意のメタデータは正規化して、駄目ならそのフィールドだけ落とす。

### プロンプトで頼んだことは守られない前提で組む

「JSONのみ」と指示してもWeb検索併用時は前置き文が付く。「120字以内」と書いても超える。**出力形式は指示ではなく仕組みで保証する**（プロンプト設計書 §2 原則5）。抽出を寛容にする・正規化する・item単位で選別する、のいずれかで吸収する。

### production 以外から外向き副作用を出さない

X投稿は `X_POSTING_MODE`、通知メールは `canSendViaSmtp`（production以外はループバック宛のみ）で止めている。**新しい外向きチャネルを足したら同じガードを付ける。** 2026-07-27、SMTPにガードが無く、動作確認で実際に98通送信した。

---

## 6. デプロイ前後

- リリース判定ゲート: `npm run release:check`（typecheck → lint → 依存監査 → test:db → build → test:e2e）。同じものをCIが push / PR で実行する。
- **CIはデプロイをブロックしない**（`main` への push でCIとVercelのproductionビルドが並行する）。止めるなら branch protection（要決定D-8）。
- デプロイ先固有の問題は**その環境で実物を動かすまで分からない**。[デプロイ手順](./deployment.md) §5 の検証で `npm run smoke:live -- --base <URL> --account <UUID>` を叩く（その環境の `CRON_SECRET` を使う）。
- ただし **`smoke:live` はブラウザを起動しない**ので、CSP・署名URL・描画崩れは検出できない。その環境を実際にブラウザで開いて確認する（層4相当）。

---

## 7. 落ちたときに原因はどこに残るか

| 探す場所 | 何が分かるか |
|---|---|
| `generation_jobs.error` | 利用者向けメッセージ＋`provider_raw_error`（**providerの生の応答**）。画像schemaの400はここだけで特定できた |
| dev サーバーの標準エラー出力 `[unexpected] <at>` | 共通出口で丸められた未知の例外の生スタック。Web検索の400はここで判明した |
| Sentry | production/preview の未知例外（DSN設定時）。`beforeSend` で秘密値と prompt 内容を除去する |
| `test-results/` | E2E失敗時の trace・screenshot（`playwright.config.ts` の `retain-on-failure`／`only-on-failure`。CIでは失敗時のみ7日保存。html reporterは未設定なので `playwright-report/` は生成されない） |
| `cron_runs` | cron の受付履歴（時間窓claim。二重起動の抑止） |

**ログには秘密値を出さない。** `console.error` は redact を通らないため、生のエラーを出す箇所では何が含まれ得るかを意識する。

---

## 8. よく使うコマンド

| コマンド | 用途 |
|---|---|
| `npm test` | 単体＋DB統合（Supabase未起動ならDBテストはskip） |
| `npm run test:db` | 上記でskipを禁止（`REQUIRE_DB=1`） |
| `npm run test:e2e` | Playwright（devサーバーとローカルSupabaseが必要） |
| `npm run release:check` | リリース判定ゲート一式 |
| `npm run check:providers` | provider契約（実API・受理されるか） |
| `npm run smoke:live -- --account <xAccountId>` | 実物スモーク（実API・成果物まで） |
| `npm run db:clean-test-data` | ローカルのテストデータ掃除（既定dry-run・`-- --apply`で実行） |

詳細と全一覧は [ローカル開発](./local-development.md) §4。
