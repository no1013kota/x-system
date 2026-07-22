import { describe, expect, it, vi } from "vitest";

import { deleteStoredApiKey } from "./api-key-deletion";

describe("deleteStoredApiKey", () => {
  it("deletes an AI key without loading or revoking X credentials", async () => {
    const loadX = vi.fn();
    const remove = vi.fn(async () => undefined);
    const revoke = vi.fn();

    await expect(
      deleteStoredApiKey("anthropic", {
        decrypt: vi.fn(),
        loadX,
        readXClientId: vi.fn(),
        remove,
        revoke,
      }),
    ).resolves.toEqual({ deleted: true, provider: "anthropic" });
    expect(loadX).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({});
  });

  it("best-effort revokes each distinct X token before local deletion", async () => {
    const calls: string[] = [];
    const remove = vi.fn(async () => {
      calls.push("remove");
    });
    const revoke = vi.fn(async ({ token }: { token: string }) => {
      calls.push(`revoke:${token}`);
    });

    await deleteStoredApiKey("x", {
      decrypt: (ciphertext) => ciphertext.replace("sealed:", ""),
      loadX: async () => ({
        credentialsCiphertext: "sealed-app",
        tokenCiphertexts: ["sealed:access", "sealed:refresh", "sealed:access"],
      }),
      readXClientId: () => "client-id",
      remove,
      revoke,
    });

    expect(revoke.mock.calls).toEqual([
      [{ clientId: "client-id", token: "access" }],
      [{ clientId: "client-id", token: "refresh" }],
    ]);
    expect(calls).toEqual(["revoke:access", "revoke:refresh", "remove"]);
    expect(remove).toHaveBeenCalledWith({ expectedXCiphertext: "sealed-app" });
  });

  it("still deletes X credentials when parsing, decryption, or revoke fails", async () => {
    const removeAfterParseFailure = vi.fn(async () => undefined);
    await deleteStoredApiKey("x", {
      decrypt: vi.fn(),
      loadX: async () => ({
        credentialsCiphertext: "broken-app",
        tokenCiphertexts: ["sealed-token"],
      }),
      readXClientId: () => {
        throw new Error("broken envelope");
      },
      remove: removeAfterParseFailure,
      revoke: vi.fn(),
    });
    expect(removeAfterParseFailure).toHaveBeenCalledWith({
      expectedXCiphertext: "broken-app",
    });

    const removeAfterRevokeFailure = vi.fn(async () => undefined);
    await deleteStoredApiKey("x", {
      decrypt: (value) => value,
      loadX: async () => ({
        credentialsCiphertext: "app",
        tokenCiphertexts: ["token"],
      }),
      readXClientId: () => "client-id",
      remove: removeAfterRevokeFailure,
      revoke: async () => {
        throw new Error("provider body must not escape");
      },
    });
    expect(removeAfterRevokeFailure).toHaveBeenCalledWith({
      expectedXCiphertext: "app",
    });
  });
});
