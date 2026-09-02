import { randomUUID } from "node:crypto";

import { createUnconfirmedAuthUser, destroyUserByEmail, query } from "./fixtures/account";
import {
  alertIn,
  expect,
  signIn,
  signUpCodeFromMail,
  test,
  openAccountMenu,
  waitForMail,
} from "./fixtures/test";

/**
 * A-1/A-2 サインアップ→メール確認→ログイン（PRD §A、要件03 §1、要件06 SC-01/SC-02）。
 *
 * メール確認（6桁コード）は**必須**（T-M8-404・運営者の指示 2026-09-01。T-M8-202で
 * 2026-08-22〜09-01の間だけ省略していた）。ログインではコードを求めない——確認済みなら
 * パスワードだけ、未確認のまま放置した登録だけコード画面（自動再送）へ回す。
 * Turnstile・同意チェック・確認後の遷移先が絡む全利用者の最初の経路。
 *
 * メールはローカルのMailpit（`supabase start` が起動）が受け取り、外部へは送信されない。
 */

test("サインアップ→6桁コードで確認→アプリへ着地し、以後はパスワードだけでログインできる（T-M8-404）", async ({ page }) => {
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
      登録後は**同じ画面が6桁コードの入力へ切り替わる**（T-M8-121→T-M8-404）。メールのリンクを
      追わせない。セッションはまだ張られず、確認するまでアプリへは入れない。
    */
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toBeVisible({
      timeout: 30_000,
    });
    expect(turnstileErrors, "Turnstileの設定エラーが発生しないこと").toEqual([]);
    // 確認前は未確認ユーザーとして存在する。
    const [created] = await query<{ confirmed_at: string | null }>(
      `select email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(created, "サインアップで利用者が作られること").toBeTruthy();
    expect(created.confirmed_at, "コードを入れる前は未確認であること").toBeNull();

    // 届いた6桁コードを入力すると確認済みになり、アプリ本体へ着地する。
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("確認");
    const code = await signUpCodeFromMail(mail.ID);
    const submit = page.getByRole("button", { name: "登録を完了する" });
    await expect(submit).toBeDisabled();
    await page.getByRole("textbox", { name: "確認コード" }).fill(code);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 30_000 });
    // **確認が済んだことを画面が言う**（T-M8-58）。
    await expect(page.getByText("メールアドレスの確認が完了しました", { exact: false })).toBeVisible();
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
    // ヘッダー廃止でアカウントメニューの中へ移った（T-M8-328）。
    await openAccountMenu(page);
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
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
    // 未契約でもアプリ本体へ入る（T-M8-268。実行しようとしたときにプランへ案内する）。
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);

    // 直接開いても弾かれない（閲覧は契約状態で止めない）。
    await page.goto("/app/posts?tab=drafts");
    await expect(page).toHaveURL(/\/app\/posts/);
  } finally {
    await destroyUserByEmail(email);
  }
});

/**
 * **ログインでは登録の有無を明かす**（T-M8-295・運営者の指示 2026-08-25。それ以前は逆だった）。
 *
 * 元は列挙対策で有無を伏せていたが、登録していない人が「入力内容を確認してください」を見て
 * 正しいパスワードを探し続ける状態になっていた（運営者が実際に踏んだ）。判断の材料:
 * - **新規登録は既に「登録済み」を明かしている**（T-M8-149）ので、ログインだけ伏せても分かる
 * - ログインは Turnstile の通過が必須で、総当たりの列挙は難しい
 * - **パスワード再設定は従来どおり伏せる**（メールを送る経路なので、存在確認と同時に
 *   第三者へメールを送りつける手段になり得る。`password-reset.spec.ts` が固定している）
 * 伏せる方へ戻すときは、この3点をまとめて見直すこと。
 */
test("未登録のメールでは登録が無いと伝え、新規登録へ案内する", async ({ page }) => {
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
  await expect(alert).toContainText("登録されていません");
});

test("未確認のまま放置した登録は、ログインでコード画面（自動再送）へ回り、勝手に確認済みにならない（T-M8-404）", async ({
  page,
}) => {
  const suffix = `unconfirmed-login-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;

  try {
    /*
      未確認アカウントをAdmin APIで作る（登録してコードを入れずに離れた人と同じ状態）。
      T-M8-377ではログイン時に確認済みへ揃えていたが、登録の6桁コード確認を必須へ戻した
      T-M8-404で廃止した——揃えると「コードを入れずにログイン」で確認を素通りできる。
      ここで守るのは、コード画面へ回ること・新しいコードが自動で送られること（T-M8-153）・
      DBが未確認のままなこと。
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

    // コード画面へ回り、新しいコードが自動で送られる（T-M8-153）。
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/login/);
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("確認");

    // DB上は未確認のまま（ログインで勝手に確認済みにしない）。
    const rows = await query<{ confirmed: boolean }>(
      `select email_confirmed_at is not null as confirmed from auth.users where email = $1`,
      [email],
    );
    expect(rows[0]?.confirmed).toBe(false);

    // 届いたコードを入れれば確認済みになりアプリへ入れる。
    const code = await signUpCodeFromMail(mail.ID);
    await page.getByRole("textbox", { name: "確認コード" }).fill(code);
    await page.getByRole("button", { name: "登録を完了する" }).click();
    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 30_000 });
  } finally {
    await destroyUserByEmail(email);
  }
});

test("アプリ内のどの画面からでもアカウントメニューのログアウトで抜けられる", async ({ accounts, page }) => {
  const account = await accounts.create("signout");
  await signIn(page, account);

  // ホーム以外の画面からでも到達できる（ヘッダはApp Shell共通・要件06 §2）
  await page.goto("/app/posts?tab=drafts");
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
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
