import { expect, signIn, test } from "./fixtures/test";

/**
 * 設定＞課金タブのアカウント表示（T-M8-95）。
 * どのメールアドレスでログインしているかを画面から確認できる（運営者の要望・2026-08-15）。
 */
test("設定にログイン中のメールアドレスが表示される", async ({ accounts, page }) => {
  const account = await accounts.create("email-view");
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing"); // メール表示は課金・プランタブ（既定タブはT-M8-104でgeneralへ）

  await expect(page.getByText("ログイン中のアカウント:")).toBeVisible();
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
});
