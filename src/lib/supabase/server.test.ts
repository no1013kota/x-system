import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  env: {
    APP_ENV: "development" as "development" | "preview" | "production",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/env", () => ({ env: mocks.env }));

import { createSupabaseServerClientFromStore } from "./server";

describe("createSupabaseServerClientFromStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.APP_ENV = "development";
    mocks.createServerClient.mockImplementation(() => ({ id: Symbol("client") }));
  });

  it("creates a new request-scoped SSR client on every call", () => {
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    };

    const first = createSupabaseServerClientFromStore(cookieStore as never);
    const second = createSupabaseServerClientFromStore(cookieStore as never);

    expect(first).not.toBe(second);
    expect(mocks.createServerClient).toHaveBeenCalledTimes(2);
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "anon-key",
      expect.objectContaining({
        cookieOptions: expect.objectContaining({
          httpOnly: true,
          sameSite: "lax",
          secure: false,
        }),
      }),
    );
  });

  it("enforces production cookie security in setAll", () => {
    mocks.env.APP_ENV = "production";
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: "sb-auth", value: "old" }]),
      set: vi.fn(),
    };
    createSupabaseServerClientFromStore(cookieStore as never);
    const options = mocks.createServerClient.mock.calls[0]?.[2];

    expect(options.cookies.getAll()).toEqual([{ name: "sb-auth", value: "old" }]);
    options.cookies.setAll([
      {
        name: "sb-auth",
        value: "new",
        options: { httpOnly: false, maxAge: 60, sameSite: "none" },
      },
    ]);

    expect(cookieStore.set).toHaveBeenCalledWith("sb-auth", "new", {
      httpOnly: true,
      maxAge: 60,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});
