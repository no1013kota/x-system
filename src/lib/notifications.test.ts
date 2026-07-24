import { describe, expect, it } from "vitest";

import {
  countUnreadNotifications,
  decodeNotificationCursor,
  encodeNotificationCursor,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  retryNotificationEmail,
} from "./notifications";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

function makeDb(
  handler: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number },
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const r = handler(sql, params);
      const rows = (r.rows ?? []) as T[];
      return { rows, rowCount: r.rowCount ?? rows.length };
    },
  };
  return { db, calls };
}

function row(id: string, createdAt: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "error",
    title: `title-${id}`,
    body: `body-${id}`,
    link: "/app/settings?tab=x-accounts",
    read_at: null,
    created_at: createdAt,
    ...over,
  };
}

describe("notification cursor", () => {
  it("round-trips", () => {
    const enc = encodeNotificationCursor({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "abc",
    });
    expect(decodeNotificationCursor(enc)).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "abc",
    });
  });
  it("returns null for empty/invalid input", () => {
    expect(decodeNotificationCursor(null)).toBeNull();
    expect(decodeNotificationCursor("")).toBeNull();
  });
});

describe("listNotifications", () => {
  it("returns a page and a nextCursor when more rows exist", async () => {
    const { db } = makeDb(() => ({
      rows: [
        row("n3", "2026-01-03T00:00:00.000Z"),
        row("n2", "2026-01-02T00:00:00.000Z"),
        row("n1", "2026-01-01T00:00:00.000Z"),
      ],
    }));
    const page = await listNotifications(db, "u1", { limit: 2 });
    expect(page.items.map((i) => i.id)).toEqual(["n3", "n2"]);
    expect(page.items[0].link).toBe("/app/settings?tab=x-accounts");
    expect(decodeNotificationCursor(page.nextCursor)?.id).toBe("n2");
  });

  it("returns no cursor when the page is not full", async () => {
    const { db } = makeDb(() => ({ rows: [row("n1", "2026-01-01T00:00:00.000Z")] }));
    const page = await listNotifications(db, "u1", { limit: 2 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("adds a read_at filter when unreadOnly", async () => {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    await listNotifications(db, "u1", { unreadOnly: true });
    expect(calls[0].sql).toMatch(/read_at is null/);
  });

  it("applies a keyset cursor comparison and params", async () => {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    const cursor = encodeNotificationCursor({
      createdAt: "2026-01-02T00:00:00.000Z",
      id: "n2",
    });
    await listNotifications(db, "u1", { cursor, limit: 2 });
    expect(calls[0].sql).toMatch(/\(created_at, id\) </);
    expect(calls[0].params).toContain("2026-01-02T00:00:00.000Z");
    expect(calls[0].params).toContain("n2");
  });
});

describe("markNotificationRead", () => {
  it("returns the read notification for the owner", async () => {
    const { db } = makeDb(() => ({
      rows: [{ id: "n1", read_at: "2026-01-01T00:00:00.000Z" }],
    }));
    const res = await markNotificationRead(db, "u1", "n1");
    expect(res.id).toBe("n1");
    expect(res.readAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("throws not_found when nothing is updated (not owner / missing)", async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    await expect(markNotificationRead(db, "u1", "n1")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("markAllNotificationsRead / countUnreadNotifications", () => {
  it("returns the number of rows marked read", async () => {
    const { db } = makeDb(() => ({ rows: [], rowCount: 5 }));
    expect(await markAllNotificationsRead(db, "u1")).toBe(5);
  });
  it("returns the unread count", async () => {
    const { db } = makeDb(() => ({ rows: [{ n: 3 }] }));
    expect(await countUnreadNotifications(db, "u1")).toBe(3);
  });
});

const RETRY_LOAD = /select email_status from notifications where id/;
const RETRY_UPDATE = /set email_status = 'queued', email_attempts = 0/;

describe("retryNotificationEmail", () => {
  it("requeues a failed email (resets attempts) when not attempted within 1 minute", async () => {
    const { db, calls } = makeDb((sql) => {
      if (RETRY_LOAD.test(sql)) return { rows: [{ email_status: "failed" }] };
      if (RETRY_UPDATE.test(sql)) return { rowCount: 1 };
      return { rows: [] };
    });
    await retryNotificationEmail(db, "u1", "n1");
    expect(calls.some((c) => RETRY_UPDATE.test(c.sql))).toBe(true);
  });

  it("throws not_found when the notification is missing/not owned", async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    await expect(retryNotificationEmail(db, "u1", "n1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects retrying a non-failed email (job_conflict:not_failed)", async () => {
    const { db } = makeDb((sql) =>
      RETRY_LOAD.test(sql) ? { rows: [{ email_status: "sent" }] } : { rows: [] },
    );
    const err = await retryNotificationEmail(db, "u1", "n1").then(
      () => { throw new Error("expected rejection"); },
      (e) => e as AppError,
    );
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("not_failed");
  });

  it("rejects a retry within 1 minute of the last attempt (job_conflict:retry_too_soon)", async () => {
    const { db } = makeDb((sql) => {
      if (RETRY_LOAD.test(sql)) return { rows: [{ email_status: "failed" }] };
      if (RETRY_UPDATE.test(sql)) return { rowCount: 0 }; // time guard blocked the update
      return { rows: [] };
    });
    const err = await retryNotificationEmail(db, "u1", "n1").then(
      () => { throw new Error("expected rejection"); },
      (e) => e as AppError,
    );
    expect(err.code).toBe("job_conflict");
    expect(err.details?.reason).toBe("retry_too_soon");
  });
});
