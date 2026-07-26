import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/stripe/portal の **route 実装** を実DB・実Supabaseクライアントで検証する。
 *
 * `portal.test.ts` は中核 `handlePortalRequest` を注入モックで網羅しているが、route が渡す
 * 本番実装（service_role の PostgREST で profiles を読む `getProfile`）は無検証だった。
 * 同じ穴が `GET /api/x/oauth/start` では service_role の GRANT 漏れ（migration 20260726000002）
 * として本番障害になっている。ここではセッションと Stripe SDK だけをモックし、profile取得と
 * billing-return cookie 発行は実際に走らせる。
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
  getCurrentUser: async () => (currentUserId.value ? { id: currentUserId.value } : null),
  requireCurrentUser: async () => {
    if (!currentUserId.value) throw new Error("unauthenticated");
    return { id: currentUserId.value };
  },
}));

/** Stripe SDK（外部HTTP）だけを差し替える。`@/lib/stripe/client` は本番実装を通す。 */
const portalCreateCalls: Record<string, unknown>[] = [];
const stripeApiKeys: string[] = [];
const portalCreateFailure: { value: Error | null } = { value: null };
const PORTAL_URL = "https://billing.stripe.test/p/session/db_test";
vi.mock("stripe", () => {
  class FakeStripe {
    billingPortal = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          portalCreateCalls.push(params);
          if (portalCreateFailure.value) throw portalCreateFailure.value;
          return { url: PORTAL_URL };
        },
      },
    };

    constructor(apiKey: string) {
      stripeApiKeys.push(apiKey);
    }
  }
  return { default: FakeStripe };
});

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

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const APP_ORIGIN = new URL(APP_BASE_URL).origin;

describe("POST /api/stripe/portal（route 実装・実DB）", () => {
  let available = false;
  let POST: (request: Request) => Promise<Response>;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let billingReturnCookie = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      available = false;
    }
    if (available) {
      ({ POST } = await import("./route"));
      ({ BILLING_RETURN_COOKIE: billingReturnCookie } = await import(
        "@/lib/stripe/billing-return-marker"
      ));
    }
  });

  afterAll(async () => {
    for (const id of userIds) {
      // profiles は auth.users への on delete cascade だが、明示的に消して残骸を残さない。
      await sql(`delete from profiles where id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
    portalCreateCalls.length = 0;
    portalCreateFailure.value = null;
  });

  /** premium 契約の利用者を作る。customerId を渡すと stripe_customer_id 付きになる。 */
  async function makeUser(customerId: string | null = null): Promise<string> {
    const id = randomUUID();
    // 途中で insert が失敗しても afterAll で消えるよう、作る前に掃除対象へ登録する。
    userIds.push(id);
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [id, `${id}@example.com`],
    );
    // auth.users への insert で trigger `on_auth_user_created` が profile を作るため upsert する。
    await sql(
      `insert into profiles (id, email, plan, subscription_status, stripe_customer_id)
       values ($1,$2,'premium','active',$3)
       on conflict (id) do update
         set plan = 'premium', subscription_status = 'active',
             stripe_customer_id = excluded.stripe_customer_id`,
      [id, `${id}@example.com`, customerId],
    );
    currentUserId.value = id;
    return id;
  }

  function request(origin: string | null = APP_ORIGIN): Request {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return new Request(`${APP_BASE_URL}/api/stripe/portal`, { method: "POST", headers });
  }

  it("customer がある利用者は Portal URL を受け取る（internal_error にならない）", async () => {
    const customerId = `cus_dbtest_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await makeUser(customerId);

    const res = await POST(request());
    const body = (await res.json()) as Record<string, unknown>;

    // ここが service_role の GRANT 漏れで internal_error になり得る経路。
    expect(
      JSON.stringify(body),
      `internal_error になっている: ${JSON.stringify(body)}`,
    ).not.toContain("internal_error");
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { url: PORTAL_URL } });

    // 実クエリで読んだ stripe_customer_id が Stripe 呼び出しに渡っていること。
    expect(portalCreateCalls).toHaveLength(1);
    expect(portalCreateCalls[0]).toMatchObject({
      customer: customerId,
      return_url: `${APP_BASE_URL}/api/stripe/return?source=portal`,
    });
    // 本番の `@/lib/stripe/client` が env の秘密鍵で初期化されていること（値は見ない）。
    // 空配列だと `every` は真になるため、実際に1回以上初期化されたことも確かめる。
    expect(stripeApiKeys.length).toBeGreaterThan(0);
    expect(stripeApiKeys.every((k) => k.length > 0)).toBe(true);

    // 成功時は billing-return cookie が付く（route の後処理まで実際に走っている）。
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(billingReturnCookie);
    expect(setCookie).toContain("HttpOnly");
  });

  it("stripe_customer_id 未作成なら subscription_required を返す（internal_error にしない）", async () => {
    await makeUser(null);

    const res = await POST(request());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(402);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "subscription_required", details: { settingsPath: "/plans" } },
    });
    expect(JSON.stringify(body)).not.toContain("internal_error");
    // Stripe は呼ばず、cookie も発行しない。
    expect(portalCreateCalls).toHaveLength(0);
    expect(res.headers.get("set-cookie") ?? "").not.toContain(billingReturnCookie);
  });

  it("profile が無い利用者では maybeSingle が空を返し internal_error になる（実クエリが走る）", async () => {
    // auth.users も profiles も無いID。PostgREST はエラーではなく0行を返す。
    currentUserId.value = randomUUID();

    const res = await POST(request());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(portalCreateCalls).toHaveLength(0);
  });

  it("Origin 不一致は認証・DB到達より前に 403 で弾く", async () => {
    await makeUser(`cus_dbtest_${randomUUID().replace(/-/g, "").slice(0, 16)}`);

    for (const origin of [null, "https://evil.example"]) {
      const res = await POST(request(origin));
      expect(res.status).toBe(403);
      expect(portalCreateCalls).toHaveLength(0);
      expect(res.headers.get("set-cookie") ?? "").not.toContain(billingReturnCookie);
    }
  });

  it("未認証は 401（DBには触らない）", async () => {
    currentUserId.value = "";

    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(portalCreateCalls).toHaveLength(0);
  });

  it("Stripe 側の失敗は provider_error に正規化する（秘密値を漏らさない）", async () => {
    await makeUser(`cus_dbtest_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
    portalCreateFailure.value = new Error("sk_test_secret provider body");

    const res = await POST(request());
    const body = JSON.stringify(await res.json());

    expect(res.status).toBe(502);
    expect(body).toContain("provider_error");
    expect(body).not.toContain("sk_test_secret");
  });
});
