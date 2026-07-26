import { randomUUID } from "node:crypto";

import { destroyUserByEmail, query } from "./fixtures/account";
import { alertIn, expect, test } from "./fixtures/test";

/**
 * A-1/A-2 サインアップ→メール確認→ログイン（PRD §A、要件03 §1、要件06 SC-01/SC-02）。
 *
 * 既存のE2Eは `createTestAccount`（Supabase Admin APIで確認済みユーザーを直接作る）を使うため、
 * **画面のサインアップとメール確認は一度も通っていなかった**。ここは全利用者が最初に踏む経路で、
 * Turnstile・同意チェック・確認メールのtoken_hash・確認後の遷移先が絡む。
 *
 * メールはローカルのMailpit（`supabase start` が起動）が受け取り、外部へは送信されない。
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** 宛先が一致する最新のメールを待つ（Mailpitは共有なので宛先で絞る）。 */
async function waitForMail(to: string): Promise<MailpitMessage> {
  let last: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
        if (!res.ok) return false;
        const body = (await res.json()) as { messages: MailpitMessage[] };
        last = body.messages.find((m) => m.To.some((t) => t.Address === to));
        return Boolean(last);
      },
      { timeout: 30_000, message: `${to} 宛の確認メールが届くこと` },
    )
    .toBe(true);
  return last as MailpitMessage;
}

/** メール本文から `/auth/confirm` のURLを取り出す。 */
async function confirmUrlFrom(messageId: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${messageId}`);
  expect(res.ok, "Mailpitからメール本文を取得できること").toBe(true);
  const body = (await res.json()) as { HTML?: string; Text?: string };
  const source = `${body.HTML ?? ""}\n${body.Text ?? ""}`;
  const match = /https?:\/\/[^\s"'<>]*\/auth\/confirm\?[^\s"'<>]+/.exec(source);
  expect(match, "確認メールに /auth/confirm のリンクが含まれること").not.toBeNull();
  // HTMLメールでは & が &amp; にエスケープされるため戻す。
  return (match as RegExpExecArray)[0].replace(/&amp;/g, "&");
}

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

    await expect(page.getByRole("heading", { name: "メールをご確認ください" })).toBeVisible();

    // 確認前は未確認ユーザーとして存在し、同意バージョンが記録されている
    const [created] = await query<{ id: string; confirmed_at: string | null }>(
      `select id, email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(created, "サインアップで利用者が作られること").toBeTruthy();
    expect(created.confirmed_at, "確認メールを開く前は未確認であること").toBeNull();

    // 確認メールのリンクを踏むと確認済みになり、プラン選択へ進む
    const mail = await waitForMail(email);
    expect(mail.Subject).toContain("確認");
    await page.goto(await confirmUrlFrom(mail.ID));
    await expect(page).toHaveURL(/\/plans/);

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

    // ログアウト相当（sessionを捨てる）→ 画面のログインフォームから入り直せる。
    // 未契約なのでアプリ本体ではなくプラン選択へ入る（要件03 §2 の閲覧ゲート）。
    await page.context().clearCookies();
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
