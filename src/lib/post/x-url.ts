/**
 * X投稿URLの検証（要件05 §12, T-M3-01）。hostは`x.com`/`twitter.com`（www.可）、pathは
 * `/{handle}/status/{numeric_id}`だけ許可する。引用ポスト・出典のX URL検証で共用する純粋関数。
 */

const X_HOSTS = new Set(["x.com", "twitter.com"]);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_ID_RE = /^\d+$/;

export interface XPostRef {
  handle: string;
  statusId: string;
}

export function parseXPostUrl(input: string): XPostRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const bareHost = host.startsWith("www.") ? host.slice(4) : host;
  if (!X_HOSTS.has(bareHost)) return null;

  const parts = url.pathname.split("/").filter((p) => p.length > 0);
  // 期待: [handle, "status", numericId]
  if (parts.length !== 3 || parts[1] !== "status") return null;
  const [handle, , statusId] = parts;
  if (!HANDLE_RE.test(handle) || !STATUS_ID_RE.test(statusId)) return null;
  return { handle, statusId };
}

export function isValidXPostUrl(input: string): boolean {
  return parseXPostUrl(input) !== null;
}
