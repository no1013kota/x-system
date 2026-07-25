interface PortalStartDependencies {
  fetcher: typeof fetch;
  navigate(url: string): void;
}

const DEFAULT_ERROR_MESSAGE =
  "お支払い管理画面を開けませんでした。時間をおいてもう一度お試しください。";

function portalUrlFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { ok?: unknown; data?: { url?: unknown } };
  if (value.ok !== true || typeof value.data?.url !== "string") return null;
  try {
    const url = new URL(value.data.url);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Starts a server-owned Customer Portal Session and navigates to it. */
export async function startCustomerPortal(
  dependencies: PortalStartDependencies = {
    // `fetch` loses its `this` binding to the global when stored as a property and
    // invoked as `dependencies.fetcher(...)` ("Illegal invocation"). Wrap it.
    fetcher: (input, init) => fetch(input, init),
    navigate: (url) => window.location.assign(url),
  },
): Promise<void> {
  let response: Response;
  try {
    response = await dependencies.fetcher("/api/stripe/portal", {
      method: "POST",
    });
  } catch {
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }
  const body: unknown = await response.json().catch(() => null);
  const url = response.ok ? portalUrlFromResponse(body) : null;
  if (!url) throw new Error(DEFAULT_ERROR_MESSAGE);
  dependencies.navigate(url);
}
