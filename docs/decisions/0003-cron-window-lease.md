# ADR-0003: 定時トリガーの時間窓重複防止をcron_runs leaseで行う

- Status: Accepted
- Date: 2026-07-21
- Supersedes: なし（T-M0-15骨格のセッションadvisory lock実装を是正。ADR-0002の定時トリガー方針は維持）

## Context

定時トリガー4本（`news-fetch`／`scheduler-tick`／`metrics-collector`／`follower-snapshot`）は、launchdのHTTP再試行・launchd→Vercel Cron切り替え時の二重起動・Vercel Cronの重複/並行起動に備え、`job名 + 対象時刻窓`ごとに高々一度だけ本処理を実行する必要がある（要件04 §1/§6）。

T-M0-15の初期実装（`withCronWindowLock`）は、プールから取得した1接続でセッションscopeの`pg_try_advisory_lock`を取得し、ハンドラ実行完了まで保持してから`pg_advisory_unlock`する方式だった。しかしworker/cronのDB接続はSupavisor **transaction mode** のpooler（`DATABASE_URL`）経由で、要件01 §3.2/§6は「Function内で接続を保持せず都度取得・即解放」を必須とする。`src/lib/db/pool.ts`自身も「transaction-mode poolingはcheckout間でセッション状態を保持しない」と明記している。

transaction modeでは文（暗黙トランザクション）ごとにバックエンドが割り当て/解放され得るため、セッションscope advisory lockをハンドラ全体で保持する設計は次の不具合を生む。

- `pg_advisory_unlock`がロック保持と別バックエンドに当たりロックがリークし、以降その時間窓が起動不能になる。
- 並行起動が別バックエンドで各々`pg_try_advisory_lock`に成功し、相互排他が効かず**二重起動**する（受け入れ条件そのものを本番で満たさない）。
- `scheduler-tick`ではロック保持接続を本処理が使わず（`runSchedulerTick`が別`withTransaction`を開く）、接続が宙に浮く。

この不整合はローカル（直結Postgres＝セッション継続）ではテストが通るため露見せず、本番poolerでのみ顕在化する。独立レビュー（review-m0-12-to-20）で確定。

## Decision

セッションadvisory lockをやめ、`cron_runs`テーブルの**lease行**で時間窓の重複を防ぐ。

- `cron_runs(id, job_name, window_key, started_at, finished_at)`、`unique (job_name, window_key)`。service role専用（RLS有効・authenticatedポリシー/GRANTなし）。
- `withCronWindowLock(jobName, windowKey, fn)`は単一transaction内で `insert into cron_runs (job_name, window_key) values ($1,$2) on conflict do nothing returning id` を実行し、行を確保できた起動だけが`fn`を実行して`finished_at`を記録する。確保できなければ`ran:false`を返し呼び出し元は処理済み相当の2xxを返す。
- `fn`は接続を受け取らず、自前で`withTransaction`等により都度接続を取得する（接続を保持しない）。
- 対象時刻窓は`hourWindowKey`（毎時cron）/`fiveMinWindowKey`（5分tick）で表す。

worker leaseの`pg_advisory_xact_lock`（transaction scope・要件04 §4）は変更しない。これはトランザクション終了で自動解放されるためtransaction mode poolerで安全。

## Consequences

- transaction mode poolerでも確実に排他できる。接続を保持しないため要件01 §3.2/§6の規約に適合する。
- **一度確保した時間窓は生涯再実行されない**。完了後のHTTP再試行・重複Cron起動でも本処理を再実行しない（従来のadvisory方式は完了後にlockが解放され、再試行で全ハンドラを再実行し得る弱点があった）。
- 起動の可観測性が上がる（`started_at`/`finished_at`）。
- 受け入れる欠点: claim後・完了前にプロセスが落ちるとその時間窓は`finished_at` nullのまま再実行されない。5分tickは次窓で追随し、毎時cronの本処理は分野別冪等keyや次回起動で回復するため許容する。将来必要なら「`started_at`が一定時間より古く`finished_at` nullなら再claim可」を追加できる（`finished_at`列はそのために残す）。
- `cron_runs`は起動ごとに増える（tick 288行/日＋毎時cron数十行/日）。保持cleanupは`scheduler_tick`（M4）で他の40日保持データと同様に削除する（`cron_runs_started_at_idx`を用意済み）。

## Alternatives

- セッションadvisory lockのままcron専用にsession mode poolerを併用する案: 接続種別が増え運用が複雑化し、要件01の「接続を保持しない」方針とも相反するため不採用。
- ハンドラ全体を1トランザクションに入れて`pg_advisory_xact_lock`で保持する案: 外部API処理を含む長時間トランザクションを生み、要件01の複文transaction方針・接続即解放と衝突するため不採用。
