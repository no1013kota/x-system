import { NextResponse } from "next/server";

import {
  ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  ATTRIBUTION_COOKIE_NAME,
} from "@/lib/affiliate/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 招待リンクの着地（T-M8-174・invite_cp.md §4）。`/r/{code}` を踏むと30日Cookieを付けて
 * LPへ送る。Last Click Attribution＝後から別のリンクを踏めばCookieを上書きする。
 * コードの実在はここでは確かめない（登録時に照合。不正な値でも害はなくDBを読む理由がない）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  const response = NextResponse.redirect(new URL("/", request.url));
  if (/^[a-z0-9]{4,32}$/i.test(code)) {
    // **小文字で保存する**（T-M8-242）。コードは小文字英数字で発行するが、この route は
    // 大文字も受けるため（`/i`）、そのまま保存すると照合（完全一致）で外れて
    // **黙って招待が付かない**。共有時に大文字化されたURLでも紐づくようにする。
    response.cookies.set(ATTRIBUTION_COOKIE_NAME, code.toLowerCase(), {
      httpOnly: true,
      maxAge: ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}
