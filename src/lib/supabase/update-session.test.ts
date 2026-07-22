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
  });
});
