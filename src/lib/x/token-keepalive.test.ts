import { describe, expect, it, vi } from "vitest";

import { refreshDueXTokens, KEEPALIVE_MAX_PER_RUN } from "./token-keepalive";
import type { Queryable } from "./token-refresh";

/**
 * Xの連携を切らさない（T-M8-359・運営者の指示 2026-08-28）。
 *
 * ここで守るのは2つ。**期限が近いものだけを対象にする**（毎時全アカウントを更新して
 * X APIを無駄に叩かない）ことと、**1件の失敗で他を巻き添えにしない**こと——
 * 1アカウントが要再連携になっただけで、他の利用者の連携まで放置されるのは避ける。
 */
function dbReturning(ids: string[]): { db: Queryable; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const db = {
    query: async (text: string, values?: unknown[]) => {
      sql.push(text);
      params.push(values ?? []);
      return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
    },
  } as unknown as Queryable;
  return { db, sql, params };
}

describe("refreshDueXTokens", () => {
  it("期限が近い active だけを、既定の上限件数までで拾う", async () => {
    const { db, sql, params } = dbReturning(["a", "b"]);
    const refresh = vi.fn(async () => "token");

    const result = await refreshDueXTokens(db, refresh);

    expect(result).toEqual({ targeted: 2, refreshed: 2, failed: 0 });
    expect(refresh).toHaveBeenCalledTimes(2);
    // 対象の条件が緩むと、切れていないtokenまで毎時更新してX APIを無駄に叩く。
    expect(sql[0]).toContain("status = 'active'");
    expect(sql[0]).toContain("refresh_token_ciphertext is not null");
    expect(sql[0]).toContain("token_expires_at <= now()");
    expect(params[0][1]).toBe(KEEPALIVE_MAX_PER_RUN);
  });

  it("1件が失敗しても残りは更新する（巻き添えにしない）", async () => {
    const { db } = dbReturning(["ng", "ok1", "ok2"]);
    const seen: string[] = [];
    const errors: string[] = [];
    const refresh = vi.fn(async (id: string) => {
      seen.push(id);
      if (id === "ng") throw new Error("要再連携");
      return "token";
    });

    const result = await refreshDueXTokens(db, refresh, {
      onError: (id) => errors.push(id),
    });

    expect(seen, "最初の失敗で打ち切っている").toEqual(["ng", "ok1", "ok2"]);
    expect(result).toEqual({ targeted: 3, refreshed: 2, failed: 1 });
    expect(errors, "失敗はそのまま捨てずに呼び出し側へ渡す").toEqual(["ng"]);
  });

  it("対象が無ければ何も呼ばない", async () => {
    const { db } = dbReturning([]);
    const refresh = vi.fn(async () => "token");
    expect(await refreshDueXTokens(db, refresh)).toEqual({
      targeted: 0,
      refreshed: 0,
      failed: 0,
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
