import { describe, expect, it } from "vitest";

import { authCookieOptions, withAuthCookiePolicy } from "./cookie-options";

describe("Supabase auth cookie policy", () => {
  it("uses HttpOnly, SameSite=Lax, and non-Secure cookies on localhost", () => {
    expect(authCookieOptions("development")).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  });

  it("requires Secure in production and cannot be weakened by caller options", () => {
    expect(
      withAuthCookiePolicy(
        {
          httpOnly: false,
          maxAge: 60,
          path: "/unsafe",
          sameSite: "none",
          secure: false,
        },
        "production",
      ),
    ).toEqual({
      httpOnly: true,
      maxAge: 60,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });
});
