import { randomUUID } from "node:crypto";

import { destroyUserByEmail, query } from "./fixtures/account";
import {
  alertIn,
  confirmUrlFromMail,
  expect,
  statusIn,
  test,
  waitForMail,
} from "./fixtures/test";

/**
 * A-2 パスワード再設定（PRD §A、要件03 §1、要件06 SC-02・T-M7-26）。
 *
 * サインアップと並んで**全利用者が踏み得る経路**なのに未カバーだった。Turnstile・確認メールの
 * `token_hash`（`type=recovery`）・復旧セッションcookie・更新後の遷移が絡む。
 * メールはローカルのMailpitが受け取り、外部へは送信されない。
 */

test("再設定メールから新しいパスワードを設定してログインできる", async ({ page }) => {
  const suffix = `pwreset-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const oldPassword = `E2e-${suffix}-Old1`;
  const newPassword = `E2e-${suffix}-New2`;

  try {
    // 確認済みユーザーを作る（サインアップ自体は auth.spec.ts が見ている）
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
    const created = await fetch(`${base}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        authorization: `Bearer ${serviceRole}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password: oldPassword, email_confirm: true }),
    });
    expect(created.ok, "テストユーザーを作成できること").toBe(true);

    // --- 申請 ---
    await page.goto("/login");
    await page.getByRole("link", { name: "パスワードを忘れた方" }).click();
    await expect(page.getByRole("heading", { name: "パスワード再設定" })).toBeVisible();

    await page.locator('input[name="email"]').fill(email);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.getByRole("button", { name: "再設定メールを送る" }).click();

    // 受け付けた旨が出る（アカウントの存在は明かさない文面）
    await expect(statusIn(page)).toBeVisible();

    // --- メールのリンクから新パスワードを設定 ---
    const mail = await waitForMail(email);
    await page.goto(await confirmUrlFromMail(mail.ID));
    await expect(page).toHaveURL(/\/reset-password/);
    await expect(page.getByRole("heading", { name: "新しいパスワードを設定" })).toBeVisible();

    await page.locator('input[name="password"]').fill(newPassword);
    await page.locator('input[name="password_confirmation"]').fill(newPassword);
    await page.getByRole("button", { name: "パスワードを更新" }).click();

    // 更新後はログイン画面へ戻り、その旨が出る
    await expect(page).toHaveURL(/\/login\?password_updated=1/);
    await expect(
      page.getByText("パスワードを更新しました。", { exact: false }),
    ).toBeVisible();

    // --- 新しいパスワードで入れる ---
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(newPassword);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("")
      ;
    await page.locator('button[type="submit"]').click();
    // 未契約なのでプラン選択へ入る（要件03 §2 の閲覧ゲート）
    await expect(page).toHaveURL(/\/plans/);

    // --- 古いパスワードでは入れない ---
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(oldPassword);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.locator('button[type="submit"]').click();
    await expect(alertIn(page)).toBeVisible();
    await expect(page).not.toHaveURL(/\/plans/);
  } finally {
    await destroyUserByEmail(email);
  }
});

test("ログイン画面から即座に遷移しても人間確認が表示される（T-M7-26で発見した回帰）", async ({
  page,
}) => {
  // 2026-07-31、ログイン画面のTurnstile初期化が終わる前に「パスワードを忘れた方」を押すと、
  // 再設定フォームのウィジェットが**永久に描画されず**（iframe・トークン・エラーのすべてが無し）
  // 申請できなくなっていた。`next/script` が同じidのスクリプトを読み込み中にunmountされると
  // 次のマウントで `onReady` が発火しないため。30秒待っても復帰しないことを実測で確認した。
  await page.goto("/login");
  // 待たずにすぐ遷移する（利用者が素早く押した場合）
  await page.getByRole("link", { name: "パスワードを忘れた方" }).click();

  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), {
      timeout: 20_000,
      message: "遷移直後でも人間確認のトークンが入ること",
    })
    .not.toBe("");
  // 「読み込めませんでした」の行き止まり表示になっていないこと
  await expect(page.getByText("ページを再読み込みしてください", { exact: false })).toHaveCount(0);
});

test("未登録のメールで申請しても、アカウントの有無を教えない", async ({ page }) => {
  const email = `e2e-nobody-${randomUUID().slice(0, 8)}@example.com`;

  await page.goto("/login?mode=forgot-password");
  await page.locator('input[name="email"]').fill(email);
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
    .not.toBe("");
  await page.getByRole("button", { name: "再設定メールを送る" }).click();

  // 存在するときと同じ「受け付けた」表示になる（列挙対策）
  const notice = statusIn(page);
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText("登録されていません");
  await expect(notice).not.toContainText("見つかりません");

  // 利用者は作られない
  const rows = await query<{ n: string }>(
    `select count(*)::text as n from auth.users where email = $1`,
    [email],
  );
  expect(rows[0].n).toBe("0");
});
