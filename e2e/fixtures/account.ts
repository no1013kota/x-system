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

/**
 * 連携済みアカウントのアカウント.md（E2E）。
 *
 * **本物と同じ見出し構造にする**（T-M8-356）。以前は見出しの無い1行だったため、
 * この状態から「アカウント設定を保存」する経路が**必ず構造エラーで落ちる**のに、
 * どのE2Eもそこを踏んでいなかった（保存の経路がテストの網に入っていなかった）。
 */
const E2E_BASE_MD = [
  "# 発信定義書（アカウント.md）",
  "",
  "## 1. ペルソナ",
  "- 発信者: E2Eの発信者",
  "",
  "## 2. 発信テーマ",
  "- 主テーマ: AI",
  "",
  "## 3. トーン&マナー",
  "- 文末: です・ます調",
  "",
  "## 4. やらないこと",
  "- 煽らない",
  "",
  "## 5. 参考にする型",
  "",
].join("\n");

export interface TestAccount {
  email: string;
  password: string;
  userId: string;
  xAccountId: string;
  handle: string;
}

export interface AccountOptions {
  /** アカウント設定まで完了した状態（base_md_version=1）。false で初期設定ガイドを出す。 */
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

/**
 * **未確認**のauthユーザーを作る（T-M8-202以降、画面からの登録は即confirmedになるため、
 * 「メール未確認のままログインを試す」系のテストはここで状態を作る）。
 */
export async function createUnconfirmedAuthUser(email: string, password: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRole as string,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: false }),
  });
  if (!res.ok) {
    throw new Error(`未確認テストユーザーを作成できませんでした（status=${res.status}）`);
  }
  return ((await res.json()) as { id: string }).id;
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
              current_period_start = now(),
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
        options.personaReady === false ? "" : E2E_BASE_MD,
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
 * 生成画像の表示を検証するため、**実物のPNGをprivate Storageへ置く**（T-M7-26）。
 *
 * 画像プレビューは署名URL経由でブラウザが読み込むため、**実際に読み込めるオブジェクトが無いと
 * 何も検証できない**。2026-07-27、CSP（`img-src`）が署名URLを弾いて生成画像が必ず非表示に
 * なっていたが、E2Eが画像を持つ下書きを一度も描画していなかったため気付けなかった（T-M7-22）。
 * 既存オブジェクトのパスを借りると他のデータに依存して壊れるので、テストごとに作って消す。
 */
export async function uploadTestImage(storagePath: string): Promise<void> {
  // sharp は本番依存。16:9 の実寸を持つPNGを作り、レイアウトも実物と同じ条件で見る。
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 220, g: 220, b: 230 } },
  })
    .png()
    .toBuffer();

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_IMAGES ?? "generated-images";
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: serviceRole,
      authorization: `Bearer ${serviceRole}`,
      "content-type": "image/png",
      "x-upsert": "true",
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    throw new Error(`テスト画像をStorageへ置けませんでした（status=${res.status}）`);
  }
}

/** 置いたテスト画像を消す（作成分だけ）。失敗しても他のテストを止めない。 */
export async function deleteTestImage(storagePath: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET_IMAGES ?? "generated-images";
  await fetch(`${base}/storage/v1/object/${bucket}/${storagePath}`, {
    method: "DELETE",
    headers: { apikey: serviceRole, authorization: `Bearer ${serviceRole}` },
  }).catch((error: unknown) => {
    console.warn("[e2e] テスト画像の削除に失敗:", (error as Error).message);
  });
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
