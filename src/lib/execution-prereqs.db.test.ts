import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "./crypto/envelope";
import { closePool, getPool, withTransaction } from "./db/pool";
import { checkExecutionPrerequisites } from "./execution-prereqs";
import { gatherExecutionPrereqInputs } from "./execution-prereqs-server";
import { X_SCOPES } from "./x/oauth";

/**
 * DB integration for the shared execution-prerequisite gatherer (T-M2-23, 要件06 §3.2):
 * a fresh BYOK profile is missing everything; a fully set-up BYOK profile passes.
 */
describe("gatherExecutionPrereqInputs (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  async function makeProfile(
    c: PoolClient,
    over: { plan?: string; status?: string; aiPurpose?: object } = {},
  ): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status, ai_purpose_config)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (id) do update set plan = excluded.plan,
                                      subscription_status = excluded.subscription_status,
                                      ai_purpose_config = excluded.ai_purpose_config`,
      [
        uid,
        `${uid}@example.com`,
        over.plan ?? "standard",
        over.status ?? "incomplete",
        JSON.stringify(over.aiPurpose ?? {}),
      ],
    );
    return uid;
  }

  it("a fresh BYOK profile is missing every prerequisite", async () => {
    const uid = await withTransaction((c) => makeProfile(c));
    try {
      const input = await gatherExecutionPrereqInputs(uid);
      const result = checkExecutionPrerequisites(input!);
      expect(result?.missing).toEqual([
        "subscription",
        "x_api_key",
        "x_account",
        "text_ai_key",
        "persona",
      ]);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("a fully set-up BYOK profile passes", async () => {
    const uid = await withTransaction(async (c) => {
      const uid = await makeProfile(c, {
        status: "active",
        aiPurpose: { text: "anthropic", image: null },
      });
      await c.query(
        `insert into user_api_keys (user_id, provider, credentials_ciphertext, display_hint, status)
         values ($1,'x',$2,'{}'::jsonb,'valid'), ($1,'anthropic',$3,'{}'::jsonb,'valid')`,
        [uid, encrypt("{}"), encrypt("k")],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts
             (user_id, x_user_id, handle, name, auth_type, status,
              access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
              token_expires_at, base_md_version)
           values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour', 1)
           returning id`,
          [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
        )
      ).rows[0].id;
      await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, xid]);
      return uid;
    });
    try {
      const input = await gatherExecutionPrereqInputs(uid);
      expect(input?.hasActiveXAccount).toBe(true);
      expect(input?.textAiKeyValid).toBe(true);
      expect(input?.baseMdVersion).toBe(1);
      expect(checkExecutionPrerequisites(input!)).toBeNull();
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});
