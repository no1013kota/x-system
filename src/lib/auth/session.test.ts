import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  headers: vi.fn(),
  secret: Buffer.alloc(32, 3),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/crypto", () => ({
  getAppEncryptionKey: () => mocks.secret,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import {
  getCurrentUser,
  readCurrentUser,
  requireCurrentUser,
} from "./session";
import { writeVerifiedUserHeaders } from "./request-user";

const USER = { id: "user-1", email: "user@example.com" } as User;

describe("session helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
  });

  it("returns the verified user from getUser", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: USER },
      error: null,
    });

    await expect(readCurrentUser({ getUser } as never)).resolves.toBe(USER);
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("returns null when the session is missing or invalid", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("session missing"),
    });

    await expect(readCurrentUser({ getUser } as never)).resolves.toBeNull();
  });

  it("creates a request-scoped client for the shared helper", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: USER },
      error: null,
    });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { getUser } });

    await expect(getCurrentUser()).resolves.toEqual({
      id: USER.id,
      email: USER.email,
    });
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledOnce();
  });

  it("reuses the user verified by proxy without another Auth request", async () => {
    const headers = new Headers();
    writeVerifiedUserHeaders(
      headers,
      { id: "user-1", email: "user@example.com" },
      mocks.secret,
    );
    mocks.headers.mockResolvedValue(headers);

    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reuses the anonymous result verified by proxy", async () => {
    const headers = new Headers();
    writeVerifiedUserHeaders(headers, null, mocks.secret);
    mocks.headers.mockResolvedValue(headers);

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("throws the stable unauthorized error when authentication is required", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("session missing"),
        }),
      },
    });

    await expect(requireCurrentUser()).rejects.toMatchObject({
      code: "unauthorized",
    } satisfies Partial<AppError>);
  });
});
