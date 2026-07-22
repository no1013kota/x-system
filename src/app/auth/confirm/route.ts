import { type NextRequest, NextResponse } from "next/server";

import {
  confirmationSuccessPath,
  otpTypeForConfirmation,
  parseConfirmationType,
} from "@/lib/auth/confirm";
import {
  RECOVERY_SESSION_COOKIE,
  RECOVERY_SESSION_MAX_AGE_SEC,
  sealRecoverySession,
} from "@/lib/auth/recovery";
import { resolveKey } from "@/lib/crypto/envelope";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function errorDestination(type: string | null): URL {
  const url = new URL("/auth/error", env.APP_BASE_URL as string);
  url.searchParams.set("flow", type === "recovery" ? "recovery" : "signup");
  return url;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type");
  const type = parseConfirmationType(rawType);

  if (!tokenHash || !type) {
    return NextResponse.redirect(errorDestination(rawType));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpTypeForConfirmation(type),
    });
    if (error || !data.user) {
      return NextResponse.redirect(errorDestination(type));
    }

    const destination = confirmationSuccessPath(
      type,
      request.nextUrl.searchParams.get("next"),
      env.APP_BASE_URL as string,
    );
    const response = NextResponse.redirect(
      new URL(destination, env.APP_BASE_URL as string),
    );
    if (type === "recovery") {
      response.cookies.set(
        RECOVERY_SESSION_COOKIE,
        sealRecoverySession(
          { issuedAt: Date.now(), userId: data.user.id },
          resolveKey(env.APP_ENCRYPTION_KEY as string),
        ),
        {
          httpOnly: true,
          maxAge: RECOVERY_SESSION_MAX_AGE_SEC,
          path: "/",
          sameSite: "lax",
          secure: env.APP_ENV === "production",
        },
      );
    }
    return response;
  } catch {
    return NextResponse.redirect(errorDestination(type));
  }
}
