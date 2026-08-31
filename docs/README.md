# ドキュメントマップ

`docs/` はExos AIの仕様の正本（Single Source of Truth）。**実装と食い違った状態を放置しない。**

- 実装を始める人はまず [開発とテストの進め方](./operations/development-and-testing.md)
- 運用中に「いま何が壊れているか」を知るには [動いているかの見張り方](./operations/monitoring.md)
- 触った層ごとの必須の検証は `CLAUDE.md`「変更影響 → 必須の検証」が正本

## 1. どこに何があるか

### 仕様の正本

| 文書 | 何が書いてあるか | 更新するとき |
|---|---|---|
| [PRD](./PRD.md) | 何を作るか・なぜ。機能ID、スコープ、プラン、料金、上限、非機能、成功指標 | 要件・料金・スコープ・上限が変わる |
| [要件定義書](./要件定義書.md) | どう作るかの全体像と、下の詳細への索引 | 詳細文書の構成が変わる |
| [プロンプト設計書](./プロンプト設計書.md) | AI実行ID、プロンプト全文、出力検証、provider adapter | AI実行・プロンプト・検証・計数が変わる |
| [投稿パターン別プロンプト設計](./prompt/README.md) | パターンごとの高インプレ実例・構造分解・設計判断（本文の正本はコードと設計書§6） | 投稿パターンのプロンプトを変える（先に設計を更新する） |

### 要件詳細（`requirements/`）

| 文書 | 担当範囲 |
|---|---|
| [01 システム構成](./requirements/01_system_architecture.md) | 技術スタック、環境変数、認証・proxy、監視、ログ保持 |
| [02 データモデル](./requirements/02_data_model.md) | 全26テーブルの列・制約・保持期間、jsonbの形 |
| [03 認証・課金・利用量](./requirements/03_auth_billing_usage.md) | 登録・ログイン、Stripe、プラン、利用枠、実行ガード |
| [04 ジョブと自動化](./requirements/04_jobs_and_automation.md) | 定時トリガー、ジョブキュー、アプリ内通知、cleanup |
| [05 API・Server Actions](./requirements/05_api_server_actions.md) | 入出力の形、エラーコード、認可、楽観lock |
| [06 画面](./requirements/06_screens_onboarding_posting.md) | SC-01〜11の画面仕様、App Shell、文言の方針 |

### 運用メモ（`operations/`）

| 文書 | 使う場面 |
|---|---|
| [開発とテストの進め方](./operations/development-and-testing.md) | **実装前に読む。** テスト8層の役割と盲点、書き方の規約、固有の落とし穴 |
| [動いているかの見張り方](./operations/monitoring.md) | 運用中。doctorの検査項目、Sentry、毎朝の運営者メール |
| [ローカル開発](./operations/local-development.md) | 手元で起動・確認する |
| [CI](./operations/ci.md) | GitHub Actionsが何を回すか |
| [デプロイ手順](./operations/deployment.md) | staging / production へ出す |
| [リリース前チェックリスト](./operations/release-checklist.md) | 公開前の確認と、人がやる準備 |
| [招待報酬の銀行振込](./operations/affiliate-payouts.md) | 月1回の振込と支払記録（T-M8-174/176） |
| [DBバックアップ・復元](./operations/database-backup-restore.md) | バックアップを取る・戻す |
| [launchd→Vercel Cron](./operations/launchd-to-vercel-cron.md) | 定時実行の移行経緯と現在の設定 |

### その他

| 場所 | 位置づけ |
|---|---|
| [ADR](./decisions/README.md) | 上記で表現しきれない技術判断。不可逆な選択をしたとき |
| [marketing/](./marketing/) | **正本ではない。** LP等の外部制作へ渡す依頼文（作成時点のスナップショット） |
| [`blog/`](../blog/README.md)（リポジトリ直下） | 公開ブログの記事（Markdown）。書き方・front matter・投稿の流れは同ディレクトリの README が正本。画面仕様は要件06 |

## 2. 仕様の所有ルール（どこに書くか）

| 種類 | 正本 | 他の文書には |
|---|---|---|
| 機能の有無、プラン差、料金、月間上限 | PRD | 参照だけ |
| DB・API・画面・jobの数値と構造 | `requirements/` の担当文書 | 要件定義書には要約だけ |
| AIプロンプト全文、出力検証 | プロンプト設計書 | 要件詳細には実行順と保存先だけ |
| 触った層 → 必須の検証の対応表 | `CLAUDE.md` | 運用メモには実行の仕方と理由 |
| 未決の事業判断 | `tasks/BACKLOG.md`「要決定」 | 要件詳細へ重複記載しない |

**同じ数字を2か所に置かない。** 片方だけ古くなる。1つの変更が複数領域へ影響するなら同じ作業単位で更新する（例: 利用上限の変更はPRD・要件03・プロンプト設計書の計数規則）。

## 3. コードとのズレを止める仕組み

**手で数え上げた一覧は必ず古くなる。** ADR-0005は因果を正しく書きながら適用先を手で列挙したため認証画面が漏れ、本番の`/signup`が18日間動かなかった（T-M8-87）。だから**機械が突き合わせる**。

| 検査 | 何と何を突き合わせるか | 実行 |
|---|---|---|
| `npm run check:doc-dates` | 更新日 ↔ その文書を最後に変えたコミットの日付。version ↔ 変更履歴 | `release:check` |
| `npm run check:doc-refs` | docs内のファイルパス ↔ 実在するファイル（`git ls-files`） | `release:check` |
| `schema-doc-sync.db.test.ts` | 要件02の表 ↔ 実DBの列 | `npm run test:db` |
| `doctor-doc-sync.test.ts` | monitoring.md §2の表 ↔ doctorが実際に出す項目 | `npm test` |
| `vercel-crons.test.ts` | 要件04の定時トリガー ↔ `vercel.json` | `npm test` |
| `warning-docs-sync.test.ts` | 要件06の警告文言 ↔ コードの警告定義 | `npm test` |
| `next-action-commands.test.ts` | 運営者へ示すコマンド ↔ 実在する`package.json`スクリプト | `npm test` |
| `route-auth.test.ts` | 開発とテストの進め方の記述 ↔ cron routeの認可 | `npm test` |
| `legal-pages.test.ts` | 法務3ページ ↔ 委託先・Cookie・事業者情報の定数 | `npm test` |
| `npm run check:csp-nonce` | ビルド成果物のHTML ↔ nonce付きCSPの前提 | `release:check` |
| `blog-articles.test.ts`／`npm run blog:check` | `blog/*.md` の front matter ↔ 画面と同じ判定（`blog-content.ts`）。不備は公開側に出ないだけなので、ここで止める | `npm test`／運営者が投稿前に実行 |

**新しく一覧や数値をdocsへ書くときは、突き合わせる検査も同時に作る。** 作れないなら「実測が正」と明記して日付を添える（例: テスト本数）。

## 4. ID体系

| 種別 | ID |
|---|---|
| 機能 | A / L / N / P / S / K / M / O / R |
| 画面 | SC-01〜SC-12 |
| AI実行 | GEN / NEWS / LRN / MD-MERGE / SUGGEST |
| 開発タスク | `T-M<マイルストーン>-<連番>`（`tasks/BACKLOG.md`） |
| 要決定 | `D-<連番>`（同ファイル「要決定・外部準備」） |
| ADR | `<4桁>-<slug>.md`（`decisions/`） |

## 5. 更新ルール

- **versionは文書内ヘッダを正とする。** ファイル名にversionを含めない。
- 仕様変更時は冒頭の**更新日**と末尾の**変更履歴**を更新する。表記修正だけならversionは上げない。
- ADRのように旧名を書き残したいときは、生きた参照を現在のファイルへ向け、**旧名はバッククォートで囲まず地の文で書く**（`check:doc-refs` が旧名を実在チェックするため）。
- DB変更はmigration、API変更は呼び出し側、prompt変更は検証schemaへの波及を同時に確認する。
- 外部APIの価格・scope・field・limitはリリース前に公式情報で確認し、**確認日**を該当文書へ残す。
- コードがまだない領域は「未実装」であることを明記する。
- コミット前に `/doc-sync` を実行する。
