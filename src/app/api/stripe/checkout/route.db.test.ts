import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/stripe/checkout の **route 実装** を実DB・実Supabaseクライアントで検証する。
 *
 * `checkout.test.ts` は中核 `handleCheckoutRequest` を注入モックで網羅しているが、route が渡す
 * 本番実装（service_role の PostgREST で profiles を読み書きする部分）は無検証だった。
 * これは 2026-07-26 の X連携不具合（service_role のテーブルGRANT漏れ → `internal_error`）と
 * 同じ穴で、アプリの大半が直結pgを使うため既存の *.db.test.ts では検出できない。
 * ここではセッションと Stripe SDK（外部HTTP）だけをモックし、profiles の取得・
 * stripe_customer_id の保存は実際に走らせる。
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

// (a) セッション: 実Cookie/Supabase Auth を張らずに利用者を差し替える。
const currentUser = { value: null as { id: string; email: string | null } | null };
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => currentUser.value,
}));

// (b) 外部HTTP: Stripe SDK。課金APIは叩かず、route が渡したパラメータを記録する。
const stripeCalls = {
  customerCreate: [] as { params: Record<string, unknown>; options?: Record<string, unknown> }[],
  sessionCreate: [] as Record<string, unknown>[],
};
const nextCustomerId = { value: "" };
const CHECKOUT_URL = "https://checkout.stripe.test/c/pay/cs_test_local";
vi.mock("@/lib/stripe/client", () => ({
  STRIPE_API_VERSION: "test-mocked",
  stripe: {
    customers: {
      create: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
        stripeCalls.customerCreate.push({ params, options });
        return { id: nextCustomerId.value };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          stripeCalls.sessionCreate.push(params);
          return { id: "cs_test_local", url: CHECKOUT_URL };
        },
      },
    },
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

describe("POST /api/stripe/checkout（route 実装・実DB）", () => {
  let available = false;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let POST: (request: Request) => Promise<Response>;
  let priceIds: Record<string, string>;
  let planIds: readonly string[];
  let appBaseUrl = "";
  let appOrigin = "";
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
      ({ STRIPE_PRICE_IDS: priceIds } = await import("@/lib/stripe/prices"));
      ({ PLAN_IDS: planIds } = await import("@/lib/plans"));
      const { env } = await import("@/lib/env");
      appBaseUrl = (env.APP_BASE_URL as string).replace(/\/$/, "");
      appOrigin = new URL(appBaseUrl).origin;
    }
  });

  afterAll(async () => {
    for (const id of userIds) {
      await sql(`delete from profiles where id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
    stripeCalls.customerCreate = [];
    stripeCalls.sessionCreate = [];
    nextCustomerId.value = `cus_test_${randomUUID().replaceAll("-", "")}`;
    currentUser.value = null;
  });

  /** Customer未作成・trial未使用の利用者を作る（profiles は auth トリガが作るので upsert で揃える）。 */
  async function makeUser(): Promise<string> {
    const id = randomUUID();
    // insert が途中で失敗しても afterAll が掃除できるよう、DB操作の前に登録する。
    userIds.push(id);
    const email = `${id}@example.com`;
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [id, email],
    );
    await sql(
      `insert into profiles (id, email, plan, subscription_status, stripe_customer_id, trial_used_at)
       values ($1,$2,'standard','incomplete',null,null)
       on conflict (id) do update set stripe_customer_id = null, trial_used_at = null`,
      [id, email],
    );
    currentUser.value = { id, email };
    return id;
  }

  async function profileRow(id: string) {
    const [row] = await sql<{ stripe_customer_id: string | null; trial_used_at: Date | null }>(
      `select stripe_customer_id, trial_used_at from profiles where id = $1`,
      [id],
    );
    return row;
  }

  /** origin を省略すると正規オリジン、null を渡すと Origin ヘッダ無しになる。 */
  function request(body: unknown, origin: string | null = appOrigin): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (origin !== null) headers.set("origin", origin);
    return new Request(`${appBaseUrl}/api/stripe/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  async function json(response: Response) {
    return (await response.json()) as Record<string, unknown>;
  }

  it("既存Customer・trial未使用: 200 で Checkout URL を返し internal_error にならない", async () => {
    const id = await makeUser();
    const existing = `cus_test_${randomUUID().replaceAll("-", "")}`;
    await sql(`update profiles set stripe_customer_id = $2 where id = $1`, [id, existing]);

    const res = await POST(request({ plan: "premium" }));
    const body = await json(res);

    // ここが service_role の GRANT 漏れや配線ミスで internal_error になる経路。
    expect(res.status, `internal_error になっている: ${JSON.stringify(body)}`).toBe(200);
    expect(JSON.stringify(body)).not.toContain("internal_error");
    expect(body).toEqual({ ok: true, data: { url: CHECKOUT_URL } });

    // 実DBから読んだ Customer をそのまま使い、新規作成しない。
    expect(stripeCalls.customerCreate).toHaveLength(0);
    expect(stripeCalls.sessionCreate[0]).toMatchObject({
      customer: existing,
      client_reference_id: id,
      mode: "subscription",
      line_items: [{ price: priceIds.premium, quantity: 1 }],
      metadata: { plan: "premium", user_id: id },
      // trial_used_at が null（実DBの値）なので初回7日trialが付く。
      subscription_data: { metadata: { plan: "premium", user_id: id }, trial_period_days: 7 },
      success_url: `${appBaseUrl}/api/stripe/return?source=checkout&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/plans?checkout=canceled`,
    });

    // 成功時は billing-return cookie が付く（/api/stripe/return 側の照合用）。
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("billing_return_tx=");
    expect(setCookie).toContain("HttpOnly");
  });

  it("Customer未作成: 作成したIDを profiles へ実際に保存する（service_role の UPDATE 経路）", async () => {
    const id = await makeUser();

    const res = await POST(request({ plan: "standard" }));
    const body = await json(res);

    expect(res.status, `internal_error になっている: ${JSON.stringify(body)}`).toBe(200);
    expect(JSON.stringify(body)).not.toContain("internal_error");
    expect(stripeCalls.customerCreate[0]).toMatchObject({
      params: { email: currentUser.value?.email, metadata: { user_id: id } },
      options: { idempotencyKey: `exos-ai:customer:${id}` },
    });
    // 保存が実際にDBへ届いていること（モックDBなら気付けない箇所）。
    expect((await profileRow(id)).stripe_customer_id).toBe(nextCustomerId.value);
    expect(stripeCalls.sessionCreate[0]).toMatchObject({ customer: nextCustomerId.value });
  });

  it("trial_used_at が入っていれば trial を付けない（実DBの値で分岐）", async () => {
    const id = await makeUser();
    await sql(
      `update profiles set stripe_customer_id = $2, trial_used_at = now() where id = $1`,
      [id, `cus_test_${randomUUID().replaceAll("-", "")}`],
    );

    const res = await POST(request({ plan: "md" }));
    const body = await json(res);

    expect(res.status, `internal_error になっている: ${JSON.stringify(body)}`).toBe(200);
    expect(stripeCalls.sessionCreate[0]).toMatchObject({
      subscription_data: { metadata: { plan: "md", user_id: id } },
    });
    expect(
      (stripeCalls.sessionCreate[0].subscription_data as Record<string, unknown>),
    ).not.toHaveProperty("trial_period_days");
  });

  it("plan ごとにサーバ保有の Price ID を使う（envからの実配線）", async () => {
    const id = await makeUser();
    await sql(`update profiles set stripe_customer_id = $2 where id = $1`, [
      id,
      `cus_test_${randomUUID().replaceAll("-", "")}`,
    ]);

    for (const plan of planIds) {
      stripeCalls.sessionCreate = [];
      const res = await POST(request({ plan }));
      expect(res.status, `plan=${plan} が 200 にならない: ${JSON.stringify(await json(res))}`).toBe(
        200,
      );
      expect(priceIds[plan], `Price ID が env から解決できていない: ${plan}`).toBeTruthy();
      expect(stripeCalls.sessionCreate[0]).toMatchObject({
        line_items: [{ price: priceIds[plan], quantity: 1 }],
      });
    }
  });

  it("Origin が無い/別オリジンなら 403 で、DBにも Stripe にも触らない", async () => {
    const id = await makeUser();

    for (const origin of [null, "https://evil.example"]) {
      const res = await POST(request({ plan: "premium" }, origin));
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(stripeCalls.customerCreate).toHaveLength(0);
    expect(stripeCalls.sessionCreate).toHaveLength(0);
    expect((await profileRow(id)).stripe_customer_id).toBeNull();
  });

  it("未ログインなら 401 で Checkout を開始しない", async () => {
    currentUser.value = null;

    const res = await POST(request({ plan: "premium" }));
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(stripeCalls.sessionCreate).toHaveLength(0);
  });

  it("plan が不正・呼び出し側指定の余剰フィールドがあれば 400", async () => {
    await makeUser();

    for (const body of [
      { plan: "free" },
      { plan: "STANDARD" },
      { plan: "" },
      { plan: null },
      { plan: "standard", price_id: "price_attacker" },
      { plan: "premium", success_url: "https://evil.example/success" },
    ]) {
      const res = await POST(request(body));
      expect(res.status, `400 にならない body: ${JSON.stringify(body)}`).toBe(400);
      expect(await json(res)).toMatchObject({ ok: false, error: { code: "validation_error" } });
    }
    expect(stripeCalls.sessionCreate).toHaveLength(0);
  });

  it("profiles に行が無い利用者は internal_error（実クエリで null が返る）", async () => {
    // auth.users も profiles も作らないID。モックDBなら行が返ってしまう分岐。
    currentUser.value = { id: randomUUID(), email: "missing@example.com" };

    const res = await POST(request({ plan: "premium" }));
    expect(res.status).toBe(500);
    expect(await json(res)).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(stripeCalls.customerCreate).toHaveLength(0);
    expect(stripeCalls.sessionCreate).toHaveLength(0);
  });
});
