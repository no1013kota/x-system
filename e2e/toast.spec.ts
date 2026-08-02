import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * 操作の結果がトーストで伝わること（T-M8-16）。
 *
 * `useToast` は Provider の外でも例外を投げない no-op なので、**呼んでいるのに何も出ない**
 * 事故が静かに起きうる。移行した画面ごとに「実際に出る」ことを1件は確かめる。
 */
test("下書きを破棄すると結果がトーストで出る", async ({ accounts, page }) => {
  const account = await accounts.create("toast-discard", { personaReady: true });
  const text = `トースト確認用の下書き ${randomUUID().slice(0, 6)}`;
  await query(
    `insert into drafts (x_account_id, pattern, thread, initial_thread, status)
     values ($1,'p1',$2::jsonb,$2::jsonb,'draft')`,
    [
      account.xAccountId,
      JSON.stringify([
        { local_id: "p1", text, weighted_length: text.length * 2, sources: [], warnings: [] },
      ]),
    ],
  );

  await signIn(page, account);
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(text)).toBeVisible();

  await page.getByRole("button", { name: "破棄", exact: true }).first().click();
  // 確認ダイアログで確定する。
  await page.getByRole("button", { name: "破棄する", exact: true }).click();

  const toast = toastIn(page);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("下書きを破棄しました");
  // 成功は読み上げを妨げない status（割り込まない）。
  await expect(toast).toHaveAttribute("role", "status");
});

test("スケジュールを停止すると結果がトーストで出る", async ({ accounts, page }) => {
  const account = await accounts.create("toast-slot", { personaReady: true });
  await query(
    `insert into schedule_slots (x_account_id, pattern, weekdays, time_jst, mode, image_enabled, enabled)
     values ($1,'p1','{1,3}','09:30','draft',false,true)`,
    [account.xAccountId],
  );

  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "停止", exact: true }).first().click();

  const toast = toastIn(page);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("スケジュールを停止しました");
});
