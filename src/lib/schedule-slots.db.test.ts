import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "./crypto/envelope";
import { closePool, getPool, withTransaction } from "./db/pool";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "./legal";
import {
  createScheduleSlot,
  disableScheduleSlot,
  enableScheduleSlot,
  updateScheduleSlot,
  type ScheduleSlotDeps,
} from "./schedule-slots";
import { X_SCOPES } from "./x/oauth";

/**
 * DB integration for schedule slot 再開（要件05 §7・要件06 §1 SC-08）。停止→再開の状態遷移、
 * 楽観lock（expected_updated_at）、auto再開時の同意ゲート、別ユーザーからの拒否を実DBで確認する。
 */
describe("enableScheduleSlot (local DB)", () => {
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

  /** active な X アカウントを持つ利用者を作る。consented=true で自動投稿の同意済みにする。 */
  async function makeAccount(
    c: PoolClient,
    opts: { consented?: boolean } = {},
  ): Promise<{ userId: string; xAccountId: string }> {
    const userId = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [userId, `${userId}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status)
       values ($1,$2,'standard','active')
       on conflict (id) do update set subscription_status = excluded.subscription_status`,
      [userId, `${userId}@example.com`],
    );
    const xAccountId = (
      await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
            token_expires_at, base_md_version,
            automation_consent_version, automation_consented_at)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now() + interval '1 hour', 1, $5, $6)
         returning id`,
        [
          userId,
          `x-${randomUUID()}`,
          encrypt("t"),
          X_SCOPES,
          opts.consented ? CURRENT_AUTOMATION_CONSENT_VERSION : null,
          opts.consented ? new Date() : null,
        ],
      )
    ).rows[0].id;
    await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [
      userId,
      xAccountId,
    ]);
    return { userId, xAccountId };
  }

  function depsFor(xAccountId: string): ScheduleSlotDeps {
    return {
      runInTx: (fn) => withTransaction((c) => fn(c)),
      resolveActiveXAccountId: async () => xAccountId,
    };
  }

  async function cleanup(userId: string): Promise<void> {
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [userId]));
  }

  it("stops and resumes a draft slot, and the row really flips in the DB", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      const created = await createScheduleSlot(
        userId,
        {
          pattern: "p1",
          weekdays: [1, 3],
          time_jst: "09:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
        },
        deps,
      );
      const disabled = await disableScheduleSlot(
        userId,
        { slot_id: created.id, expected_updated_at: created.updated_at },
        deps,
      );
      expect(disabled.enabled).toBe(false);

      const resumed = await enableScheduleSlot(
        userId,
        { slot_id: created.id, expected_updated_at: disabled.updated_at },
        deps,
      );
      expect(resumed.enabled).toBe(true);

      const row = await withTransaction((c) =>
        c.query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [
          created.id,
        ]),
      );
      expect(row.rows[0].enabled).toBe(true);
    } finally {
      await cleanup(userId);
    }
  });

  it("rejects a stale expected_updated_at with job_conflict (optimistic lock)", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      const created = await createScheduleSlot(
        userId,
        {
          pattern: "p1",
          weekdays: [2],
          time_jst: "10:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
        },
        deps,
      );
      await disableScheduleSlot(
        userId,
        { slot_id: created.id, expected_updated_at: created.updated_at },
        deps,
      );
      // 停止で updated_at が進むため、作成時の版で再開しようとすると競合になる。
      await expect(
        enableScheduleSlot(
          userId,
          { slot_id: created.id, expected_updated_at: created.updated_at },
          deps,
        ),
      ).rejects.toMatchObject({ code: "job_conflict" });
    } finally {
      await cleanup(userId);
    }
  });

  it("requires automation consent before resuming an auto slot", async () => {
    // 同意済みで auto を作り、同意を撤回してから再開を試みる。
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c, { consented: true }));
    try {
      const deps = depsFor(xAccountId);
      const created = await createScheduleSlot(
        userId,
        {
          pattern: "p1",
          weekdays: [4],
          time_jst: "11:00",
          mode: "auto",
          theme: "other",
          image_enabled: false,
        },
        deps,
      );
      const disabled = await disableScheduleSlot(
        userId,
        { slot_id: created.id, expected_updated_at: created.updated_at },
        deps,
      );
      await withTransaction((c) =>
        c.query(`update x_accounts set automation_disabled_at = now() where id = $1`, [xAccountId]),
      );

      await expect(
        enableScheduleSlot(
          userId,
          { slot_id: created.id, expected_updated_at: disabled.updated_at },
          deps,
        ),
      ).rejects.toMatchObject({ code: "automation_consent_required" });

      // 同意ゲートで止まった以上、DBは停止のままでなければならない。
      const row = await withTransaction((c) =>
        c.query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [
          created.id,
        ]),
      );
      expect(row.rows[0].enabled).toBe(false);
    } finally {
      await cleanup(userId);
    }
  });

  it("does not let another user resume someone else's slot", async () => {
    const owner = await withTransaction((c) => makeAccount(c));
    const intruder = await withTransaction((c) => makeAccount(c));
    try {
      const ownerDeps = depsFor(owner.xAccountId);
      const created = await createScheduleSlot(
        owner.userId,
        {
          pattern: "p1",
          weekdays: [5],
          time_jst: "12:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
        },
        ownerDeps,
      );
      const disabled = await disableScheduleSlot(
        owner.userId,
        { slot_id: created.id, expected_updated_at: created.updated_at },
        ownerDeps,
      );

      await expect(
        enableScheduleSlot(
          intruder.userId,
          { slot_id: created.id, expected_updated_at: disabled.updated_at },
          depsFor(intruder.xAccountId),
        ),
      ).rejects.toMatchObject({ code: "not_found" });

      const row = await withTransaction((c) =>
        c.query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [
          created.id,
        ]),
      );
      expect(row.rows[0].enabled).toBe(false);
    } finally {
      await cleanup(owner.userId);
      await cleanup(intruder.userId);
    }
  });

  /**
   * 分野（発信テーマ）の保存（T-M8-28）。DBには CHECK 制約を付けてある。
   * **画面のzodだけでは守れない**（Server Action を直接叩けば通る）ので、実DBで往復を確かめる。
   */
  it("分野を保存して読み戻せる。「その他」も値として入る（NULLは入らない）", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      const withTheme = await createScheduleSlot(
        userId,
        {
          pattern: "p1",
          weekdays: [1],
          time_jst: "09:00",
          mode: "draft",
          theme: "business_ops",
          image_enabled: false,
        },
        deps,
      );
      expect(withTheme.theme).toBe("business_ops");

      // 「その他」は追加指示に分野を書く意思表示。null は**入らない**（DBが NOT NULL）。
      const other = await createScheduleSlot(
        userId,
        {
          pattern: "p3",
          weekdays: [2],
          time_jst: "10:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
        },
        deps,
      );
      expect(other.theme).toBe("other");

      // 編集で「その他」へ戻せる（一度選んだら変えられない、にしない）。
      const cleared = await updateScheduleSlot(
        userId,
        {
          slot_id: withTheme.id,
          expected_updated_at: withTheme.updated_at,
          pattern: "p1",
          weekdays: [1],
          time_jst: "09:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
        },
        deps,
      );
      expect(cleared.theme).toBe("other");
    } finally {
      await cleanup(userId);
    }
  });

  it("**DBが未知の分野を拒否する**（Server Actionを迂回しても入らない）", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      await expect(
        withTransaction((c) =>
          c.query(
            `insert into schedule_slots (x_account_id, pattern, weekdays, time_jst, mode, image_enabled, enabled, theme)
             values ($1, 'p1', '{1}', '09:00', 'draft', false, true, 'bogus')`,
            [xAccountId],
          ),
        ),
      ).rejects.toThrow(/schedule_slots_theme_valid/);
    } finally {
      await cleanup(userId);
    }
  });

});
