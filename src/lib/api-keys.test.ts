import { describe, expect, it } from "vitest";

import {
  lastFour,
  parseXAppCredentials,
  saveAiApiKeySchema,
  saveXApiKeySchema,
  serializeXAppCredentials,
} from "./api-keys";

describe("API key input schemas", () => {
  it("accepts public and confidential X clients with the required fields", () => {
    expect(
      saveXApiKeySchema.parse({
        client_id: "public-client_123",
        client_type: "public",
      }),
    ).toMatchObject({ client_id: "public-client_123" });
    expect(
      saveXApiKeySchema.parse({
        client_id: "confidential-client_123",
        client_secret: "secret-value",
        client_type: "confidential",
      }),
    ).toMatchObject({ client_secret: "secret-value" });
  });

  it("rejects invalid client IDs and client type/secret mismatches", () => {
    expect(() =>
      saveXApiKeySchema.parse({ client_id: "bad id", client_type: "public" }),
    ).toThrow();
    expect(() =>
      saveXApiKeySchema.parse({
        client_id: "confidential-client",
        client_type: "confidential",
      }),
    ).toThrow(/Client Secret/);
    expect(() =>
      saveXApiKeySchema.parse({
        client_id: "public-client",
        client_secret: "must-not-store",
        client_type: "public",
      }),
    ).toThrow(/Public client/);
  });

  it.each(["anthropic", "openai", "google"])(
    "accepts a non-whitespace %s key",
    (provider) => {
      expect(
        saveAiApiKeySchema.parse({
          api_key: "secret-key-1234567890",
          provider,
        }),
      ).toMatchObject({ provider });
    },
  );

  it("rejects an unsupported provider, short key, and whitespace", () => {
    for (const input of [
      { api_key: "secret-key-1234567890", provider: "x" },
      { api_key: "short", provider: "openai" },
      { api_key: "secret key 1234567890", provider: "google" },
    ]) {
      expect(() => saveAiApiKeySchema.parse(input)).toThrow();
    }
  });
});

describe("X App credentials serialization", () => {
  it("round-trips the field names used inside ciphertext", () => {
    const serialized = serializeXAppCredentials({
      client_id: "client-123456",
      client_secret: "secret-123456",
      client_type: "confidential",
    });
    expect(parseXAppCredentials(serialized)).toEqual({
      clientId: "client-123456",
      clientSecret: "secret-123456",
      clientType: "confidential",
    });
  });

  it("returns only the final four characters for display", () => {
    expect(lastFour("secret-123456")).toBe("3456");
  });
});
