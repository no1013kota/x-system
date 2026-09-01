import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/cron/scheduler-tick の **route 実装** を実DBで検証する。
 *
 * `route-auth.test.ts` は CRON_SECRET 無しの401だけを見ており、認証を通った先（`handleCronRoute` の
 * 窓claim → `runSchedulerTick` の全段）は無検証だった。2026-07-26 のX連携不具合（service_role の
 * GRANT 漏れ）と同じ構図で、中核ロジックの単体テストが緑でも route が組む本番配線は誰も踏んでいない。
 * ここでは実DB・実 `dispatchJob`・実メール配線で route を走らせ、
 * (a) 200 で全段が完走する（例外・cleanup握り潰しが無い）、(b) cron_runs の窓claimが1件、
 * (c) 同一5分窓の二重起動は本処理を再実行しない、(d) 次の窓では取り残しを回収する、を確認する。
 *
 * モックは外部HTTP（dispatchJob の `POST /api/jobs/run`）だけ。DB・SMTP配線・env は本番実装のまま
 * （SMTPは未設定にして送信をskipさせる＝実送信も既存 queued 通知行の書き換えも起こさない）。
 * ローカルSupabaseが無い環境では skip する。
 *
 * 【共有DBへの副作用】このテストは実 tick を DB 全体に対して走らせる。dispatch は全 queued job
 * （最大50件）、recoverStaleJobs は全 stale running を requeue、cleanupOldData は40日超の
 * news/usage/cron_runs と24時間超の未参照Storage画像を実際に削除する。他ファイルが queued /
 * running job を持つタイミングで並行実行すると相互に干渉し得る（既存 cron.db.test.ts と同性質）。
 * enqueue 段は schedule_slots の時刻制約とdue窓のため決定的に作れず、応答形の検証に留めている。
 */

// `@/lib/env` は import 時に process.env を検証するため、route を読む前に .env.local を流し込む。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
const loaded = loadEnvConfig(process.cwd(), true, console, true).combinedEnv;
Object.assign(process.env, loaded);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

// cron認証は .env.local の実値ではなくテスト専用の値で通す（秘密値をテストへ持ち込まない）。
const CRON_SECRET = `test-cron-${randomUUID()}`;
Reflect.set(process.env, "CRON_SECRET", CRON_SECRET);

// SMTPは未設定にする（通知メールはT-M8-222で廃止。運営者向けopsメールの実送信も封じる）。
for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD"]) {
  Reflect.deleteProperty(process.env, key);
}

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

/** route の応答（`{ok, ran, window}` ＋ claim成立時のみ tick の各段結果）。 */
interface TickBody {
  ok?: boolean;
  ran?: boolean;
  window?: string;
  dispatched?: number;
  scheduleRecovered?: unknown;
  enqueued?: unknown;
  cleaned?: unknown;
  recovered?: { requeued: number; failed: number };
  error?: unknown;
}

/** テスト側の独立オラクル: UTCの5分バケット（`YYYY-MM-DDTHH:MM`）。 */
function windowKeyOf(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return [
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    `T${p(d.getUTCHours())}:${p(Math.floor(d.getUTCMinutes() / 5) * 5)}`,
  ].join("");
}

describe("GET /api/cron/scheduler-tick（route 実装・実DB）", () => {
  let available = false;
  // env を流し込んだ後に読む必要があるため動的import（静的importはhoistされ先に走る）。
  let GET: (request: Request) => Promise<Response>;
  let closePool: () => Promise<void>;

  const userIds: string[] = [];
  /** dispatchJob が叩いた `POST /api/jobs/run` の jobId（外部HTTPはここで止める）。 */
  const dispatched: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  // 窓keyは起動時刻から決まるため Date だけを固定して決定化する（pg等の setTimeout は実タイマーのまま）。
  // 固定先は実運用の窓・ローカルのlaunchd起動と衝突しない遠い未来かつ実行ごとに異なる5分バケット。
  // 分は「バケット境界＋2分」にして、5分への切り捨てが実装されていることも見る。
  const PINNED_YEAR = 2098;
  const pinned = new Date(
    Date.UTC(
      PINNED_YEAR,
      0,
      1 + Math.floor(Math.random() * 360),
      Math.floor(Math.random() * 24),
      Math.floor(Math.random() * 12) * 5 + 2,
      7,
    ),
  );
  const nextWindowAt = new Date(pinned.getTime() + 5 * 60_000);

  beforeAll(async () => {
    try {
      await sql("select 1");
      available = true;
    } catch {
      available = false;
    }
    if (!available) return;

    ({ GET } = await import("./route"));
    ({ closePool } = await import("@/lib/db/pool"));

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(pinned);

    // 外部HTTPは dispatchJob の `POST /api/jobs/run` だけ。worker を実起動させず 202 を返す。
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/api/jobs/run")) {
        const body = typeof init?.body === "string" ? init.body : "{}";
        const parsed = JSON.parse(body) as { jobId?: string };
        if (parsed.jobId) dispatched.push(parsed.jobId);
        return new Response(null, { status: 202 });
      }
      return (realFetch as typeof fetch)(input as RequestInfo | URL, init);
    });

    // route が注入する運用ログ（onCleanupError / onEmailStaleWarning）の到達を観測する。
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterAll(async () => {
    // 2098年へ固定した時計で書いたKPI行を残さない（共有DBの他テストのmax()検査を汚す・T-M8-398で実害）。
    await sql(`delete from kpi_daily where metric_date >= '2090-01-01'`).catch(() => undefined);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // 固定した年の窓keyだけを消す（実運用の窓とは衝突しない）。失敗時に別形式のkeyが
    // claim されていても取り残さないため、個別keyではなく前方一致で掃除する。
    await sql(`delete from cron_runs where job_name = 'scheduler_tick' and window_key like $1`, [
      `${PINNED_YEAR}-%`,
    ]).catch(() => []);
    // FK順に消す（generation_jobs/notifications → x_accounts → profiles → auth.users）。
    for (const id of userIds) {
      await sql(
        `delete from generation_jobs where x_account_id in (select id from x_accounts where user_id = $1)`,
        [id],
      ).catch(() => []);
      await sql(`delete from notifications where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from x_accounts where user_id = $1`, [id]).catch(() => []);
      await sql(`delete from profiles where id = $1`, [id]).catch(() => []);
      await sql(`delete from auth.users where id = $1`, [id]).catch(() => []);
    }
    if (closePool) await closePool();
  });

  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  /** premium/trialing の利用者と active な X アカウントを作る。 */
  async function makeAccount(): Promise<{ userId: string; xAccountId: string }> {
    const userId = randomUUID();
    await sql(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [userId, `${userId}@example.com`],
    );
    await sql(
      `insert into profiles (id, email, plan, subscription_status)
       values ($1,$2,'premium','trialing')
       on conflict (id) do update set plan = 'premium', subscription_status = 'trialing'`,
      [userId, `${userId}@example.com`],
    );
    userIds.push(userId);
    const rows = await sql<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status, base_md_version)
       values ($1,$2,'h','n','byok','active',1) returning id`,
      [userId, `x-${userId}`],
    );
    return { userId, xAccountId: rows[0].id };
  }

  /** dispatch 対象になる queued ジョブ（available_at は既定 now()）。 */
  async function insertQueuedJob(xAccountId: string): Promise<string> {
    const rows = await sql<{ id: string }>(
      `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status)
       values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued') returning id`,
      [xAccountId],
    );
    return rows[0].id;
  }

  /** stale 回収対象の running ジョブ（locked_at 15分前・attempt<3）。 */
  async function insertStaleJob(xAccountId: string): Promise<string> {
    const rows = await sql<{ id: string }>(
      `insert into generation_jobs
         (x_account_id, kind, trigger, pattern_id, status, attempt, locked_at, locked_by, started_at)
       values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'running', 1, now() - interval '15 min', 'w', now())
       returning id`,
      [xAccountId],
    );
    return rows[0].id;
  }

  async function jobStatus(id: string): Promise<string> {
    const rows = await sql<{ status: string }>(
      `select status from generation_jobs where id = $1`,
      [id],
    );
    return rows[0]?.status ?? "missing";
  }

  async function claimCount(windowKey: string): Promise<number> {
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from cron_runs where job_name = 'scheduler_tick' and window_key = $1`,
      [windowKey],
    );
    return rows[0].n;
  }

  function authedRequest(): Request {
    return new Request("http://127.0.0.1:3000/api/cron/scheduler-tick", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
  }

  let xAccountId = "";
  let leftoverJobId = "";

  it("CRON_SECRET 無しは401で、窓claimも作らない（本処理へ進まない）", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/cron/scheduler-tick"));
    expect(res.status).toBe(401);
    expect(await claimCount(windowKeyOf(pinned))).toBe(0);
  });

  it("認証済み: 200 で窓をclaimし、tick の全段が実DBで走る", async () => {
    const account = await makeAccount();
    xAccountId = account.xAccountId;

    /*
      日次サマリの積み残し警告を、**このDBに溜まった過去のテスト利用者の人数**から切り離す。
      対象は「X連携済みで今日のサマリ通知が無い利用者」なので、既存利用者ぶんを先に
      「今日は作成済み」にしておく（人数がバッチ上限を超えると警告が出てこのテストが赤くなる。
      件数依存の決定的な失敗・T-M8-161と同型。2026-09-01に蓄積で実際に落ちた）。
    */
    const jstDate = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    await sql(
      `insert into notifications (user_id, type, dedupe_key, title, body, in_app_enabled)
       select p.id, 'summary', $1, 'test-presummarized', '', false from profiles p
        where exists (select 1 from x_accounts xa where xa.user_id = p.id)
       on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
      [`summary:${jstDate}`],
    );
    const queuedJobId = await insertQueuedJob(xAccountId);
    const staleJobId = await insertStaleJob(xAccountId);

    // ここで例外が出れば route の本番配線（実SQL・env・注入）が壊れている＝500相当。
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as TickBody;
    expect(body).not.toHaveProperty("error");
    expect(body.ok).toBe(true);
    expect(body.ran).toBe(true);

    // 窓keyは5分バケット（hour窓ではない）。
    expect(body.window).toBe(windowKeyOf(pinned));
    expect(await claimCount(windowKeyOf(pinned))).toBe(1);

    // (1)(2) cancel/enqueue 段: 実SQLが走り結果が応答に載る。
    expect(body.scheduleRecovered).toEqual({
      canceledExpired: expect.any(Number),
      missedNotified: expect.any(Number),
      canceledFeatureDisabled: expect.any(Number),
    });
    expect(body.enqueued).toEqual({ scanned: expect.any(Number), enqueued: expect.any(Number) });

    // (3) dispatch 段: 既定の実 dispatchJob 経由で POST /api/jobs/run が叩かれる。
    expect(dispatched).toContain(queuedJobId);
    expect(Number(body.dispatched)).toBeGreaterThanOrEqual(1);

    /*
      (4) stale 回収段: running が queued へ戻り、ロックが外れる。

      **件数（`recovered.requeued`）では判定しない。** `recoverStaleJobs` は
      「stale な running を全部」拾う全体クエリで、テストは共有DBに対して並行に走るため、
      **別ファイルのtickがこの枠を先に回収して自分の回収数が0になる**ことがある
      （実際に断続的に落ちた。落ちた回数ではなく落ちる条件を見る・CLAUDE.md §3）。
      見たいのは「この枠が回収されたか」なので、枠の状態そのもので確かめる。
    */
    expect(await jobStatus(staleJobId)).toBe("queued");
    const staleRow = await sql<{ locked_at: string | null; locked_by: string | null }>(
      `select locked_at::text as locked_at, locked_by from generation_jobs where id = $1`,
      [staleJobId],
    );
    expect(staleRow[0], "回収されていればロックが外れている").toMatchObject({
      locked_at: null,
      locked_by: null,
    });
    // 段そのものが走ったことは応答の形で見る（0件でも「走った」は言える）。
    expect(body.recovered).toMatchObject({ requeued: expect.any(Number) });

    // （旧(4') メール回収段はT-M8-222で廃止）

    // (5) cleanup 段: 各段は失敗を握り潰すため、応答形と onCleanupError 未発火で成功を確かめる。
    expect(body.cleaned).toEqual({
      newsNotifications: expect.any(Number),
      // news以外の通知にも保持期間が効く（T-M8-246）。
      otherNotifications: expect.any(Number),
      newsItems: expect.any(Number),
      usageEvents: expect.any(Number),
      cronRuns: expect.any(Number),
      newsFetchOutcomes: expect.any(Number),
      // DB接続の待ちの記録（T-M8-198）。通常は0件のまま消える対象が無い。
      poolEvents: expect.any(Number),
      // 終わったジョブとStripeイベントの保持期間（T-M8-363）。
      generationJobs: expect.any(Number),
      stripeEvents: expect.any(Number),
      // 分析用データの保持期間（T-M8-364）。
      timelinePosts: expect.any(Number),
      followerSnapshots: expect.any(Number),
      // KPIスナップショットの保持期間（T-M8-373）。
      kpiDaily: expect.any(Number),
      // ページ閲覧の生記録の保持期間（T-M8-378）。
      pageViews: expect.any(Number),
      images: expect.any(Number),
    });
    expect(errors.filter((e) => e.includes("[scheduler_tick cleanup]"))).toEqual([]);
  });

  it("同一5分窓の二重起動は本処理を再実行しない（ran:false・dispatchしない・claimは1行）", async () => {
    leftoverJobId = await insertQueuedJob(xAccountId);
    const before = dispatched.length;

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.ran).toBe(false);
    expect(body.window).toBe(windowKeyOf(pinned));
    // work 自体が走っていないので tick の結果キーは載らない。
    expect(body).not.toHaveProperty("dispatched");

    expect(dispatched.slice(before)).toEqual([]);
    expect(dispatched).not.toContain(leftoverJobId);
    expect(await jobStatus(leftoverJobId)).toBe("queued");
    expect(await claimCount(windowKeyOf(pinned))).toBe(1);
  });

  it("次の5分窓では再度走り、前窓の取り残しを回収する", async () => {
    vi.setSystemTime(nextWindowAt);

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ran).toBe(true);
    expect(body.window).toBe(windowKeyOf(nextWindowAt));
    expect(body.window).not.toBe(windowKeyOf(pinned));

    // 前窓で dispatch されなかったジョブが次窓で dispatch される（catch-up）。
    expect(dispatched).toContain(leftoverJobId);
    expect(await claimCount(windowKeyOf(nextWindowAt))).toBe(1);
  });
});
