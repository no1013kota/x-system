import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchJob } from "./dispatch";

describe("dispatchJob", () => {
  const origBase = process.env.APP_BASE_URL;
  const origSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.APP_BASE_URL = origBase;
    process.env.CRON_SECRET = origSecret;
  });

  it("POSTs to /api/jobs/run with bearer + jobId and returns ok on 202", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    const result = await dispatchJob("job-123");
    expect(result).toEqual({ ok: true, status: 202 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/jobs/run");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer s3cret");
    expect((init as RequestInit).body).toBe(JSON.stringify({ jobId: "job-123" }));
  });

  it("does not wait for worker processing (resolves at the 202 response)", async () => {
    // the route returns 202 immediately; dispatchJob must resolve without any
    // further round-trip. We assert fetch is called exactly once.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));
    await dispatchJob("j");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false on non-2xx without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("err", { status: 500 }),
    );
    await expect(dispatchJob("j")).resolves.toEqual({ ok: false, status: 500 });
  });

  it("returns ok:false on transport failure without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await dispatchJob("j");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns ok:false and does not call fetch when config is missing", async () => {
    delete process.env.CRON_SECRET;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await dispatchJob("j");
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
