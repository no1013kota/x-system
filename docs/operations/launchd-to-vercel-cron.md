# 運用メモ: launchdからVercel Cronへの切り替え

| 項目 | 内容 |
|---|---|
| バージョン | v1.2 |
| 更新日 | 2026-07-21 |
| 関連 | [システム構成](../requirements/01_system_architecture.md)／[ジョブ・自動実行](../requirements/04_jobs_and_automation.md) |

## 1. 方針

定時処理の本体はVercel上の`/api/cron/*`に置き、初期は常時稼働Macの`launchd`、移行後はVercel Cronが同じendpointを呼ぶ。DB job、冪等key、時間窓lease（`cron_runs`）・worker advisory lock、retry規則はトリガーに依存させない。

初期のMacはtimezoneを`Asia/Tokyo`に固定し、スリープを無効化する。ユーザーloginに依存しない`LaunchDaemon`を基本とし、開発者個人の検証だけ`LaunchAgent`を許可する。秘密値はplistへ直書きせずmacOS Keychainまたは所有者だけが読める秘密ファイルから取得する。

## 2. 初期launchdスケジュール

`StartInterval`ではなく`StartCalendarInterval`を使用する。

| job | launchd実行時刻（JST） | 呼び出すendpoint |
|---|---|---|
| `news_fetch` | 09:00〜20:00の毎時00分 | `/api/cron/news-fetch` |
| `scheduler_tick` | 5分間隔（毎時00・05・…・55分の12エントリ） | `/api/cron/scheduler-tick` |
| `metrics_collector` | 毎時00分 | `/api/cron/metrics-collector` |
| `follower_snapshot` | 毎時10分 | `/api/cron/follower-snapshot` |

呼び出しは`Authorization: Bearer ${CRON_SECRET}`を付ける。接続timeoutは10秒、request全体のtimeoutはFunction上限（200秒）より長い210秒以上とする。timeout・名前解決・5xxは30秒、60秒後に最大2回再試行し、初回を含む3回すべて失敗したらmacOSのローカルlogへ記録して監視対象とする。HTTP redirectは成功扱いにしない。再試行時の重複はhandlerの時間窓lease（`cron_runs`）と冪等keyで抑止する（完了後の再試行でも同一窓は再実行しない）。

Macの停止・スリープ・回線断中は定時性を保証できない。復帰時に予定から10分を超えた投稿slotを遡って投稿せず、`schedule_missed`として通知する。

## 3. Vercel Cronへの移行条件

次のいずれかで移行する。

- 外部ユーザーへ安定提供を開始し、個人Macを単一障害点にできなくなった
- 同一時刻のdue slotが`scheduler_tick`のdispatch上限（50件/起動）に近づく、またはqueued jobの回収遅延が許容できない
- Macの停止・スリープ・回線断により定時処理を1回でも取りこぼした
- 運用担当者がMacの死活監視・秘密管理を継続できない

## 4. 切り替え手順

1. Vercel projectへ初期と同じ`CRON_SECRET`が設定済みであることを確認する。
2. `vercel.json`へ次の4 scheduleを追加してproductionへdeployする。Vercel CronはUTCであることに注意する。
3. Vercel Dashboardで4 jobが登録され、手動HTTP呼び出しで2xxとDB上のlease（`cron_runs`）・処理結果を確認する。
4. Vercel Cronの初回実行をlogで確認する。切り替え中にlaunchdと重複しても、handlerの時間窓lease（`cron_runs`）と冪等keyで外部処理を重複させない。
5. 初回確認直後に`launchctl bootout`で4 jobを停止し、自動再読込設定も無効化する。
6. 24時間、cron実行log、`schedule_missed`、queued件数、最古queued経過時間を監視して移行完了とする。

```json
{
  "crons": [
    { "path": "/api/cron/news-fetch", "schedule": "0 0-11 * * *" },
    { "path": "/api/cron/scheduler-tick", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/metrics-collector", "schedule": "0 * * * *" },
    { "path": "/api/cron/follower-snapshot", "schedule": "10 * * * *" }
  ]
}
```

移行後も5分間隔（`*/5`）を維持する。負荷・費用に応じて間隔を調整してよいが、頻度変更時もendpointとDB schemaは変えない（スロット定刻00分/30分の起動は必ず含める）。

## 5. ロールバック

Vercel Cronで障害が出た場合はDashboardでCron Jobsを無効化し、launchdの4 jobを再読込する。同じ時間窓で重複起動しても安全だが、両方を長期間併用しない。復旧後はDBのqueued/stale jobと`schedule_missed`通知を確認し、投稿作成結果が不明なjobを盲目的に再送しない。
