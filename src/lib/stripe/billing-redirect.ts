import { preconnect } from "react-dom";

/**
 * Shared client helper for server-owned billing redirects (Checkout / Customer
 * Portal). POSTs to a server route, validates the `{ ok, data: { url } }`
 * envelope, and performs the only allowed external (https) navigation. Keeps the
 * fetch→json→navigate flow and https-URL validation in one place.
 */
export interface BillingRedirectDependencies {
  fetcher: typeof fetch;
  navigate(url: string): void;
  /** Starts DNS/TCP/TLS setup while the application creates the Stripe session. */
  prepareHostedOrigin?(origin: string): void;
}

/**
 * Default deps. `fetch` loses its `this` binding to the global when stored as a
 * property and invoked as `deps.fetcher(...)` ("Illegal invocation"), so it is
 * wrapped to keep the binding.
 */
export const defaultBillingRedirectDeps: BillingRedirectDependencies = {
  fetcher: (input, init) => fetch(input, init),
  navigate: (url) => window.location.assign(url),
  prepareHostedOrigin: (origin) => preconnect(origin),
};

/** Extracts an https URL from a `{ ok: true, data: { url } }` body, else null. */
export function httpsUrlFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { ok?: unknown; data?: { url?: unknown } };
  if (value.ok !== true || typeof value.data?.url !== "string") return null;
  try {
    const url = new URL(value.data.url);
    return url.protocol === "https:" ? url.toString() : null;
  // eslint-disable-next-line no-restricted-syntax -- URL/protocolが不正であること自体が判定結果（null）
  } catch {
    return null;
  }
}

/**
 * サーバが返した利用者向け文言を取り出す（T-M8-148）。
 *
 * 失敗の理由によって言うべきことは違うのに、ここは**常に同じ固定文**を出していた。
 * 2026-08-18、Stripeアカウントが本番決済を受け付けられない状態で「決済画面を開けませんでした。
 * **時間をおいて**もう一度お試しください」と出続けた——待っても直らないので嘘になり、
 * 利用者は同じ操作を繰り返す（CLAUDE.md 原則1）。
 *
 * 文言の正本はサーバ側の `USER_MESSAGES`（`observability/errors.ts`）で、コードが増えても
 * ここを直す必要が無い。取り出せないときだけ呼び出し側の既定文へ落ちる。
 */
export function userMessageFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { ok?: unknown; error?: { message?: unknown } };
  if (value.ok !== false) return null;
  const message = value.error?.message;
  return typeof message === "string" && message !== "" ? message : null;
}

/**
 * POSTs to `endpoint`, reads the `{ ok, data: { url } }` envelope, and navigates
 * to the returned https URL. Throws `Error` on any failure, preferring the
 * server's user-facing message over `errorMessage`.
 */
export async function startBillingRedirect(
  endpoint: string,
  errorMessage: string,
  hostedOrigin: string,
  dependencies: BillingRedirectDependencies = defaultBillingRedirectDeps,
  init?: RequestInit,
): Promise<void> {
  /*
   * Stripeのセッションは短寿命なので、利用者が押す前に作らない。一方、遷移先originは固定で
   * 分かっている。ここでpreconnectを始め、同一origin APIの認証・DB読込・Stripe Session作成と
   * DNS/TCP/TLSを並行させる。URLを受け取ってから接続を始めるより、そのぶん遷移待ちを短くできる。
   */
  dependencies.prepareHostedOrigin?.(hostedOrigin);

  let response: Response;
  try {
    response = await dependencies.fetcher(endpoint, { method: "POST", ...init });
  } catch (error) {
    // 利用者向けの文言へ差し替えるが、cause を捨てると通信失敗の原因が追えなくなる。
    throw new Error(errorMessage, { cause: error });
  }
  const body: unknown = await response.json().catch(() => null);
  const url = response.ok ? httpsUrlFromResponse(body) : null;
  if (!url) throw new Error(userMessageFromResponse(body) ?? errorMessage);
  dependencies.navigate(url);
}
