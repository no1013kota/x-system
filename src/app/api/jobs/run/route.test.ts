import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// after() should run its callback synchronously in tests so we can assert dispatch
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    void cb();
  },
}));

const { runJob } = vi.hoisted(() => ({
  runJob: vi.fn(async () => ({ outcome: "leased" as const })),
}));
vi.mock("@/lib/jobs/worker", () => ({ runJob }));

import { POST } from "./route";

function req(body: unknown, auth?: string): Request {
  return new Request("http://localhost/api/jobs/run", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  });
}

describe("POST /api/jobs/run", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    runJob.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("401 without/with wrong bearer, and does not dispatch", async () => {
    expect((await POST(req({ jobId: "j1" }))).status).toBe(401);
    expect((await POST(req({ jobId: "j1" }, "Bearer wrong"))).status).toBe(401);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("400 when jobId missing", async () => {
    const res = await POST(req({}, "Bearer s3cret"));
    expect(res.status).toBe(400);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("202 and dispatches runJob with the jobId when authorized", async () => {
    const res = await POST(req({ jobId: "job-123" }, "Bearer s3cret"));
    expect(res.status).toBe(202);
    expect(runJob).toHaveBeenCalledWith("job-123");
  });
});
