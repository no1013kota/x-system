import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/update-session";

/** Session refresh only; route guards are added by T-M1-08. */
export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
