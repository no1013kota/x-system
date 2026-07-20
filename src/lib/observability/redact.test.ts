import { describe, expect, it } from "vitest";

import { REDACTED, redactEvent } from "./redact";

describe("redactEvent", () => {
  it("redacts Authorization and Cookie headers", () => {
    const out = redactEvent({
      request: {
        headers: {
          Authorization: "Bearer sk-secret",
          Cookie: "session=abc",
          "User-Agent": "test",
        },
      },
    });
    expect(out.request?.headers?.Authorization).toBe(REDACTED);
    expect(out.request?.headers?.Cookie).toBe(REDACTED);
    expect(out.request?.headers?.["User-Agent"]).toBe("test");
  });

  it("redacts api keys, tokens, secrets, credentials in extra", () => {
    const out = redactEvent({
      extra: {
        api_key: "sk-123",
        access_token: "tok-xyz",
        client_secret: "cs-abc",
        credentials_ciphertext: "enc",
        harmless: "keep",
      },
    });
    expect(out.extra?.api_key).toBe(REDACTED);
    expect(out.extra?.access_token).toBe(REDACTED);
    expect(out.extra?.client_secret).toBe(REDACTED);
    expect(out.extra?.credentials_ciphertext).toBe(REDACTED);
    expect(out.extra?.harmless).toBe("keep");
  });

  it("redacts prompt / base_md / pre-post private input", () => {
    const out = redactEvent({
      extra: {
        prompt: "full system prompt text",
        base_md: "発信定義書 full text",
        instructions: "追加指示",
        user_opinion: "自分の考え",
        content: "投稿本文",
      },
    });
    expect(out.extra?.prompt).toBe(REDACTED);
    expect(out.extra?.base_md).toBe(REDACTED);
    expect(out.extra?.instructions).toBe(REDACTED);
    expect(out.extra?.user_opinion).toBe(REDACTED);
    expect(out.extra?.content).toBe(REDACTED);
  });

  it("redacts nested sensitive values", () => {
    const out = redactEvent({
      contexts: {
        job: { input: { source_url: "https://ok", api_key: "sk-deep" } },
      },
    });
    const job = out.contexts?.job as { input: Record<string, unknown> };
    expect(job.input.api_key).toBe(REDACTED);
    expect(job.input.source_url).toBe("https://ok");
  });

  it("handles arrays and preserves non-sensitive data", () => {
    const out = redactEvent({
      extra: {
        list: [{ token: "t1" }, { name: "n2" }],
      },
    });
    const list = out.extra?.list as Array<Record<string, unknown>>;
    expect(list[0].token).toBe(REDACTED);
    expect(list[1].name).toBe("n2");
  });
});
