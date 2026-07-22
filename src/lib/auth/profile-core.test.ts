import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AI_PURPOSE_CONFIG,
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "@/lib/config-defaults";

import {
  ensureUserProfileWithClient,
  initialProfileForUser,
} from "./profile-core";

const USER = { id: "user-1", email: "user@example.com" } as User;

describe("profile creation fallback", () => {
  const upsert = vi.fn();
  const admin = {
    from: vi.fn(() => ({ upsert })),
  } as unknown as Pick<SupabaseClient, "from">;

  beforeEach(() => {
    vi.clearAllMocks();
    upsert.mockResolvedValue({ error: null });
  });

  it("builds the documented initial profile from code constants", () => {
    expect(initialProfileForUser(USER)).toEqual({
      id: "user-1",
      email: "user@example.com",
      plan: "standard",
      subscription_status: "incomplete",
      ai_purpose_config: DEFAULT_AI_PURPOSE_CONFIG,
      news_config: DEFAULT_NEWS_CONFIG,
      notification_config: DEFAULT_NOTIFICATION_CONFIG,
    });
  });

  it("uses an insert-only upsert so repeated calls cannot overwrite a profile", async () => {
    await ensureUserProfileWithClient(USER, admin);
    await ensureUserProfileWithClient(USER, admin);

    expect(admin.from).toHaveBeenCalledTimes(2);
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(initialProfileForUser(USER), {
      ignoreDuplicates: true,
      onConflict: "id",
    });
  });

  it("fails safely when the authenticated user has no email", async () => {
    const noEmailUser = { id: "user-2" } as User;

    await expect(
      ensureUserProfileWithClient(noEmailUser, admin),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("collapses database failures to an internal application error", async () => {
    upsert.mockResolvedValue({ error: { code: "42501", message: "denied" } });

    await expect(ensureUserProfileWithClient(USER, admin)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});
