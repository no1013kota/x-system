import { describe, expect, it } from "vitest";

import {
  readVerifiedUserHeaders,
  writeVerifiedUserHeaders,
} from "./request-user";

const SECRET = Buffer.alloc(32, 7);

describe("verified request user", () => {
  it("round-trips an authenticated user, including a non-ASCII email", () => {
    const headers = new Headers();

    writeVerifiedUserHeaders(
      headers,
      {
        id: "8ee5139a-0bb6-459f-a17a-f138031910a6",
        email: "利用者+test@example.com",
      },
      SECRET,
    );

    expect(readVerifiedUserHeaders(headers, SECRET)).toEqual({
      id: "8ee5139a-0bb6-459f-a17a-f138031910a6",
      email: "利用者+test@example.com",
    });
  });

  it("distinguishes verified anonymous from a request that skipped proxy", () => {
    const headers = new Headers();
    expect(readVerifiedUserHeaders(headers, SECRET)).toBeUndefined();

    writeVerifiedUserHeaders(headers, null, SECRET);
    expect(readVerifiedUserHeaders(headers, SECRET)).toBeNull();
  });

  it("overwrites spoofed incoming values", () => {
    const headers = new Headers({
      "x-exos-verified-auth": "authenticated-v1",
      "x-exos-verified-user-email": "attacker%40example.com",
      "x-exos-verified-user-id": "attacker",
    });

    writeVerifiedUserHeaders(
      headers,
      {
        id: "real-user",
        email: "real@example.com",
      },
      SECRET,
    );

    expect(readVerifiedUserHeaders(headers, SECRET)).toEqual({
      id: "real-user",
      email: "real@example.com",
    });
  });

  it("rejects a tampered authenticated context", () => {
    const headers = new Headers();
    writeVerifiedUserHeaders(
      headers,
      { id: "real-user", email: "real@example.com" },
      SECRET,
    );
    headers.set("x-exos-verified-user-id", "attacker");

    expect(readVerifiedUserHeaders(headers, SECRET)).toBeUndefined();
  });
});
