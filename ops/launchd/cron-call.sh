#!/usr/bin/env bash
# Exos AI launchd cron caller（要件04 §6・運用メモ §1/§2・ADR-0002/0003, T-M4-18）。
# ローカル起動アプリの /api/cron/* を Bearer 付きで呼ぶ。秘密値は plist へ直書きせず
# 所有者限定の秘密ファイル（CRON_SECRET_FILE）または macOS Keychain から取得する。
# timeout/DNS/5xx は 30s→60s の最大2回再試行、3回失敗でローカルlogへ記録。redirect は非成功扱い。
set -uo pipefail

ENDPOINT="${1:-}"
case "$ENDPOINT" in
  news-fetch | scheduler-tick | metrics-collector) ;;
  *)
    echo "usage: cron-call.sh <news-fetch|scheduler-tick|metrics-collector>" >&2
    exit 2
    ;;
esac

APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:3000}"
CONNECT_TIMEOUT="${CRON_CONNECT_TIMEOUT:-10}"
MAX_TIME="${CRON_MAX_TIME:-210}"
LOG_FILE="${CRON_LOG:-$HOME/Library/Logs/space-ai/cron.log}"
KEYCHAIN_SERVICE="${CRON_SECRET_KEYCHAIN_SERVICE:-space-ai-cron-secret}"
# 再試行間隔（秒）。既定 30,60（＝最大2回再試行）。テストは "0 0" で短縮可能。
read -r -a RETRY_DELAYS <<<"${CRON_RETRY_DELAYS:-30 60}"

# 秘密の取得: 秘密ファイル優先→Keychain。plist へは絶対に置かない。
read_secret() {
  if [[ -n "${CRON_SECRET_FILE:-}" && -f "${CRON_SECRET_FILE}" ]]; then
    tr -d '\r\n' <"${CRON_SECRET_FILE}"
    return 0
  fi
  if command -v security >/dev/null 2>&1; then
    security find-generic-password -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null && return 0
  fi
  return 1
}

SECRET="$(read_secret)" || {
  echo "cron-call: CRON_SECRET unavailable (set CRON_SECRET_FILE or Keychain '${KEYCHAIN_SERVICE}')" >&2
  exit 3
}

URL="${APP_BASE_URL%/}/api/cron/${ENDPOINT}"

log_failure() {
  mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
  printf '%s space-ai cron %s FAILED: %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENDPOINT" "$1" >>"$LOG_FILE"
}

max_attempts=$((${#RETRY_DELAYS[@]} + 1))
attempt=0
while :; do
  attempt=$((attempt + 1))
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
    --max-redirs 0 \
    -H "Authorization: Bearer ${SECRET}" \
    -X GET "$URL" 2>/dev/null)"
  curl_rc=$?

  # 成功は 2xx のみ（redirect は成功扱いにしない）。
  if [[ $curl_rc -eq 0 && "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    exit 0
  fi

  # 再試行対象: 接続timeout(28)/接続失敗(7)/DNS(6)/SSL(35) または HTTP 5xx。
  retryable=0
  case "$curl_rc" in 6 | 7 | 28 | 35) retryable=1 ;; esac
  [[ "$http_code" =~ ^5[0-9][0-9]$ ]] && retryable=1

  if [[ $retryable -eq 1 && $attempt -lt $max_attempts ]]; then
    sleep "${RETRY_DELAYS[$((attempt - 1))]}"
    continue
  fi

  log_failure "rc=${curl_rc} http=${http_code} attempts=${attempt}"
  exit 1
done
