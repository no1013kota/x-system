import { applyUpdatePatternPrompt } from "./post-patterns-store";
import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { parsePatternSpec, scheduledPostSlots } from "./pattern-spec";
import { GENERATION_MAX_POSTS } from "./thread-limits";

/**
 * `post_patterns`（投稿パターンをアカウント別のマスタにする・T-M8-129 U1）。
 *
 * **ここで守るのは「削除しても過去が壊れない」こと。** 運営者は既定パターンも削除できる
 * （2026-08-18 の指示）。パターン行を消したときに、
 * - 過去の下書き・履歴の表示が**名前のまま残る**（画面に内部ID `p1` を出さない・要件06 §1.0）
 * - 予約は**設定を残したまま停止**する（曜日・時刻・テーマを黙って捨てない）
 * - 実行中のjobは**そのまま完走できる**（enqueue時点のspecを凍結してあるため）
 * を満たす必要がある。論理削除（archived_at）を持たない設計の根拠がこの3点。
 */
describe("post_patterns（ローカルDB）", () => {
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

  /** 利用者＋Xアカウントを作る。パターンは x_accounts のトリガが自動で入れる。 */
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

  it("Xアカウントを作ると既定パターンが自動で入る（手順を人が思い出さない）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const { rows } = await getPool().query<{ seed_key: string; name: string }>(
        `select seed_key, name from post_patterns where x_account_id = $1 order by sort_order`,
        [xid],
      );
      expect(rows.length, "既定6件").toBe(6);
      expect(rows.map((r) => r.seed_key)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
      // 画面に出るのは名前だけ。内部IDは名前に混ぜない。
      for (const r of rows) expect(r.name).not.toMatch(/^p[1-6]$/);
      // 既定はプロンプトを持たない（null = コード定数を使う。改善が既存アカウントへ届く）。
      const { rows: nulls } = await getPool().query<{ n: string }>(
        `select count(*)::text n from post_patterns where x_account_id = $1 and prompt is null`,
        [xid],
      );
      expect(nulls[0].n).toBe("6");
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * プロンプト保存で placeholders が本文から導出される（T-M8-186）。
   * 宣言と本文が食い違うと、後のパターン編集が placeholder_not_used で落ちるか、
   * 増やした {名前} の入力欄が出ない。
   */
  it("プロンプト保存で placeholders が本文から導出される", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const { rows } = await withTransaction((c) =>
        c.query<{ id: string }>(
          `select id from post_patterns where x_account_id = $1 and seed_key = 'p2'`,
          [xid],
        ),
      );
      const patternId = rows[0].id;
      // 初回保存（prompt is null → 上書き作成）: {お題} と {切り口} を含む本文。
      const saved = await withTransaction((c) =>
        applyUpdatePatternPrompt(c, {
          xAccountId: xid,
          patternId,
          content: "# タスク\nお題: {お題} 切り口: {切り口}\n# 構成と分量とスレッド数\n1スレッド目のみ",
          expectedUpdatedAt: null,
        }),
      );
      const after = await withTransaction((c) =>
        c.query<{ placeholders: { name: string }[] }>(
          `select placeholders from post_patterns where id = $1`,
          [patternId],
        ),
      );
      expect(after.rows[0].placeholders).toEqual([{ name: "お題" }, { name: "切り口" }]);
      // 2回目: {お題} だけへ減らすと宣言も減る。
      await withTransaction((c) =>
        applyUpdatePatternPrompt(c, {
          xAccountId: xid,
          patternId,
          content: "# タスク\nお題: {お題}\n# 構成と分量とスレッド数\n1スレッド目のみ",
          expectedUpdatedAt: saved.updatedAt,
        }),
      );
      const reduced = await withTransaction((c) =>
        c.query<{ placeholders: { name: string }[] }>(
          `select placeholders from post_patterns where id = $1`,
          [patternId],
        ),
      );
      expect(reduced.rows[0].placeholders).toEqual([{ name: "お題" }]);
    } finally {
      await cleanup(uid);
    }
  });

  it("既定パターンの名前とポスト数がコード側の定数と一致する（黙ってずれない）", async () => {
    // **U2 は生成のポスト数上限を `post_patterns.max_posts` から引く。** seed とコード定数が
    // ずれると、画面の説明と実際に作られる数が食い違う（T-M8-33 と同じ事故）。
    // 移行が終わるまで両方が正なので、ここで突き合わせる。
    const { uid, xid } = await seedAccount();
    try {
      const { rows } = await getPool().query<{
        seed_key: string;
        name: string;
        max_posts: number;
      }>(`select seed_key, name, max_posts from post_patterns where x_account_id = $1`, [xid]);
      const bySeed = new Map(rows.map((r) => [r.seed_key, r]));

    // 画面の説明は `patternDescriptionWithCount()` が `max_posts` から組むので、
      // 説明文とポスト数がずれることは構造的に起きない（T-M8-33 の再発防止）。
      // ここで守るのは **seed の値がコード定数と一致していること**。
      for (const [seedKey, expected] of Object.entries(GENERATION_MAX_POSTS)) {
        const seeded = bySeed.get(seedKey);
        expect(seeded, `${seedKey} が seed されている`).toBeTruthy();
        expect(seeded?.max_posts, `${seedKey} の生成上限`).toBe(expected);
        expect(seeded?.name, `${seedKey} の名前に内部IDを含めない`).not.toMatch(/^p[1-6]$/);
      }
    } finally {
      await cleanup(uid);
    }
  });

  it("`pattern_spec_of()` の出力を TS 側がそのまま読める（SQLとパーサの噛み合い）", async () => {
    // **ここが U2/U3 の一番危ない結合点。** jsonb のキー名を1つ変えただけで
    // `parsePatternSpec` が null を返し、生成が「pattern_spec_missing」で全部落ちる。
    // モックしたテストでは絶対に出ないので、実DBの関数出力で確かめる。
    const { uid, xid } = await seedAccount();
    try {
      const { rows } = await getPool().query<{ seed_key: string; spec: unknown }>(
        `select seed_key, pattern_spec_of(id) as spec from post_patterns
          where x_account_id = $1 order by sort_order`,
        [xid],
      );
      expect(rows.length).toBe(6);
      for (const row of rows) {
        const spec = parsePatternSpec(row.spec);
        expect(spec, `${row.seed_key} の spec が読める`).not.toBeNull();
        expect(spec?.seedKey).toBe(row.seed_key);
        expect(spec?.maxPostsEdit).toBeGreaterThanOrEqual(spec!.maxPosts);
      }

      // 予約枠の見積りが要件04 §7.1 の値になる（実DBのseed値から導く）。
      const bySeed = new Map(rows.map((r) => [r.seed_key, parsePatternSpec(r.spec)!]));
      expect(scheduledPostSlots(bySeed.get("p1")!)).toEqual({ normal: 10, url: 1 });
      expect(scheduledPostSlots(bySeed.get("p2")!)).toEqual({ normal: 1, url: 0 });
      expect(scheduledPostSlots(bySeed.get("p3")!)).toEqual({ normal: 12, url: 1 });
      expect(scheduledPostSlots(bySeed.get("p4")!)).toEqual({ normal: 8, url: 1 });
      expect(scheduledPostSlots(bySeed.get("p6")!)).toEqual({ normal: 12, url: 1 });
    } finally {
      await cleanup(uid);
    }
  });

  it("予約の生成jobは pattern_spec を必須にする（型の分からないjobを作らない）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      // `pattern` も `pattern_id` も無ければ、fillトリガが spec を作れず CHECK が拒否する。
      await expect(
        getPool().query(
          `insert into generation_jobs (x_account_id, kind, trigger, status, request_key)
           values ($1,'post_generation','schedule','queued',$2)`,
          [xid, `pp-${randomUUID()}`],
        ),
      ).rejects.toThrow(/pattern_spec/);

      // 旧 `pattern` だけでも fillトリガが spec を作るので通る（移行中の経路）。
      const { rows } = await getPool().query<{ spec: unknown }>(
        `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, request_key)
         values ($1, 'post_generation', 'schedule', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued', $2) returning pattern_spec as spec`,
        [xid, `pp-${randomUUID()}`],
      );
      expect(parsePatternSpec(rows[0].spec)?.seedKey).toBe("p1");
    } finally {
      await cleanup(uid);
    }
  });

  it("削除しても過去の下書きは名前が残り、予約は設定を残して停止する", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const [pattern] = (
        await getPool().query<{ id: string; name: string }>(
          `select id, name from post_patterns where x_account_id = $1 and seed_key = 'p1'`,
          [xid],
        )
      ).rows;

      const thread = JSON.stringify([
        { local_id: "1", text: "本文", weighted_length: 2, warnings: [] },
      ]);
      const [draft] = (
        await getPool().query<{ id: string }>(
          `insert into drafts
             (x_account_id, pattern_id, pattern_name, max_posts, status, thread, initial_thread)
           values ($1, $2, $3, 4, 'posted', $4::jsonb, $4::jsonb) returning id`,
          [xid, pattern.id, pattern.name, thread],
        )
      ).rows;

      const [slot] = (
        await getPool().query<{ id: string }>(
          `insert into schedule_slots
             (x_account_id, pattern_id, weekdays, time_jst, theme, mode, enabled)
           values ($1, $2, '{1}', '09:00', 'ai', 'auto', true) returning id`,
          [xid, pattern.id],
        )
      ).rows;

      // 実行中のjob。spec を凍結してあるので、パターンが消えても走り切れる。
      const [job] = (
        await getPool().query<{ id: string }>(
          `insert into generation_jobs
             (x_account_id, kind, trigger, pattern_id, pattern_spec, status, request_key)
           values ($1, 'post_generation', 'manual', $2, pattern_spec_of($2), 'running', $3)
           returning id`,
          [xid, pattern.id, `pp-${randomUUID()}`],
        )
      ).rows;

      await getPool().query(`delete from post_patterns where id = $1`, [pattern.id]);

      const [afterDraft] = (
        await getPool().query<{ pattern_name: string; pattern_id: string | null }>(
          `select pattern_name, pattern_id from drafts where id = $1`,
          [draft.id],
        )
      ).rows;
      expect(afterDraft.pattern_name, "履歴の表示名は残る").toBe(pattern.name);
      expect(afterDraft.pattern_id, "参照だけ外れる").toBeNull();

      const [afterSlot] = (
        await getPool().query<{
          enabled: boolean;
          pattern_id: string | null;
          weekdays: number[];
          time_jst: string;
        }>(`select enabled, pattern_id, weekdays, time_jst from schedule_slots where id = $1`, [
          slot.id,
        ])
      ).rows;
      expect(afterSlot.enabled, "予約は停止する").toBe(false);
      expect(afterSlot.pattern_id).toBeNull();
      // **設定は捨てない**（曜日・時刻が残るので選び直すだけで再開できる）。
      expect(afterSlot.weekdays).toEqual([1]);
      expect(afterSlot.time_jst).toContain("09:00");

      const [afterJob] = (
        await getPool().query<{ pattern_spec: { name: string; max_posts: number } | null }>(
          `select pattern_spec from generation_jobs where id = $1`,
          [job.id],
        )
      ).rows;
      expect(afterJob.pattern_spec?.name, "実行中jobは当時のspecで走り切れる").toBe(pattern.name);
      expect(afterJob.pattern_spec?.max_posts).toBe(4);
    } finally {
      await cleanup(uid);
    }
  });

  it("削除した既定パターンを復元でき、名前が衝突しても潰さない", async () => {
    const { uid, xid } = await seedAccount();
    try {
      await getPool().query(
        `delete from post_patterns where x_account_id = $1 and seed_key = 'p1'`,
        [xid],
      );
      // 同じ名前の自作パターンを作ってから復元する（運営者が実際にやりうる）。
      await getPool().query(
        `insert into post_patterns (x_account_id, name, prompt) values ($1,'ニュース解説','# タスク')`,
        [xid],
      );
      await getPool().query(`select seed_default_post_patterns($1)`, [xid]);

      const { rows } = await getPool().query<{ name: string; seed_key: string | null }>(
        `select name, seed_key from post_patterns where x_account_id = $1 and lower(name) like 'ニュース解説%'
         order by seed_key nulls first`,
        [xid],
      );
      expect(rows.length, "自作と復元の2件が共存する").toBe(2);
      expect(rows.find((r) => r.seed_key === null)?.name).toBe("ニュース解説");
      expect(rows.find((r) => r.seed_key === "p1")?.name).toBe("ニュース解説（復元）");
    } finally {
      await cleanup(uid);
    }
  });

  it("他のアカウントのパターンは参照できない（DBレベルで塞ぐ）", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    try {
      const [foreign] = (
        await getPool().query<{ id: string }>(
          `select id from post_patterns where x_account_id = $1 and seed_key = 'p1'`,
          [b.xid],
        )
      ).rows;
      await expect(
        getPool().query(
          `insert into schedule_slots
             (x_account_id, pattern_id, weekdays, time_jst, theme, mode, enabled)
           values ($1, $2, '{2}', '10:00', 'ai', 'auto', true)`,
          [a.xid, foreign.id],
        ),
        "テナントを越えた参照は外部キーで拒否される",
      ).rejects.toThrow();
    } finally {
      await cleanup(a.uid);
      await cleanup(b.uid);
    }
  });

  it("引用ポストは予約に使えない（旧CHECKの意図をパターン属性で引き継ぐ）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      const [quote] = (
        await getPool().query<{ id: string }>(
          `select id from post_patterns where x_account_id = $1 and requires_quote_url`,
          [xid],
        )
      ).rows;
      expect(quote, "引用ポストが既定に含まれる").toBeTruthy();
      // `pattern_id` を明示すると fill トリガは素通りし、usable トリガの判定に乗る。
      await expect(
        getPool().query(
          `insert into schedule_slots
             (x_account_id, pattern_id, weekdays, time_jst, theme, mode, enabled)
           values ($1, $2, '{3}', '11:00', 'ai', 'auto', true)`,
          [xid, quote.id],
        ),
        "引用対象URLを毎回指定する必要があるので予約できない",
      ).rejects.toThrow(/quote/i);
    } finally {
      await cleanup(uid);
    }
  });

  it("動いている予約はパターンを必ず持つ（型が無いのに動く状態を作らない）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      // 有効なまま pattern_id を外そうとすると CHECK が拒否する。
      // （新規insertは fill トリガが旧 `pattern` から補完するので、更新で確かめる）
      const [slot] = (
        await getPool().query<{ id: string }>(
          `insert into schedule_slots
             (x_account_id, pattern_id, weekdays, time_jst, theme, mode, enabled)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{4}', '12:00', 'ai', 'auto', true) returning id`,
          [xid],
        )
      ).rows;
      await expect(
        getPool().query(`update schedule_slots set pattern_id = null where id = $1`, [slot.id]),
        "動いているのにパターンが無い状態は作れない",
      ).rejects.toThrow();

      // 停止すれば パターン無しで残せる（＝削除後の状態。設定は残る）。
      await expect(
        getPool().query(
          `update schedule_slots set enabled = false, pattern_id = null where id = $1`,
          [slot.id],
        ),
      ).resolves.toBeDefined();
    } finally {
      await cleanup(uid);
    }
  });

  it("自分のパターンだけが読める（画面が使う authenticated 経路）", async () => {
    // RLSの有効化そのものは `rls.db.test.ts` が全テーブルを動的に見る。ここは
    // **画面が実際に使う読み取り経路**（`authenticated` の select）で他人の行が出ないことを見る。
    await withTransaction(async (c: PoolClient) => {
      const mk = async () => {
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
        const { rows } = await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
           values ($1,$2,'pp','n','byok') returning id`,
          [uid, `x-${randomUUID()}`],
        );
        return { uid, xid: rows[0].id };
      };
      const a = await mk();
      const b = await mk();

      await c.query(`select set_config('role','authenticated', true)`);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: a.uid, role: "authenticated" }),
      ]);
      const { rows } = await c.query<{ x_account_id: string }>(
        `select distinct x_account_id from post_patterns`,
      );
      expect(rows.map((r) => r.x_account_id), "自分の分だけ見える").toEqual([a.xid]);
      expect(rows.some((r) => r.x_account_id === b.xid)).toBe(false);

      await c.query(`select set_config('role','postgres', true)`);
      // withTransaction はロールバックするので後片付けは不要。
    });
  });

  it("表示名は同じアカウント内で重複させない（画面で見分けられなくなる）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      await expect(
        getPool().query(
          `insert into post_patterns (x_account_id, name, prompt) values ($1,'ニュース解説','# タスク')`,
          [xid],
        ),
        "既定と同じ名前は作れない",
      ).rejects.toThrow();
      // 大文字小文字だけ違うものも同じ扱い。
      await expect(
        getPool().query(
          `insert into post_patterns (x_account_id, name, prompt) values ($1,'ニュース解説 ','# タスク')`,
          [xid],
        ),
      ).resolves.toBeDefined();
    } finally {
      await cleanup(uid);
    }
  });

  it("名前にプロンプトを壊す文字を入れられない（PT-SUGGESTへ差し込まれるため）", async () => {
    const { uid, xid } = await seedAccount();
    try {
      for (const bad of ["改行\n入り", "<tag>", "閉じ>括弧"]) {
        await expect(
          getPool().query(
            `insert into post_patterns (x_account_id, name, prompt) values ($1,$2,'# タスク')`,
            [xid, bad],
          ),
          `${JSON.stringify(bad)} を拒否する`,
        ).rejects.toThrow();
      }
    } finally {
      await cleanup(uid);
    }
  });
});
