import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  env: {
    APP_ENV: "production" as "development" | "preview" | "production",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/env", () => ({ env: mocks.env }));

import { updateSupabaseSession } from "./update-session";

describe("updateSupabaseSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards refreshed cookies and anti-cache headers to the response", async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          options.cookies.setAll(
            [
              {
                name: "sb-auth",
                value: "refreshed",
                options: { httpOnly: false, sameSite: "none" },
              },
            ],
            {
              "Cache-Control": "private, no-store",
              Expires: "0",
              Pragma: "no-cache",
            },
          );
          return { data: { user: null }, error: null };
        }),
      },
    }));
    const request = new NextRequest("https://space-ai.example/app");

    const response = await updateSupabaseSession(request);

    expect(request.cookies.get("sb-auth")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-auth")).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
      value: "refreshed",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("location")).toBe(
      "https://space-ai.example/login?next=%2Fapp",
    );
  });

  it.each(["active", "trialing", "past_due", "unpaid", "paused", "canceled"])(
    "allows an authenticated %s profile to browse app routes",
    async (subscriptionStatus) => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { plan: "standard", subscription_status: subscriptionStatus },
        error: null,
      });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      mocks.createServerClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-1" } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({ select }),
      });

      const response = await updateSupabaseSession(
        new NextRequest("https://space-ai.example/app/posts?tab=drafts"),
      );

      expect(response.headers.get("location")).toBeNull();
      expect(select).toHaveBeenCalledWith("plan, subscription_status");
      expect(eq).toHaveBeenCalledWith("id", "user-1");
    },
  );

  it("redirects an incomplete profile to plans but allows billing/support tabs", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { plan: null, subscription_status: "incomplete" },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({ select }),
    });

    const blocked = await updateSupabaseSession(
      new NextRequest("https://space-ai.example/app/posts"),
    );
    const billing = await updateSupabaseSession(
      new NextRequest("https://space-ai.example/app/settings?tab=billing"),
    );
    const support = await updateSupabaseSession(
      new NextRequest("https://space-ai.example/app/settings?tab=support"),
    );

    expect(blocked.headers.get("location")).toBe(
      "https://space-ai.example/plans",
    );
    expect(billing.headers.get("location")).toBeNull();
    expect(support.headers.get("location")).toBeNull();
  });
});
