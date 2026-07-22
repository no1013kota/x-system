import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { signOut } from "./auth";

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("invalidates the Supabase session before redirecting to login", async () => {
    const signOutSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { signOut: signOutSession },
    });

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT");
    expect(signOutSession).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(signOutSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] as number,
    );
  });

  it("does not redirect when Supabase fails to invalidate the session", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: new Error("failed") }) },
    });

    await expect(signOut()).rejects.toMatchObject({ code: "internal_error" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
