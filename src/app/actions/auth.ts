"use server";

import { redirect } from "next/navigation";

import { AppError } from "@/lib/observability/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Invalidates the Supabase session before returning the user to login. */
export async function signOut(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new AppError("internal_error", { cause: error });
  }

  redirect("/login");
}
