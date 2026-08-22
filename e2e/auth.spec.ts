import { randomUUID } from "node:crypto";

import { createUnconfirmedAuthUser, destroyUserByEmail, query } from "./fixtures/account";
import {
  alertIn,
  expect,
  signIn,
  signUpCodeFromMail,
  test,
  waitForMail,
} from "./fixtures/test";

/**
 * A-1/A-2 サインアップ→ログイン（PRD §A、要件03 §1、要件06 SC-01/SC-02）。
 *
 * メール確認（6桁コード）はT-M8-202で省略中（登録即ログイン）。コード画面・自動再送の経路は
 * 「未確認アカウントのログイン」テストが未確認ユーザー（Admin APIで作成）経由で守り続ける。
 * Turnstile・同意チェック・確認後の遷移先が絡む全利用者の最初の経路。
 *
 * メールはローカルのMailpit（`supabase start` が起動）が受け取り、外部へは送信されない。
 */

test("サインアップは確認コードなしで完了し、未契約はプラン選択で止まる（T-M8-202）", async ({ page }) => {
  const suffix = `signup-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;
  const turnstileErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("Turnstile")) turnstileErrors.push(error.message);
  });

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

    /*
      メール確認は省略（T-M8-202・運営者の決定 2026-08-22）。登録と同時にセッションが張られ、
      **そのままプラン選択へ着地し、成功の文言が出る**。確認コード画面には入らない。
      （戻す場合の挙動は supabase/config.toml と scripts/auth-settings.mjs のコメント参照。
      コード検証・再送のUIは次のテストが未確認ユーザー経由で引き続き検証している。）
    */
    await expect(page).toHaveURL(/\/plans/, { timeout: 30_000 });
    await expect(page.getByText("登録が完了しました", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toHaveCount(0);
    expect(turnstileErrors, "Turnstileの設定エラーが発生しないこと").toEqual([]);

    // 登録と同時にconfirmedになっている。
    const [created] = await query<{ confirmed_at: string | null }>(
      `select email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(created.confirmed_at, "登録と同時にemail_confirmed_atが入ること").not.toBeNull();

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

test("未確認アカウントのログインは黄色の案内付き6桁画面へ移り、コードを自動再送する", async ({
  page,
}) => {
  const suffix = `unconfirmed-login-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;
  const turnstileErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("Turnstile")) turnstileErrors.push(error.message);
  });

  try {
    /*
      未確認アカウントをAdmin APIで作る（T-M8-202以降、画面からの登録は即confirmedになるため）。
      過去に登録したまま確認していない利用者・確認を再有効化した後の利用者が該当する経路で、
      6桁コードの画面と自動再送はこのテストが引き続き守る。
    */
    await createUnconfirmedAuthUser(email, password);

    await page.goto("/login");
    const loginForm = page.getByTestId("login-form");
    await loginForm.locator('input[type="email"]').fill(email);
    await loginForm.locator('input[type="password"]').fill(password);
    await expect
      .poll(() => loginForm.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.getByTestId("login-submit").click();

    // ログインフォームを残さず、要求どおり6桁コードの画面へ切り替える。
    await expect(page.getByTestId("login-form")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toBeVisible();
    const warning = page.getByText("メール確認が終わっていません", { exact: true });
    await expect(warning).toBeVisible();
    await expect(warning).toHaveClass(/border-warn-fg/);

    // ログイン用tokenの再利用ではなく、切替後のwidgetが新しいtokenを得て自動再送する。
    const resentMail = await waitForMail(email);
    await expect(page.getByText("確認メールを再送しました", { exact: false })).toBeVisible();

    const code = await signUpCodeFromMail(resentMail.ID);
    await page.getByRole("textbox", { name: "確認コード" }).fill(code);
    await page.getByRole("button", { name: "登録を完了する" }).click();
    await expect(page).toHaveURL(/\/plans/);
    expect(turnstileErrors, "Turnstileの設定エラーが発生しないこと").toEqual([]);
  } finally {
    await destroyUserByEmail(email);
  }
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

/**
 * 登録済みのメールで再登録したとき、原因が分かること（T-M8-127）。
 *
 * 以前は「登録を完了できませんでした。入力内容を確認し、時間をおいて再度お試しください。」
 * だけが出ていた。**登録済みは待っても直らない**ので、この文言は嘘であり、利用者は同じ操作を
 * 繰り返す。Supabaseは確認済みメールに対して 422 `user_already_exists` を返すので、
 * それを言い分ける（2026-08-18にローカルで実応答を確認）。
 */
test("登録済みのメールで再登録すると、そう分かってログインへ行ける（T-M8-127）", async ({
  accounts,
  page,
}) => {
  // fixtureの利用者は確認済みで作られる（＝運営者が踏んだ状態と同じ）。
  const account = await accounts.create("dup-signup");

  await page.goto("/signup");
  await page.locator('input[name="email"]:not([type="hidden"])').fill(account.email);
  await page.locator('input[name="password"]').fill(`Dup-${randomUUID().slice(0, 8)}-Pw1`);
  await page
    .locator('input[name="password_confirmation"]')
    .fill(await page.locator('input[name="password"]').inputValue());
  await page.locator('input[name="terms_accepted"]').check();
  await page.locator('input[name="privacy_acknowledged"]').check();
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
    .not.toBe("");
  await page.getByRole("button", { name: "メールアドレスで登録" }).click();

  const notice = alertIn(page);
  await expect(notice.getByText("既に登録されています", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  // 待っても直らないので「時間をおいて」と言わない。
  await expect(notice.getByText("時間をおいて", { exact: false })).toHaveCount(0);
  // 行き止まりにしない。
  await expect(notice.getByRole("link", { name: "ログイン画面へ" })).toBeVisible();
});
