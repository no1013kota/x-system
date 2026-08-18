# 運用メモ: launchdからVercel Cronへの切り替え

| 項目 | 内容 |
|---|---|
| バージョン | v1.4 |
| 更新日 | 2026-08-15 |
| 関連 | [システム構成](../requirements/01_system_architecture.md)／[ジョブ・自動実行](../requirements/04_jobs_and_automation.md) |

## 0. 現在の状態（2026-08-14）

**production は Vercel Cron へ移行済み**（T-M8-88）。`vercel.json` の `crons` に4本を登録している。

移行のきっかけは §3 の条件そのものではなく、**移行しないまま本番を公開してしまったこと**だった。2026-08-14 に `exosai.net` を公開した直後 `npm run doctor -- --base https://exosai.net` を回したところ「定時実行: まだ一度も動いていません」が出た。`vercel.json` が存在せず、`ops/launchd/` の4本は `http://127.0.0.1` 向けで `launchctl` にも未登録——つまり**本番では予約投稿・通知メール・ニュース取得・実績収集・日次サマリが1つも動かない状態でアプリだけが応答していた**。アプリは200を返すので画面からは分からない。

`ops/launchd/` の4本は移行前の構成としてリポジトリに残してある（§5 のロールバック先）。**launchdとVercel Cronを長期間併用しない。**

schedule の正本は要件04 §6 の表で、`vercel.json` との一致は `src/lib/ops/vercel-crons.test.ts` が検査する（4本あること・各schedule・UTCとJSTの取り違え・登録したpathのrouteの実在・カナリアを登録していないこと）。

## 1. 方針

定時処理の本体はVercel上の`/api/cron/*`に置き、初期は常時稼働Macの`launchd`、移行後はVercel Cronが同じendpointを呼ぶ。DB job、冪等key、時間窓の受付（`cron_runs` window claim）・worker advisory lock、retry規則はトリガーに依存させない。`cron_runs`は重複受付防止のみを担い本処理の成否・完了は持たない（この行だけで本体成功と判断しない）。完了の正本は`generation_jobs.status`/`finished_at`または対象業務データの現在状態（要件04 §6、ADR-0003）。

初期のMacはtimezoneを`Asia/Tokyo`に固定し、スリープを無効化する。ユーザーloginに依存しない`LaunchDaemon`を基本とし、開発者個人の検証だけ`LaunchAgent`を許可する。秘密値はplistへ直書きせずmacOS Keychainまたは所有者だけが読める秘密ファイルから取得する。

## 2. 初期launchdスケジュール

`StartInterval`ではなく`StartCalendarInterval`を使用する。

| job | launchd実行時刻（JST） | 呼び出すendpoint |
|---|---|---|
| `news_fetch` | 09:00〜20:00の毎時00分 | `/api/cron/news-fetch` |
| `scheduler_tick` | 5分間隔（毎時00・05・…・55分の12エントリ） | `/api/cron/scheduler-tick` |
| `metrics_collector` | 毎時00分 | `/api/cron/metrics-collector` |
| `follower_snapshot` | 毎時10分 | `/api/cron/follower-snapshot` |

呼び出しは`Authorization: Bearer ${CRON_SECRET}`を付ける。接続timeoutは10秒、request全体のtimeoutはFunction上限（200秒）より長い210秒以上とする。timeout・名前解決・5xxは30秒、60秒後に最大2回再試行し、初回を含む3回すべて失敗したらmacOSのローカルlogへ記録して監視対象とする。HTTP redirectは成功扱いにしない。再試行時の重複はhandlerの時間窓受付（`cron_runs` window claim）と冪等keyで抑止する（完了後の再試行でも同一窓は再受付しない）。

Macの停止・スリープ・回線断中は定時性を保証できない。復帰時に予定から10分を超えた投稿slotを遡って投稿せず、`schedule_missed`として通知する。

実体は `ops/launchd/`（T-M4-18）: 4本の `com.spaceai.*.plist`（`StartCalendarInterval`。news-fetch=Hour 9〜20/Minute 0、scheduler-tick=Minute 0〜55の5分刻み12件、metrics-collector=Minute 0、follower-snapshot=Minute 10）＋共通呼び出し `cron-call.sh`＋`README.md`（配置手順・Keychain）。`plist` に秘密値は書かず、`cron-call.sh` が `CRON_SECRET_FILE`（所有者限定）または Keychain（`space-ai-cron-secret`）から取得し `Authorization: Bearer` を付与、接続10秒/全体210秒・timeout/DNS/5xxを30秒→60秒で最大2回再試行・3回失敗でローカルlog記録・redirectは非成功扱いとする。`metrics-collector`/`follower-snapshot` の route 本体は分析系マイルストーンで実装するため、それまでは認証疎通のみ確認する。実Macへの配置・`launchctl bootstrap`・24時間監視は open_questions。

## 3. Vercel Cronへの移行条件

次のいずれかで移行する。

- 外部ユーザーへ安定提供を開始し、個人Macを単一障害点にできなくなった
- 同一時刻のdue slotが`scheduler_tick`のdispatch上限（50件/起動）に近づく、またはqueued jobの回収遅延が許容できない
- Macの停止・スリープ・回線断により定時処理を1回でも取りこぼした
- 運用担当者がMacの死活監視・秘密管理を継続できない

## 4. 切り替え手順

1. Vercel projectへ初期と同じ`CRON_SECRET`が設定済みであることを確認する。
2. `vercel.json`へ次の4 scheduleを追加してproductionへdeployする。Vercel CronはUTCであることに注意する。
3. Vercel Dashboardで4 jobが登録され、手動HTTP呼び出しで2xxとDB上の受付（`cron_runs`）・処理結果を確認する。
4. Vercel Cronの初回実行をlogで確認する。切り替え中にlaunchdと重複しても、handlerの時間窓受付（`cron_runs` window claim）と冪等keyで外部処理を重複させない。
5. 初回確認直後に`launchctl bootout`で4 jobを停止し、自動再読込設定も無効化する。
6. 24時間、cron実行log、`schedule_missed`、queued件数、最古queued経過時間を監視して移行完了とする。

```json
{
  "crons": [
    { "path": "/api/cron/news-fetch", "schedule": "0 1-11/2 * * *" },
    { "path": "/api/cron/scheduler-tick", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/metrics-collector", "schedule": "0 * * * *" },
    { "path": "/api/cron/follower-snapshot", "schedule": "10 * * * *" }
  ]
}
```

移行後も5分間隔（`*/5`）を維持する。負荷・費用に応じて間隔を調整してよいが、頻度変更時もendpointとDB schemaは変えない（スロット定刻00分/30分の起動は必ず含める）。

## 5. ロールバック

Vercel Cronで障害が出た場合はDashboardでCron Jobsを無効化し、launchdの4 jobを再読込する。同じ時間窓で重複起動しても安全だが、両方を長期間併用しない。復旧後はDBのqueued/stale jobと`schedule_missed`通知を確認し、投稿作成結果が不明なjobを盲目的に再送しない。
