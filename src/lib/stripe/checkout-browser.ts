import type { PlanId } from "@/lib/plans";

interface CheckoutStartDependencies {
  fetcher: typeof fetch;
  navigate(url: string): void;
}

const DEFAULT_ERROR_MESSAGE =
  "決済画面を開けませんでした。時間をおいてもう一度お試しください。";

function checkoutUrlFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = body as {
    ok?: unknown;
    data?: { url?: unknown };
  };
  if (value.ok !== true || typeof value.data?.url !== "string") return null;

  try {
    const url = new URL(value.data.url);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Starts server-owned Checkout and performs the only allowed external navigation. */
export async function startCheckout(
  plan: PlanId,
  dependencies: CheckoutStartDependencies = {
    // `fetch` loses its `this` binding to the global when stored as a property and
    // invoked as `dependencies.fetcher(...)` — the browser throws "Illegal
    // invocation". Wrap it so the global fetch keeps its binding.
    fetcher: (input, init) => fetch(input, init),
    navigate: (url) => window.location.assign(url),
  },
): Promise<void> {
  let response: Response;
  try {
    response = await dependencies.fetcher("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
  } catch {
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }

  const body: unknown = await response.json().catch(() => null);
  const url = response.ok ? checkoutUrlFromResponse(body) : null;
  if (!url) throw new Error(DEFAULT_ERROR_MESSAGE);
  dependencies.navigate(url);
}
