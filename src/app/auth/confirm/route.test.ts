import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_SESSION_COOKIE, verifyRecoverySession } from "@/lib/auth/recovery";
import { resolveKey } from "@/lib/crypto/envelope";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    APP_BASE_URL: "https://app.example.com",
    APP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    APP_ENV: "production",
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { GET } from "./route";

function request(query: string): NextRequest {
  return new NextRequest(`https://app.example.com/auth/confirm?${query}`);
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { verifyOtp: mocks.verifyOtp },
    });
  });

  it("verifies signup token_hash on the server and redirects to plans", async () => {
    const response = await GET(request("token_hash=signup-hash&type=signup"));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "signup-hash",
      type: "signup",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example.com/plans");
  });

  it("redirects a verified recovery token to reset-password", async () => {
    const response = await GET(
      request("token_hash=recovery-hash&type=recovery"),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "recovery-hash",
      type: "recovery",
    });
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/reset-password",
    );
    const marker = response.cookies.get(RECOVERY_SESSION_COOKIE);
    expect(marker).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(() =>
      verifyRecoverySession(marker?.value, resolveKey(ENCRYPTION_KEY), {
        now: Date.now(),
        userId: "user-1",
      }),
    ).not.toThrow();
  });

  it("uses a safe approved next path without carrying auth query values", async () => {
    const response = await GET(
      request(
        "token_hash=hash&type=signup&next=%2Fapp%2Fposts%3Ftab%3Ddrafts%26token_hash%3Dnested",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/app/posts?tab=drafts",
    );
  });

  it.each([
    new Error("expired token"),
    new Error("already used"),
    new Error("invalid token: secret-provider-detail"),
  ])("maps every verification failure to the same generic URL", async (error) => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error });

    const response = await GET(request("token_hash=secret&type=signup"));
    const location = response.headers.get("location");

    expect(location).toBe("https://app.example.com/auth/error?flow=signup");
    expect(location).not.toContain("secret");
    expect(location).not.toContain(error.message);
  });

  it("shows the recovery re-request flow without verifying malformed input", async () => {
    const response = await GET(request("type=recovery"));

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/auth/error?flow=recovery",
    );
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects unapproved external next values", async () => {
    const response = await GET(
      request(
        "token_hash=hash&type=signup&next=https%3A%2F%2Fevil.example%2Fsteal",
      ),
    );

    expect(response.headers.get("location")).toBe("https://app.example.com/plans");
  });
});
