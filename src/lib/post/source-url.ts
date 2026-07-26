/**
 * 出典URLの検証（要件05 §12・プロンプト設計書 §7, T-M3-01）。https必須、DNS解決後の
 * private/loopback/link-local IPを拒否、redirect先も再検証、timeout 10秒。本文は取得しない（HEAD）。
 * DNS・fetch・時計は注入し純粋に保つ（モックでSSRF系をテスト）。
 */

export const SOURCE_URL_TIMEOUT_MS = 10_000;
export const SOURCE_URL_MAX_REDIRECTS = 5;

export interface ResolvedAddress {
  address: string;
  family: number; // 4 | 6
}

export interface SourceUrlDeps {
  /** hostname を全解決アドレスへ（node dns.lookup {all:true} 相当）。 */
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  /** HEAD 相当。redirect は手動で辿るため 'manual'。 */
  fetch: (
    url: string,
    init: { method: string; redirect: "manual"; signal: AbortSignal },
  ) => Promise<{ status: number; headers: { get(name: string): string | null } }>;
  timeoutMs?: number;
  maxRedirects?: number;
}

export type SourceUrlReason =
  | "invalid_url"
  | "not_https"
  | "dns_failed"
  | "blocked_ip"
  | "too_many_redirects"
  | "redirect_no_location"
  | "http_error"
  | "timeout";

export interface SourceUrlResult {
  ok: boolean;
  finalUrl?: string;
  reason?: SourceUrlReason;
}

function ipv4ToOctets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

function isPrivateIpv4(ip: string): boolean {
  const o = ipv4ToOctets(ip);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 (unspecified/this-network)
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a >= 224) return true; // multicast/reserved (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

/** private/loopback/link-local/unspecified/reserved を拒否対象と判定する。 */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr.includes(".")) {
    // IPv4-mapped IPv6 (::ffff:1.2.3.4) の末尾IPv4を取り出して判定
    const mapped = addr.split(":").pop();
    if (addr.includes(":") && mapped) return isPrivateIpv4(mapped);
    return isPrivateIpv4(addr);
  }
  // IPv6
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe80") || addr.startsWith("fe9") || addr.startsWith("fea") || addr.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // fc00::/7 ULA
  if (addr.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
}

async function hostAllowed(hostname: string, deps: SourceUrlDeps): Promise<boolean | null> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await deps.resolve(hostname);
  // eslint-disable-next-line no-restricted-syntax -- DNS解決の失敗が判定結果（null＝解決不能としてSSRF検証を落とす）
  } catch {
    return null; // DNS失敗
  }
  if (addresses.length === 0) return null;
  // いずれかが拒否対象なら不許可（DNS rebinding対策で全アドレスを確認）
  return !addresses.some((a) => isBlockedIp(a.address));
}

export async function validateSourceUrl(
  rawUrl: string,
  deps: SourceUrlDeps,
): Promise<SourceUrlResult> {
  const maxRedirects = deps.maxRedirects ?? SOURCE_URL_MAX_REDIRECTS;
  const timeoutMs = deps.timeoutMs ?? SOURCE_URL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let url: URL;
      try {
        url = new URL(current);
      // eslint-disable-next-line no-restricted-syntax -- URLとして解釈できないことが判定結果（invalid_url）
      } catch {
        return { ok: false, reason: "invalid_url" };
      }
      if (url.protocol !== "https:") return { ok: false, reason: "not_https" };

      const allowed = await hostAllowed(url.hostname, deps);
      if (allowed === null) return { ok: false, reason: "dns_failed" };
      if (!allowed) return { ok: false, reason: "blocked_ip" };

      let res: { status: number; headers: { get(name: string): string | null } };
      try {
        res = await deps.fetch(url.toString(), {
          method: "HEAD",
          redirect: "manual",
          signal: controller.signal,
        });
      // eslint-disable-next-line no-restricted-syntax -- 失敗理由は timeout / http_error として戻り値に残る
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "http_error" };
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return { ok: false, reason: "redirect_no_location" };
        if (hop === maxRedirects) return { ok: false, reason: "too_many_redirects" };
        current = new URL(location, url).toString(); // 相対Locationも解決
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, finalUrl: url.toString() };
      }
      return { ok: false, reason: "http_error" };
    }
    return { ok: false, reason: "too_many_redirects" };
  } finally {
    clearTimeout(timer);
  }
}
