# ADR-0002: ジョブ実行のdispatch fan-outモデルとscheduler_tickの5分間隔化

- Status: Accepted
- Date: 2026-07-20
- Supersedes: ADR-0001のうち「定時トリガー時刻（05分/35分）」と「回収=tick内処理」の記述

## Context

実装前レビューで2つの構造問題が確認された。

1. 旧設計は`scheduler_tick`の1起動あたりjob処理を5件に制限し、起動は毎時05分/35分のみだった。「scheduled_for+10分でcanceled」ルールと組み合わさると、同時刻のdue slotが6件以上で6件目以降の予約投稿が確定的にキャンセルされる（lease機会が期限内に1回しかないため）。
2. 生成→画像→投稿の子job連鎖（最大240秒）が1 Functionのdeadline（110秒）に収まらず、残りが次回tick（最大30分後）送りとなり、画像ON自動投稿の定常遅延・手動生成のdraft確定遅延が発生する。

## Decision

- すべてのjobを「1 job = 1 worker Function呼び出し（`POST /api/jobs/run`、`CRON_SECRET`認証）」でdispatchする。workerは202を即時返却し、本処理を`after()`で実行する。dispatch経路は (1) 手動: Server Action/API Routeの`after()`、(2) 定時: `scheduler_tick`がenqueue直後に一括dispatch（上限50件/起動）、(3) 子job: 親jobのworkerが作成直後に連鎖dispatch、の3つ。tick内でjob本処理は行わない。
- `scheduler_tick`を5分間隔（毎時00・05・…・55分）で起動する。すべての起動が冪等なenqueueクエリ（直前10分以内の未処理slot）を実行してからdispatchし、あわせてdispatch失敗・stale jobの回収、期限切れcancel、通知メール・期限切れデータのcleanupを行う（定刻起動が全滅しても後続tickが+10分期限内にenqueue・dispatchできる）。初期はlaunchd、移行後はVercel Cron（`*/5`）。
- worker/cron routeの`maxDuration`を200秒、Function内の処理deadlineを180秒とする（provider callは最大90秒のまま。初回call＋JSON修復callが1 attemptに収まる）。VercelのFluid compute上限（Hobby 300秒／Pro 800秒）内。

## Consequences

- 同時due slotの処理能力が「5件/30分」から「50件/起動・各jobは独立Function」へ拡大し、正常系の自動投稿は定刻から概ね5分以内に完了する。「生成→画像→投稿」の段間遅延はdispatch往復の数秒になる。
- dispatch失敗・stale時の回収も最大5分に短縮され、schedule_missed（+10分ルール）までに通常2回の追加lease機会がある。
- launchdの起動が5分間隔×終日（288回/日）となり、Vercel Cron移行後の実行回数も増える（Fluid computeの課金は主にアクティブCPU時間のため影響は小さい）。
- worker Functionの同時実行数が増えるため、DB接続はSupabaseのconnection pooler経由とし、同時実行はtickのdispatch上限（50）と同一Xアカウント・同一user直列化で制御する。
- launchd側のHTTP timeoutはFunction上限（200秒）より長く取る（運用メモ参照）。

## Alternatives

- tick内で最大N件を処理する旧方式: Nを増やしてもFunction deadlineと衝突し、容量の崖が残るため不採用。
- tick起動を00分/30分の2回/時にとどめる案: 正常系は成立するが、dispatch失敗・子job回収・queuedメールの遅延が最大30分残り、+10分キャンセルルールとの整合が脆いため不採用。
- schedule起点jobの優先lease規則の追加: dispatch fan-outにより不要になったため導入しない。
