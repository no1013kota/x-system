import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";
import { AppError } from "@/lib/observability/errors";
import { DEFAULT_TONE_SETTINGS } from "@/lib/persona-settings";

import { applyPersonaSettingsUpdate } from "./persona-settings-store";

function settings(speaker: string) {
  return {
    ng: { rules: [], topics: ["誹謗中傷"], words: ["禁止語"] },
    persona: {
      audience: "小規模事業者",
      speaker,
      value: "実務に使える知識",
    },
    themes: {
      free_text: "地域ビジネス",
      primary: ["business_ops" as const],
      secondary: ["ai" as const],
    },
    tone: { ...DEFAULT_TONE_SETTINGS },
    volume: { free_text: "" },
  };
}

describe("updatePersonaSettings transaction", () => {
  let database: Awaited<ReturnType<typeof connectLocalDb>>;

  beforeAll(async () => {
    database = await connectLocalDb();
    if (database) await database.query("begin");
  });

  afterAll(async () => {
    if (database) {
      await database.query("rollback");
      await database.end();
    }
  });

  it("creates version 1, preserves learned sections later, and rejects conflicts", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    const xAccountId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(
      `insert into x_accounts
        (id, user_id, x_user_id, handle, name, auth_type, status)
       values ($1, $2, $3, 'persona_test', 'Persona Test', 'byok', 'active')`,
      [xAccountId, userId, `x_${xAccountId}`],
    );
    await db.query(
      `update profiles
          set plan = 'standard', subscription_status = 'active',
              active_x_account_id = $2
        where id = $1`,
      [userId, xAccountId],
    );

    const first = await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: 0,
      settings: settings("初回の発信者"),
      userId,
      xAccountId,
    });
    expect(first.version).toBe(1);
    expect(first.baseMd).toContain("- 発信者: 初回の発信者");
    expect(first.baseMd).toContain("## 5. NG設定");
    const firstRows = await db.query(
      `select x.settings, x.base_md, x.base_md_version from x_accounts x where x.id = $1`,
      [xAccountId],
    );
    expect(firstRows.rows).toHaveLength(1);
    expect(firstRows.rows[0]).toMatchObject({ base_md: first.baseMd, base_md_version: 1 });

    // 別経路が書き換えた版があっても、保存は設定から全文を作り直す（T-M8-395）。
    const learned = first.baseMd.replace("## 5. NG設定", "## 5. NG設定\n- 学習済み構成");
    await db.query(
      "update x_accounts set base_md = $2, base_md_version = 2 where id = $1",
      [xAccountId, learned],
    );
    const second = await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: 2,
      settings: settings("更新後の発信者"),
      userId,
      xAccountId,
    });
    expect(second).toMatchObject({ version: 3 });
    expect(second.baseMd).toContain("- 発信者: 更新後の発信者");
    expect(second.baseMd).not.toContain("学習済み構成");

    await expect(
      applyPersonaSettingsUpdate(db as unknown as PoolClient, {
        expectedBaseMdVersion: 2,
        settings: settings("競合する発信者"),
        userId,
        xAccountId,
      }),
    ).rejects.toMatchObject({ code: "job_conflict" } satisfies Partial<AppError>);

    const runningJobId = randomUUID();
    await db.query(
      `insert into generation_jobs
        (id, x_account_id, kind, trigger, status)
       values ($1, $2, 'learning_analysis', 'manual', 'running')`,
      [runningJobId, xAccountId],
    );
    await expect(
      applyPersonaSettingsUpdate(db as unknown as PoolClient, {
        expectedBaseMdVersion: 3,
        settings: settings("学習中の発信者"),
        userId,
        xAccountId,
      }),
    ).rejects.toMatchObject({
      code: "job_conflict",
      details: { reason: "base_md_learning_in_progress" },
    } satisfies Partial<AppError>);

    const afterConflicts = await db.query(
      `select x.base_md_version, x.base_md,
              (select count(*)::int from usage_events u
                where u.x_account_id = x.id) as usage_count
         from x_accounts x where x.id = $1`,
      [xAccountId],
    );
    expect(afterConflicts.rows[0]).toMatchObject({
      base_md: second.baseMd,
      base_md_version: 3,
      usage_count: 0,
    });
  });

  /**
   * アカウント.mdは全5セクションを設定から生成する（T-M8-395・運営者の指示 2026-09-01）。
   * 旧・手書き5章（参考にする型）は保存し直した時点で新形式に置き換わる。
   */
  it("保存のたびに全5セクション（新見出し）で作り直される", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    const xAccountId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(
      `insert into x_accounts
        (id, user_id, x_user_id, handle, name, auth_type, status)
       values ($1, $2, $3, 'free_sections', 'Free Sections', 'byok', 'active')`,
      [xAccountId, userId, `x_${xAccountId}`],
    );
    await db.query(
      `update profiles
          set plan = 'standard', subscription_status = 'active', active_x_account_id = $2
        where id = $1`,
      [userId, xAccountId],
    );

    const withVolume = settings("初回の発信者");
    withVolume.volume = { free_text: "1ポストは3〜5行。" };
    const first = await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: 0,
      settings: withVolume,
      userId,
      xAccountId,
    });
    expect(first.baseMd).toContain("## 4. スレッド量や文章量\n1ポストは3〜5行。");
    expect(first.baseMd).toContain("## 5. NG設定");

    // 2回目の保存でも全文が設定から作り直される（手書き章の温存機構は無い）。
    const second = await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: first.version,
      settings: settings("2回目の発信者"),
      userId,
      xAccountId,
    });
    expect(second.baseMd).toContain("2回目の発信者");
    expect(second.baseMd).toContain("指定なし（投稿の型の設定に従う）");
  });

  /**
   * 参考ソースからの反映は**保存前の提案**（T-M8-349・運営者の指示 2026-08-28）。
   *
   * 保存で提案を消さないと、画面を開き直すたびに「参考ソースから作った内容を入れました。
   * まだ保存されていません」が出続け、**確定したのかどうかが分からなくなる**（原則1）。
   */
  it("保存すると settings_proposal が消える（提案が残り続けない）", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    const xAccountId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(
      `insert into x_accounts
        (id, user_id, x_user_id, handle, name, auth_type, status, settings_proposal)
       values ($1, $2, $3, 'proposal_test', 'Proposal Test', 'byok', 'active', $4::jsonb)`,
      [xAccountId, userId, `x_${xAccountId}`, JSON.stringify(settings("提案の発信者"))],
    );
    await db.query(
      `update profiles
          set plan = 'standard', subscription_status = 'active', active_x_account_id = $2
        where id = $1`,
      [userId, xAccountId],
    );

    await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: 0,
      settings: settings("確定した発信者"),
      userId,
      xAccountId,
    });

    const after = await db.query<{ proposal: unknown; speaker: string }>(
      `select settings_proposal as proposal, settings->'persona'->>'speaker' as speaker
         from x_accounts where id = $1`,
      [xAccountId],
    );
    expect(after.rows[0].proposal, "保存したら提案は残さない").toBeNull();
    expect(after.rows[0].speaker).toBe("確定した発信者");
  });
});
