import { describe, expect, it } from "vitest";

import {
  looksLikeUuid,
  normalizeAccountSelector,
  resolveXAccountId,
} from "./resolve-account";

const UUID = "3f2b8c1e-9d4a-4b7e-8f10-5c6d7e8f9a0b";

/** 問い合わせSQLごとに返す行を差し替えられる最小のダミー。 */
function fakeDb(rows: { byKey: Record<string, unknown>[]; all: Record<string, unknown>[] }) {
  const calls: string[] = [];
  return {
    calls,
    query(sql: string) {
      calls.push(sql);
      // 候補一覧の問い合わせだけ handle のみを select する。
      return Promise.resolve({ rows: sql.includes("order by created_at") ? rows.all : rows.byKey });
    },
  };
}

describe("looksLikeUuid", () => {
  it("UUIDの形なら true", () => {
    expect(looksLikeUuid(UUID)).toBe(true);
    expect(looksLikeUuid(` ${UUID.toUpperCase()} `)).toBe(true);
  });

  it("Xのユーザー名は false", () => {
    for (const value of ["ai_newinfo", "@ai_newinfo", "", "3f2b8c1e-9d4a"]) {
      expect(looksLikeUuid(value)).toBe(false);
    }
  });
});

describe("normalizeAccountSelector", () => {
  it("前後の空白と先頭の@を落とす", () => {
    expect(normalizeAccountSelector("  @ai_newinfo ")).toBe("ai_newinfo");
    expect(normalizeAccountSelector("@@ai_newinfo")).toBe("ai_newinfo");
    expect(normalizeAccountSelector("ai_newinfo")).toBe("ai_newinfo");
  });
});

describe("resolveXAccountId", () => {
  it("Xのユーザー名で解決できる（@付きでも可）", async () => {
    const db = fakeDb({ byKey: [{ id: UUID, handle: "ai_newinfo" }], all: [] });
    const result = await resolveXAccountId("@ai_newinfo", { db });
    expect(result).toEqual({ ok: true, id: UUID, handle: "ai_newinfo" });
    // 大文字小文字を無視して引く（Xのユーザー名は区別しない）。
    expect(db.calls[0]).toContain("lower(handle) = lower($1)");
  });

  it("UUIDを渡したときは id で引く", async () => {
    const db = fakeDb({ byKey: [{ id: UUID, handle: "ai_newinfo" }], all: [] });
    const result = await resolveXAccountId(UUID, { db });
    expect(result).toEqual({ ok: true, id: UUID, handle: "ai_newinfo" });
    expect(db.calls[0]).toContain("where id = $1");
  });

  it("見つからないときは連携済みの候補を出す", async () => {
    const db = fakeDb({ byKey: [], all: [{ handle: "ai_newinfo" }, { handle: "exos_ai" }] });
    const result = await resolveXAccountId("typo_handle", { db });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("@ai_newinfo");
    expect(result.message).toContain("@exos_ai");
  });

  it("1件も連携されていないときは連携方法を案内する", async () => {
    const db = fakeDb({ byKey: [], all: [] });
    const result = await resolveXAccountId("ai_newinfo", { db });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Xアカウントを追加");
  });

  it("同じユーザー名が複数あるときは選ばずに止める", async () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const db = fakeDb({
      byKey: [
        { id: UUID, handle: "ai_newinfo" },
        { id: other, handle: "ai_newinfo" },
      ],
      all: [],
    });
    const result = await resolveXAccountId("ai_newinfo", { db });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 誤ったアカウントで生成すると枠と費用を消費するため、勝手に選ばない。
    expect(result.message).toContain("UUIDで指定してください");
    expect(result.message).toContain(UUID);
    expect(result.message).toContain(other);
  });

  it("空文字は問い合わせずに止める", async () => {
    const db = fakeDb({ byKey: [], all: [] });
    const result = await resolveXAccountId("  @ ", { db });
    expect(result.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
