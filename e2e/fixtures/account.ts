import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { encryptWithKey, resolveKey } from "@/lib/crypto/envelope";
import {
  CURRENT_AUTOMATION_CONSENT_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";
import { X_SCOPES } from "@/lib/x/oauth";

/**
 * E2E用のテストアカウント（T-M7-05）。ローカルSupabaseに「実行前提を満たしたユーザー」を作り、
 * 実行後に作成分だけを消す。X tokenは`APP_ENCRYPTION_KEY`で封緘した偽トークンで、実際のX APIは
 * dry_runのため呼ばれない。安全ゲートは `guard.ts` が globalSetup で確認済み。
 */

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface TestAccount {
  email: string;
  password: string;
  userId: string;
  xAccountId: string;
  handle: string;
}

export interface AccountOptions {
  /** 発信設定まで完了した状態（base_md_version=1）。false で初期設定ガイドを出す。 */
  personaReady?: boolean;
  /** 自動投稿への同意済みにする。 */
  automationConsent?: boolean;
}

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Supabase Admin API で確認済みユーザーを作る（メール確認フローを省く）。 */
async function createAuthUser(email: string, password: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRole as string,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) {
    throw new Error(`テストユーザーを作成できませんでした（status=${res.status}）`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function createTestAccount(
  label: string,
  options: AccountOptions = {},
): Promise<TestAccount> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;
  const userId = await createAuthUser(email, password);
  const handle = `e2e_${suffix.replace(/-/g, "_")}`;
  const sealed = encryptWithKey("e2e-fake-token", resolveKey(process.env.APP_ENCRYPTION_KEY ?? ""));

  const xAccountId = await withDb(async (c) => {
    await c.query(
      `update profiles
          set plan = 'premium', subscription_status = 'trialing',
              current_period_end = now() + interval '7 days',
              trial_ends_at = now() + interval '7 days',
              terms_version = $2, terms_accepted_at = now(),
              privacy_version = $3, privacy_acknowledged_at = now()
        where id = $1`,
      [userId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
    );
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts
         (user_id, x_user_id, handle, name, auth_type, status,
          access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
          token_expires_at, base_md, base_md_version,
          automation_consent_version, automation_consented_at)
       values ($1, $2, $3, 'E2E Account', 'managed', 'active',
               $4, $4, $5, now() + interval '1 hour', $6, $7, $8, $9)
       returning id`,
      [
        userId,
        `x-${suffix}`,
        handle,
        sealed,
        X_SCOPES,
        options.personaReady === false ? "" : "# 発信定義書\n\nE2E用のベースmdです。",
        options.personaReady === false ? 0 : 1,
        options.automationConsent ? CURRENT_AUTOMATION_CONSENT_VERSION : null,
        options.automationConsent ? new Date() : null,
      ],
    );
    const id = rows[0].id;
    await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [userId, id]);
    return id;
  });

  return { email, password, userId, xAccountId, handle };
}

/** 作成分だけをFK順（子→親）に消す。失敗しても他のテストを止めないよう例外は投げない。 */
export async function destroyTestAccount(account: TestAccount): Promise<void> {
  try {
    await withDb(async (c) => {
      await c.query(`update profiles set active_x_account_id = null where id = $1`, [
        account.userId,
      ]);
      // x_accounts / profiles を参照する表をすべて先に消す（FK順。参照元が増えたらここへ足す）。
      for (const table of [
        "external_api_usage_events",
        "usage_events",
        "improvement_suggestions",
        "follower_snapshots",
        "learning_sources",
        "prompt_templates",
        "base_md_versions",
        "generation_jobs",
        "drafts",
        "schedule_slots",
      ]) {
        await c.query(`delete from ${table} where x_account_id = $1`, [account.xAccountId]);
      }
      for (const table of [
        "external_api_usage_events",
        "usage_events",
        "usage_counters",
        "user_api_keys",
        "notifications",
      ]) {
        await c.query(`delete from ${table} where user_id = $1`, [account.userId]);
      }
      await c.query(`delete from x_accounts where id = $1`, [account.xAccountId]);
      await c.query(`delete from auth.users where id = $1`, [account.userId]);
    });
  } catch (error) {
    console.warn(`[e2e] cleanup failed for ${account.email}:`, (error as Error).message);
  }
}

/**
 * 画面のサインアップで作られた利用者を消す（`createTestAccount` を経ないため
 * `accounts` fixture の後片付け対象にならない）。auth.users の cascade で profiles も消える。
 */
export async function destroyUserByEmail(email: string): Promise<void> {
  try {
    await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select id from auth.users where email = $1`,
        [email],
      );
      for (const { id } of rows) {
        await c.query(`delete from notifications where user_id = $1`, [id]);
        await c.query(`delete from usage_counters where user_id = $1`, [id]);
        await c.query(`delete from auth.users where id = $1`, [id]);
      }
    });
  } catch (error) {
    console.warn(`[e2e] cleanup failed for ${email}:`, (error as Error).message);
  }
}

/** テスト内でDBを直接読み書きする（前提の作り込みと結果の検証に使う）。 */
export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withDb(async (c) => (await c.query<T>(sql, params)).rows);
}
