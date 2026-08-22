import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/stripe/webhook の **route 実装** を実DBで検証する。
 *
 * `webhook.test.ts` / `subscription-sync.test.ts` は中核ロジックを注入モックで網羅し、
 * `*.db.test.ts` も savepoint 上の自作 transaction で検証しているが、**route が注入する本番実装**
 * （`withTransaction`（実プール）＋ `prepareStripeEvent` ＋ `applyPreparedStripeEvent` ＋
 * `STRIPE_PRICE_IDS` ＋ `env.STRIPE_WEBHOOK_SECRET` の配線）は無検証だった。2026-07-26 のX連携不具合
 * （route が渡す本番実装だけが壊れていて誰も気付けなかった）と同じ穴なので、ここでは
 * Stripe SDK（外部HTTP境界）だけを差し替え、DB側は一切モックせずに走らせる。
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

/** 有効な署名として扱う値。実際の署名計算はStripe SDKの責務なのでここでは作らない。 */
const VALID_SIGNATURE = "t=0,v1=valid-for-this-test-only";

interface SubscriptionStub {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number;
  customerId: string;
  priceId: string;
  status: string;
  subscriptionId: string;
  trialEnd: number | null;
  trialStart: number | null;
  userId: string | null;
}

/** Stripe SDK 境界の差し替え口。テスト本体から挙動を差し込む。 */
const stripeStub = {
  /** `subscriptions.retrieve` が返す現在状態。 */
  subscription: null as SubscriptionStub | null,
  /** route が env の webhook secret を渡してきたか（値そのものは見ない）。 */
  secretProvided: false,
  verifyCalls: 0,
  retrieveCalls: 0,
};

function subscriptionPayload(stub: SubscriptionStub): Record<string, unknown> {
  return {
    id: stub.subscriptionId,
    customer: stub.customerId,
    status: stub.status,
    cancel_at_period_end: stub.cancelAtPeriodEnd,
    trial_end: stub.trialEnd,
    trial_start: stub.trialStart,
    metadata: stub.userId ? { user_id: stub.userId } : {},
    items: {
      data: [
        {
          price: { id: stub.priceId },
          current_period_end: stub.currentPeriodEnd,
        },
      ],
    },
  };
}

// 外部HTTP境界（Stripe SDK）だけを差し替える。DB・プール・同期ロジックは本番実装のまま走らせる。
vi.mock("@/lib/stripe/client", () => ({
  STRIPE_API_VERSION: "2026-06-24.dahlia",
  stripe: {
    subscriptions: {
      retrieve: async (id: string) => {
        stripeStub.retrieveCalls += 1;
        if (!stripeStub.subscription) throw new Error(`no subscription stub for ${id}`);
        return subscriptionPayload(stripeStub.subscription) as unknown as Stripe.Subscription;
      },
    },
    webhooks: {
      constructEvent: (payload: string, signature: string, secret: string) => {
        stripeStub.verifyCalls += 1;
        stripeStub.secretProvided = typeof secret === "string" && secret.length > 0;
        if (signature !== VALID_SIGNATURE) {
          // 実SDKの署名不一致と同じく throw する（route の verifyEvent の catch を通す）。
          throw new Error(
            "No signatures found matching the expected signature for payload.",
          );
        }
        return JSON.parse(payload) as Stripe.Event;
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

interface WebhookBody {
  data?: { received: boolean; result: string };
  error?: { code: string; message: string };
  ok: boolean;
}

describe("POST /api/stripe/webhook（route 実装・実DB）", () => {
  let available = false;
  let POST: (request: Request) => Promise<Response>;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let priceIds: Record<"standard" | "premium" | "expert", string>;
  let closePool: () => Promise<void>;
  const userIds: string[] = [];
  const eventIds: string[] = [];
  // console.error は recordUnexpectedError の記録先。差し替えて内容を捕まえる。
  let consoleError: { mockRestore: () => void } | null = null;
  const errorLogs: string[] = [];

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
      ({ closePool } = await import("@/lib/db/pool"));
    }
  });

  afterAll(async () => {
    for (const id of eventIds) {
      await sql(`delete from stripe_events where event_id = $1`, [id]).catch(() => []);
    }
    for (const id of userIds) {
      await sql(`delete from notifications where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from profiles where id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
    // route は実プールを使うためテストプロセスが終われない。必ず閉じる。
    if (closePool) await closePool().catch(() => undefined);
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
    stripeStub.subscription = null;
    stripeStub.secretProvided = false;
    stripeStub.verifyCalls = 0;
    stripeStub.retrieveCalls = 0;
  });

  afterEach(() => {
    consoleError?.mockRestore();
    consoleError = null;
  });

  /** 契約前（standard/incomplete）の利用者と、その Stripe customer を作る。 */
  async function makeProfile(): Promise<{ customerId: string; userId: string }> {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    // profiles は auth.users の on_auth_user_created trigger が作る。
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [userId, email],
    );
    userIds.push(userId);
    const customerId = `cus_test_${userId.replaceAll("-", "")}`;
    await sql(`update profiles set stripe_customer_id = $2 where id = $1`, [
      userId,
      customerId,
    ]);
    return { customerId, userId };
  }

  function eventId(prefix: string): string {
    const id = `evt_route_${prefix}_${randomUUID()}`;
    eventIds.push(id);
    return id;
  }

  /** `customer.subscription.updated` のイベント本体を組む。 */
  function subscriptionEvent(
    id: string,
    created: number,
    stub: SubscriptionStub,
  ): Record<string, unknown> {
    return {
      id,
      type: "customer.subscription.updated",
      created,
      data: { object: subscriptionPayload(stub) },
    };
  }

  function post(payload: unknown, signature: string | null = VALID_SIGNATURE): Promise<Response> {
    return POST(
      new Request("http://127.0.0.1:3000/api/stripe/webhook", {
        method: "POST",
        headers: signature ? { "stripe-signature": signature } : {},
        body: JSON.stringify(payload),
      }),
    );
  }

  it("署名が有効なら200で profiles を実際に更新し、stripe_events に記録する", async () => {
    const { customerId, userId } = await makeProfile();
    const created = 1_784_675_200;
    const stub: SubscriptionStub = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: created + 604_800,
      customerId,
      priceId: priceIds.premium,
      status: "trialing",
      subscriptionId: `sub_test_${userId.slice(0, 8)}`,
      trialEnd: created + 604_800,
      trialStart: created - 60,
      userId,
    };
    stripeStub.subscription = stub;
    const id = eventId("ok");

    const res = await post(subscriptionEvent(id, created, stub));
    const body = (await res.json()) as WebhookBody;

    // ここが「route が注入する本番実装だけが壊れている」を捕まえる肝。
    expect(body.error, `internal_error になっている: ${JSON.stringify(body.error)}`).toBeUndefined();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { received: true, result: "processed" } });
    // env の webhook secret が verifyEvent へ渡っている（値は見ない）。
    expect(stripeStub.secretProvided).toBe(true);
    // prepareStripeEvent が実際に Stripe を引きに行っている（本番実装が走った証拠）。
    expect(stripeStub.retrieveCalls).toBe(1);

    const profiles = await sql<{
      cancel_at_period_end: boolean;
      current_period_end: Date;
      plan: string;
      stripe_subscription_id: string;
      subscription_event_created_at: Date;
      subscription_status: string;
      trial_used_at: Date | null;
    }>(
      `select plan, subscription_status, cancel_at_period_end, current_period_end,
              stripe_subscription_id, subscription_event_created_at, trial_used_at
         from profiles where id = $1`,
      [userId],
    );
    expect(profiles[0]).toMatchObject({
      cancel_at_period_end: false,
      plan: "premium",
      stripe_subscription_id: stub.subscriptionId,
      subscription_status: "trialing",
    });
    expect(profiles[0].subscription_event_created_at.toISOString()).toBe(
      new Date(created * 1000).toISOString(),
    );
    expect(profiles[0].current_period_end.toISOString()).toBe(
      new Date(stub.currentPeriodEnd * 1000).toISOString(),
    );
    expect(profiles[0].trial_used_at?.toISOString()).toBe(
      new Date((created - 60) * 1000).toISOString(),
    );

    const events = await sql<{ object_id: string; type: string }>(
      `select type, object_id from stripe_events where event_id = $1`,
      [id],
    );
    expect(events).toEqual([
      { object_id: stub.subscriptionId, type: "customer.subscription.updated" },
    ]);
  });

  it("同一イベントの二重配信は duplicate になり、profiles を二重に反映しない", async () => {
    const { customerId, userId } = await makeProfile();
    const created = 1_784_680_000;
    const stub: SubscriptionStub = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: created + 2_592_000,
      customerId,
      priceId: priceIds.expert,
      status: "active",
      subscriptionId: `sub_dup_${userId.slice(0, 8)}`,
      trialEnd: null,
      trialStart: null,
      userId,
    };
    stripeStub.subscription = stub;
    const id = eventId("dup");
    const payload = subscriptionEvent(id, created, stub);

    const first = (await (await post(payload)).json()) as WebhookBody;
    expect(first).toEqual({ ok: true, data: { received: true, result: "processed" } });

    // 「二重に反映されたか」を観測できるように、DB側の値を人為的にずらす。
    // 冪等なら再配信では上書きされない（event_id の claim で弾かれる）。
    await sql(`update profiles set plan = 'standard' where id = $1`, [userId]);

    const second = await post(payload);
    const secondBody = (await second.json()) as WebhookBody;
    expect(secondBody.error).toBeUndefined();
    expect(second.status).toBe(200);
    expect(secondBody).toEqual({ ok: true, data: { received: true, result: "duplicate" } });

    const after = await sql<{ plan: string }>(
      `select plan from profiles where id = $1`,
      [userId],
    );
    expect(after[0].plan, "再配信で applyEvent が再実行されている").toBe("standard");

    const rows = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(rows[0].count).toBe(1);
  });

  it("署名が不正なら400で拒否し、原因を記録し、DBには何も残さない", async () => {
    const { customerId, userId } = await makeProfile();
    const created = 1_784_690_000;
    const stub: SubscriptionStub = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: created + 2_592_000,
      customerId,
      priceId: priceIds.premium,
      status: "active",
      subscriptionId: `sub_bad_${userId.slice(0, 8)}`,
      trialEnd: null,
      trialStart: null,
      userId,
    };
    stripeStub.subscription = stub;
    const id = eventId("bad");
    // 署名検証の失敗は「攻撃」だけでなく secret 設定ミスでも起きるため無記録にしない。
    consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errorLogs.push(args.map((arg) => String(arg)).join(" "));
      });

    const res = await post(subscriptionEvent(id, created, stub), "t=0,v1=forged");
    const body = (await res.json()) as WebhookBody;

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("forbidden");
    expect(stripeStub.verifyCalls).toBe(1);
    // recordUnexpectedError（Sentry未設定でも標準エラー出力に残る）で記録されている。
    expect(errorLogs.join("\n")).toContain("stripe-webhook:verify");

    // 検証前に本文を解釈しないため、記録・契約反映は一切起きない。
    const events = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(events[0].count).toBe(0);
    const profiles = await sql<{ plan: string; subscription_status: string }>(
      `select plan, subscription_status from profiles where id = $1`,
      [userId],
    );
    // 未契約の既定は null（T-M8-168）。不正署名でDBが変わらないこと。
    expect(profiles[0]).toEqual({ plan: null, subscription_status: "incomplete" });
  });

  it("stripe-signature ヘッダが無ければ本文を読む前に400で返す", async () => {
    const id = eventId("nosig");
    const res = await post({ id, type: "customer.subscription.updated", created: 1, data: { object: {} } }, null);
    const body = (await res.json()) as WebhookBody;

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("forbidden");
    expect(stripeStub.verifyCalls, "署名なしで検証を試みている").toBe(0);
    const events = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(events[0].count).toBe(0);
  });

  it("未対応イベントは ignored として200で返し、記録も反映もしない", async () => {
    const id = eventId("ignored");
    const res = await post({
      id,
      type: "customer.created",
      created: 1_784_700_000,
      data: { object: { id: "cus_ignored" } },
    });
    const body = (await res.json()) as WebhookBody;

    expect(body.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { received: true, result: "ignored" } });
    const events = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(events[0].count).toBe(0);
  });

  /**
   * **恒久エラーは200で返す**（T-M8-245）。再送しても直らない失敗に500を返し続けると、
   * Stripeが最大3日リトライしたのち **endpoint 自体を無効化**し、他の全利用者の契約同期まで止まる。
   * claim を残さない点は従来どおり（設定を直したあと手動で再送すれば処理できる）。
   */
  it("未知のPrice IDは200で返し（endpointを止めない）、claim も残さない", async () => {
    const { customerId, userId } = await makeProfile();
    const created = 1_784_710_000;
    const stub: SubscriptionStub = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: created + 2_592_000,
      customerId,
      priceId: "price_not_configured_in_env",
      status: "active",
      subscriptionId: `sub_unknown_${userId.slice(0, 8)}`,
      trialEnd: null,
      trialStart: null,
      userId,
    };
    stripeStub.subscription = stub;
    const id = eventId("price");

    const res = await post(subscriptionEvent(id, created, stub));
    const body = (await res.json()) as WebhookBody;

    expect(res.status, "恒久エラーで endpoint を止めない").toBe(200);
    expect(body.error?.code).toBeUndefined();
    const events = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(events[0].count).toBe(0);
    const profiles = await sql<{ plan: string | null }>(
      `select plan from profiles where id = $1`,
      [userId],
    );
    // 未契約の既定は null（T-M8-168で default 'standard' を撤廃）。失敗イベントでplanが変わらないこと。
    expect(profiles[0].plan).toBeNull();
  });

  it("profileに紐付かないcustomerは200で返し（恒久エラー）、実トランザクションが claim をロールバックする", async () => {
    const created = 1_784_720_000;
    const stub: SubscriptionStub = {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: created + 2_592_000,
      customerId: `cus_missing_${randomUUID().replaceAll("-", "")}`,
      priceId: priceIds.standard,
      status: "active",
      subscriptionId: `sub_missing_${randomUUID().slice(0, 8)}`,
      trialEnd: null,
      trialStart: null,
      userId: null,
    };
    stripeStub.subscription = stub;
    const id = eventId("nomap");

    const res = await post(subscriptionEvent(id, created, stub));
    const body = (await res.json()) as WebhookBody;

    expect(res.status, "恒久エラーで endpoint を止めない").toBe(200);
    expect(body.error?.code).toBeUndefined();
    // insert 済みの claim が commit されていないこと＝実 withTransaction の rollback が効いている。
    const events = await sql<{ count: number }>(
      `select count(*)::int as count from stripe_events where event_id = $1`,
      [id],
    );
    expect(events[0].count).toBe(0);
  });
});
