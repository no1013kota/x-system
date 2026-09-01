import { describe, expect, it } from "vitest";

import type { Queryable } from "../x/token-refresh";
import { fanOutNewsDigest, newsDigestWindowStart } from "./news-digest";

const SELECT = /with new_items as/;
const INSERT = /insert into notifications/;

type Row = Record<string, unknown>;

let insertSeq = 0;

function mockDb(
  digestRows: Row[],
  insertRowCount: (params: unknown[]) => number = () => 1,
) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      if (SELECT.test(sql)) return { rows: digestRows as T[], rowCount: digestRows.length };
      if (INSERT.test(sql)) {
        // returning id, user_id: 挿入成功(rowCount 1)なら行を返し、conflict(0)なら空。
        const inserted = insertRowCount(params) > 0;
        insertSeq += 1;
        const userIds = params[0] as string[];
        return {
          rows: (inserted
            ? userIds.map((userId, i) => ({ id: `notif-${insertSeq}-${i}`, user_id: userId }))
            : []) as T[],
          rowCount: inserted ? userIds.length : 0,
        };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { db, writes };
}

const aggRow = (over: Partial<Row> = {}): Row => ({
  user_id: "u1",
  in_app: true,
  email_on: false,
  email_address: "u1@example.com",
  total_count: 7,
  item_ids: ["id1", "id2", "id3"],
  top_titles: ["t1", "t2", "t3", "t4", "t5"],
  ...over,
});

describe("newsDigestWindowStart", () => {
  it("floors a UTC instant to the top of the hour", () => {
    expect(newsDigestWindowStart(new Date("2026-07-19T00:37:12.500Z")).toISOString()).toBe(
      "2026-07-19T00:00:00.000Z",
    );
  });
});

describe("fanOutNewsDigest", () => {
  const windowStart = new Date("2026-07-19T00:00:00Z");

  it("creates one digest per matched user with dedupe key, top-5 body, and payload", async () => {
    const { db, writes } = mockDb([aggRow()]);
    const res = await fanOutNewsDigest({ db, windowStart });

    expect(res.matchedUsers).toBe(1);
    expect(res.notified).toBe(1);
    expect(res.createdIds).toHaveLength(1);
    // 1文で全員ぶんを作る（T-M8-290）。パラメータは列ごとの配列。
    const ins = writes.find((w) => INSERT.test(w.sql))!;
    expect(writes.filter((w) => INSERT.test(w.sql)), "対象者ごとに文を投げない").toHaveLength(1);
    expect(ins.params[1]).toBe("news-digest:2026-07-19T00:00:00Z"); // dedupe_key
    expect(ins.params[3]).toEqual(["ニュースダイジェスト 7件"]); // titles
    expect(ins.params[4]).toEqual(["・t1\n・t2\n・t3\n・t4\n・t5\nほか2件"]); // bodies: top5 + remainder
    expect(ins.params[6]).toEqual([true]); // in_app_enabled
    const payload = JSON.parse((ins.params[5] as string[])[0]);
    expect(payload).toEqual({
      window_started_at: "2026-07-19T00:00:00Z",
      window_ended_at: "2026-07-19T01:00:00Z",
      total_count: 7,
      news_item_ids: ["id1", "id2", "id3"],
    });
  });

  it("omits the remainder line when 5 or fewer items match", async () => {
    const { db, writes } = mockDb([aggRow({ total_count: 3, top_titles: ["a", "b", "c"] })]);
    await fanOutNewsDigest({ db, windowStart });
    expect(writes.find((w) => INSERT.test(w.sql))!.params[4]).toEqual(["・a\n・b\n・c"]);
  });

  it("creates nothing when no user matches", async () => {
    const { db, writes } = mockDb([]);
    const res = await fanOutNewsDigest({ db, windowStart });
    expect(res).toEqual({ matchedUsers: 0, notified: 0, createdIds: [], emailTargets: [] });
    expect(writes.some((w) => INSERT.test(w.sql))).toBe(false);
  });

  it("counts a deduped (already-existing) row as not newly notified", async () => {
    const { db } = mockDb([aggRow({ email_on: true })], () => 0); // on conflict do nothing → 0 rows
    const res = await fanOutNewsDigest({ db, windowStart });
    // 再実行ではメールの宛先も作らない（二重送信しない・T-M8-407）。
    expect(res).toEqual({ matchedUsers: 1, notified: 0, createdIds: [], emailTargets: [] });
  });

  it("メール通知ONの利用者ぶんだけ、作れた行からメールの宛先を作る（T-M8-407）", async () => {
    const { db, writes } = mockDb([
      aggRow({ user_id: "u1", email_on: true, email_address: "u1@example.com" }),
      aggRow({ user_id: "u2", in_app: false, email_on: true, email_address: "u2@example.com", total_count: 2, top_titles: ["a", "b"] }),
      aggRow({ user_id: "u3", email_on: false }),
      aggRow({ user_id: "u4", email_on: true, email_address: null }),
    ]);
    const res = await fanOutNewsDigest({ db, windowStart });
    expect(res.notified).toBe(4);
    // メールだけの人（u2）も行は作る（in_app_enabled=false でアプリ内には出ない）。
    const ins = writes.find((w) => INSERT.test(w.sql))!;
    expect(ins.params[6]).toEqual([true, false, true, true]);
    expect(res.emailTargets.map((t) => t.userId)).toEqual(["u1", "u2"]);
    expect(res.emailTargets[1]).toMatchObject({
      to: "u2@example.com",
      title: "ニュースダイジェスト 2件",
      body: "・a\n・b",
      totalCount: 2,
    });
    expect(res.emailTargets[1].link).toMatch(/^\/app\/news\?from=/);
  });
});
