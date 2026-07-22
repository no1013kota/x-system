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
    expect(first.baseMd).toMatch(/## 5\.[^\n]*\n\n## 6\.[^\n]*\n$/);
    const firstRows = await db.query(
      `select x.settings, x.base_md, x.base_md_version,
              v.version, v.change_source
         from x_accounts x
         join base_md_versions v on v.x_account_id = x.id
        where x.id = $1`,
      [xAccountId],
    );
    expect(firstRows.rows).toHaveLength(1);
    expect(firstRows.rows[0]).toMatchObject({
      base_md: first.baseMd,
      base_md_version: 1,
      change_source: "settings",
      version: 1,
    });

    const learned = first.baseMd.replace(
      "## 5. 文体・自分らしさ\n\n## 6. 参考にする型",
      "## 5. 文体・自分らしさ\n- 学習済み文体\n\n## 6. 参考にする型\n- 学習済み構成",
    );
    await db.query(
      "update x_accounts set base_md = $2, base_md_version = 2 where id = $1",
      [xAccountId, learned],
    );
    await db.query(
      `insert into base_md_versions
        (x_account_id, version, content, change_source)
       values ($1, 2, $2, 'learning')`,
      [xAccountId, learned],
    );
    const learnedTail = learned.slice(learned.indexOf("## 5."));
    const second = await applyPersonaSettingsUpdate(db as unknown as PoolClient, {
      expectedBaseMdVersion: 2,
      settings: settings("更新後の発信者"),
      userId,
      xAccountId,
    });
    expect(second).toMatchObject({ version: 3 });
    expect(second.baseMd).toContain("- 発信者: 更新後の発信者");
    expect(second.baseMd.slice(second.baseMd.indexOf("## 5."))).toBe(
      learnedTail,
    );

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
              (select count(*)::int from base_md_versions v
                where v.x_account_id = x.id) as version_count,
              (select count(*)::int from usage_events u
                where u.x_account_id = x.id) as usage_count
         from x_accounts x where x.id = $1`,
      [xAccountId],
    );
    expect(afterConflicts.rows[0]).toMatchObject({
      base_md: second.baseMd,
      base_md_version: 3,
      usage_count: 0,
      version_count: 3,
    });
  });
});
