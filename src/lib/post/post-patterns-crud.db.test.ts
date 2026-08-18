import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";

import {
  applyCreatePattern,
  applyDeletePattern,
  applyRestoreDefaultPatterns,
  applyUpdatePattern,
  listPatterns,
  type PatternInput,
} from "./post-patterns-store";

/**
 * パターンのCRUD（T-M8-129 U4a・ADR-0008）。
 *
 * ここで守るのは「利用者が壊せない」こと。運営者は既定パターンも削除・編集できるので、
 * **削除が過去を壊さない**／**0件にならない**／**名前が重複しない**／
 * **DBのCHECKに当たる前に理由の分かるエラーが返る**ことを実DBで固定する。
 */
describe("post_patterns CRUD（ローカルDB）", () => {
  let available = false;
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

  async function seedAccount(): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan) values ($1,$2,'premium') on conflict (id) do nothing`,
        [uid, `${uid}@example.com`],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
         values ($1,$2,'pp','n','managed','active') returning id`,
        [uid, `x-${randomUUID()}`],
      );
      return { uid, xid: rows[0].id };
    });
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  const input = (over: Partial<PatternInput> = {}): PatternInput => ({
    name: "自作パターン",
    description: "検証用",
    prompt: "# タスク\n検証用のプロンプト",
    maxPosts: 3,
    webSearchPolicy: "always",
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
    ...over,
  });

  it("作ると一覧の末尾に並び、編集上限は生成上限より広い", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const created = await applyCreatePattern(getPool(), { ...input(), xAccountId: xid });
      expect(created.name).toBe("自作パターン");
      expect(created.isSystemDefault, "自作は既定ではない").toBe(false);
      expect(created.hasCustomPrompt).toBe(true);
    // 生成3 → 編集は min(8, 3+2) = 5。生成された分に少し足して整えられる幅を持たせる。
      expect(created.maxPostsEdit).toBe(5);

      const all = await listPatterns(getPool(), xid);
      expect(all.length, "既定6件＋自作1件").toBe(7);
      expect(all[all.length - 1].id, "末尾に並ぶ").toBe(created.id);
    } finally {
      await cleanup(uid);
    }
  });

  it("名前が重複したら理由の分かるエラーを返す（大文字小文字と前後空白は無視）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      await expect(
        applyCreatePattern(getPool(), { ...input({ name: "  ニュース解説  " }), xAccountId: xid }),
        "既定と同じ名前",
      ).rejects.toMatchObject({ code: "validation_error", details: { reason: "name_taken" } });

      await applyCreatePattern(getPool(), { ...input({ name: "My Pattern" }), xAccountId: xid });
      await expect(
        applyCreatePattern(getPool(), { ...input({ name: "my pattern" }), xAccountId: xid }),
      ).rejects.toMatchObject({ details: { reason: "name_taken" } });
    } finally {
      await cleanup(uid);
    }
  });

  it("DBのCHECKに当たる前に理由を返す（名前の長さ・危険文字・ポスト数・プロンプト必須）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const cases: [Partial<PatternInput>, string][] = [
        [{ name: "" }, "name_length"],
        [{ name: "あ".repeat(31) }, "name_length"],
        [{ name: "改行\n入り" }, "name_unsafe_chars"],
        [{ name: "<tag>" }, "name_unsafe_chars"],
      [{ maxPosts: 0 }, "max_posts_range"],
        // 総ポスト数の上限は8（画面のスレッド数 0〜7 に対応・T-M8-130）。
        [{ maxPosts: 9 }, "max_posts_range"],
        [{ prompt: null }, "prompt_required"],
        [{ prompt: "   " }, "prompt_required"],
        [{ prompt: "あ".repeat(8001) }, "too_long"],
        [{ requiresQuoteUrl: true, includeNewsDigest: true }, "quote_with_digest"],
      ];
      for (const [over, reason] of cases) {
        await expect(
          applyCreatePattern(getPool(), { ...input(over), xAccountId: xid }),
          `${reason} を返す`,
        ).rejects.toMatchObject({ code: "validation_error", details: { reason } });
      }
    } finally {
      await cleanup(uid);
    }
  });

  it("既定パターンも編集できる（プロンプトを null に戻すとシステム既定へ）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const before = (await listPatterns(getPool(), xid)).find((p) => p.name === "ニュース解説")!;
      const renamed = await applyUpdatePattern(getPool(), {
        ...input({ name: "ニュース速報", prompt: "# タスク\n自分の指示", maxPosts: 5 }),
        xAccountId: xid,
        patternId: before.id,
      });
      expect(renamed.name).toBe("ニュース速報");
      expect(renamed.hasCustomPrompt).toBe(true);
      expect(renamed.isSystemDefault, "既定であることは変わらない").toBe(true);
      // **編集上限は狭めない**（既存の下書きが編集できなくなるため）。既定は6で、生成5に上げても6のまま。
      expect(renamed.maxPostsEdit).toBe(6);

      const reset = await applyUpdatePattern(getPool(), {
        ...input({ name: "ニュース速報", prompt: null, maxPosts: 5 }),
        xAccountId: xid,
        patternId: before.id,
      });
      expect(reset.hasCustomPrompt, "既定パターンはプロンプトを null に戻せる").toBe(false);
    } finally {
      await cleanup(uid);
    }
  });

  it("生成上限を編集上限より大きくしても保存できる（編集上限が追いつく）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const single = (await listPatterns(getPool(), xid)).find(
        (p) => p.name === "自分の考え・意見",
      )!;
      expect(single.maxPostsEdit, "単発の型は編集も1").toBe(1);
      const updated = await applyUpdatePattern(getPool(), {
        ...input({ name: "自分の考え・意見", prompt: null, maxPosts: 4 }),
        xAccountId: xid,
        patternId: single.id,
      });
      expect(updated.maxPosts).toBe(4);
      expect(updated.maxPostsEdit, "生成上限まで広がる").toBe(4);
    } finally {
      await cleanup(uid);
    }
  });

  it("削除すると予約は停止し、停止件数を返す（何が起きたか画面で言える）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const target = (await listPatterns(getPool(), xid)).find((p) => p.name === "ニュース解説")!;
      await getPool().query(
        `insert into schedule_slots
           (x_account_id, pattern_id, weekdays, time_jst, theme, mode, enabled)
         values ($1, $2, '{1}', '09:00', 'ai', 'auto', true)`,
        [xid, target.id],
      );

      const result = await applyDeletePattern(getPool(), { xAccountId: xid, patternId: target.id });
      expect(result.deletedName).toBe("ニュース解説");
      expect(result.disabledSlots, "停止した予約の件数").toBe(1);

      const { rows } = await getPool().query<{ enabled: boolean; pattern_id: string | null }>(
        `select enabled, pattern_id from schedule_slots where x_account_id = $1`,
        [xid],
      );
      expect(rows[0].enabled).toBe(false);
      expect(rows[0].pattern_id).toBeNull();
    } finally {
      await cleanup(uid);
    }
  });

  it("最後の1件は削除させない（投稿を作る手段が画面から消える）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const all = await listPatterns(getPool(), xid);
      for (const p of all.slice(0, -1)) {
        await applyDeletePattern(getPool(), { xAccountId: xid, patternId: p.id });
      }
      const last = (await listPatterns(getPool(), xid))[0];
      await expect(
        applyDeletePattern(getPool(), { xAccountId: xid, patternId: last.id }),
      ).rejects.toMatchObject({ code: "validation_error", details: { reason: "last_pattern" } });
      expect((await listPatterns(getPool(), xid)).length).toBe(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("他のアカウントのパターンは編集も削除もできない", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    try {
      const foreign = (await listPatterns(getPool(), b.xid))[0];
      await expect(
        applyUpdatePattern(getPool(), {
          ...input(),
          xAccountId: a.xid,
          patternId: foreign.id,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        applyDeletePattern(getPool(), { xAccountId: a.xid, patternId: foreign.id }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect((await listPatterns(getPool(), b.xid)).length, "相手のパターンは無傷").toBe(6);
    } finally {
      await cleanup(a.uid);
      await cleanup(b.uid);
    }
  });

  it("削除した既定パターンを復元でき、入れた件数を返す", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const all = await listPatterns(getPool(), xid);
      await applyDeletePattern(getPool(), { xAccountId: xid, patternId: all[0].id });
      await applyDeletePattern(getPool(), { xAccountId: xid, patternId: all[1].id });
      expect((await listPatterns(getPool(), xid)).length).toBe(4);

      const restored = await applyRestoreDefaultPatterns(getPool(), xid);
      expect(restored, "消した2件だけ戻る").toBe(2);
      expect((await listPatterns(getPool(), xid)).length).toBe(6);

      // 2回目は何も起きない（冪等）。
      expect(await applyRestoreDefaultPatterns(getPool(), xid)).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });
});
