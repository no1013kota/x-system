import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-05 ホーム（要件06 §1.4・§3.1）。初期設定の未完了→完了で「初期設定ガイド」が出し分けられ、
 * 「次回の予定」がスケジュール未登録／有効スロットありで行き止まりにならないことを確認する。
 */

test("初期設定が未完了ならガイドが出て、予定・実績は空状態から次の操作へ進める", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("home-setup", { personaReady: false });
  await signIn(page, account);

  const guide = page.getByRole("heading", { name: "初期設定ガイド" });
  await expect(guide).toBeVisible();
  await expect(page.getByText("次にやること")).toBeVisible();

  // スケジュール未登録・投稿なしでも、それぞれ次の画面へ進める
  await expect(page.getByRole("link", { name: "スケジュールを設定" })).toHaveAttribute(
    "href",
    "/app/schedule",
  );
  await expect(page.getByText("まだ投稿がありません。", { exact: false })).toBeVisible();
});

test("有効スロットがあれば次回の予定が並び、初期設定が済むとガイドが消える", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("home-schedule");
  await query(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, enabled)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{0,1,2,3,4,5,6}', '09:30', 'draft', 'other', true)`,
    [account.xAccountId],
  );
  await signIn(page, account);

  // アカウント設定まで完了しているのでガイドは出ない
  await expect(page.getByRole("heading", { name: "初期設定ガイド" })).toHaveCount(0);

  const upcoming = page.locator("section", { has: page.getByRole("heading", { name: "次回の予定" }) });
  await expect(upcoming.getByText("下書きを作成")).toBeVisible();
  await expect(upcoming.getByText(/\d+月\d+日\(.\) 9:30/)).toBeVisible();
  // 実行できる状態なので警告は出ない
  await expect(upcoming.getByText("初期設定が未完了のため", { exact: false })).toHaveCount(0);

  // 停止すると「すべて停止中」になり、SC-08への導線が残る
  await query(`update schedule_slots set enabled = false where x_account_id = $1`, [
    account.xAccountId,
  ]);
  await page.reload();
  await expect(page.getByText("スケジュールはすべて停止中です。")).toBeVisible();
  await expect(page.getByRole("link", { name: "スケジュールを確認" })).toBeVisible();
});

test("メインナビは遷移中を即時表示し、行き先の画面へ到達する", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("navigation-feedback");
  await signIn(page, account);

  // Delay only the RSC response so the normally brief pending indicator is observable.
  await page.route("**/app/news*", async (route) => {
    if (route.request().headers().rsc === "1") {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });

  const desktopNav = page.getByRole("navigation", {
    name: "メインナビゲーション",
    exact: true,
  });
  const newsLink = desktopNav.getByRole("link", { name: "最新ニュース" });
  await newsLink.click();

  await expect(newsLink.locator(".animate-spin")).toBeVisible();
  await page.waitForURL("/app/news");
  await expect(page.getByRole("heading", { name: "最新ニュース" })).toBeVisible();
});
