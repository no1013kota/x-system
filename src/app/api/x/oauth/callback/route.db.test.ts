import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/x/oauth/callback の **route 実装** を実DB・実crypto・実stateで検証する。
 *
 * `oauth-callback.test.ts` / `oauth-callback.db.test.ts` は中核 `handleXOAuthCallback` を
 * 注入モックで網羅しているが、route が注入する本番実装（`verifyState`・`managedOAuthClient`・
 * `sealTokens`・`withTransaction`+`linkXAccountRecord` の配線）は無検証だった。start route の
 * service_role GRANT 漏れ（2026-07-26）と同じ「中核は緑・配線は未検証」の穴なので、ここでは
 * 外部HTTP（token交換・/2/users/me）とセッションだけをモックし、state検証・token封緘・
 * x_accounts への永続化は実物を走らせる。
 *
 * ローカルSupabaseが無い環境では skip する。
 */

// `@/lib/env` は import 時に process.env を検証するため、route を読む前に .env.local を流し込む。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
const loaded = loadEnvConfig(process.cwd(), true, console, true).combinedEnv;
Object.assign(process.env, loaded);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

const currentUserId = { value: "" };
vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: async () => {
    if (!currentUserId.value) throw new Error("unauthenticated");
    return { id: currentUserId.value };
  },
}));

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function sql<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

/** X API への1リクエスト分の記録（body/headerも配線検証に使う）。 */
interface XApiCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

describe("GET /api/x/oauth/callback（route 実装・実DB）", () => {
  let available = false;
  // route の GET は NextRequest を取るが、実際に参照するのは nextUrl と cookies だけなので
  // 最小形を渡す（型は実装側に合わせる）。
  let GET: (request: never) => Promise<Response>;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let stateCookieName = "";
  let sealState: (tx: OAuthTx) => string;
  let newTx: (input: {
    userId: string;
    authType: "byok" | "managed";
    returnPath: string;
    now: number;
  }) => OAuthTx;
  let scopes: readonly string[] = [];
  let decrypt: (ciphertext: string) => string;
  let closePool: () => Promise<void>;
  const userIds: string[] = [];

  interface OAuthTx {
    userId: string;
    authType: "byok" | "managed";
    returnPath: string;
    state: string;
    codeVerifier: string;
    issuedAt: number;
  }

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      available = false;
    }
    if (available) {
      ({ GET } = await import("./route"));
      ({
        X_OAUTH_STATE_COOKIE: stateCookieName,
        sealState,
      } = await import("@/lib/x/oauth-server"));
      ({ newOAuthTransaction: newTx, X_SCOPES: scopes } = await import("@/lib/x/oauth"));
      ({ decrypt } = await import("@/lib/crypto"));
      ({ closePool } = await import("@/lib/db/pool"));
    }
  });

  afterAll(async () => {
    for (const id of userIds) {
      // active_x_account_id は on delete set null なので x_accounts から消せる。
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
    if (available) await closePool();
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** premium（managed経路）・実行可能な契約の利用者を作る（X連携は0件）。 */
  async function makeUser(): Promise<string> {
    const id = randomUUID();
    // insert が途中で失敗しても afterAll が掃除できるよう、DB操作の前に登録する。
    userIds.push(id);
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [id, `${id}@example.com`],
    );
    await sql(
      `insert into profiles (id, email, plan, subscription_status)
       values ($1,$2,'premium','trialing')
       on conflict (id) do update set plan = 'premium', subscription_status = 'trialing'`,
      [id, `${id}@example.com`],
    );
    currentUserId.value = id;
    return id;
  }

  /**
   * X API（token交換・/2/users/me）だけを差し替える。ここをモックしないとテストが実Xを叩くため、
   * 外部HTTPは境界として止め、それ以外（state検証・暗号化・DB）は本番実装をそのまま走らせる。
   */
  function stubXApi(opts: {
    accessToken: string;
    refreshToken?: string;
    scope?: string;
    xUser: { id: string; username: string; name: string; profile_image_url?: string };
  }): XApiCall[] {
    const calls: XApiCall[] = [];
    vi.stubGlobal(
      "fetch",
      async (
        url: string | URL,
        init?: { method?: string; headers?: Record<string, string>; body?: string },
      ) => {
        const u = String(url);
        calls.push({
          url: u,
          method: init?.method ?? "GET",
          body: init?.body ?? "",
          headers: init?.headers ?? {},
        });
        if (u.startsWith("https://api.x.com/2/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: opts.accessToken,
              refresh_token: opts.refreshToken ?? `${opts.accessToken}-refresh`,
              expires_in: 7200,
              token_type: "bearer",
              scope: opts.scope ?? scopes.join(" "),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u.startsWith("https://api.x.com/2/users/me")) {
          return new Response(JSON.stringify({ data: opts.xUser }), {
            status: 200,
            headers: { "content-type": "application/json", "x-transaction-id": "tx-test" },
          });
        }
        throw new Error(`unexpected fetch in callback route test: ${u}`);
      },
    );
    return calls;
  }

  /** 封緘済みstate cookieを持つcallbackリクエストを組み立てる。 */
  function request(input: {
    code?: string | null;
    state?: string | null;
    sealed?: string | null;
  }): never {
    const url = new URL("http://127.0.0.1:3000/api/x/oauth/callback");
    if (input.code) url.searchParams.set("code", input.code);
    if (input.state) url.searchParams.set("state", input.state);
    return {
      nextUrl: url,
      url: url.toString(),
      cookies: {
        get: (name: string) =>
          name === stateCookieName && input.sealed ? { name, value: input.sealed } : undefined,
      },
    } as unknown as never;
  }

  /** premium/managed の正しいトランザクションを実 `sealState` で封緘する。 */
  function sealedTx(userId: string, returnPath = "/app/settings?tab=x-accounts"): {
    tx: OAuthTx;
    sealed: string;
  } {
    const tx = newTx({ userId, authType: "managed", returnPath, now: Date.now() });
    return { tx, sealed: sealState(tx) };
  }

  const countXAccounts = async (userId: string): Promise<number> =>
    (
      await sql<{ n: number }>(
        `select count(*)::int as n from x_accounts where user_id = $1`,
        [userId],
      )
    )[0].n;

  it("happy path: x_accounts を実際に作り、returnPath へ x_connected=1 でリダイレクトする", async () => {
    const userId = await makeUser();
    const { tx, sealed } = sealedTx(userId);
    const xUser = {
      id: `x-${randomUUID()}`,
      username: "route_db_test",
      name: "Route DB Test",
      profile_image_url: "https://example.com/a.png",
    };
    const accessToken = `at-${randomUUID()}`;
    const calls = stubXApi({ accessToken, refreshToken: `rt-${randomUUID()}`, xUser });

    const res = await GET(request({ code: "auth-code-1", state: tx.state, sealed }));

    expect([302, 307]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    // 配線・権限バグはここで internal_error として表面化する（start routeのGRANT漏れと同型）。
    expect(location, `x_oauth_error になっている: ${location}`).not.toContain("x_oauth_error");
    expect(location).not.toContain("internal_error");
    expect(location).toContain("/app/settings");
    expect(location).toContain("tab=x-accounts");
    expect(location).toContain("x_connected=1");
    // 使い終わったstate cookieは削除する（再利用防止）。
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(stateCookieName);
    expect(setCookie).toContain("Max-Age=0");

    // 実DBに連携が1件作られ、tokenは実 crypto（APP_ENCRYPTION_KEY）で暗号化されている。
    const rows = await sql<{
      id: string;
      x_user_id: string;
      handle: string;
      name: string;
      profile_image_url: string | null;
      auth_type: string;
      status: string;
      oauth_scopes: string[];
      access_token_ciphertext: string;
      refresh_token_ciphertext: string | null;
      token_expires_at: string | null;
    }>(
      `select id, x_user_id, handle, name, profile_image_url, auth_type, status, oauth_scopes,
              access_token_ciphertext, refresh_token_ciphertext, token_expires_at
         from x_accounts where user_id = $1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.x_user_id).toBe(xUser.id);
    expect(row.handle).toBe(xUser.username);
    expect(row.name).toBe(xUser.name);
    expect(row.profile_image_url).toBe(xUser.profile_image_url);
    expect(row.auth_type).toBe("managed");
    expect(row.status).toBe("active");
    expect(row.oauth_scopes).toEqual([...scopes]);
    expect(row.access_token_ciphertext).not.toContain(accessToken); // 平文保存していない
    expect(decrypt(row.access_token_ciphertext)).toBe(accessToken);
    expect(row.refresh_token_ciphertext).not.toBeNull();
    expect(row.token_expires_at).not.toBeNull();

    // active_x_account_id 未設定なら当該連携が既定になる（実クエリ）。
    const prof = await sql<{ active_x_account_id: string | null }>(
      `select active_x_account_id from profiles where id = $1`,
      [userId],
    );
    expect(prof[0].active_x_account_id).toBe(row.id);

    // token交換→/2/users/me の順で呼ばれ、PKCE verifier は封緘stateから取り出した実値。
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([
      "https://api.x.com/2/oauth2/token",
      "https://api.x.com/2/users/me",
    ]);
    const tokenBody = new URLSearchParams(calls[0].body);
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("code")).toBe("auth-code-1");
    expect(tokenBody.get("code_verifier")).toBe(tx.codeVerifier);
    expect(tokenBody.get("redirect_uri")).toBe(
      `${process.env.APP_BASE_URL}${process.env.X_OAUTH_REDIRECT_PATH}`,
    );
    // managed（confidential client）は Basic 認証。値そのものは検証しない（秘密値）。
    expect(calls[0].headers.authorization ?? "").toMatch(/^Basic /);
    expect(calls[1].headers.authorization).toBe(`Bearer ${accessToken}`);
  });

  it("state不一致（別トランザクションのcookie）は拒否し、x_accounts を作らない", async () => {
    const userId = await makeUser();
    const { sealed } = sealedTx(userId);
    const calls = stubXApi({
      accessToken: "must-not-be-used",
      xUser: { id: `x-${randomUUID()}`, username: "nope", name: "Nope" },
    });

    // cookie側のstateとクエリのstateが食い違う＝CSRF/クロスセッションcallback。
    const res = await GET(request({ code: "c", state: `mismatched-${randomUUID()}`, sealed }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/app/settings");
    expect(location).toContain("x_oauth_error=");
    expect(location).not.toContain("x_connected");
    // token交換にも到達しない（state検証は最初の関門）。
    expect(calls).toHaveLength(0);
    expect(await countXAccounts(userId)).toBe(0);
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("state cookie の userId とセッションが違えば forbidden（cookie-forcing防御）", async () => {
    const victim = await makeUser(); // このセッションで実行する
    const attacker = randomUUID(); // 攻撃者が自分のstateを植え付けた想定
    const { tx, sealed } = sealedTx(attacker);
    const calls = stubXApi({
      accessToken: "must-not-be-used",
      xUser: { id: `x-${randomUUID()}`, username: "nope", name: "Nope" },
    });

    const res = await GET(request({ code: "c", state: tx.state, sealed }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_error=forbidden");
    expect(location).toContain("x_oauth_reason=oauth_session_mismatch");
    expect(location).not.toContain("x_connected");
    expect(calls).toHaveLength(0);
    expect(await countXAccounts(victim)).toBe(0);
  });

  it("code欠落（Xの拒否・中断）は validation_error で設定画面へ戻す", async () => {
    const userId = await makeUser();
    const { tx, sealed } = sealedTx(userId);
    const calls = stubXApi({
      accessToken: "must-not-be-used",
      xUser: { id: `x-${randomUUID()}`, username: "nope", name: "Nope" },
    });

    const res = await GET(request({ state: tx.state, sealed }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_error=validation_error");
    expect(location).toContain("x_oauth_reason=missing_code_or_state");
    expect(location).not.toContain("internal_error");
    expect(location).not.toContain("x_connected");
    expect(calls).toHaveLength(0);
    expect(await countXAccounts(userId)).toBe(0);
  });

  it("scope不足はtoken保存前に拒否し、/2/users/me も呼ばない", async () => {
    const userId = await makeUser();
    const { tx, sealed } = sealedTx(userId);
    const calls = stubXApi({
      accessToken: `at-${randomUUID()}`,
      // media.write と offline.access が欠けた付与（利用者が一部scopeを外した場合）。
      scope: "tweet.read tweet.write users.read",
      xUser: { id: `x-${randomUUID()}`, username: "partial", name: "Partial" },
    });

    const res = await GET(request({ code: "c", state: tx.state, sealed }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_error=forbidden");
    expect(location).toContain("x_oauth_reason=insufficient_scope");
    expect(location).not.toContain("internal_error");
    expect(location).not.toContain("x_connected");
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([
      "https://api.x.com/2/oauth2/token",
    ]);
    expect(await countXAccounts(userId)).toBe(0);
  });

  it("plan上限到達は x_account_limit_reached を返す（internal_error にしない）", async () => {
    const userId = await makeUser();
    // premium の上限は3。activeを3件作ってから別のX userで戻ってくる。
    for (let i = 0; i < 3; i++) {
      await sql(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
         values ($1, $2, $3, 'n', 'managed', 'active')`,
        [userId, `x-${userId}-${i}`, `h${i}`],
      );
    }
    const { tx, sealed } = sealedTx(userId);
    stubXApi({
      accessToken: `at-${randomUUID()}`,
      xUser: { id: `x-${randomUUID()}`, username: "fourth", name: "Fourth" },
    });

    const res = await GET(request({ code: "c", state: tx.state, sealed }));

    const location = res.headers.get("location") ?? "";
    // withTransaction 内で投げた AppError が route まで正しく伝わることの確認も含む。
    expect(location).toContain("x_oauth_error=forbidden");
    expect(location).toContain("x_oauth_reason=x_account_limit_reached");
    expect(location).not.toContain("internal_error");
    expect(location).not.toContain("x_connected");
    expect(await countXAccounts(userId)).toBe(3); // 4件目は保存されない
  });
});
