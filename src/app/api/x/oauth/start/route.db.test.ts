import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/x/oauth/start の **route 実装** を実DB・実Supabaseクライアントで検証する。
 *
 * `oauth-start.test.ts` は中核 `buildXOAuthStart` を注入モックで網羅しているが、route が渡す
 * 本番実装（service_role の PostgREST クエリ）は無検証だった。そのため service_role の GRANT
 * 漏れ（migration 20260726000002）に気付けず、X連携が `internal_error` で落ちていた。
 * ここではセッションだけをモックし、profile取得・active連携数カウントは実際に走らせる。
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

describe("GET /api/x/oauth/start（route 実装・実DB）", () => {
  let available = false;
  // route の GET は NextRequest を取るが、実際に参照するのは nextUrl だけなので
  // 最小形を渡す（型は実装側に合わせる）。
  let GET: (request: never) => Promise<Response>;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let stateCookieName = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      available = false;
    }
    if (available) {
      ({ GET } = await import("./route"));
      ({ X_OAUTH_STATE_COOKIE: stateCookieName } = await import("@/lib/x/oauth-server"));
    }
  });

  afterAll(async () => {
    for (const id of userIds) {
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  /** premium/trialing の利用者を作る（X連携は0件）。 */
  async function makeUser(): Promise<string> {
    const id = randomUUID();
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
    userIds.push(id);
    currentUserId.value = id;
    return id;
  }

  function request(returnPath?: string): never {
    const url = new URL("http://127.0.0.1:3000/api/x/oauth/start");
    if (returnPath) url.searchParams.set("return", returnPath);
    // route は nextUrl.searchParams だけを見るため、必要な形だけを渡す。
    return { nextUrl: url, url: url.toString() } as unknown as never;
  }

  it("premium: X認可URLへ 307/302 でリダイレクトし、state cookie を発行する", async () => {
    await makeUser();
    const res = await GET(request("/app/settings?tab=x-accounts"));

    expect([302, 307]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    // ここが service_role の GRANT 漏れで internal_error になっていた経路。
    expect(location, `x_oauth_error になっている: ${location}`).toContain(
      "https://x.com/i/oauth2/authorize",
    );
    expect(location).toContain("code_challenge_method=S256");
    expect(location).toContain("response_type=code");
    // cookie名は実装の定数に合わせる（封緘したPKCE/stateを載せる短TTL cookie）。
    expect(res.headers.get("set-cookie") ?? "").toContain(stateCookieName);
    expect(res.headers.get("set-cookie") ?? "").toContain("HttpOnly");
  });

  it("profile が無い利用者は not_found として設定画面へ戻す（実クエリが走る）", async () => {
    const id = randomUUID();
    currentUserId.value = id; // auth.users も profiles も無いID
    const res = await GET(request());
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_error=not_found");
    expect(location).not.toContain("internal_error");
  });

  it("契約が実行不可なら設定画面へ戻す（internal_error にしない）", async () => {
    const id = await makeUser();
    await sql(`update profiles set subscription_status = 'canceled' where id = $1`, [id]);
    const res = await GET(request());
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_error=");
    expect(location).not.toContain("internal_error");
  });

  it("plan上限に達していたら x_account_limit_reached を返す（active連携数の実カウント）", async () => {
    const id = await makeUser();
    // premium の上限は3。activeを3件作って上限到達にする。
    for (let i = 0; i < 3; i++) {
      await sql(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
         values ($1, $2, $3, 'n', 'managed', 'active')`,
        [id, `x-${id}-${i}`, `h${i}`],
      );
    }
    const res = await GET(request());
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("x_oauth_reason=x_account_limit_reached");
    expect(location).not.toContain("internal_error");
  });
});
