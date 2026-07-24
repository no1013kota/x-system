#!/usr/bin/env bash
#
# Supabase 論理バックアップ（要件01 §9, T-M6-19）。
# DATABASE_URL の DB を pg_dump し、BACKUP_ENCRYPTION_KEY で AES-256-CBC 暗号化して
# Supabase 外のファイル（BACKUP_OUT_DIR、既定 ./backups）へ保存する。
# 復元手順・運用（週1回＋schema変更前・RPO/RTO）は docs/operations/database-backup-restore.md を正とする。
#
# 前提: pg_dump（PostgreSQL 17 クライアント。server 以上のバージョン）と openssl。
# 使い方: DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... bash scripts/db-backup.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (dump 対象DBの接続文字列。pooler ではなく direct 接続を推奨)}"
: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY (AES パスフレーズ。リポジトリ・Supabase の外で保管)}"

OUT_DIR="${BACKUP_OUT_DIR:-./backups}"
PG_DUMP="${PG_DUMP:-pg_dump}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT_DIR}/spaceai-${TS}.sql.enc"

mkdir -p "$OUT_DIR"

# --no-owner/--no-privileges: 別インスタンス/新規プロジェクトへ復元する際の role 依存を避ける。
# パスフレーズはコマンドラインに出さず env 経由で openssl へ渡す。
"$PG_DUMP" --no-owner --no-privileges "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "env:BACKUP_ENCRYPTION_KEY" \
  > "$OUT"

echo "backup written: ${OUT} ($(wc -c < "$OUT" | tr -d ' ') bytes, AES-256-CBC encrypted)"
