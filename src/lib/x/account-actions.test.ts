import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  disconnectXAccount,
  enableXAccount,
  listXAccountsForUser,
  refreshXAccountStatus,
  type XMeFetcher,
} from "./account-actions";
import type { Queryable } from "./token-refresh";

type Row = Record<string, unknown>;
type Responder = (sql: string, params: unknown[]) => Row[];

/** SQL 文面で分岐する最小 Queryable。全クエリを writes に記録する。 */
function makeDb(responder: Responder) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const rows = responder(sql, params) as unknown as T[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, writes };
}

const OWNED = /select xa\.status, xa\.auth_type, p\.plan/;
const STATUS = /select status from x_accounts where id/;
const PLAN_FOR_UPDATE = /select plan from profiles where id = \$1 for update/;
const ACTIVE_COUNT = /count\(\*\)::int as n from x_accounts/;

const runInTxPassthrough =
  (db: Queryable) =>
  <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
    fn(db);

const me: Awaited<ReturnType<XMeFetcher>> = {
  id: "x-1",
  username: "acme",
  name: "Acme",
  profileImageUrl: "https://img",
};

/** Resolves to the rejection reason (as AppError); throws if the promise resolves. */
async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected the promise to reject");
}

describe("listXAccountsForUser", () => {
  it("maps rows to the display shape (active + automation flags)", async () => {
    const { db } = makeDb(() => [
      {
        id: "a1",
        handle: "acme",
        name: "Acme",
        profile_image_url: null,
        auth_type: "byok",
        status: "active",
        is_active: true,
        automation_active: false,
      },
    ]);
    const list = await listXAccountsForUser(db, "u1");
    expect(list).toEqual([
      {
        id: "a1",
        handle: "acme",
        name: "Acme",
        profileImageUrl: null,
        authType: "byok",
        status: "active",
        isActive: true,
        automationActive: false,
      },
    ]);
  });
});

describe("refreshXAccountStatus", () => {
  it("sets active and applies /me fields when /me succeeds", async () => {
    const { db, writes } = makeDb((sql) =>
      OWNED.test(sql) ? [{ status: "active", auth_type: "managed", plan: "premium" }] : [],
    );
    const res = await refreshXAccountStatus("a1", "u1", {
      db,
      getAccessToken: async () => "tok",
      fetchMe: async () => me,
    });
    expect(res.status).toBe("active");
    const update = writes.find((w) => /update x_accounts\s+set handle/.test(w.sql));
    expect(update?.params).toEqual(["a1", "acme", "Acme", "https://img"]);
  });

  it("returns the stored status (e.g. expired) when token refresh throws", async () => {
    const { db } = makeDb((sql) => {
      if (OWNED.test(sql)) return [{ status: "active", auth_type: "managed", plan: "premium" }];
      if (STATUS.test(sql)) return [{ status: "expired" }];
      return [];
    });
    const res = await refreshXAccountStatus("a1", "u1", {
      db,
      getAccessToken: async () => {
        throw new AppError("forbidden");
      },
      fetchMe: async () => me,
    });
    expect(res.status).toBe("expired");
  });

  it("marks status=error when the token is valid but /me fails", async () => {
    const { db, writes } = makeDb((sql) =>
      OWNED.test(sql) ? [{ status: "active", auth_type: "managed", plan: "premium" }] : [],
    );
    const res = await refreshXAccountStatus("a1", "u1", {
      db,
      getAccessToken: async () => "tok",
      fetchMe: async () => {
        throw new Error("suspended");
      },
    });
    expect(res.status).toBe("error");
    expect(writes.some((w) => /status = 'error'/.test(w.sql))).toBe(true);
  });

  it("rejects when the account is not owned by the user", async () => {
    const { db } = makeDb(() => []); // readOwnedAccount finds nothing
    await expect(
      refreshXAccountStatus("a1", "u1", {
        db,
        getAccessToken: async () => "tok",
        fetchMe: async () => me,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("enableXAccount", () => {
  function db(plan: string, authType: string, activeCount: number) {
    return makeDb((sql) => {
      if (OWNED.test(sql)) return [{ status: "disabled", auth_type: authType, plan }];
      if (PLAN_FOR_UPDATE.test(sql)) return [{ plan }];
      if (ACTIVE_COUNT.test(sql)) return [{ n: activeCount }];
      return [];
    });
  }

  it("activates when auth_type matches the plan, /me succeeds, and there is room", async () => {
    const { db: d } = db("premium", "managed", 0); // premium limit 3
    const res = await enableXAccount("a1", "u1", {
      db: d,
      runInTx: runInTxPassthrough(d),
      getAccessToken: async () => "tok",
      fetchMe: async () => me,
    });
    expect(res.status).toBe("active");
  });

  it("rejects auth_type mismatch (byok account under premium)", async () => {
    const { db: d } = db("premium", "byok", 0); // premium expects managed
    await expect(
      enableXAccount("a1", "u1", {
        db: d,
        runInTx: runInTxPassthrough(d),
        getAccessToken: async () => "tok",
        fetchMe: async () => me,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects with reauth_required when refresh/me fails", async () => {
    const { db: d } = db("standard", "byok", 0);
    const err = await rejection(
      enableXAccount("a1", "u1", {
        db: d,
        runInTx: runInTxPassthrough(d),
        getAccessToken: async () => {
          throw new AppError("forbidden");
        },
        fetchMe: async () => me,
      }),
    );
    expect(err.code).toBe("forbidden");
    expect(err.details?.reason).toBe("reauth_required");
  });

  it("rejects when the plan limit is already full", async () => {
    const { db: d } = db("standard", "byok", 1); // standard limit 1, already 1 other active
    const err = await rejection(
      enableXAccount("a1", "u1", {
        db: d,
        runInTx: runInTxPassthrough(d),
        getAccessToken: async () => "tok",
        fetchMe: async () => me,
      }),
    );
    expect(err.code).toBe("forbidden");
    expect(err.details?.reason).toBe("x_account_limit_reached");
  });
});

describe("disconnectXAccount", () => {
  it("disables the account, revokes best-effort, disables auto slots, and clears active", async () => {
    const { db, writes } = makeDb((sql) =>
      OWNED.test(sql) ? [{ status: "active", auth_type: "managed", plan: "premium" }] : [],
    );
    const revoke = vi.fn(async () => {});
    const res = await disconnectXAccount("a1", "u1", {
      db,
      runInTx: runInTxPassthrough(db),
      revoke,
    });
    expect(res.status).toBe("disabled");
    expect(revoke).toHaveBeenCalledWith("a1");
    expect(writes.some((w) => /status = 'disabled'/.test(w.sql))).toBe(true);
    expect(
      writes.some((w) => /update schedule_slots set enabled = false/.test(w.sql) && /mode = 'auto'/.test(w.sql)),
    ).toBe(true);
    expect(writes.some((w) => /update profiles set active_x_account_id = null/.test(w.sql))).toBe(true);
  });

  it("still disconnects when the best-effort revoke throws", async () => {
    const { db, writes } = makeDb((sql) =>
      OWNED.test(sql) ? [{ status: "active", auth_type: "byok", plan: "standard" }] : [],
    );
    const res = await disconnectXAccount("a1", "u1", {
      db,
      runInTx: runInTxPassthrough(db),
      revoke: async () => {
        throw new Error("revoke network error");
      },
    });
    expect(res.status).toBe("disabled");
    expect(writes.some((w) => /status = 'disabled'/.test(w.sql))).toBe(true);
  });
});
