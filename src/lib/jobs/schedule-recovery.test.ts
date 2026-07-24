import { describe, expect, it } from "vitest";

import { recoverSchedule } from "./schedule-recovery";
import type { Queryable } from "../x/token-refresh";

type Row = Record<string, unknown>;

const CANCEL_EXPIRED = /with expired as/;
const UNENQUEUED = /from schedule_slots ss/;
const MISSED = /insert into notifications/;
const P5_CANCEL = /pattern = 'p5' and status = 'queued'/;

function makeDb(handler: (sql: string) => { rows?: Row[]; rowCount?: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql);
      return { rows: (r.rows ?? []) as T[], rowCount: r.rowCount ?? (r.rows?.length ?? 0) };
    },
  };
  return { db, writes };
}

const expiredJob = () => ({
  slot_id: "s1",
  user_id: "u1",
  occ_date: "2026-07-24",
  occ_time: "09:00",
});

describe("recoverSchedule — expired schedule jobs", () => {
  it("cancels expired jobs and creates schedule_missed notifications", async () => {
    const { db, writes } = makeDb((sql) => {
      if (CANCEL_EXPIRED.test(sql)) return { rows: [expiredJob()] };
      if (MISSED.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    const res = await recoverSchedule({ db, quotePostEnabled: true });
    expect(res.canceledExpired).toBe(1);
    expect(res.missedNotified).toBe(1);
    const notif = writes.find((w) => MISSED.test(w.sql));
    expect(notif?.params[1]).toBe("slot:s1:2026-07-24:09:00:missed"); // dedupe_key
  });

  it("does not count a deduped missed notification", async () => {
    const { db } = makeDb((sql) => {
      if (CANCEL_EXPIRED.test(sql)) return { rows: [expiredJob()] };
      if (MISSED.test(sql)) return { rows: [], rowCount: 0 }; // 既存につき挿入なし
      return { rows: [] };
    });
    const res = await recoverSchedule({ db, quotePostEnabled: true });
    expect(res.canceledExpired).toBe(1);
    expect(res.missedNotified).toBe(0);
  });
});

describe("recoverSchedule — un-enqueued missed slots", () => {
  it("notifies slots that passed their time without a job", async () => {
    const { db, writes } = makeDb((sql) => {
      if (CANCEL_EXPIRED.test(sql)) return { rows: [] };
      if (UNENQUEUED.test(sql))
        return { rows: [{ id: "s2", user_id: "u2", occ_date: "2026-07-24", occ_time: "10:00" }] };
      if (MISSED.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    const res = await recoverSchedule({ db, quotePostEnabled: true });
    expect(res.missedNotified).toBe(1);
    expect(writes.find((w) => MISSED.test(w.sql))?.params[1]).toBe("slot:s2:2026-07-24:10:00:missed");
  });
});

describe("recoverSchedule — P-5 feature disabled", () => {
  it("cancels queued P-5 jobs when the flag is off", async () => {
    const { db, writes } = makeDb((sql) => {
      if (CANCEL_EXPIRED.test(sql)) return { rows: [] };
      if (P5_CANCEL.test(sql)) return { rows: [], rowCount: 3 };
      return { rows: [] };
    });
    const res = await recoverSchedule({ db, quotePostEnabled: false });
    expect(res.canceledFeatureDisabled).toBe(3);
    expect(writes.some((w) => P5_CANCEL.test(w.sql))).toBe(true);
  });

  it("does not touch P-5 jobs when the flag is on", async () => {
    const { db, writes } = makeDb((sql) => (CANCEL_EXPIRED.test(sql) ? { rows: [] } : { rows: [] }));
    const res = await recoverSchedule({ db, quotePostEnabled: true });
    expect(res.canceledFeatureDisabled).toBe(0);
    expect(writes.some((w) => P5_CANCEL.test(w.sql))).toBe(false);
  });
});
