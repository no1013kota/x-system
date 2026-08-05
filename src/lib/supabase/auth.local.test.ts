import { randomUUID } from "node:crypto";

import { loadEnvConfig, resetEnv } from "@next/env";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureUserProfileWithClient } from "@/lib/auth/profile-core";
import { readCurrentUser } from "@/lib/auth/session-core";
import {
  DEFAULT_AI_PURPOSE_CONFIG,
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "@/lib/config-defaults";

import { authCookieOptions } from "./cookie-options";

const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
const localEnv = {
  ...loadEnvConfig(process.cwd(), true, console, true).combinedEnv,
};
resetEnv();
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

function isLocalSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

// Local Supabase Auth has Turnstile captcha enabled (supabase/config.toml
// [auth.captcha]). TURNSTILE_SECRET_KEY is Cloudflare's always-pass test secret,
// so any token validates — but GoTrue still rejects a request with no token
// (captcha_failed). Pass a dummy token on client-side auth calls.
const CAPTCHA_TEST_TOKEN = "1x00000000000000000000AA";

/** Local Supabase Auth integration; skipped when the local stack is unavailable. */
describe("Supabase SSR auth session (local)", () => {
  const supabaseUrl = localEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
  const createdUserIds: string[] = [];
  let available = false;

  const admin =
    supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        })
      : null;

  beforeAll(async () => {
    if (
      !isLocalSupabaseUrl(supabaseUrl) ||
      !anonKey ||
      !serviceRoleKey ||
      !admin
    ) {
      return;
    }
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`);
      available = response.ok;
    } catch {
      available = false;
    }
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  afterAll(async () => {
    if (!admin) return;
    await Promise.all(
      createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)),
    );
  });

  it("detects a valid session and invalidates it on sign out", async () => {
    const email = `auth-${randomUUID()}@example.com`;
    const password = `Local-test-${randomUUID()}`;
    const created = await admin!.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    expect(created.error).toBeNull();
    const userId = created.data.user?.id;
    expect(userId).toBeTruthy();
    createdUserIds.push(userId as string);

    const jar = new Map<string, string>();
    const client = createServerClient(supabaseUrl!, anonKey!, {
      cookieOptions: authCookieOptions("development"),
      cookies: {
        getAll() {
          return [...jar].map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (options.maxAge === 0) jar.delete(name);
            else jar.set(name, value);
          });
        },
      },
    });

    const signedIn = await client.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: CAPTCHA_TEST_TOKEN },
    });
    expect(signedIn.error).toBeNull();
    await expect(readCurrentUser(client.auth)).resolves.toMatchObject({
      email,
      id: userId,
    });

    const signedOut = await client.auth.signOut();
    expect(signedOut.error).toBeNull();
    await expect(readCurrentUser(client.auth)).resolves.toBeNull();
    expect(jar.size).toBe(0);
  });

  it("creates profile defaults and idempotently repairs a missing row", async () => {
    const email = `profile-${randomUUID()}@example.com`;
    const created = await admin!.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `Local-test-${randomUUID()}`,
    });
    expect(created.error).toBeNull();
    const user = created.data.user;
    expect(user).toBeTruthy();
    createdUserIds.push(user!.id);

    const initial = await admin!
      .from("profiles")
      .select(
        "id,email,plan,subscription_status,ai_purpose_config,news_config,notification_config",
      )
      .eq("id", user!.id)
      .single();
    expect(initial.error).toBeNull();
    expect(initial.data).toEqual({
      id: user!.id,
      email,
      plan: "standard",
      subscription_status: "incomplete",
      ai_purpose_config: DEFAULT_AI_PURPOSE_CONFIG,
      news_config: DEFAULT_NEWS_CONFIG,
      notification_config: DEFAULT_NOTIFICATION_CONFIG,
    });

    const removed = await admin!.from("profiles").delete().eq("id", user!.id);
    expect(removed.error).toBeNull();

    await ensureUserProfileWithClient(user!, admin!);
    const customizedNotification = {
      ...DEFAULT_NOTIFICATION_CONFIG,
      posted: { in_app: false, email: false },
    };
    const customized = await admin!
      .from("profiles")
      .update({
        notification_config: customizedNotification,
      })
      .eq("id", user!.id);
    expect(customized.error).toBeNull();

    await ensureUserProfileWithClient(user!, admin!);
    const repaired = await admin!
      .from("profiles")
      .select("id,notification_config")
      .eq("id", user!.id);
    expect(repaired.error).toBeNull();
    expect(repaired.data).toEqual([
      {
        id: user!.id,
        notification_config: customizedNotification,
      },
    ]);
  });
});
