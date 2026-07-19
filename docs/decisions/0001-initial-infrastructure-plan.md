# ADR-0001: 初期インフラのプラン構成

- Status: Accepted
- Date: 2026-07-19
- Note: 定時トリガーの起動時刻（05分/35分）と回収モデルは[ADR-0002](./0002-job-dispatch-fanout.md)で置換された（5分間隔・dispatch fan-out）。その他の判断（Vercel Pro／Supabase Free／launchd／Gmail SMTP）は有効

## Context

Space AIは30分刻みの予約投稿に加え、未処理job、通知メール、期限切れデータを定期回収する必要がある。Vercel Cronを30分間隔で使うにはProが必要だが、初期は運用を小さく始め、定時トリガーだけ常時稼働Macへ置ける。一方、初期利用量ではSupabase Proの容量は不要であり、固定費を抑えたい。

## Decision

- 商用productionのhostingはVercel Proを使用する。定時トリガーは初期に常時稼働Macのlaunchdを使い、投稿スロット00分/30分に対して回収用`scheduler_tick`を05分/35分に起動する。
- 定時処理の本体はVercel上の同一API Routeへ置き、運用条件到達後に呼び出し元だけVercel Cronへ切り替える。切り替え・rollback手順は[運用メモ](../operations/launchd-to-vercel-cron.md)を正とする。
- Supabaseは初期にFreeを使用する。FreeのDB 500MB、Storage 1GB、自動backupなし、漏洩パスワード保護なし、非稼働時pauseの制約を受け入れる。
- 初期メール送信はGmail SMTPを使用し、送信元・返信先・問い合わせ先を`matsubuz.10@gmail.com`へ統一する。通常passwordではなくGoogle App PasswordをServer onlyで管理する。
- Free運用中は週1回およびschemaへ影響する変更前に`supabase db dump`で論理backupを取得し、Supabase外へ暗号化保存する。初期RPOは最大7日、RTOはbest effortとする。
- DBまたはStorage使用量が上限の80%へ到達した場合、Freeのpause・backup・security制約が運用上許容できなくなった場合、または日次自動backupが必要になった場合はSupabase Proへ移行する。

## Consequences

- 初期はVercel Cronに依存せず定時処理を検証でき、移行時もDB schemaやjob処理を変更せずに済む。
- launchd運用中はMacの電源、スリープ、回線、timezone、秘密管理が単一障害点になる。回収は通常5分後だが、即時dispatch失敗・stale job・queuedメールの次回回収は最大30分遅れる。
- Free運用中は自動backup、PITR、漏洩パスワード保護、稼働保証を利用できない。Turnstile、12文字以上のpassword、rate limit、手動backupで一部を補完するが、Proと同等の復旧性・securityにはならない。
- 個人向けGmailの送信上限・到達性に依存するため、通知量増加または配信品質低下が起きた場合は専用のtransactional email providerへ移行する。
- Pro移行後は日次backupと漏洩パスワード保護を有効化し、復元手順を確認する。

## Alternatives

- Supabase Proを初期から使う案は、backupとsecurityの運用が単純になる一方、初期固定費が増えるため採用しない。
- Vercel Cronを初期から使う案は運用が単純になるが、まずlaunchdで小さく検証してから切り替える方針を優先して採用しない。
- Vercel Functionの120秒上限はHobbyでも技術的に設定可能だが、商用productionのplan判断とは分けて扱う。
