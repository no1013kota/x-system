import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * ヘッダの通知ベル（O-2, 要件06 §2, T-M8-32）。
 *
 * 押した瞬間に閉じて遷移することと、未読数がその場で減ることを固定する。以前は**既読化の
 * サーバ往復を待ってから**閉じて遷移していたため、押しても何も起きない時間があった。
 */
test("通知を押すと即座に閉じて遷移し、未読数がその場で減る", async ({ accounts, page }) => {
  const account = await accounts.create("bell", { personaReady: true });
  const marker = randomUUID().slice(0, 6);
  await query(
    `insert into notifications (user_id, type, title, body, link, in_app_enabled, email_status)
     values ($1,'error',$2,'APIキーが無効です。','/app/settings?tab=api-keys',true,'not_requested'),
            ($1,'summary',$3,'本日のまとめです。',null,true,'not_requested')`,
    [account.userId, `失敗しました ${marker}`, `まとめ ${marker}`],
  );

  await signIn(page, account);

  const bell = page.getByRole("button", { name: /通知/ });
  await expect(bell).toContainText("2");
  await bell.click();

  // リンクの無い通知は押せる形にしない（押しても何も起きないボタンを出さない）
  const summaryRow = page.locator("li", { hasText: `まとめ ${marker}` });
  await expect(summaryRow.getByRole("button")).toHaveCount(0);

  // リンクのある通知を押す → 閉じて遷移し、未読が減る
  await page.locator("li button", { hasText: `失敗しました ${marker}` }).click();
  await page.waitForURL(/tab=api-keys/);
  await expect(page.locator("li button")).toHaveCount(0); // ポップアップが閉じている
  await expect(bell).toContainText("1");

  // DBでも既読になっている（見た目だけ変えて終わりにしない）
  await expect
    .poll(
      async () =>
        (
          await query<{ n: number }>(
            `select count(*)::int as n from notifications where user_id = $1 and read_at is not null`,
            [account.userId],
          )
        )[0].n,
      { timeout: 10_000, message: "押した通知がDBでも既読になること" },
    )
    .toBe(1);
});

test("すべて既読で未読バッジが消え、DBにも反映される", async ({ accounts, page }) => {
  const account = await accounts.create("bell-all", { personaReady: true });
  await query(
    `insert into notifications (user_id, type, title, body, link, in_app_enabled, email_status)
     select $1,'news','ニュース ' || g::text,'本文','/app/news',true,'not_requested'
       from generate_series(1,3) g`,
    [account.userId],
  );

  await signIn(page, account);
  const bell = page.getByRole("button", { name: /通知/ });
  await expect(bell).toContainText("3");
  await bell.click();
  await page.getByRole("button", { name: "すべて既読" }).click();

  await expect(bell).not.toContainText("3");
  await expect
    .poll(
      async () =>
        (
          await query<{ n: number }>(
            `select count(*)::int as n from notifications where user_id = $1 and read_at is null`,
            [account.userId],
          )
        )[0].n,
      { timeout: 10_000, message: "すべて既読がDBへ反映されること" },
    )
    .toBe(0);
});
