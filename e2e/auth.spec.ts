import { randomUUID } from "node:crypto";

import { destroyUserByEmail, query } from "./fixtures/account";
import { alertIn, expect, signIn, signUpCodeFromMail, test, waitForMail } from "./fixtures/test";

/**
 * A-1/A-2 サインアップ→メール確認→ログイン（PRD §A、要件03 §1、要件06 SC-01/SC-02）。
 *
 * 既存のE2Eは `createTestAccount`（Supabase Admin APIで確認済みユーザーを直接作る）を使うため、
 * **画面のサインアップとメール確認は一度も通っていなかった**。ここは全利用者が最初に踏む経路で、
 * Turnstile・同意チェック・確認メールのtoken_hash・確認後の遷移先が絡む。
 *
 * メールはローカルのMailpit（`supabase start` が起動）が受け取り、外部へは送信されない。
 */

test("サインアップ→確認メール→ログインまで通り、未契約はプラン選択で止まる", async ({ page }) => {
  const suffix = `signup-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;

  try {
    await page.goto("/signup");
    await page.locator('input[name="email"]:not([type="hidden"])').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_confirmation"]').fill(password);
    await page.locator('input[name="terms_accepted"]').check();
    await page.locator('input[name="privacy_acknowledged"]').check();

    // Turnstileのテストキーがtokenを入れるまで待つ（空のまま送ると検証エラー）。
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), {
        timeout: 30_000,
        message: "Turnstileのトークンが入らない",
      })
      .not.toBe("");
    await page.getByRole("button", { name: "メールアドレスで登録" }).click();

    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toBeVisible();

    // 確認前は未確認ユーザーとして存在し、同意バージョンが記録されている
    const [created] = await query<{ id: string; confirmed_at: string | null }>(
      `select id, email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(created, "サインアップで利用者が作られること").toBeTruthy();
    expect(created.confirmed_at, "確認メールを開く前は未確認であること").toBeNull();

    // 届いた6桁コードを入力すると確認済みになり、プラン選択へ進む（T-M8-121）。
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("確認");
    const code = await signUpCodeFromMail(mail.ID);
    // 入力しきるまで送信できない（押しても何も起きないボタンを作らない）。
    const submit = page.getByRole("button", { name: "登録を完了する" });
    await expect(submit).toBeDisabled();
    await page.getByRole("textbox", { name: "確認コード" }).fill(code);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/plans/);

    // **確認が済んだことを画面が言う**（T-M8-58）。以前は無言で料金表に変わるだけで、
    // リンクを押した結果（確認できたのか）が分からなかった（失敗時だけ文言があった）。
    await expect(
      page.getByText("メールアドレスの確認が完了しました", { exact: false }),
    ).toBeVisible();

    const [confirmed] = await query<{ confirmed_at: string | null }>(
      `select email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(confirmed.confirmed_at, "確認後は email_confirmed_at が入ること").not.toBeNull();

    // 同意は profiles に記録されている（要件03 §1）
    const [profile] = await query<{ terms_version: string | null }>(
      `select terms_version from profiles where email = $1`,
      [email],
    );
    expect(profile?.terms_version, "利用規約バージョンが記録されること").toBeTruthy();

    // 未契約は /plans に留められる（App Shellのヘッダへ到達できない）ので、
    // この画面のログアウトから抜けられること（PRD A-2・T-M7-19）。
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login/);
    // sessionが破棄されており、保護routeへ戻れない
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/plans/);

    // 未契約のまま /app を直接開いてもアプリ本体には入れない
    await page.goto("/app");
    await expect(page).toHaveURL(/\/plans/);
  } finally {
    await destroyUserByEmail(email);
  }
});

test("未登録のメールではログインできず、原因を推測させる情報も出さない", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(`e2e-nobody-${randomUUID().slice(0, 8)}@example.com`);
  await page.locator('input[type="password"]').fill("Wrong-Password-1");
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
    .not.toBe("");
  await page.locator('button[type="submit"]').click();

  // /app へは入れない
  await expect(page).not.toHaveURL(/\/app(\/|$)/);
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  // 「このメールは登録されていません」等、アカウントの存在を教えない（列挙対策）
  await expect(alert).not.toContainText("登録されていません");
});

test("アプリ内のどの画面からでもヘッダのログアウトで抜けられる", async ({ accounts, page }) => {
  const account = await accounts.create("signout");
  await signIn(page, account);

  // ホーム以外の画面からでも到達できる（ヘッダはApp Shell共通・要件06 §2）
  await page.goto("/app/posts?tab=drafts");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);

  // session破棄後は保護routeへ戻れない（要件03 §1）
  await page.goto("/app/posts");
  await expect(page).toHaveURL(/\/login/);
});
