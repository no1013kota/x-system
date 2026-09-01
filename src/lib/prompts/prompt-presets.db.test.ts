import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import {
  createPromptPresetForUser,
  deletePromptPresetForUser,
  listPromptPresetsForUser,
  setPromptPresetInUseForUser,
  updatePromptPresetForUser,
} from "./prompt-presets-server";

/**
 * プロンプトの本棚（T-M8-332）。**本番実装をそのまま通す**。
 *
 * ここで守りたいのは1つだけ: **画面に「使用中」と出ているものが、生成が実際に読む場所と
 * 同じ中身であること**。写しが落ちると、画面には新しい文章が出ているのに生成は古い文章で
 * 動き続ける——利用者からは説明できない（原則1）。
 */

const VALID_BASE_MD = [
  "# 発信定義書（アカウント.md）",
  "",
  "## 1. 発信者",
  "テスト用の発信者",
  "",
  "## 2. 対象読者",
  "テスト読者",
  "",
  "## 3. トーン&マナー",
  "ていねい",
  "",
  "## 4. 発信テーマ",
  "AI",
  "",
  "## 5. 実績・知見",
  "なし",
  "",
].join("\n");

describe("prompt presets（local DB）", () => {
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

  async function seed(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    // profiles はトリガで作られることがあるので、**作成ではなく確定**させる
    // （`do nothing` だけだと plan が既定のままになり、編集権限で落ちる）。
    await c.query(
      `insert into profiles (id, email, plan) values ($1,$2,'premium')
         on conflict (id) do update set plan = 'premium'`,
      [uid, `${uid}@example.com`],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at,
            base_md, base_md_version)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour', $5, 1)
         returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES, VALID_BASE_MD],
      )
    ).rows[0].id;
    await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, xid]);
    return { uid, xid };
  }

  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  const baseMdOf = (xid: string) =>
    getPool()
      .query<{ base_md: string; base_md_version: number }>(
        `select base_md, base_md_version from x_accounts where id = $1`,
        [xid],
      )
      .then((r) => r.rows[0]);

  const imageOverrideOf = (xid: string) =>
    getPool()
      .query<{ content: string }>(
        `select content from prompt_templates where x_account_id = $1 and kind = 'image'`,
        [xid],
      )
      .then((r) => r.rows[0]?.content ?? null);

  it("最初に開いたときは、いま効いている内容が「使用中」の1件として並ぶ", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const presets = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      expect(presets, "本棚が空のままだと「いま何が効いているか」が画面から消える").toHaveLength(1);
      expect(presets[0].inUse).toBe(true);
      expect(presets[0].content).toBe(VALID_BASE_MD);
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * 持てる件数の上限（T-M8-350・運営者の指示 2026-08-28）。
   *
   * **書き終えてから弾かれない。** 画面は残数を出して「追加」を止めるが、
   * 画面だけの制限は迂回できるのでサーバー側でも見る。
   */
  /**
   * **先に自分で1件作ってからアカウント設定を保存した場合**（T-M8-355）。
   *
   * アカウント.mdは設定の保存前から作れる（T-M8-350）ので、この順番が実際に起きる。
   * 「空のときだけ埋める」形だと、生成が読む内容（`base_md`）を表す行がどこにも無くなり、
   * 画面には「控え」しか並ばない——**いま何が効いているのかが説明できない**（原則1）。
   */
  it("控えだけがある状態で開いても、いま効いている内容が使用中として並ぶ", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      // 使用中を持たない状態を作る（自分で1件だけ作った直後と同じ）。
      await withTransaction((c) =>
        c.query(
          `insert into prompt_presets (x_account_id, kind, name, content, is_default)
           values ($1, 'base_md', '自分の書き方', $2, false)`,
          [xid, VALID_BASE_MD.replace("テスト用の発信者", "自分で書いた発信者")],
        ),
      );

      const listed = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      expect(listed, "控え1件＋いま効いている内容").toHaveLength(2);
      // 並びは作成順（T-M8-411）。いま作った「使用中」は末尾に来る。
      expect(listed[0].inUse).toBe(false);
      expect(listed[1].inUse, "使用中は作成順で末尾").toBe(true);
      expect(listed[1].content, "使用中は生成が読む内容と同じ").toBe(VALID_BASE_MD);
    } finally {
      await cleanup(uid);
    }
  });

  it("アカウント.mdは5件まで。6件目は理由つきで断る", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      // 1件目は「いま効いている内容」として自動で入る。
      await listPromptPresetsForUser({ userId: uid, xAccountId: xid, kind: "base_md" });
      for (let i = 2; i <= 5; i++) {
        await createPromptPresetForUser({
          userId: uid,
          xAccountId: xid,
          kind: "base_md",
          name: `控え${i}`,
          content: VALID_BASE_MD.replace("テスト用の発信者", `発信者${i}`),
        });
      }
      const listed = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      expect(listed).toHaveLength(5);

      await expect(
        createPromptPresetForUser({
          userId: uid,
          xAccountId: xid,
          kind: "base_md",
          name: "6件目",
          content: VALID_BASE_MD.replace("テスト用の発信者", "発信者6"),
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    } finally {
      await cleanup(uid);
    }
  });

  it("追加しただけでは切り替わらない。使用中にすると x_accounts.base_md まで変わる", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      await listPromptPresetsForUser({ userId: uid, xAccountId: xid, kind: "base_md" });
      const alternate = VALID_BASE_MD.replace("テスト用の発信者", "別人格の発信者");
      const added = await createPromptPresetForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
        name: "別人格",
        content: alternate,
      });
      expect(added.inUse, "追加しただけで生成が変わってはいけない").toBe(false);
      expect((await baseMdOf(xid)).base_md).toBe(VALID_BASE_MD);

      const before = await baseMdOf(xid);
      const switched = await setPromptPresetInUseForUser({
        userId: uid,
        xAccountId: xid,
        presetId: added.id,
      });
      expect(switched.inUse).toBe(true);
      const after = await baseMdOf(xid);
      expect(after.base_md, "使用中にしたのに生成が読む場所が古いまま").toBe(alternate);
      expect(after.base_md_version, "切り替えは版として残る（戻せる）").toBe(
        before.base_md_version + 1,
      );
    } finally {
      await cleanup(uid);
    }
  });

  it("使用中を保存すると生成が読む場所も変わる。控えを保存しても変わらない", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const [inUse] = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      const edited = VALID_BASE_MD.replace("ていねい", "ややくだけた");
      await updatePromptPresetForUser({
        userId: uid,
        xAccountId: xid,
        presetId: inUse.id,
        name: inUse.name,
        content: edited,
        expectedUpdatedAt: inUse.updatedAt,
      });
      expect((await baseMdOf(xid)).base_md).toBe(edited);

      const spare = await createPromptPresetForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
        name: "控え",
        content: VALID_BASE_MD.replace("なし", "控えの知見"),
      });
      await updatePromptPresetForUser({
        userId: uid,
        xAccountId: xid,
        presetId: spare.id,
        name: "控え",
        content: VALID_BASE_MD.replace("なし", "控えの知見2"),
        expectedUpdatedAt: spare.updatedAt,
      });
      expect((await baseMdOf(xid)).base_md, "控えの編集で生成が変わってはいけない").toBe(edited);
    } finally {
      await cleanup(uid);
    }
  });

  it("見出しが壊れたアカウント.mdは保存できない（生成が読む場所も変わらない）", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const [inUse] = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      await expect(
        updatePromptPresetForUser({
          userId: uid,
          xAccountId: xid,
          presetId: inUse.id,
          name: inUse.name,
          content: VALID_BASE_MD.replace("## 3. トーン&マナー", "### 3. トーン&マナー"),
          expectedUpdatedAt: inUse.updatedAt,
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect((await baseMdOf(xid)).base_md).toBe(VALID_BASE_MD);
    } finally {
      await cleanup(uid);
    }
  });

  it("使用中は削除できない（消すと何が効いているか分からなくなる）", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const [inUse] = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      await expect(
        deletePromptPresetForUser({ userId: uid, xAccountId: xid, presetId: inUse.id }),
      ).rejects.toMatchObject({ code: "validation_error" });
    } finally {
      await cleanup(uid);
    }
  });

  it("画像プロンプトも同じ。使用中にすると prompt_templates の上書きが入れ替わる", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const presets = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "image",
      });
      expect(presets, "システム既定の内容が1件目として並ぶ").toHaveLength(1);

      const added = await createPromptPresetForUser({
        userId: uid,
        xAccountId: xid,
        kind: "image",
        name: "写実寄り",
        content: "写実的な写真として描写する。文字は入れない。",
      });
      expect(await imageOverrideOf(xid), "追加だけで上書きが入ってはいけない").toBeNull();

      await setPromptPresetInUseForUser({ userId: uid, xAccountId: xid, presetId: added.id });
      expect(await imageOverrideOf(xid)).toBe("写実的な写真として描写する。文字は入れない。");
    } finally {
      await cleanup(uid);
    }
  });

  it("学習・アカウント設定が base_md を書き換えたら、本棚の使用中も追随する", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      await listPromptPresetsForUser({ userId: uid, xAccountId: xid, kind: "base_md" });
      // 学習反映（md-merge）と同じ経路を通す。
      const merged = VALID_BASE_MD.replace("## 5. 実績・知見\nなし", "## 5. 実績・知見\n学習で得た知見");
      const { syncInUsePreset } = await import("./prompt-preset-sync");
      await withTransaction(async (c) => {
        await c.query(`update x_accounts set base_md = $2, base_md_version = 2 where id = $1`, [
          xid,
          merged,
        ]);
        await syncInUsePreset(c, { xAccountId: xid, kind: "base_md", content: merged });
      });
      const presets = await listPromptPresetsForUser({
        userId: uid,
        xAccountId: xid,
        kind: "base_md",
      });
      expect(
        presets.find((p) => p.inUse)?.content,
        "画面の本文と生成に使われる本文が食い違っている",
      ).toBe(merged);
    } finally {
      await cleanup(uid);
    }
  });
});
