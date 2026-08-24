import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures/test";

/**
 * ログインの失敗を原因ごとに言い分ける（T-M8-295・運営者の指示 2026-08-25）。
 *
 * 以前はどの失敗でも「入力内容を確認し、時間をおいて再度お試しください」だったため、
 * **登録していないアドレスで試した人が、正しいパスワードを探して何度も試す**ことになった
 * （運営者が実際に踏んだ）。Supabase はどちらも同じ `invalid_credentials` を返すので、
 * ここが緑であることは「アプリ側で存在を確かめて言い分けている」ことの証明になる。
 */
async function submitLogin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  const form = page.getByTestId("login-form");
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await expect
    .poll(() => form.locator('input[name="captcha_token"]').inputValue(), {
      timeout: 30_000,
      message: "Turnstileのトークンが入らない",
    })
    .not.toBe("");
  await page.getByTestId("login-submit").click();
}

test("登録が無いアドレスなら「登録されていません」と新規登録への導線を出す", async ({ page }) => {
  await submitLogin(page, `nobody-${randomUUID().slice(0, 8)}@example.com`, "Whatever-123456");

  // Next.js のルートアナウンサーも role="alert" を持つので、フォーム内へ絞る。
  const alert = page.getByTestId("login-form").getByRole("alert");
  await expect(alert).toContainText("このメールアドレスは登録されていません");
  await expect(alert.getByRole("link", { name: "新規登録へ" })).toHaveAttribute("href", "/signup");
  // 待っても直らない失敗に「時間をおいて」と言わない。
  await expect(alert).not.toContainText("時間をおいて");
});

test("登録済みでパスワードが違うときは、存在を伏せず「正しくありません」と言う", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("login-wrongpw");

  await submitLogin(page, account.email, "Definitely-Wrong-999");

  // Next.js のルートアナウンサーも role="alert" を持つので、フォーム内へ絞る。
  const alert = page.getByTestId("login-form").getByRole("alert");
  await expect(alert).toContainText("メールアドレスまたはパスワードが正しくありません");
  // 登録はあるので、新規登録へは誘導しない（押した先で「既に登録されています」になる）。
  await expect(alert.getByRole("link", { name: "新規登録へ" })).toHaveCount(0);
});
