import { STRIPE_HOSTED_ORIGINS } from "@/lib/stripe/hosted-origins";

/**
 * セキュリティヘッダ／CSP の構築（要件01 §8, T-M6-17）。proxy（updateSupabaseSession）から使う。
 * next/server に依存しない純粋関数として書き、ユニットテスト可能にする（Headers はグローバル）。
 *
 * - script-src は 'self'＋per-request nonce＋'strict-dynamic' のみ（'unsafe-inline' 無し）＝nonceなし
 *   inline script を実行させない。Next.js は request の CSP から nonce を読み、自身のscriptへ付与する。
 * - style は React の inline style属性・Next/Tailwind のため 'unsafe-inline' を許可する。
 * - 外部: Turnstile（script/iframe）と、DSN設定時の Sentry Ingest（connect-src）。
 * - HSTS と upgrade-insecure-requests は production（NODE_ENV=production）のみ。
 */

const TURNSTILE = "https://challenges.cloudflare.com";
const STRIPE_HOSTED = STRIPE_HOSTED_ORIGINS.join(" ");
const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

export function isProdRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** リクエストごとの CSP nonce（推測困難な値）。 */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/** Sentry のブラウザSDKが送信する Ingest 先（DSN設定時のみ connect-src へ加える）。 */
function sentryConnectSrc(): string {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return "";
  try {
    return ` https://${new URL(dsn).host}`;
  // eslint-disable-next-line no-restricted-syntax -- DSNが不正ならCSPへ何も足さない。不正の通知はSentry初期化側が行う
  } catch {
    return "";
  }
}

/**
 * Supabase Storage のオリジン（署名URLの配信元）。
 *
 * 本番は `https://<ref>.supabase.co` なので `https:` に含まれるが、**ローカルは
 * `http://127.0.0.1:54321` で http かつ別オリジンのため `img-src` に弾かれ、
 * 生成画像のプレビューが必ず表示されない**（2026-07-27 に実ブラウザで確認）。
 * 環境ごとの実オリジンを明示して、開発でも本番と同じ見え方にする。
 */
function supabaseOrigin(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "";
  try {
    return ` ${new URL(url).origin}`;
  // eslint-disable-next-line no-restricted-syntax -- 不正ならCSPへ何も足さない。env検証側が起動時に弾く
  } catch {
    return "";
  }
}

export function buildContentSecurityPolicy(nonce: string, isProd: boolean): string {
  // dev（next dev）は React Refresh 等で eval を使うため 'unsafe-eval' を許可する（productionは付けない）。
  const devEval = isProd ? "" : " 'unsafe-eval'";
  // dev（Turbopack）は HMR の WebSocket（ws://127.0.0.1:3000/_next/webpack-hmr）へ接続する。
  // 'self' が ws: を確実にカバーしないブラウザ実装があるため dev のみ ws: を明示許可する（prodは付けない）。
  const devConnect = isProd ? "" : " ws:";
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} ${TURNSTILE}`,
    `style-src 'self' 'unsafe-inline'`,
    // X アバター（pbs.twimg.com）・Supabase Storage の下書き画像・ニュース画像など任意ホストの
    // 画像を表示するため https: を許可する（画像はscript実行を伴わず露出リスクが低い）。
    // Supabase のオリジンは明示する（ローカルは http のため https: に含まれない）。
    `img-src 'self' data: blob: https:${supabaseOrigin()}`,
    `font-src 'self' data:`,
    // Checkout／Portalへ押下時にpreconnectし、Session作成中にDNS/TCP/TLSを準備する。
    `connect-src 'self' ${TURNSTILE} ${STRIPE_HOSTED}${sentryConnectSrc()}${devConnect}`,
    `frame-src 'self' ${TURNSTILE}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  if (isProd) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** 応答へ CSP・nosniff・Referrer-Policy（＋prodはHSTS）を付与する。 */
export function applySecurityResponseHeaders(headers: Headers, csp: string, isProd: boolean): void {
  headers.set("content-security-policy", csp);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (isProd) headers.set("strict-transport-security", HSTS_VALUE);
}
