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

test("本日の投稿上限に達したら、投稿を試す前にバナーで分かる（要決定D-15 案A）", async ({
  accounts,
  page,
}) => {
  // 上限そのものは前からあったが、判定が投稿jobの中にしか無く**投稿しようとして初めて分かる**
  // 状態だった。50件を積んで、画面を開いた時点で分かることを確かめる。
  const account = await accounts.create("daily-limit", { personaReady: true });
  await query(
    `insert into usage_events
       (user_id, x_account_id, month, counter_type, operation, delta, reason, idempotency_key)
     select $1, $2, to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM'),
            'post_normal', 'post_create', 1, 'consume', 'e2e-daily-' || g::text
       from generate_series(1, 50) g`,
    [account.userId, account.xAccountId],
  );

  await signIn(page, account);
  const banner = page.getByRole("complementary", { name: "本日の投稿上限に達しました" });
  await expect(banner).toBeVisible();
  // 何件までか・いつ再開するか・自動実行はどうなるかが読める（行き止まりにしない）。
  await expect(banner).toContainText("翌日0:00（JST）");
  await expect(banner).toContainText("下書きの作成まで続きます");

  // 画面を移っても出続ける（App Shell の常設バナー）。
  await page.goto("/app/posts?tab=create");
  await expect(page.getByRole("complementary", { name: "本日の投稿上限に達しました" })).toBeVisible();
});

test("スケジュールに分野を設定でき、行に出てDBへ入る（T-M8-28）", async ({ accounts, page }) => {
  // 分野はAIへ渡す指示になる。画面で選べても保存されなければ意味が無いので、DBまで見る。
  const account = await accounts.create("slot-theme", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/schedule");

  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await page.getByRole("radio", { name: "ノウハウ" }).check();
  await page.getByLabel("分野（任意）").selectOption("business_ops");
  await page.getByRole("checkbox", { name: "月", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 行に分野が出る（編集画面を開かないと分からない状態にしない）
  await expect(page.getByText("業務改善", { exact: true }).first()).toBeVisible();

  await expect
    .poll(
      async () =>
        (
          await query<{ theme: string | null }>(
            `select theme from schedule_slots where x_account_id = $1`,
            [account.xAccountId],
          )
        )[0]?.theme,
      { message: "分野がDBへ保存されること" },
    )
    .toBe("business_ops");
});
