import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  env: {
    APP_ENV: "production" as "development" | "preview" | "production",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  },
  captureServerException: vi.fn(),
  secret: Buffer.alloc(32, 5),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/crypto", () => ({
  getAppEncryptionKey: () => mocks.secret,
}));
vi.mock("@/lib/observability/sentry", () => ({
  captureServerException: mocks.captureServerException,
}));

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
    const request = new NextRequest("https://exos-ai.example/app");

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
      "https://exos-ai.example/login?next=%2Fapp",
    );
  });

  it("forwards a refreshed cookie and verified anonymous state upstream", async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          options.cookies.setAll(
            [{ name: "sb-auth", value: "refreshed", options: {} }],
            { "Cache-Control": "private, no-store" },
          );
          return { data: { user: null }, error: null };
        }),
      },
    }));

    const response = await updateSupabaseSession(
      new NextRequest("https://exos-ai.example/login"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      "sb-auth=refreshed",
    );
    expect(
      response.headers.get("x-middleware-request-x-exos-verified-auth"),
    ).toBe("anonymous-v1");
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
            data: { user: { id: "user-1", email: "user@example.com" } },
            error: null,
          }),
        },
        from: vi.fn().mockReturnValue({ select }),
      });

      const response = await updateSupabaseSession(
        new NextRequest("https://exos-ai.example/app/posts?tab=drafts"),
      );

      expect(response.headers.get("location")).toBeNull();
      expect(
        response.headers.get("x-middleware-request-x-exos-verified-auth"),
      ).toBe("authenticated-v1");
      expect(
        response.headers.get("x-middleware-request-x-exos-verified-user-id"),
      ).toBe("user-1");
      expect(
        response.headers.get("x-middleware-request-x-exos-verified-user-email"),
      ).toBe("user%40example.com");
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
      new NextRequest("https://exos-ai.example/app/posts"),
    );
    const billing = await updateSupabaseSession(
      new NextRequest("https://exos-ai.example/app/settings?tab=billing"),
    );
    const support = await updateSupabaseSession(
      new NextRequest("https://exos-ai.example/app/settings?tab=support"),
    );

    expect(blocked.headers.get("location")).toBe(
      "https://exos-ai.example/plans",
    );
    expect(billing.headers.get("location")).toBeNull();
    expect(support.headers.get("location")).toBeNull();
  });

  /**
   * profile読み取りが失敗したときの扱い（T-M8-159）。
   *
   * **向きは変えない**（fail closed のまま `/plans` へ送る。要件01 §5の意図）。
   * 変えるのは「黙って起きる」ことだけ——記録が無いと、DB障害を運営者は
   * 「解約が急増した」としか読めなかった（原則1）。
   *
   * **proxyは全リクエストを通るのでthrowしてはいけない。** 投げると `/app` 配下だけでなく
   * ログイン画面まで落ちる。ここはその2点を同時に固定する。
   */
  it("profile読み取りの失敗はthrowせず、fail closedのまま記録する", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
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
      new NextRequest("https://exos-ai.example/app/posts"),
    );

    // 落ちずに応答を返し、向きは従来どおり /plans。
    expect(response.headers.get("location")).toBe(
      "https://exos-ai.example/plans",
    );
    // 黙って起きない。
    expect(mocks.captureServerException).toHaveBeenCalledTimes(1);
    const [error, context] = mocks.captureServerException.mock.calls[0];
    expect((error as Error).message).toContain("route-guard profile");
    expect(context).toMatchObject({
      reason: "route_guard_profile_read_failed",
    });
  });
});
