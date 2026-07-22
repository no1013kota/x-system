import { describe, expect, it, vi } from "vitest";

import { verifyStoredApiKey } from "./api-key-verification";

describe("verifyStoredApiKey", () => {
  it.each(["anthropic", "openai", "google"] as const)(
    "marks a successful %s adapter call valid",
    async (provider) => {
      const verify = vi.fn().mockResolvedValue(undefined);
      const persist = vi.fn().mockResolvedValue(undefined);
      const result = await verifyStoredApiKey({
        decrypt: () => "decrypted-secret",
        load: async () => ({ ciphertext: "ciphertext", provider }),
        persist,
        verify,
      });
      expect(verify).toHaveBeenCalledWith(provider, "decrypted-secret");
      expect(persist).toHaveBeenCalledWith({
        ciphertext: "ciphertext",
        status: "valid",
      });
      expect(result).toEqual({ provider, status: "valid" });
    },
  );

  it("marks adapter failure invalid without exposing its body", async () => {
    const providerBody = "upstream-secret-response-body";
    const persist = vi.fn().mockResolvedValue(undefined);
    const result = await verifyStoredApiKey({
      decrypt: () => "decrypted-secret",
      load: async () => ({ ciphertext: "ciphertext", provider: "openai" }),
      persist,
      verify: vi.fn().mockRejectedValue(new Error(providerBody)),
    });
    expect(result).toEqual({
      code: "provider_error",
      provider: "openai",
      status: "invalid",
    });
    expect(JSON.stringify(result)).not.toContain(providerBody);
    expect(persist).toHaveBeenCalledWith({
      ciphertext: "ciphertext",
      status: "invalid",
    });
  });

  it("keeps X unchecked for OAuth verification without calling an adapter", async () => {
    const verify = vi.fn();
    const persist = vi.fn();
    await expect(
      verifyStoredApiKey({
        decrypt: vi.fn(),
        load: async () => ({ ciphertext: "ciphertext", provider: "x" }),
        persist,
        verify,
      }),
    ).resolves.toEqual({ provider: "x", status: "unchecked" });
    expect(verify).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
