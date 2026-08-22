import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 2アカウントでの分離を実ブラウザで確認する（利用者が増えたときに初めて出る種類の不具合）。
 *
 * DB層の分離は `src/lib/db/rls.db.test.ts`（RLS・所有権トリガー・全テーブル検査）と
 * `src/lib/ops/tenant-isolation.db.test.ts`（挙動の干渉）が担当する。ここでは
 * **画面に他人のものが出ないこと**と、**片方の操作でもう片方のデータが変わらないこと**を見る。
 */

async function seedDraft(xAccountId: string, text: string): Promise<string> {
  const thread = [{ local_id: "p1", text, weighted_length: text.length * 2, sources: [], warnings: [] }];
  const [row] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), $2::jsonb, $2::jsonb, 'draft') returning id`,
    [xAccountId, JSON.stringify(thread)],
  );
  return row.id;
}

test("下書き・通知が他の利用者へ漏れず、片方の操作でもう片方が変わらない", async ({
  accounts,
  page,
}) => {
  const marker = randomUUID().slice(0, 8);
  const a = await accounts.create("tenant-a");
  const b = await accounts.create("tenant-b");

  const draftA = await seedDraft(a.xAccountId, `Aの下書き ${marker}`);
  const draftB = await seedDraft(b.xAccountId, `Bの下書き ${marker}`);
  for (const [account, label] of [
    [a, "Aへの通知"],
    [b, "Bへの通知"],
  ] as const) {
    await query(
      `insert into notifications (user_id, type, title, body, in_app_enabled)
       values ($1, 'summary', $2, $3, true)`,
      [account.userId, `${label} ${marker}`, "本文"],
    );
  }

  // --- Aとしてログイン ---
  await signIn(page, a);
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(`Aの下書き ${marker}`)).toBeVisible();
  await expect(page.getByText(`Bの下書き ${marker}`), "他人の下書きは出ない").toHaveCount(0);

  // Aの操作（下書きの破棄）でBの下書きが変わらないこと
  const [beforeB] = await query<{ status: string; updated_at: string }>(
    `select status::text as status, updated_at::text as updated_at from drafts where id = $1`,
    [draftB],
  );
  await page.getByRole("button", { name: "破棄" }).first().click();
  const dialog = page.getByRole("button", { name: /破棄する|はい|OK/ });
  if (await dialog.count()) await dialog.first().click();
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(
            `select status::text as status from drafts where id = $1`,
            [draftA],
          )
        )[0]?.status,
      { timeout: 15_000, message: "Aの下書きが破棄されること" },
    )
    .not.toBe("draft");

  const [afterB] = await query<{ status: string; updated_at: string }>(
    `select status::text as status, updated_at::text as updated_at from drafts where id = $1`,
    [draftB],
  );
  expect(afterB.status, "Bの下書きの状態は変わらない").toBe(beforeB.status);
  expect(afterB.updated_at, "Bの下書きは触られていない").toBe(beforeB.updated_at);

  // --- Bとしてログイン（同じブラウザで切り替え） ---
  await page.context().clearCookies();
  await signIn(page, b);
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(`Bの下書き ${marker}`)).toBeVisible();
  await expect(page.getByText(`Aの下書き ${marker}`), "他人の下書きは出ない").toHaveCount(0);
});
