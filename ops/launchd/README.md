# launchd 定時トリガー（初期・常時稼働Mac）

要件04 §6・運用メモ §1/§2・ADR-0002/0003 の初期定時トリガー4本。Vercel Cron 移行後は
`docs/operations/launchd-to-vercel-cron.md` §3/§4 に従う。

## 構成

| ファイル | job | 実行時刻(JST) | endpoint |
|---|---|---|---|
| `com.spaceai.news-fetch.plist` | news_fetch | **9:00〜21:00 3時間おき**（9/12/15/18/21時・T-M8-195） | `/api/cron/news-fetch` |
| `com.spaceai.scheduler-tick.plist` | scheduler_tick | 5分間隔（00・05・…・55の12エントリ） | `/api/cron/scheduler-tick` |
| `com.spaceai.metrics-collector.plist` | metrics_collector | 毎時00分 | `/api/cron/metrics-collector` |
| `com.spaceai.follower-snapshot.plist` | follower_snapshot | 毎時00分 | `/api/cron/follower-snapshot` |
| `cron-call.sh` | 共通呼び出し | — | Bearer 付きで endpoint を叩く |

`StartInterval` ではなく `StartCalendarInterval` を使う。plist に秘密値は書かない。

## セットアップ（実Macでの配置は open_questions）

1. Mac の timezone を `Asia/Tokyo` に固定し、スリープを無効化する。ユーザーloginに依存しない
   `LaunchDaemon`（`/Library/LaunchDaemons`）を基本とし、個人検証のみ `LaunchAgent` を許可する。
2. `CRON_SECRET` を Keychain へ保存する（plist へ直書きしない）:
   ```sh
   security add-generic-password -s space-ai-cron-secret -a "$USER" -w '<CRON_SECRET>'
   ```
   または所有者限定の秘密ファイル（`chmod 600`）を用意し、`cron-call.sh` に `CRON_SECRET_FILE` を渡す。
3. plist の `__INSTALL_DIR__` を実配置先（既定 `/opt/space-ai`）へ置換し、`ProgramArguments` の
   `APP_BASE_URL` をローカル起動アプリのURLに合わせる。`ops/launchd/` と `cron-call.sh` を配置し
   `logs/` を作成する。
4. `sudo cp com.spaceai.*.plist /Library/LaunchDaemons/` して各 plist を bootstrap:
   ```sh
   sudo launchctl bootstrap system /Library/LaunchDaemons/com.spaceai.news-fetch.plist
   # scheduler-tick / metrics-collector / follower-snapshot も同様
   ```
5. `plutil -lint /Library/LaunchDaemons/com.spaceai.*.plist` で妥当性を確認する。
6. 手動起動で疎通確認（2xx／secret不一致で401）:
   ```sh
   APP_BASE_URL=http://127.0.0.1:3000 CRON_SECRET_FILE=/path/secret \
     bash cron-call.sh scheduler-tick
   ```

## 呼び出し規則（cron-call.sh）

- `Authorization: Bearer ${CRON_SECRET}` を付与。接続timeout 10秒・request全体 210秒。
- timeout/DNS/5xx は 30秒→60秒で最大2回再試行。初回含む3回失敗でローカルlog（`CRON_LOG`、既定
  `~/Library/Logs/space-ai/cron.log`）へ記録し監視対象とする。
- HTTP redirect は成功扱いにしない（2xx のみ成功）。
- 再試行・重複起動の重複実行は handler 側の時間窓受付（`cron_runs` window claim）＋冪等keyで抑止する。

## 注記

- `metrics_collector` / `follower_snapshot` の route 本体は分析系マイルストーンで実装する。それまでは
  認証疎通（401/404）確認までとし、route 実装後に再検証する。
- 実Macへの配置・`launchctl bootstrap`・24時間監視は open_questions（運用メモ §1/§2）。
