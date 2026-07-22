import { describe, expect, it } from "vitest";

import { maskedApiKeyLabel } from "./api-key-view";

describe("maskedApiKeyLabel", () => {
  it("renders only X Client ID last-four metadata", () => {
    expect(
      maskedApiKeyLabel({
        displayHint: {
          client_id_last4: "1234",
          client_type: "confidential",
          has_client_secret: true,
        },
        provider: "x",
        status: "unchecked",
        verifiedAt: null,
      }),
    ).toBe("Client ID ••••1234（Confidential）");
  });

  it("renders only the AI key last four", () => {
    expect(
      maskedApiKeyLabel({
        displayHint: { api_key_last4: "abcd" },
        provider: "openai",
        status: "valid",
        verifiedAt: "2026-07-23T00:00:00.000Z",
      }),
    ).toBe("APIキー ••••abcd");
  });
});
