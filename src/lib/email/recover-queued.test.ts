import { describe, expect, it, vi } from "vitest";

import { recoverQueuedEmails } from "./recover-queued";
import type { NotificationEmailResult } from "./notification-email";
import type { Queryable } from "../x/token-refresh";

const AGE = /min\(created_at\)/;
const BATCH = /select id from notifications/;

function mockDb(available: number, ageMs: number | null) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (AGE.test(sql)) return { rows: [{ age_ms: ageMs }] as T[], rowCount: 1 };
      if (BATCH.test(sql)) {
        const limit = (params[0] as number) ?? 100;
        const n = Math.min(available, limit);
        const rows = Array.from({ length: n }, (_, i) => ({ id: `n${i}` })) as T[];
        return { rows, rowCount: n };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { db, calls };
}

describe("recoverQueuedEmails", () => {
  it("processes at most `limit` (100) due emails at `concurrency` (10) parallelism", async () => {
    const { db } = mockDb(150, 1000);
    let active = 0;
    let maxActive = 0;
    const send = vi.fn(async (): Promise<NotificationEmailResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return { outcome: "sent" };
    });
    const res = await recoverQueuedEmails({ db, send });
    expect(res.processed).toBe(100); // capped by limit though 150 queued
    expect(res.sent).toBe(100);
    expect(send).toHaveBeenCalledTimes(100);
    expect(maxActive).toBeLessThanOrEqual(10);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("tallies outcomes by type", async () => {
    const { db } = mockDb(3, 0);
    const outcomes: NotificationEmailResult[] = [
      { outcome: "sent" },
      { outcome: "requeued", attempts: 1 },
      { outcome: "failed", attempts: 3 },
    ];
    let i = 0;
    const send = async () => outcomes[i++];
    const res = await recoverQueuedEmails({ db, send });
    expect(res).toEqual({ processed: 3, sent: 1, requeued: 1, failed: 1 });
  });

  it("warns when the oldest due queued email exceeds the stale threshold (10min)", async () => {
    const onStaleWarning = vi.fn();
    const { db } = mockDb(1, 11 * 60_000);
    await recoverQueuedEmails({ db, send: async () => ({ outcome: "sent" }), onStaleWarning });
    expect(onStaleWarning).toHaveBeenCalledTimes(1);
    expect(onStaleWarning.mock.calls[0][0]).toBe(11 * 60_000);
  });

  it("does not warn when the backlog is within the threshold", async () => {
    const onStaleWarning = vi.fn();
    const { db } = mockDb(1, 5 * 60_000);
    await recoverQueuedEmails({ db, send: async () => ({ outcome: "sent" }), onStaleWarning });
    expect(onStaleWarning).not.toHaveBeenCalled();
  });
});
