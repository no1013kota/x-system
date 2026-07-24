#!/usr/bin/env bash
#
# Supabase 論理バックアップの復元（要件01 §9, T-M6-19）。
# 暗号化 dump（scripts/db-backup.sh の出力）を BACKUP_ENCRYPTION_KEY で復号し、
# TARGET_DATABASE_URL の「空の」DB へ psql で流し込む。手順は docs/operations/database-backup-restore.md を正とする。
#
# 前提: psql（PostgreSQL 17 クライアント）と openssl。復元先は空のDB/新規 Supabase プロジェクト。
# 使い方: TARGET_DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... bash scripts/db-restore.sh <backup-file.sql.enc>
#
# 注意: 非 superuser での復元では supabase 内部オブジェクト（vault.secrets への insert・log_min_messages
#       の SET 等）に権限エラーが数件出るが、アプリの public schema/データには影響しない（ON_ERROR_STOP=0）。
set -euo pipefail

: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY (バックアップ時と同じパスフレーズ)}"
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL (復元先の空DB接続文字列)}"

IN="${1:?usage: TARGET_DATABASE_URL=... BACKUP_ENCRYPTION_KEY=... bash scripts/db-restore.sh <backup-file.sql.enc>}"
PSQL="${PSQL:-psql}"

if [ ! -f "$IN" ]; then
  echo "backup file not found: $IN" >&2
  exit 1
fi

openssl enc -d -aes-256-cbc -pbkdf2 -pass "env:BACKUP_ENCRYPTION_KEY" -in "$IN" \
  | "$PSQL" "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=0

echo "restore complete → TARGET_DATABASE_URL"
echo "verify: public テーブル数と public.prompt_templates（seed 7件）が元と一致することを確認してください。"
