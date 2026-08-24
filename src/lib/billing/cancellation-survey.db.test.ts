import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { cancellationReasonCounts, saveCancellationSurvey } from "./cancellation-survey";

/**
 * 解約アンケートの保存（T-M8-277）。運営者が「何を直せば解約が減るか」を読めるようにする。
 */
describe("cancellationSurvey (db)", () => {
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

  it("回答時のプランごと保存し、集計は解約へ進んだ分だけ数える", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = randomUUID();
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await db.query(`update profiles set plan = 'premium' where id = $1`, [userId]);

    await saveCancellationSurvey(db, userId, { reasons: ["price"], detail: "  高い  ", proceeded: true });
    // 確認画面で引き返した回答も残す（何が刺さって留まったかが分かる）。
    await saveCancellationSurvey(db, userId, { reasons: ["temporary"], detail: "", proceeded: false });

    // 複数選択（T-M8-294）。重複は落とし、並びは選択肢の順に揃える。
    await saveCancellationSurvey(db, userId, {
      reasons: ["quality", "price", "price"],
      detail: null,
      proceeded: false,
    });

    const rows = await db.query<{ reasons: string[]; detail: string | null; proceeded: boolean; plan: string }>(
      `select reasons, detail, proceeded, plan from cancellation_surveys
        where user_id = $1 order by array_to_string(reasons, ',')`,
      [userId],
    );
    expect(rows.rows).toEqual([
      { reasons: ["price"], detail: "高い", proceeded: true, plan: "premium" },
      // 入力は quality→price→price だが、定数の並び（price が先）で重複なく入る。
      { reasons: ["price", "quality"], detail: null, proceeded: false, plan: "premium" },
      { reasons: ["temporary"], detail: null, proceeded: false, plan: "premium" },
    ]);

    // 集計は全利用者ぶんなので、**この利用者の行だけ**で「進んだ分だけ数える」を確かめる
    // （他のテストが並行して行を入れることがある）。
    const mine = await db.query<{ reason: string }>(
      `select reason from cancellation_surveys, unnest(reasons) as reason
        where user_id = $1 and proceeded`,
      [userId],
    );
    expect(mine.rows.map((r) => r.reason)).toEqual(["price"]);

    // 1つも選ばずに保存はできない（DBへ空配列を入れない）。
    await expect(
      saveCancellationSurvey(db, userId, { reasons: [], proceeded: true }),
    ).rejects.toMatchObject({ code: "validation_error" });
    const counts = await cancellationReasonCounts(db, 30);
    expect(counts.find((c) => c.reason === "price")?.count).toBeGreaterThanOrEqual(1);

    // 未知の理由・長すぎる記述は受け付けない（DBへ入る値を絞る）。
    await expect(
      saveCancellationSurvey(db, userId, { reasons: ["なんとなく"], proceeded: true }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      saveCancellationSurvey(db, userId, { reasons: ["price"], detail: "あ".repeat(1001), proceeded: true }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
