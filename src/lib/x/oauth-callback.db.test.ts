import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decryptWithKey, encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import {
  sealTokenResponse,
  X_SCOPES,
  type OAuthTransaction,
  type XTokenResponse,
} from "./oauth";
import {
  handleXOAuthCallback,
  linkXAccountRecord,
  type XCallbackUser,
  type XOAuthCallbackDeps,
} from "./oauth-callback";

/**
 * Integration test for the X OAuth callback happy path (T-M2-13, 要件05 §4.3):
 * mock X API (token endpoint + /2/users/me) + real local DB via linkXAccountRecord.
 * Skips without the local Supabase stack.
 */
describe("X OAuth callback link (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
  const decrypt = (c: string) => decryptWithKey(c, testKey);

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

  async function makeUserWithByokKey(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into user_api_keys (user_id, provider, credentials_ciphertext, display_hint, status)
       values ($1,'x',$2,'{}'::jsonb,'unchecked')`,
      [
        uid,
        encrypt(
          JSON.stringify({ clientId: "cid", clientSecret: null, clientType: "public" }),
        ),
      ],
    );
    return uid;
  }

  function deps(
    uid: string,
    token: XTokenResponse,
    user: XCallbackUser,
  ): XOAuthCallbackDeps {
    const tx: OAuthTransaction = {
      userId: uid,
      authType: "byok",
      returnPath: "/app/settings?tab=api-keys",
      state: "st",
      codeVerifier: "cv",
      issuedAt: 1,
    };
    return {
      verifyState: () => tx,
      resolveClient: () => ({ clientId: "cid", redirectUri: "https://cb" }),
      exchangeCode: async () => token,
      fetchMe: async () => user,
      sealTokens: (res) => sealTokenResponse(res, encrypt, 1_700_000_000_000),
      persist: (record) => withTransaction((c) => linkXAccountRecord(c, record)),
    };
  }

  it("creates an active x_account, stores encrypted tokens, validates the BYOK key, and sets the active account", async () => {
    const uid = await withTransaction((c) => makeUserWithByokKey(c));
    try {
      const token: XTokenResponse = {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 7200,
        scope: X_SCOPES.join(" "),
      };
      const user: XCallbackUser = {
        id: `x-${randomUUID()}`,
        username: "acme",
        name: "Acme",
        profileImageUrl: "https://img",
      };
      const res = await handleXOAuthCallback(
        { code: "c", returnedState: "st", sealedStateCookie: "s", sessionUserId: uid },
        deps(uid, token, user),
      );

      const row = (
        await withTransaction((c) =>
          c.query<{
            x_user_id: string;
            handle: string;
            auth_type: string;
            status: string;
            oauth_scopes: string[];
            access_token_ciphertext: string;
            refresh_token_ciphertext: string;
          }>(
            `select x_user_id, handle, auth_type, status, oauth_scopes,
                    access_token_ciphertext, refresh_token_ciphertext
               from x_accounts where id = $1`,
            [res.xAccountId],
          ),
        )
      ).rows[0];
      expect(row.x_user_id).toBe(user.id);
      expect(row.handle).toBe("acme");
      expect(row.auth_type).toBe("byok");
      expect(row.status).toBe("active");
      expect(row.oauth_scopes).toEqual([...X_SCOPES]);
      expect(decrypt(row.access_token_ciphertext)).toBe("access-1");
      expect(decrypt(row.refresh_token_ciphertext)).toBe("refresh-1");

      const key = (
        await withTransaction((c) =>
          c.query<{ status: string }>(
            `select status from user_api_keys where user_id=$1 and provider='x'`,
            [uid],
          ),
        )
      ).rows[0];
      expect(key.status).toBe("valid");

      const prof = (
        await withTransaction((c) =>
          c.query<{ active_x_account_id: string | null }>(
            `select active_x_account_id from profiles where id=$1`,
            [uid],
          ),
        )
      ).rows[0];
      expect(prof.active_x_account_id).toBe(res.xAccountId);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = $1`, [uid]),
      );
    }
  });

  it("re-link upserts tokens for the same x_user_id and preserves base_md/settings", async () => {
    const uid = await withTransaction((c) => makeUserWithByokKey(c));
    const xUserId = `x-${randomUUID()}`;
    const user: XCallbackUser = {
      id: xUserId,
      username: "acme",
      name: "Acme",
      profileImageUrl: null,
    };
    try {
      const first = await handleXOAuthCallback(
        { code: "c", returnedState: "st", sealedStateCookie: "s", sessionUserId: uid },
        deps(
          uid,
          { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: X_SCOPES.join(" ") },
          user,
        ),
      );
      // accumulate account-scoped data that a re-link must not destroy
      await withTransaction((c) =>
        c.query(
          `update x_accounts set base_md='persona-md', base_md_version=2 where id=$1`,
          [first.xAccountId],
        ),
      );

      const second = await handleXOAuthCallback(
        { code: "c2", returnedState: "st", sealedStateCookie: "s", sessionUserId: uid },
        deps(
          uid,
          { access_token: "a2", refresh_token: "r2", expires_in: 7200, scope: X_SCOPES.join(" ") },
          user,
        ),
      );
      expect(second.xAccountId).toBe(first.xAccountId); // same row (upsert)

      const row = (
        await withTransaction((c) =>
          c.query<{
            base_md: string;
            base_md_version: number;
            access_token_ciphertext: string;
          }>(
            `select base_md, base_md_version, access_token_ciphertext from x_accounts where id=$1`,
            [first.xAccountId],
          ),
        )
      ).rows[0];
      expect(row.base_md).toBe("persona-md"); // preserved
      expect(row.base_md_version).toBe(2);
      expect(decrypt(row.access_token_ciphertext)).toBe("a2"); // rotated
    } finally {
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = $1`, [uid]),
      );
    }
  });
});
