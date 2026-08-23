import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import type { NextRequest } from "next/server";
import { Client } from "pg";
import type Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * GET /api/stripe/return の **route 実装** を実DB・実Supabaseクライアントで検証する。
 *
 * `billing-return.test.ts` は中核 `reconcileBillingReturn` を注入モックで網羅しているが、route が
 * 渡す本番実装（service_role の PostgREST での profile 取得＋直結pg の withTransaction での反映）は
 * 無検証だった。2026-07-26 の X連携不具合（service_role の GRANT 漏れ）とここは同型で、PostgREST
 * だけが `42501 permission denied` になっても catch されて `sync=pending` に丸まるため、
 * テストが無ければ誰も気付けない。
 *
 * そこでモックするのはセッションと Stripe SDK（外部HTTP）だけにし、
 * marker の復号・profile 取得・契約反映トランザクションは実際に走らせる。
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
  getCurrentUser: async () =>
    currentUserId.value ? { id: currentUserId.value } : null,
}));

// Stripe SDK は外部HTTPなので唯一モックする境界。呼び出し回数も検証する。
const stripeStub = {
  retrieveSession: vi.fn<(id: string) => Promise<Stripe.Checkout.Session>>(async () => {
    throw new Error("checkout.sessions.retrieve is not stubbed");
  }),
  retrieveSubscription: vi.fn<(id: string) => Promise<Stripe.Subscription>>(async () => {
    throw new Error("subscriptions.retrieve is not stubbed");
  }),
};
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    checkout: { sessions: { retrieve: (id: string) => stripeStub.retrieveSession(id) } },
    subscriptions: { retrieve: (id: string) => stripeStub.retrieveSubscription(id) },
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

const NOW = () => Math.floor(Date.now() / 1000);

describe("GET /api/stripe/return（route 実装・実DB）", () => {
  let available = false;
  let GET: (request: NextRequest) => Promise<Response>;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let NextRequestCtor: typeof import("next/server").NextRequest;
  let issueBillingReturnCookie: typeof import("@/lib/stripe/billing-return-server").issueBillingReturnCookie;
  let priceIds: typeof import("@/lib/stripe/prices").STRIPE_PRICE_IDS;
  let closePool: typeof import("@/lib/db/pool").closePool;
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
      ({ NextRequest: NextRequestCtor } = await import("next/server"));
      ({ issueBillingReturnCookie } = await import(
        "@/lib/stripe/billing-return-server"
      ));
      ({ STRIPE_PRICE_IDS: priceIds } = await import("@/lib/stripe/prices"));
      ({ closePool } = await import("@/lib/db/pool"));
    }
  });

  afterAll(async () => {
    for (const id of userIds) {
      await sql(`delete from notifications where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from profiles where id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
    // route が使う共有プールを閉じる（開いたままだと vitest が終われない）。
    if (closePool) await closePool();
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
    stripeStub.retrieveSession.mockClear();
    stripeStub.retrieveSubscription.mockClear();
  });

  /**
   * Checkout/Portal から戻ってきた利用者を作る。profiles は auth.users のトリガで
   * 自動生成されるので、Stripe 側の識別子だけ後から載せる。
   */
  async function makeUser(customerId: string | null, subscriptionId: string | null) {
    const id = randomUUID();
    // insert が途中で失敗しても afterAll が掃除できるよう、DB操作の前に登録する。
    userIds.push(id);
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [id, `${id}@example.com`],
    );
    await sql(
      `insert into profiles (id, email, stripe_customer_id, stripe_subscription_id)
       values ($1,$2,$3,$4)
       on conflict (id) do update
         set stripe_customer_id = $3, stripe_subscription_id = $4`,
      [id, `${id}@example.com`, customerId, subscriptionId],
    );
    currentUserId.value = id;
    return id;
  }

  /** Stripe から返る想定の subscription。plan は env の実 price ID に一致させる。 */
  function subscription(
    userId: string,
    customerId: string,
    subscriptionId: string,
  ): Stripe.Subscription {
    return {
      id: subscriptionId,
      customer: customerId,
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      trial_start: null,
      livemode: false,
      metadata: { user_id: userId },
      items: {
        data: [
          {
            current_period_end: NOW() + 86_400,
            current_period_start: NOW() - 86_400,
            price: { id: priceIds.standard },
          },
        ],
      },
    } as unknown as Stripe.Subscription;
  }

  /** 本番と同じ発行経路（AES-256-GCM 封緘）で cookie を作り、値部分だけを取り出す。 */
  function markerCookie(
    userId: string,
    source: "checkout" | "portal",
    issuedAt: number,
  ): string {
    return issueBillingReturnCookie(userId, source, issuedAt).split(";")[0];
  }

  function request(
    params: Record<string, string>,
    cookie?: string,
  ): NextRequest {
    const url = new URL("http://127.0.0.1:3000/api/stripe/return");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    // 実 NextRequest を使う（cookie のパース／URLデコードも本番と同じ経路を通す）。
    return new NextRequestCtor(url, {
      headers: cookie ? { cookie } : {},
    }) as NextRequest;
  }

  function location(res: Response): string {
    return res.headers.get("location") ?? "";
  }

  it("source が無い復帰は /plans へ戻し、Stripe にもDBにも触らない", async () => {
    await makeUser(null, null);
    const res = await GET(request({}));

    expect([302, 307]).toContain(res.status);
    expect(location(res)).toBe("http://127.0.0.1:3000/plans");
    expect(stripeStub.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripeStub.retrieveSession).not.toHaveBeenCalled();
  });

  it("未ログインなら復帰先を next に載せてログイン画面へ送る", async () => {
    currentUserId.value = "";
    const res = await GET(request({ source: "checkout" }));

    const target = location(res);
    expect(target).toContain("/login?next=");
    expect(target).toContain(
      encodeURIComponent("/plans?checkout=success&sync=skipped"),
    );
  });

  it("marker cookie が無ければ照合せず sync=skipped で戻す（internal_error 相当にしない）", async () => {
    await makeUser(null, null);
    const res = await GET(request({ source: "checkout" }));

    expect(location(res)).toBe(
      "http://127.0.0.1:3000/plans?checkout=success&sync=skipped",
    );
    expect(location(res)).not.toContain("sync=pending");
    expect(stripeStub.retrieveSubscription).not.toHaveBeenCalled();
  });

  it("portal 復帰: profile を service_role で読み、契約を実DBへ反映して sync=updated を返す", async () => {
    const customerId = `cus_return_${randomUUID()}`;
    const subscriptionId = `sub_return_${randomUUID()}`;
    const userId = await makeUser(customerId, subscriptionId);
    stripeStub.retrieveSubscription.mockImplementation(async (id) => {
      expect(id).toBe(subscriptionId);
      return subscription(userId, customerId, subscriptionId);
    });

    const res = await GET(
      request(
        { source: "portal" },
        markerCookie(userId, "portal", NOW() - 60),
      ),
    );

    const target = location(res);
    // ここが service_role の GRANT 漏れ／配線ミスで sync=pending に丸まる経路。
    expect(target, `照合が pending に落ちている: ${target}`).toBe(
      "http://127.0.0.1:3000/app/settings?tab=billing&portal=return&sync=updated",
    );
    expect(target).not.toContain("sync=pending");
    expect(stripeStub.retrieveSubscription).toHaveBeenCalledTimes(1);

    // 直結pg の withTransaction が実際にコミットされていることを確認する。
    const [profile] = await sql<{
      plan: string;
      subscription_status: string;
      stripe_subscription_id: string | null;
      subscription_event_created_at: Date | null;
    }>(
      `select plan::text as plan, subscription_status::text as subscription_status,
              stripe_subscription_id, subscription_event_created_at
         from profiles where id = $1`,
      [userId],
    );
    expect(profile.plan).toBe("standard");
    expect(profile.subscription_status).toBe("active");
    expect(profile.stripe_subscription_id).toBe(subscriptionId);
    expect(profile.subscription_event_created_at).not.toBeNull();

    // 復帰後は marker cookie を必ず失効させる。
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("billing_return_tx=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("checkout 成功復帰: session を照合してから契約を反映し sync=updated を返す", async () => {
    const customerId = `cus_checkout_${randomUUID()}`;
    const subscriptionId = `sub_checkout_${randomUUID()}`;
    // Checkout 直後は profile に subscription がまだ無い状態を再現する。
    const userId = await makeUser(customerId, null);
    stripeStub.retrieveSession.mockImplementation(
      async (id) =>
        ({
          id,
          client_reference_id: userId,
          customer: customerId,
          subscription: subscriptionId,
        }) as unknown as Stripe.Checkout.Session,
    );
    stripeStub.retrieveSubscription.mockImplementation(async () =>
      subscription(userId, customerId, subscriptionId),
    );

    const res = await GET(
      request(
        { source: "checkout", session_id: "cs_test_return" },
        markerCookie(userId, "checkout", NOW() - 30),
      ),
    );

    expect(location(res)).toBe(
      "http://127.0.0.1:3000/plans?checkout=success&sync=updated",
    );
    expect(stripeStub.retrieveSession).toHaveBeenCalledTimes(1);
    expect(stripeStub.retrieveSubscription).toHaveBeenCalledTimes(1);

    const [profile] = await sql<{ stripe_subscription_id: string | null }>(
      `select stripe_subscription_id from profiles where id = $1`,
      [userId],
    );
    expect(profile.stripe_subscription_id).toBe(subscriptionId);
  });

  it("webhook が先に反映済みなら Stripe を呼ばず sync=current を返す", async () => {
    const customerId = `cus_current_${randomUUID()}`;
    const subscriptionId = `sub_current_${randomUUID()}`;
    const userId = await makeUser(customerId, subscriptionId);
    const issuedAt = NOW() - 120;
    // marker 発行以降の webhook が反映済み＝profile は最新、という状態を作る。
    await sql(
      `update profiles set subscription_event_created_at = to_timestamp($2) where id = $1`,
      [userId, issuedAt + 10],
    );

    const res = await GET(
      request({ source: "portal" }, markerCookie(userId, "portal", issuedAt)),
    );

    // service_role の SELECT が通り subscription_event_created_at を読めていないと成立しない。
    expect(location(res)).toBe(
      "http://127.0.0.1:3000/app/settings?tab=billing&portal=return&sync=current",
    );
    expect(stripeStub.retrieveSubscription).not.toHaveBeenCalled();
  });

  it("profile に subscription が無い portal 復帰は sync=skipped で戻す", async () => {
    const userId = await makeUser(`cus_nosub_${randomUUID()}`, null);
    const res = await GET(
      request({ source: "portal" }, markerCookie(userId, "portal", NOW() - 60)),
    );

    expect(location(res)).toBe(
      "http://127.0.0.1:3000/app/settings?tab=billing&portal=return&sync=skipped",
    );
    expect(location(res)).not.toContain("sync=pending");
    expect(stripeStub.retrieveSubscription).not.toHaveBeenCalled();
  });

  it("他人の marker では照合せず、DBも書き換えない", async () => {
    const customerId = `cus_other_${randomUUID()}`;
    const subscriptionId = `sub_other_${randomUUID()}`;
    const userId = await makeUser(customerId, subscriptionId);
    const strangerCookie = markerCookie(randomUUID(), "portal", NOW() - 60);

    const res = await GET(request({ source: "portal" }, strangerCookie));

    expect(location(res)).toContain("sync=skipped");
    expect(stripeStub.retrieveSubscription).not.toHaveBeenCalled();
    const [profile] = await sql<{ subscription_event_created_at: Date | null }>(
      `select subscription_event_created_at from profiles where id = $1`,
      [userId],
    );
    expect(profile.subscription_event_created_at).toBeNull();
  });
});
