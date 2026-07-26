/**
 * Shared client helper for server-owned billing redirects (Checkout / Customer
 * Portal). POSTs to a server route, validates the `{ ok, data: { url } }`
 * envelope, and performs the only allowed external (https) navigation. Keeps the
 * fetch→json→navigate flow and https-URL validation in one place.
 */
export interface BillingRedirectDependencies {
  fetcher: typeof fetch;
  navigate(url: string): void;
}

/**
 * Default deps. `fetch` loses its `this` binding to the global when stored as a
 * property and invoked as `deps.fetcher(...)` ("Illegal invocation"), so it is
 * wrapped to keep the binding.
 */
export const defaultBillingRedirectDeps: BillingRedirectDependencies = {
  fetcher: (input, init) => fetch(input, init),
  navigate: (url) => window.location.assign(url),
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
 * POSTs to `endpoint`, reads the `{ ok, data: { url } }` envelope, and navigates
 * to the returned https URL. Throws `Error(errorMessage)` on any failure.
 */
export async function startBillingRedirect(
  endpoint: string,
  errorMessage: string,
  dependencies: BillingRedirectDependencies = defaultBillingRedirectDeps,
  init?: RequestInit,
): Promise<void> {
  let response: Response;
  try {
    response = await dependencies.fetcher(endpoint, { method: "POST", ...init });
  } catch (error) {
    // 利用者向けの文言へ差し替えるが、cause を捨てると通信失敗の原因が追えなくなる。
    throw new Error(errorMessage, { cause: error });
  }
  const body: unknown = await response.json().catch(() => null);
  const url = response.ok ? httpsUrlFromResponse(body) : null;
  if (!url) throw new Error(errorMessage);
  dependencies.navigate(url);
}
