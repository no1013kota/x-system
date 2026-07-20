import * as Sentry from "@sentry/nextjs";
import { afterAll, describe, expect, it } from "vitest";

import { redactEvent, type RedactableEvent } from "./redact";

/**
 * Verifies a captured server exception flows through our beforeSend (redaction)
 * to the transport, and that secrets are scrubbed end-to-end. Uses a mock
 * transport so nothing leaves the process (no real DSN needed). Named *.db.test
 * only so it runs in the integration lane; it needs no external services.
 */
describe("Sentry capture → transport pipeline", () => {
  const sent: string[] = [];

  const mockTransport = () => ({
    send: (envelope: unknown) => {
      sent.push(JSON.stringify(envelope));
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });

  Sentry.init({
    dsn: "https://public@o0.ingest.sentry.io/0",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    defaultIntegrations: false,
    transport: mockTransport,
    beforeSend: (event) =>
      redactEvent(event as unknown as RedactableEvent) as unknown as typeof event,
  });

  afterAll(async () => {
    await Sentry.close();
  });

  it("delivers a captured exception to the transport with secrets redacted", async () => {
    Sentry.captureException(new Error("boom"), {
      extra: {
        api_key: "sk-super-secret-value",
        prompt: "the full private prompt text",
        harmless: "keep-me",
      },
    });
    const flushed = await Sentry.flush(2000);
    expect(flushed).toBe(true);

    // reached the transport
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const payload = sent.join("\n");
    // secrets scrubbed end-to-end
    expect(payload).not.toContain("sk-super-secret-value");
    expect(payload).not.toContain("the full private prompt text");
    // non-sensitive extra survives
    expect(payload).toContain("keep-me");
  });
});
