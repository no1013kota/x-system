import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  },
}));

import { createSupabaseAdminClient } from "./admin";

describe("createSupabaseAdminClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the service role without persisting an auth session", () => {
    createSupabaseAdminClient();

    expect(mocks.createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "service-role-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });
});
