import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/stripe/resume の **route 実装** を実DB・実Supabaseクライアントで検証する（T-M8-264）。
 *
 * `resume.test.ts` は中核 `handleResumeRequest` を注入モックで網羅している。ここでは
 * セッションと Stripe SDK だけをモックし、route が渡す本番実装——service_role の PostgREST で
 * profiles を読む `getProfile` と、**成立した契約を `applyPreparedStripeEvent` で実DBへ反映する
 * `applyProjection`**——を実際に走らせる（portal/route.db.test.ts と同じ理由・構造）。
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
const createCalls: { params: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
const listedSubscriptions: { value: Record<string, unknown>[] } = { value: [] };
const listedCards: { value: Record<string, unknown>[] } = { value: [{ id: "pm_db_card" }] };
const state: { periodEnd: number; premiumPrice: string } = { periodEnd: 0, premiumPrice: "" };
const lastCreated: { value: Record<string, unknown> } = { value: {} };
vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        expire: async () => ({}),
        list: async () => ({ data: [] }),
      },
    };

    paymentMethods = {
      list: async () => ({ data: listedCards.value }),
    };

    subscriptions = {
      create: async (
        params: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => {
        createCalls.push({ params, options });
        lastCreated.value = {
          id: "sub_db_resumed",
          cancel_at: null,
          cancel_at_period_end: false,
          customer: params.customer,
          items: {
            data: [
              { current_period_end: state.periodEnd, price: { id: state.premiumPrice } },
            ],
          },
          livemode: false,
          metadata: params.metadata,
          status: "active",
          trial_end: null,
          trial_start: null,
        };
        return lastCreated.value;
      },
      list: async () => ({ data: listedSubscriptions.value }),
      retrieve: async () => lastCreated.value,
    };
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

describe("POST /api/stripe/resume（route 実装・実DB）", () => {
  let available = false;
  let POST: (request: Request) => Promise<Response>;
  const userIds: string[] = [];

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      available = false;
    }
    if (available) {
      // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
      ({ POST } = await import("./route"));
      state.premiumPrice = process.env.STRIPE_PRICE_PREMIUM_MONTHLY as string;
      state.periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
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
    createCalls.length = 0;
    listedSubscriptions.value = [];
    listedCards.value = [{ id: "pm_db_card" }];
  });

  /** 解約済みpremiumの利用者を作る。 */
  async function makeCanceledUser(): Promise<{ id: string; customerId: string }> {
    const id = randomUUID();
    userIds.push(id);
    const customerId = `cus_dbtest_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [id, `${id}@example.com`],
    );
    // auth.users への insert で trigger が profile を作るため upsert する。
    await sql(
      `insert into profiles (id, email, plan, subscription_status, stripe_customer_id,
                             current_period_end, trial_used_at)
       values ($1,$2,'premium','canceled',$3, now() - interval '1 day', now() - interval '10 days')
       on conflict (id) do update
         set plan = 'premium', subscription_status = 'canceled',
             stripe_customer_id = excluded.stripe_customer_id,
             current_period_end = excluded.current_period_end,
             trial_used_at = excluded.trial_used_at`,
      [id, `${id}@example.com`, customerId],
    );
    currentUserId.value = id;
    return { id, customerId };
  }

  function request(origin: string | null = APP_ORIGIN): Request {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return new Request(`${APP_BASE_URL}/api/stripe/resume`, { method: "POST", headers });
  }

  it("解約済み利用者が再開すると契約が作られ、実DBの profiles が active へ即時反映される", async () => {
    const { id, customerId } = await makeCanceledUser();

    const res = await POST(request());
    const body = (await res.json()) as Record<string, unknown>;

    expect(
      JSON.stringify(body),
      `internal_error になっている: ${JSON.stringify(body)}`,
    ).not.toContain("internal_error");
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { status: "active", synced: true } });

    // 実クエリで読んだ plan/customer が server-owned な Price と一緒に渡ること。
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].params).toMatchObject({
      customer: customerId,
      default_payment_method: "pm_db_card",
      payment_behavior: "error_if_incomplete",
    });
    // 冪等キーは 10分バケット付き（Stripeの24時間リプレイから再試行を逃がす）。
    const bucket = Math.floor(Date.now() / 1000 / 600);
    const key = (createCalls[0].options as { idempotencyKey: string }).idempotencyKey;
    expect([
      `exos-ai:resume:${customerId}:pm_db_card:${bucket}`,
      // 実行がバケット境界をまたいだ場合の1つ前も許容する。
      `exos-ai:resume:${customerId}:pm_db_card:${bucket - 1}`,
    ]).toContain(key);

    // **applyPreparedStripeEvent が実DBへ書いたこと**（webhookなしで active になる）。
    const rows = await sql<{ subscription_status: string; stripe_subscription_id: string }>(
      `select subscription_status::text as subscription_status, stripe_subscription_id
         from profiles where id = $1`,
      [id],
    );
    expect(rows[0].subscription_status).toBe("active");
    expect(rows[0].stripe_subscription_id).toBe("sub_db_resumed");
  });

  it("Stripe側に生きている契約が見つかれば作らない（already_subscribed）", async () => {
    await makeCanceledUser();
    listedSubscriptions.value = [{ status: "active" }];

    const res = await POST(request());
    expect(res.status).toBe(402);
    expect(createCalls).toHaveLength(0);
  });

  it("未認証は401（DBに触れない）", async () => {
    currentUserId.value = "";
    const res = await POST(request());
    expect(res.status).toBe(401);
  });
});
