import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AuthReader = Pick<SupabaseClient["auth"], "getUser">;

/** Returns the verified user or null when no valid session is present. */
export async function readCurrentUser(auth: AuthReader): Promise<User | null> {
  const { data, error } = await auth.getUser();
  if (error) return null;
  return data.user ?? null;
}
