import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

import { authCookieOptions, withAuthCookiePolicy } from "./cookie-options";

type NextCookieStore = Awaited<ReturnType<typeof cookies>>;
type SupabaseCookieStore = Pick<NextCookieStore, "getAll" | "set">;

/**
 * Creates one cookie-scoped Supabase client for the current request.
 * Never cache this client at module scope because it carries user session state.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createSupabaseServerClientFromStore(cookieStore);
}

/** Injectable adapter used by the runtime helper and integration tests. */
export function createSupabaseServerClientFromStore(
  cookieStore: SupabaseCookieStore,
) {
  const cookiePolicy = authCookieOptions(env.APP_ENV);

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookieOptions: cookiePolicy,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(
                name,
                value,
                withAuthCookiePolicy(options, env.APP_ENV),
              );
            });
          // eslint-disable-next-line no-restricted-syntax -- Server Componentからcookieを書けないのは既知の正常系。proxyが更新する
          } catch {
            // Server Components cannot write cookies. The request proxy refreshes
            // sessions and persists any rotated token before rendering.
          }
        },
      },
    },
  );
}
