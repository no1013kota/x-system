# 運用メモ: データベース論理バックアップと復元

| 項目 | 内容 |
|---|---|
| バージョン | v1.0 |
| 更新日 | 2026-08-18 |
| 関連 | [システム構成 §9](../requirements/01_system_architecture.md)／`scripts/db-backup.sh`・`scripts/db-restore.sh` |

## 1. 方針

Supabase Free には自動バックアップがないため（要件01 §9）、`pg_dump` による論理バックアップを手動運用する。dump は AES-256-CBC で暗号化して Supabase の外（暗号化外部ドライブ／クラウド等）に保管する。目標は **RPO 最大7日・RTO best effort**。

- **バックアップ頻度**: 週1回、および schema 変更（マイグレーション適用）の直前に必ず取得する。
- **暗号鍵 `BACKUP_ENCRYPTION_KEY`**: 十分に長いパスフレーズを 1Password / Keychain 等で管理し、**バックアップファイルとは別の場所**に保管する。リポジトリ・Supabase・`.env` には置かない。
- **保管**: 直近4週分以上を保持し、古いものはローテーションする。dump ファイル（`*.sql.enc`）と鍵は同じ場所に置かない。

## 2. 前提

- PostgreSQL 17 クライアント（`pg_dump` / `psql`。server 以上のバージョンが必要）と `openssl`。
  - 例: `brew install postgresql@17`（`pg_dump`/`psql` を PATH に通す）。
- 接続は pooler ではなく **direct 接続**の `DATABASE_URL` を使う（pg_dump は direct 推奨）。

## 3. バックアップ手順

```bash
DATABASE_URL="postgresql://…/postgres" \
BACKUP_ENCRYPTION_KEY="<保管したパスフレーズ>" \
BACKUP_OUT_DIR="/secure/location/backups" \
bash scripts/db-backup.sh
# → /secure/location/backups/exosai-YYYYMMDDTHHMMSSZ.sql.enc（AES-256-CBC 暗号化）
```

- スクリプトは `pg_dump --no-owner --no-privileges`（別インスタンス／新規プロジェクトへの復元時の role 依存回避）→ `openssl enc -aes-256-cbc -pbkdf2 -salt` の順で暗号化する。
- 生成物は暗号文（先頭が `Salted__`）で、平文 SQL は残さない。取得後、暗号化ファイルを Supabase 外の保管先へ退避する。

## 4. 復元手順

1. 空の復元先を用意する（新規 Supabase プロジェクト、またはローカルの新規 DB）。
2. 復元を実行する:

```bash
TARGET_DATABASE_URL="postgresql://…/<空DB>" \
BACKUP_ENCRYPTION_KEY="<バックアップ時と同じパスフレーズ>" \
bash scripts/db-restore.sh /secure/location/backups/exosai-YYYYMMDDTHHMMSSZ.sql.enc
```

3. 検証（元と一致することを確認する）:

```bash
# public テーブル数（現行 18）
psql "$TARGET_DATABASE_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
# seed（system default プロンプト 7件）
psql "$TARGET_DATABASE_URL" -tAc "select count(*) from public.prompt_templates"
```

- **想定される非致命エラー**: 非 superuser での復元では supabase 内部オブジェクト（`log_min_messages` の `SET`、`vault.secrets` への insert 等）に権限エラーが数件出る。アプリの `public` schema・データには影響しないため無視してよい（スクリプトは `ON_ERROR_STOP=0`）。superuser 権限がある環境ではエラーは出ない。

## 5. 検証済み（T-M6-19, 2026-07-25）

ローカル Supabase（PostgreSQL 17.6）で、`pg_dump` → openssl 暗号化 → openssl 復号 → `psql` で空DBへ復元、を実施。`public` テーブル 18件・`prompt_templates` seed が元と一致することを確認した（当時7件。T-M8-129 U2 以降は画像1件）（暗号化ファイルは `Salted__` 始まりの暗号文で平文 SQL ではない）。

## 6. 人手作業（要決定）

- バックアップ実行環境（常時稼働Mac 等の cron/launchd 設定）と、暗号化ファイルの保管先・鍵の保管先の用意は人間側作業。`open_questions` 参照。
