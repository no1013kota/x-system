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

    /*
      **コード入力の画面にCloudflareのUIを出さない**（T-M8-138・運営者の指示 2026-08-18）。
      コード検証自体は人間確認を求めていないので、見えていると「打つのに確認が要る」と読める。
      ただし再送はSupabaseがトークンを要求するので、**不可視で残っている**ことも同時に見る
      （見た目だけ消してトークンまで消すと、再送が黙って壊れる）。
    */
    /*
      判定は**確保された表示枠**で見る。ローカルのTurnstileはテストキーなので
      Cloudflareのiframeを描かず、iframeの有無では可視/不可視を見分けられない
      （実測: どちらも0件）。可視モードは `min-h-16`（64px）の空きを必ず作るので、
      それが無いことを見る＝画面にCloudflareの箱が出ていないこと。
    */
    await expect(
      page.locator("form .min-h-16"),
      "コード入力画面にCloudflareの表示枠が確保されている",
    ).toHaveCount(0);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), {
        timeout: 30_000,
        message: "再送用のトークンが（不可視でも）入らない",
      })
      .not.toBe("");

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
