/**
 * App Shell の骨格（T-M8-328・運営者の指示 2026-08-27）。
 *
 * **ヘッダーを廃止し、その導線をサイドバー下部へ集めた。** 戻ってしまうと
 * 「お知らせが開けない」「ログアウトできない」が起きるので、位置ではなく
 * **到達できること**を検査で固定する。
 */
import { expect, signIn, test } from "./fixtures/test";

test("App Shell: ヘッダーが無く、ナビ下部にお知らせとアカウントがある", async ({ accounts, page }) => {
  const account = await accounts.create("shell-check");
  await signIn(page, account);
  await page.goto("/app");

  // ヘッダーが消えていること
  expect(await page.locator("header").count(), "ヘッダーが残っている").toBe(0);

  const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
  await expect(nav.getByRole("link", { exact: true, name: "プロンプト" })).toBeVisible();
  await expect(nav.getByRole("link", { exact: true, name: "設定" })).toHaveCount(0);

  await expect(page.getByRole("button", { name: /お知らせ/ })).toBeVisible();

  const accountBtn = page.getByRole("button", { name: /@|アカウント/ }).last();
  await accountBtn.click();
  await expect(page.getByRole("menuitem", { name: "課金・プラン" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "ログアウト" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByRole("navigation", { name: "メインナビゲーション（モバイル）" })).toBeVisible();
});
