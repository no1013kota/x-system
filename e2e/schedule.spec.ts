import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-08 スケジュールの停止→再開（要件06 §1・要件05 §7）。画面操作の結果がDBまで反映され、
 * 停止したまま削除しか残らない行き止まりにならないことを確認する。
 */

test("スロットを停止して再開でき、DBの enabled が追従する", async ({ accounts, page }) => {
  const account = await accounts.create("schedule");
  const [slot] = await query<{ id: string }>(
    `insert into schedule_slots (x_account_id, pattern, weekdays, time_jst, mode, enabled)
     values ($1, 'p3', '{1,3,5}', '19:00', 'draft', true) returning id`,
    [account.xAccountId],
  );
  await signIn(page, account);
  await page.goto("/app/schedule");

  const row = page.locator("li", { hasText: "ノウハウ" }).first();
  await expect(row.getByText("次回", { exact: false })).toBeVisible();

  await row.getByRole("button", { name: "停止" }).click();
  await expect(row.getByText("停止中（実行されません）")).toBeVisible();
  expect(
    (await query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [slot.id]))[0]
      .enabled,
  ).toBe(false);

  await row.getByRole("button", { name: "再開" }).click();
  await expect(row.getByText("停止中（実行されません）")).toHaveCount(0);
  expect(
    (await query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [slot.id]))[0]
      .enabled,
  ).toBe(true);
});
