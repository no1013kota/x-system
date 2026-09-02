import { randomBytes, randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyUsage, type TextGen } from "@/lib/ai/types";
import { encryptWithKey } from "@/lib/crypto/envelope";
import { closePool, getPool, withTransaction } from "@/lib/db/pool";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal";
import type { XHttp } from "@/lib/x/client";
import { X_SCOPES } from "@/lib/x/oauth";

/**
 * 「参考投稿からAIで作る」の Server Action を**本番実装のまま実DBへ通す**（T-M8-399）。
 *
 * モックするのは外部境界だけ——セッション・AI provider・Xの HTTP・X token。
 * DB・原価台帳・クレジット精算・URL→本文の引き直しはモックしない。見るのは
 * (1) URLを貼っても本文へ引き直されてAIへ渡ること (2) X読取とAI呼び出しが台帳へ載ること
 * (3) 読めないURLは理由つきで断り、AIを呼ばないこと。
 */

const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
Object.assign(process.env, loadEnvConfig(process.cwd(), true, console, true).combinedEnv);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  /** Xの /2/tweets 応答に載せる投稿（id → 本文）。テストごとに差し替える。 */
  tweets: new Map<string, string>(),
  /** AIへ渡った user プロンプト（本文が引き直されたことを確かめる）。 */
  aiUserPrompts: [] as string[],
  resolveTextProvider: vi.fn(),
  getValidXAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireUser: mocks.getCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  after: (fn: () => void) => void fn,
}));
vi.mock("@/lib/ai/resolve-provider-server", () => ({
  resolveTextProvider: mocks.resolveTextProvider,
}));
vi.mock("@/lib/x/token-refresh-server", () => ({
  getValidXAccessToken: mocks.getValidXAccessToken,
}));
// X読取の配線だけ差し替える（HTTPを偽にし、台帳は実DBへ書く）。
vi.mock("@/lib/x/read-client-server", async () => {
  const { pooledQueryable } = await import("@/lib/db/pool");
  const http: XHttp = async (req) => {
    const ids = new URL(req.url).searchParams.get("ids")?.split(",") ?? [];
    const data = ids
      .filter((id) => mocks.tweets.has(id))
      .map((id) => ({ id, text: mocks.tweets.get(id), public_metrics: { like_count: 1 } }));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
      requestId: "req-test",
    };
  };
  return {
    buildXReadDeps: (accessToken: string, ctx: unknown) => ({
      db: pooledQueryable(),
      x: { http, mode: "dry_run" },
      accessToken,
      ctx,
      costs: {
        contentCreateUsd: 0,
        contentCreateWithUrlUsd: 0,
        interactionDeleteUsd: 0,
        postReadUsd: 0.005,
        userReadUsd: 0.01,
      },
    }),
  };
});

function fakeTextGen(): TextGen {
  return {
    generate: async (req) => {
      mocks.aiUserPrompts.push(req.user);
      return {
        provider: "anthropic",
        requestId: "ai-req",
        text: JSON.stringify({
          name: "悲報型ニュース速報",
          description: "テスト生成",
          prompt: "# 投稿内容\n{題材}について悲報型で書く。",
          error: null,
        }),
        citations: [],
        usage: { ...emptyUsage(), inputTokens: 500, outputTokens: 200, providerCalls: 1 },
        stopReason: "end_turn",
      };
    },
  };
}

describe("generatePatternPromptAction（本番実装 × 実DB・T-M8-399）", () => {
  let available = false;
  const testKey = randomBytes(32);
  let userId = "";
  let xAccountId = "";

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
    if (!available) return;
    await import("./pattern-prompt");
  });

  afterEach(async () => {
    mocks.tweets.clear();
    mocks.aiUserPrompts.length = 0;
    mocks.resolveTextProvider.mockReset();
    mocks.getValidXAccessToken.mockReset();
    if (!userId) return;
    const uid = userId;
    userId = "";
    xAccountId = "";
    await withTransaction(async (c) => {
      for (const table of ["external_api_usage_events", "usage_events"]) {
        await c.query(
          `delete from ${table} where x_account_id in (select id from x_accounts where user_id = $1)`,
          [uid],
        );
      }
      for (const table of ["usage_counters", "notifications"]) {
        await c.query(`delete from ${table} where user_id = $1`, [uid]);
      }
      await c.query(`update profiles set active_x_account_id = null where id = $1`, [uid]);
      await c.query(`delete from x_accounts where user_id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    }).catch(() => {});
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const seeded = await withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `update profiles set plan = 'premium', subscription_status = 'active',
            current_period_end = now() + interval '30 days',
            terms_version = $2, terms_accepted_at = now(),
            privacy_version = $3, privacy_acknowledged_at = now()
          where id = $1`,
        [uid, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
         values ($1,$2,$3,'テスト','managed','active',$4,$4,$5, now() + interval '1 hour')
         returning id`,
        [uid, `x-${randomUUID()}`, `h${uid.slice(0, 8)}`, encryptWithKey("t", testKey), X_SCOPES],
      );
      await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, rows[0].id]);
      return { uid, xid: rows[0].id };
    });
    userId = seeded.uid;
    xAccountId = seeded.xid;
    mocks.getCurrentUser.mockResolvedValue({ id: userId, email: `${userId}@example.com` });
    mocks.getValidXAccessToken.mockResolvedValue("access-token");
    mocks.resolveTextProvider.mockResolvedValue({
      textGen: fakeTextGen(),
      provider: "anthropic",
      model: "claude-sonnet-5",
      keySource: "operator",
    });
  });

  it("X投稿のURLを貼ると本文へ引き直してAIへ渡し、X読取とAI呼び出しが台帳へ載る", async () => {
    const { generatePatternPromptAction } = await import("./pattern-prompt");
    mocks.tweets.set("1234567890", "【悲報】〇〇が終了\n\n詳細はスレッドで");

    const res = await generatePatternPromptAction({
      x_account_id: xAccountId,
      reference_posts: ["https://x.com/ExosAI/status/1234567890?s=20", "貼り付けた本文"],
      hint: "",
    });
    expect(res.status, JSON.stringify(res)).toBe("success");
    expect(res.name).toBe("悲報型ニュース速報");
    expect(res.description).toBe("テスト生成");
    expect(res.prompt).toContain("{題材}");

    // AIにはURLではなく本文が渡っている。
    expect(mocks.aiUserPrompts).toHaveLength(1);
    expect(mocks.aiUserPrompts[0]).toContain("【悲報】〇〇が終了");
    expect(mocks.aiUserPrompts[0]).not.toContain("x.com/ExosAI/status");
    // モデルは analysis 層（Anthropic=Sonnet 5）で解決している。
    expect(mocks.resolveTextProvider).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      expect.objectContaining({ purpose: "analysis" }),
    );

    const ledger = await getPool().query<{ operation: string; provider: string }>(
      `select operation, provider from external_api_usage_events where x_account_id = $1`,
      [xAccountId],
    );
    expect(ledger.rows.map((r) => r.operation)).toEqual(
      expect.arrayContaining(["x_post_read", "text_generation"]),
    );
    // premium なのでAIクレジットへ実費が精算される（jobを作らない同期実行・冪等キー付き）。
    const usage = await getPool().query<{ n: number }>(
      `select count(*)::int as n from usage_events where x_account_id = $1`,
      [xAccountId],
    );
    expect(usage.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("読めない投稿のURLは理由に列挙して断り、AIは呼ばない（黙って空で生成しない・原則1）", async () => {
    const { generatePatternPromptAction } = await import("./pattern-prompt");
    mocks.tweets.set("111", "読める投稿");

    const res = await generatePatternPromptAction({
      x_account_id: xAccountId,
      reference_posts: ["https://x.com/a/status/111", "https://x.com/a/status/222"],
      hint: "",
    });
    expect(res.status).toBe("error");
    expect(res.message).toContain("https://x.com/a/status/222");
    expect(mocks.resolveTextProvider).not.toHaveBeenCalled();
  });

  it("X連携が使えないときは、直す場所（Xアカウント設定）を添えて断る", async () => {
    const { generatePatternPromptAction } = await import("./pattern-prompt");
    mocks.getValidXAccessToken.mockRejectedValue(new Error("x_token_expired"));

    const res = await generatePatternPromptAction({
      x_account_id: xAccountId,
      reference_posts: ["https://x.com/a/status/111"],
      hint: "",
    });
    expect(res.status).toBe("error");
    expect(res.message).toContain("X連携");
    expect(res.details?.settingsPath).toBe("/app/settings?tab=x-accounts");
    expect(mocks.resolveTextProvider).not.toHaveBeenCalled();
  });

  it("X以外のURLだけの行は、Xを読まずにどの行が読めないかを返す", async () => {
    const { generatePatternPromptAction } = await import("./pattern-prompt");

    const res = await generatePatternPromptAction({
      x_account_id: xAccountId,
      reference_posts: ["https://example.com/article"],
      hint: "",
    });
    expect(res.status).toBe("error");
    expect(res.message).toContain("https://example.com/article");
    expect(mocks.getValidXAccessToken).not.toHaveBeenCalled();
    expect(mocks.resolveTextProvider).not.toHaveBeenCalled();
  });
});
