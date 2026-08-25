import { describe, expect, it } from "vitest";

import { autoPostPublishKey, ensureAutoPostPublishJob, isAutoMode } from "./publish-chain";
import type { Queryable } from "../db/queryable";

/**
 * T-M8-143。**auto（自動投稿）の「生成成功 → 投稿」の連鎖。**
 *
 * これが無いあいだ、`mode=auto` の予約は下書きを作るだけで投稿されていなかった。
 * ここで守るのは「1つの下書きに投稿jobが2件作られない」こと——
 * 本文生成の成功・画像生成の成功・画像失敗の回収の3経路が同じ下書きで投稿へ進もうとするため、
 * **経路ごとのkeyにすると同じ下書きが2回投稿されうる**。
 */
function makeDb(handler: (sql: string, params: unknown[]) => { rowCount: number }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const r = handler(sql, params);
      return { rows: [] as T[], rowCount: r.rowCount };
    },
  };
  return { db, calls };
}

const ACTIVE = /kind = 'post_publish' and status in/;
const INSERT = /insert into generation_jobs/;

describe("自動投稿への連鎖（T-M8-143）", () => {
  it("待機中・実行中の投稿jobが無ければ1件作る", async () => {
    const { db, calls } = makeDb((sql) => ({ rowCount: INSERT.test(sql) ? 1 : 0 }));
    expect(await ensureAutoPostPublishJob(db, { xAccountId: "xa1", draftId: "d1" })).toBe("created");
    const ins = calls.find((c) => INSERT.test(c.sql));
    expect(ins, "insert が実行されていない").toBeDefined();
    // trigger は system（利用者の操作ではない）。mode=auto を input へ入れる。
    expect(ins!.sql).toContain("'post_publish'");
    expect(ins!.sql).toContain("'system'");
    expect(ins!.params).toContain(JSON.stringify({ mode: "auto" }));
  });

  it("すでに待機中・実行中があれば作らない（二重投稿を防ぐ）", async () => {
    const { db, calls } = makeDb((sql) => ({ rowCount: ACTIVE.test(sql) ? 1 : 0 }));
    expect(await ensureAutoPostPublishJob(db, { xAccountId: "xa1", draftId: "d1" })).toBe("active");
    expect(calls.some((c) => INSERT.test(c.sql)), "insert してしまっている").toBe(false);
  });

  it("冪等keyは**draft単位**（経路が違っても衝突する）", () => {
    // 本文生成の成功・画像生成の成功・画像失敗の回収がすべて同じkeyを作る。
    expect(autoPostPublishKey("d1")).toBe("job:d1:post_publish:auto");
    expect(autoPostPublishKey("d1")).toBe(autoPostPublishKey("d1"));
    expect(autoPostPublishKey("d2")).not.toBe(autoPostPublishKey("d1"));
    // **親job単位にしない**。経路ごとに別keyだと同じ下書きが2回投稿されうる。
    expect(autoPostPublishKey("d1")).not.toContain("parent:");
  });

  it("on conflict で衝突したら spent（終端jobがkeyを保持＝二度と作れない・T-M8-196）", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 }));
    expect(await ensureAutoPostPublishJob(db, { xAccountId: "xa1", draftId: "d1" })).toBe("spent");
  });

  it("auto かどうかは input.mode だけで決める", () => {
    expect(isAutoMode({ mode: "auto" })).toBe(true);
    expect(isAutoMode({ mode: "draft" })).toBe(false);
    // **未設定は auto にしない**（手動起点を勝手に投稿しない）。
    expect(isAutoMode({})).toBe(false);
    expect(isAutoMode(null)).toBe(false);
    expect(isAutoMode(undefined)).toBe(false);
  });
});
