/**
 * App Shell の骨格（T-M8-328→T-M8-416・運営者の指示 2026-09-03）。
 *
 * デスクトップはヘッダー無し（導線はサイドバー下部）。モバイルは**上部の固定ヘッダー**に
 * ロゴ・お知らせ・アカウントを置き、下部バーはナビ7タブだけ。戻ってしまうと
 * 「お知らせが開けない」「ログアウトできない」が起きるので、**到達できること**を検査で固定する。
 */
import { expect, signIn, test } from "./fixtures/test";

test("App Shell: デスクトップはヘッダー非表示・モバイルは上部ヘッダー（T-M8-416）", async ({ accounts, page }) => {
  const account = await accounts.create("shell-check");
  await signIn(page, account);
  await page.goto("/app");

  // デスクトップではヘッダーが見えない（モバイル用ヘッダーはDOMにあるが lg:hidden）。
  await expect(page.locator("header"), "デスクトップにヘッダーが出ている").toBeHidden();

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
  // モバイルは上部ヘッダーが見え、お知らせがその中にある（T-M8-416）。
  const mobileHeader = page.locator("header");
  await expect(mobileHeader).toBeVisible();
  const headerBox = await mobileHeader.boundingBox();
  expect(headerBox!.y, "ヘッダーが画面上部にある").toBeLessThan(50);
  await expect(mobileHeader.getByRole("button", { name: /お知らせ/ })).toBeVisible();
});
