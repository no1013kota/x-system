import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import {
  getCurrentUser,
  readCurrentUser,
  requireCurrentUser,
} from "./session";

const USER = { id: "user-1", email: "user@example.com" } as User;

describe("session helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    await expect(getCurrentUser()).resolves.toBe(USER);
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledOnce();
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
