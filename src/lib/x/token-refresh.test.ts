import { describe, expect, it, vi } from "vitest";

import {
  X_SCOPES,
  XTokenError,
  type FetchLike,
  type FetchResponseLike,
  type OAuthClient,
} from "./oauth";
import {
  getValidAccessToken,
  XAccountNotConnectedError,
  XTokenExpiredError,
  XTokenRefreshTimeoutError,
  type GetValidAccessTokenDeps,
  type Queryable,
} from "./token-refresh";

// fake clock: now() reads `clock`, sleep() advances it — deterministic waits.
function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

const FRESH = new Date(10 * 60 * 1000).toISOString(); // > now(0)+5min
const STALE = new Date(0).toISOString();

interface Row {
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  status: string;
  oauth_scopes: string[];
  auth_type: string;
}

function account(overrides: Partial<Row> = {}): Row {
  return {
    access_token_ciphertext: "access-old",
    refresh_token_ciphertext: "refresh-old",
    token_expires_at: STALE,
    status: "active",
    oauth_scopes: [...X_SCOPES],
    auth_type: "managed",
    ...overrides,
  };
}

/** Routes queries: select→selectRows queue, update+returning→leaseRows queue, other update→recorded. */
function mockDb(opts: { selectRows?: (Row | null)[]; leaseRows?: (Row | null)[] }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  let s = 0;
  let l = 0;
  const pick = (arr: (Row | null)[] | undefined, i: number) =>
    arr && arr.length ? arr[Math.min(i, arr.length - 1)] : null;
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      if (/^\s*select/i.test(sql)) {
        const row = pick(opts.selectRows, s++);
        return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
      }
      writes.push({ sql, params });
      if (/returning/i.test(sql)) {
        const row = pick(opts.leaseRows, l++);
        return { rows: (row ? [row] : []) as unknown as T[], rowCount: row ? 1 : 0 };
      }
      return { rows: [] as unknown as T[], rowCount: 1 };
    },
  };
  return { db, writes };
}

function jsonResponse(status: number, body: unknown): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function makeDeps(
  db: Queryable,
  fetchImpl: FetchLike,
  overrides: Partial<GetValidAccessTokenDeps> = {},
): GetValidAccessTokenDeps {
  const clock = fakeClock();
  return {
    db,
    fetch: fetchImpl,
    decrypt: (c) => c,
    encrypt: (p) => p,
    resolveClient: (): OAuthClient => ({ clientId: "cid", redirectUri: "https://cb" }),
    now: clock.now,
    sleep: clock.sleep,
    newLockId: () => "lock-1",
    ...overrides,
  };
}

describe("getValidAccessToken", () => {
  it("returns the current token without refreshing when not near expiry", async () => {
    const { db, writes } = mockDb({ selectRows: [account({ token_expires_at: FRESH })] });
    const fetchSpy = vi.fn<FetchLike>();
    const token = await getValidAccessToken("acc", makeDeps(db, fetchSpy));
    expect(token).toBe("access-old");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0); // no lease taken
  });

  it("refreshes with exactly one HTTP call and stores rotated tokens near expiry", async () => {
    const { db, writes } = mockDb({
      selectRows: [account()],
      leaseRows: [account()], // lease acquired, still stale
    });
    const fetchSpy = vi.fn<FetchLike>(async () =>
      jsonResponse(200, {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 7200,
        scope: X_SCOPES.join(" "),
      }),
    );
    const token = await getValidAccessToken("acc", makeDeps(db, fetchSpy));
    expect(token).toBe("access-new");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const apply = writes.find((w) => /access_token_ciphertext = \$3/.test(w.sql));
    expect(apply).toBeTruthy();
    expect(apply?.params[2]).toBe("access-new"); // $3 access ct
    expect(apply?.params[3]).toBe("refresh-new"); // $4 rotated refresh ct
    expect(apply?.params[1]).toBe("lock-1"); // conditioned on our lock id
  });

  it("keeps the existing refresh token when the response omits refresh_token", async () => {
    const { db, writes } = mockDb({ selectRows: [account()], leaseRows: [account()] });
    const fetchSpy = vi.fn<FetchLike>(async () =>
      jsonResponse(200, { access_token: "access-new", expires_in: 7200, scope: X_SCOPES.join(" ") }),
    );
    await getValidAccessToken("acc", makeDeps(db, fetchSpy));
    const apply = writes.find((w) => /access_token_ciphertext = \$3/.test(w.sql));
    expect(apply?.params[3]).toBe("refresh-old"); // kept existing
  });

  it("marks the account expired and calls onExpired on invalid_grant", async () => {
    const { db, writes } = mockDb({ selectRows: [account()], leaseRows: [account()] });
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse(400, { error: "invalid_grant" }));
    const onExpired = vi.fn();
    await expect(
      getValidAccessToken("acc", makeDeps(db, fetchSpy, { onExpired })),
    ).rejects.toBeInstanceOf(XTokenExpiredError);
    expect(writes.some((w) => /status = 'expired'/.test(w.sql))).toBe(true);
    expect(onExpired).toHaveBeenCalledWith("acc", "invalid_grant");
  });

  it("does not call onExpired when the expired-transition is lost to a stale-lease steal", async () => {
    // lease acquired, but the status='expired' UPDATE affects 0 rows (another run stole the
    // lease and already handled it) → the notification (onExpired) must fire only for the winner.
    const onExpired = vi.fn();
    const db: Queryable = {
      query: async <T = unknown>(sql: string) => {
        if (/^\s*select/i.test(sql)) {
          return { rows: [account()] as unknown as T[], rowCount: 1 };
        }
        if (/returning/i.test(sql)) {
          return { rows: [account()] as unknown as T[], rowCount: 1 }; // lease acquired
        }
        if (/status = 'expired'/.test(sql)) {
          return { rows: [] as unknown as T[], rowCount: 0 }; // lock stolen → 0 rows
        }
        return { rows: [] as unknown as T[], rowCount: 1 };
      },
    };
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse(400, { error: "invalid_grant" }));
    await expect(
      getValidAccessToken("acc", makeDeps(db, fetchSpy, { onExpired })),
    ).rejects.toBeInstanceOf(XTokenExpiredError);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("marks expired when the refreshed scopes are insufficient", async () => {
    const { db, writes } = mockDb({ selectRows: [account()], leaseRows: [account()] });
    const fetchSpy = vi.fn<FetchLike>(async () =>
      jsonResponse(200, { access_token: "a", expires_in: 7200, scope: "tweet.read users.read" }),
    );
    await expect(
      getValidAccessToken("acc", makeDeps(db, fetchSpy)),
    ).rejects.toBeInstanceOf(XTokenExpiredError);
    expect(writes.some((w) => /status = 'expired'/.test(w.sql))).toBe(true);
  });

  /**
   * Xは失効・ローテート済みのrefresh tokenに `invalid_grant` ではなく **400 `invalid_request`** を
   * 返すことがある（2026-08-15 に実アカウント2件で確認・T-M8-96）。これを一時エラー扱いにすると
   * 画面は「連携済み」のままrefreshが永遠に失敗し続ける。4xxは要再連携として扱う。
   */
  it("marks the account expired on 400 invalid_request too (T-M8-96)", async () => {
    const { db, writes } = mockDb({ selectRows: [account()], leaseRows: [account()] });
    const onExpired = vi.fn();
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse(400, { error: "invalid_request" }));
    await expect(
      getValidAccessToken("acc", { ...makeDeps(db, fetchSpy), onExpired }),
    ).rejects.toMatchObject({ code: "x_token_expired", reason: "invalid_request" });
    expect(writes.some((w) => /status = 'expired'/.test(w.sql))).toBe(true);
    expect(onExpired).toHaveBeenCalledWith("acc", "invalid_request");
  });

  it("releases the lease and rethrows on a transient (5xx) error", async () => {
    const { db, writes } = mockDb({ selectRows: [account()], leaseRows: [account()] });
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse(503, { error: "service_unavailable" }));
    await expect(getValidAccessToken("acc", makeDeps(db, fetchSpy))).rejects.toBeInstanceOf(
      XTokenError,
    );
    // released (lock nulled) but NOT expired
    expect(writes.some((w) => /status = 'expired'/.test(w.sql))).toBe(false);
    expect(
      writes.some((w) => /token_refresh_lock_id = null/.test(w.sql) && !/expired/.test(w.sql)),
    ).toBe(true);
  });

  it("marks expired (no_refresh_token) when there is no refresh token to use", async () => {
    const { db } = mockDb({
      selectRows: [account({ refresh_token_ciphertext: null })],
      leaseRows: [account({ refresh_token_ciphertext: null })],
    });
    const fetchSpy = vi.fn<FetchLike>();
    await expect(getValidAccessToken("acc", makeDeps(db, fetchSpy))).rejects.toMatchObject({
      code: "x_token_expired",
      reason: "no_refresh_token",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws for an already-expired account without any work", async () => {
    const { db } = mockDb({ selectRows: [account({ status: "expired" })] });
    const fetchSpy = vi.fn<FetchLike>();
    await expect(getValidAccessToken("acc", makeDeps(db, fetchSpy))).rejects.toBeInstanceOf(
      XTokenExpiredError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws not-connected when the account is missing", async () => {
    const { db } = mockDb({ selectRows: [null] });
    await expect(
      getValidAccessToken("acc", makeDeps(db, vi.fn<FetchLike>())),
    ).rejects.toBeInstanceOf(XAccountNotConnectedError);
  });

  it("waiter re-reads and returns the refreshed token when another run holds the lease", async () => {
    // initial read stale → lease NOT acquired ([]) → poll: stale, then fresh.
    const { db } = mockDb({
      selectRows: [account(), account(), account({ token_expires_at: FRESH, access_token_ciphertext: "access-new" })],
      leaseRows: [null],
    });
    const fetchSpy = vi.fn<FetchLike>();
    const token = await getValidAccessToken("acc", makeDeps(db, fetchSpy));
    expect(token).toBe("access-new");
    expect(fetchSpy).not.toHaveBeenCalled(); // we did not refresh; the holder did
  });

  it("times out waiting when the holder never publishes a fresh token", async () => {
    const { db } = mockDb({ selectRows: [account()], leaseRows: [null] }); // always stale
    const fetchSpy = vi.fn<FetchLike>();
    await expect(getValidAccessToken("acc", makeDeps(db, fetchSpy))).rejects.toBeInstanceOf(
      XTokenRefreshTimeoutError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
