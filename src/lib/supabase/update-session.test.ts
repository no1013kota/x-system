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

  /**
   * **契約状態は proxy で見ない**（T-M8-268）。画面を弾かなくなったので、`/app` 配下の
   * 全リクエストで走っていた profiles の SELECT も消した（遷移のたびの往復を1本削減）。
   */
  it.each([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "canceled",
    "incomplete",
    "incomplete_expired",
  ])("allows an authenticated %s profile to browse app routes", async () => {
      const from = vi.fn();
      mocks.createServerClient.mockReturnValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-1", email: "user@example.com" } },
            error: null,
          }),
        },
        from,
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
      // profiles を読まない（画面遷移のたびのDB往復をやめた・T-M8-268）。
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("プラン未選択でも /app 配下を閲覧できる（T-M8-268）", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn(),
    });

    for (const path of ["/app/posts", "/app/invite", "/app/settings?tab=billing"]) {
      const response = await updateSupabaseSession(
        new NextRequest(`https://exos-ai.example${path}`),
      );
      expect(response.headers.get("location")).toBeNull();
    }
  });

});
