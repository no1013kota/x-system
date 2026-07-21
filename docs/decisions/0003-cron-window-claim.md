# ADR-0003: 定時トリガーの時間窓重複受付防止をcron_runs window claimで行う

- Status: Accepted
- Date: 2026-07-21
- Supersedes: なし（T-M0-15骨格のセッションadvisory lock実装を是正。ADR-0002の定時トリガー方針は維持）

## Context

定時トリガー4本（`news-fetch`／`scheduler-tick`／`metrics-collector`／`follower-snapshot`）は、launchdのHTTP再試行・launchd→Vercel Cron切り替え時の二重起動・Vercel Cronの重複/並行起動に備え、`job名 + 対象時刻窓`ごとに受付を高々一度にする必要がある（要件04 §1/§6）。

T-M0-15の初期実装は、プールから取得した1接続でセッションscopeの`pg_try_advisory_lock`を取得し、ハンドラ実行完了まで保持してから解放する方式だった。しかしworker/cronのDB接続はSupavisor **transaction mode** のpooler（`DATABASE_URL`）経由で、要件01 §3.2/§6は「Function内で接続を保持せず都度取得・即解放」を必須とする。`src/lib/db/pool.ts`自身も「transaction-mode poolingはcheckout間でセッション状態を保持しない」と明記している。

transaction modeでは文（暗黙トランザクション）ごとにバックエンドが割り当て/解放され得るため、セッションscope advisory lockをハンドラ全体で保持する設計はロックのリーク（unlockが別バックエンドに当たる）や並行起動での二重取得（相互排他が効かない）を招く。ローカル（直結Postgres）ではテストが通り本番poolerでのみ顕在化する。独立レビュー（review-m0-12-to-20）で確定。

## Decision

セッションadvisory lockをやめ、`cron_runs`テーブルの**window claim（dedup marker）**で時間窓の重複受付を防ぐ。

- `cron_runs(id, job_name, window_key, claimed_at)`、`unique (job_name, window_key)`。service role専用（RLS有効・authenticatedポリシー/GRANTなし）。
- `withCronWindowClaim(jobName, windowKey, fn)`は単一transaction内で `insert into cron_runs (job_name, window_key) values ($1,$2) on conflict do nothing` を実行し、行を確保できた起動だけが`fn`を実行する。確保できなければ`ran:false`を返し呼び出し元は処理済み相当の2xxを返す。
- `fn`は接続を受け取らず、自前で`withTransaction`等により都度接続を取得する（接続を保持しない）。
- 対象時刻窓は`hourWindowKey`（毎時cron）/`fiveMinWindowKey`（5分tick）で表す。

worker leaseの`pg_advisory_xact_lock`（transaction scope・要件04 §4）は変更しない。これはトランザクション終了で自動解放されるためtransaction mode poolerで安全。

### 責務分担（cron_runs は完了状態を持たない）

`cron_runs`の責務は「同一 `job_name`/`window_key` の重複受付防止」**のみ**。本処理の成否・完了は保持せず、`cron_runs`の行の有無だけで本体成功を判断してはならない。完了状態の正本は次のとおり。

- 永続ジョブ: `generation_jobs.status` / `generation_jobs.finished_at`
- 状態ベースcron（tick/metrics/follower）: 対象業務データの現在状態（例: 当日分の`follower_snapshots`行の有無、`drafts.metrics_completed_at`、queued/runningな`generation_jobs`）

そのため`cron_runs`に完了列（`finished_at`等）は設けない。

### 実行保証

- **Cronトリガー**: `(job_name, window_key)` 単位で **at-most-once**（同一窓の受付は高々一度）。
- **generation_jobs**: retry（`attempt`上限3・指数backoff）とstale回収・scheduler再dispatchによる **at-least-once 相当**。
- **状態ベースcron**: 同一窓は再実行せず、**次窓で現在状態を再走査してcatch-up**する（tickはqueued/staleを毎回回収、metrics/followerはdue対象を毎回処理）。
- **副作用**: 冪等キーまたはDB制約（unique）で重複に耐える設計とする。
- **受付（cron claim）と業務処理の完了は別状態**として扱う。
- 本システムのどの経路も **exactly-once を保証しない**。exactly-onceを主張する表現は用いない。

## Consequences

- transaction mode poolerでも確実に重複受付を防げる。接続を保持しないため要件01 §3.2/§6に適合する。
- **一度受け付けた時間窓は完了後も再受付しない**。完了後のHTTP再試行・重複Cron起動でも本処理を再実行しない。
- 受け入れる欠点: 受付後・本処理未完了でプロセスが落ちた窓は、状態ベースcron（tick/metrics/follower）は次窓のcatch-upで回復する。`news_fetch`のように窓固有の成果を作るものは、この単純なclaimでは失敗窓を回復できないため、下記「news_fetchの時間窓欠落対策」の3時間ラップ取得で回復性を持たせる。
- `cron_runs`は受付ごとに増える（tick 288行/日＋毎時cron数十行/日）。**保持は暫定40日**とし、`scheduler_tick`（M4）が他の40日保持データと同様に`claimed_at`基準でcleanupする（要件01 §9、`cron_runs_claimed_at_idx`）。
- cleanupで古い行が消えると同一 `window_key` を再claim可能になるが、`window_key`は時刻由来で単調増加するため、保持期間を超えた過去の窓が通常運用で再来・再実行されることはない。

### news_fetch の時間窓欠落対策（解決: 3時間ラップ取得。2026-07-21）

`news_fetch`は時間窓の欠落を許容しない一方、単純な `withCronWindowClaim`（受付を先にコミットしてから`fn`を実行）は、受付後に本処理が失敗/中断した窓を回復できない（同一窓の再試行は`ran:false`）。

当初「window claim と永続ジョブ（`generation_jobs`）のINSERTを同一transactionで行い実処理をworkerに委ねる」案（案II）を検討したが、**要件04 §2「NEWSはユーザー所有の`generation_jobs`へ保存しない。実行結果は`news_items.fetched_at`で追跡する」と矛盾**する（加えて6分野×最大90秒はFunction上限200秒に単一jobでは収まらずchild job分割が必要）ため**不採用**。

採用（案I・§2維持）: `news_fetch`は**各回が直近3時間分を重ねて取得**する。1時間ごと起動で窓が重なるため、一部起動が失敗しても**3回に1回成功すれば**当該時間帯を取得できる（稼働は9:00〜20:00・12回/日を維持。前日20:00以降の夜間分は当日9:00/10:00/11:00の起動が延長ルックバック13/14/15時間で補完する。プロンプト設計書 §6.10の`{{hours}}`）。重複は`source_url`のcanonical unique制約と`<known_urls>`で排除する。したがって`cron_runs`の受付は並行・重複起動の抑止のみを担い、欠落回復はラップ取得側が持つ。完了追跡は§2どおり`news_items.fetched_at`、UIは既定で過去7日分を表示する（PRD N-1/N-2、要件04 §6、T-M4-10/11）。

### M4で追加を想定する汎用プリミティブ

`withCronWindowClaim`は受付をコミットしてから`fn`を呼ぶため、受付とその他のDB書き込みを同一transactionにしたいcron（例: `scheduler_tick`のenqueueを受付と原子的に行いたい場合）には次のプリミティブを別途用意できる。汎用部品として位置づける（news_fetchは案I＝3時間ラップ取得のため本プリミティブに依存しない）。

- `tryClaimCronWindow(client, jobName, windowKey): Promise<boolean>` — 呼び出し側の`withTransaction`内で`insert ... on conflict do nothing`を実行し受付可否を返す。`withCronWindowClaim`もこのプリミティブを内部利用するよう整理できる。

## Alternatives

- セッションadvisory lockのままcron専用にsession mode poolerを併用する案: 接続種別が増え運用が複雑化し、要件01の「接続を保持しない」方針と相反するため不採用。
- ハンドラ全体を1トランザクションに入れて`pg_advisory_xact_lock`で保持する案: 外部API処理を含む長時間トランザクションを生み、要件01の複文transaction方針・接続即解放と衝突するため不採用。
- `cron_runs`に完了列（`finished_at`/status）を持たせ完了管理も兼ねる案: 完了の正本が二重化し、「受付」と「完了」が混線するため不採用。完了は`generation_jobs`・業務データを正本とする。
