import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/update-session";

/** Refreshes the session and applies route-level auth/subscription guards. */
export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  // Skip all Next internals — `_next/*` (static, image, and crucially the dev
  // `_next/webpack-hmr` WebSocket, whose upgrade the proxy would otherwise break)
  // and dev fonts under `__nextjs_font/` — plus static asset extensions. Auth
  // session refresh only needs to run on real navigations/route requests.
  matcher: [
    "/((?!_next/|__nextjs_font/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
