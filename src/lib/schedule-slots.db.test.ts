import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "./crypto/envelope";
import { closePool, getPool, withTransaction } from "./db/pool";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "./legal";
import { POST_THEME_IDS } from "./post/post-theme";
import {
  createScheduleSlot,
  disableScheduleSlot,
  enableScheduleSlot,
  updateScheduleSlot,
  type ScheduleSlotDeps,
} from "./schedule-slots";
import { disableXAutomation, resumeXAutomation } from "./x/automation-consent";
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
  /** 既定パターンの `post_patterns.id` を seed_key から引く（画面と同じ入口）。 */
  async function patternId(c: PoolClient, xAccountId: string, seedKey: string): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `select id from post_patterns where x_account_id = $1 and seed_key = $2`,
      [xAccountId, seedKey],
    );
    return rows[0].id;
  }

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

  /**
   * T-M8-135。**予約にも投稿作成と同じ生成入力を持たせる**（運営者の指示・2026-08-18）。
   *
   * 参考URL・プレースホルダーの値・この枠だけのプロンプトが実DBへ往復し、
   * **そのパターンに無いプレースホルダーの値は捨てられる**こと。
   * 残すと、どこにも表示されない値が保存され続けて画面で説明できなくなる。
   */
  it("保存した生成入力が往復し、パターンに無いプレースホルダーは捨てられる", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      // p2（自分の考え・意見）は `自分の考え` プレースホルダーを持つ。
      const p2 = await withTransaction((c) => patternId(c, xAccountId, "p2"));
      const created = await createScheduleSlot(
        userId,
        {
          pattern_id: p2,
          weekdays: [2],
          time_jst: "10:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
          source_url: "https://example.com/a",
          placeholder_values: { 自分の考え: "  値に前後の空白  ", 存在しない項目: "捨てられる" },
          prompt_override: "# タスク\nこの枠だけのプロンプト",
        },
        deps,
      );
      expect(created.source_url).toBe("https://example.com/a");
      expect(created.placeholder_values, "前後の空白は落とす／未定義の項目は捨てる").toEqual({
        自分の考え: "値に前後の空白",
      });
      expect(created.prompt_override).toBe("# タスク\nこの枠だけのプロンプト");

      // 空文字の prompt_override は「上書きなし」として null になる。
      const updated = await updateScheduleSlot(
        userId,
        {
          slot_id: created.id,
          expected_updated_at: created.updated_at,
          pattern_id: p2,
          weekdays: [2],
          time_jst: "10:00",
          mode: "draft",
          theme: "other",
          image_enabled: false,
          prompt_override: "   ",
        },
        deps,
      );
      expect(updated.prompt_override, "空白だけの上書きは持たない").toBeNull();
      expect(updated.source_url, "未指定なら消える").toBeNull();
      expect(updated.placeholder_values).toEqual({});
    } finally {
      await cleanup(userId);
    }
  });

  it("参考URLは http/https 以外を受け付けない（DBのCHECKと同じ条件）", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      const p1 = await withTransaction((c) => patternId(c, xAccountId, "p1"));
      await expect(
        createScheduleSlot(
          userId,
          {
            pattern_id: p1,
            weekdays: [2],
            time_jst: "10:00",
            mode: "draft",
            theme: "other",
            image_enabled: false,
            source_url: "javascript:alert(1)",
          },
          deps,
        ),
      ).rejects.toThrow();
    } finally {
      await cleanup(userId);
    }
  });

  it("stops and resumes a draft slot, and the row really flips in the DB", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c));
    try {
      const deps = depsFor(xAccountId);
      const pid = (seedKey: string) =>
        withTransaction((c) => patternId(c, xAccountId, seedKey));
      const created = await createScheduleSlot(
        userId,
        {
          pattern_id: await pid("p1"),
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
      const pid = (seedKey: string) =>
        withTransaction((c) => patternId(c, xAccountId, seedKey));
      const created = await createScheduleSlot(
        userId,
        {
          pattern_id: await pid("p1"),
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
      const pid = (seedKey: string) =>
        withTransaction((c) => patternId(c, xAccountId, seedKey));
      const created = await createScheduleSlot(
        userId,
        {
          pattern_id: await pid("p1"),
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
          pattern_id: await withTransaction((c) => patternId(c, owner.xAccountId, "p1")),
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
      const pid = (seedKey: string) =>
        withTransaction((c) => patternId(c, xAccountId, seedKey));
      const withTheme = await createScheduleSlot(
        userId,
        {
          pattern_id: await pid("p1"),
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
          pattern_id: await pid("p3"),
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
          pattern_id: await pid("p1"),
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
            `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, image_enabled, enabled, theme)
             values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1}', '09:00', 'draft', false, true, 'bogus')`,
            [xAccountId],
          ),
        ),
      ).rejects.toThrow(/schedule_slots_theme_valid/);
    } finally {
      await cleanup(userId);
    }
  });

  /**
   * CHECK制約の値集合と `POST_THEME_IDS` が一致していること（R29）。
   *
   * migration のコメントは「値は `src/lib/themes.ts` の THEME_IDS」と宣言しているが、
   * それを確かめる検査が無かった。**分野を1つ足すと画面には選択肢が出るのに、
   * 保存の瞬間に CHECK 違反で落ちる**（利用者からは「保存できない」としか見えない）。
   * 上の「未知の分野を拒否する」検査は逆方向（DBが緩すぎないこと）しか見ていないので、
   * ここで「DBが厳しすぎないこと」も止める。
   */
  /**
   * 「すべて停止」→「すべて再開」の往復（T-M8-233／T-M8-251・運営者の指示 2026-08-23）。
   *
   * 守りたいのは2つ。**下書き作成の枠も止まること**（以前は auto だけ止めていた）と、
   * **「すべて」が文字どおり全部であること**——個別に止めた枠も再開で動き出す。
   * 押した結果が「全部止まる／全部動く」で一致していないと、運営者が状態を言い当てられない。
   */
  it("すべて停止→再開: 下書き枠も個別に止めた枠も、まとめて止まり・まとめて動く", async () => {
    const { userId, xAccountId } = await withTransaction((c) => makeAccount(c, { consented: true }));
    try {
      const deps = depsFor(xAccountId);
      const p1 = await withTransaction((c) => patternId(c, xAccountId, "p1"));
      const base = { pattern_id: p1, theme: "ai" as const, image_enabled: false };
      const auto = await createScheduleSlot(
        userId,
        { ...base, weekdays: [1], time_jst: "09:00", mode: "auto" },
        deps,
      );
      const draft = await createScheduleSlot(
        userId,
        { ...base, weekdays: [2], time_jst: "10:00", mode: "draft" },
        deps,
      );
      // 利用者が自分で止めた枠。停止/再開のどちらでも触られてはいけない。
      const manuallyStopped = await createScheduleSlot(
        userId,
        { ...base, weekdays: [3], time_jst: "11:00", mode: "draft" },
        deps,
      );
      await disableScheduleSlot(
        userId,
        { slot_id: manuallyStopped.id, expected_updated_at: manuallyStopped.updated_at },
        deps,
      );

      const stopped = await disableXAutomation(userId, xAccountId, { runInTx: withTransaction });
      // 動いていた2枠（auto と draft）が止まる。既に止まっていた1枠は数えない（水増ししない）。
      expect(stopped.disabledSlots).toBe(2);

      const readSlots = async () =>
        (
          await withTransaction((c) =>
            c.query<{ id: string; enabled: boolean }>(
              `select id, enabled from schedule_slots where x_account_id = $1`,
              [xAccountId],
            ),
          )
        ).rows;

      const afterStop = await readSlots();
      expect(afterStop.every((r) => r.enabled === false), "下書き枠も止まっていない").toBe(true);

      // 再開には現行版の同意が要る（停止で撤回されているため）。チェック無しでは戻さない。
      await expect(
        resumeXAutomation(userId, { x_account_id: xAccountId }, { runInTx: withTransaction }),
      ).rejects.toMatchObject({ code: "automation_consent_required" });
      expect((await readSlots()).every((r) => r.enabled === false)).toBe(true);

      const resumed = await resumeXAutomation(
        userId,
        {
          x_account_id: xAccountId,
          confirmed: true,
          consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
        },
        { runInTx: withTransaction },
      );
      // 個別に止めた枠も含めて3枠すべてが戻る（T-M8-251）。
      expect(resumed).toMatchObject({ resumedSlots: 3, includesAuto: true, consentRecorded: true });

      const afterResume = await readSlots();
      const byId = new Map(afterResume.map((r) => [r.id, r]));
      expect(byId.get(auto.id)?.enabled, "自動投稿の枠が戻っていない").toBe(true);
      expect(byId.get(draft.id)?.enabled, "下書きの枠が戻っていない").toBe(true);
      expect(
        byId.get(manuallyStopped.id)?.enabled,
        "「すべて再開」なのに個別に止めた枠が動いていない",
      ).toBe(true);

      // 同意も戻っている（次の停止操作が効く状態）。
      const consent = await withTransaction((c) =>
        c.query<{ disabled: string | null }>(
          `select automation_disabled_at::text as disabled from x_accounts where id = $1`,
          [xAccountId],
        ),
      );
      expect(consent.rows[0].disabled).toBeNull();
    } finally {
      await cleanup(userId);
    }
  });

  it("theme の CHECK 制約が POST_THEME_IDS と同じ値集合である", async () => {
    const { rows } = await getPool().query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'schedule_slots'
          and c.conname = 'schedule_slots_theme_valid'`,
    );
    expect(rows[0]?.def, "schedule_slots_theme_valid が見つからない").toBeDefined();
    // `CHECK ((theme = ANY (ARRAY['ai'::text, ...])))` から値だけを取り出す。
    // 分野IDは数字を含む（`web3`）ので `[a-z_]` だけでは取りこぼす。
    const allowed = [...rows[0].def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]).sort();
    expect(allowed).toEqual([...POST_THEME_IDS].sort());
  });
});
