import { expect, test as base, type Locator, type Page } from "@playwright/test";

import {
  createTestAccount,
  destroyTestAccount,
  type AccountOptions,
  type TestAccount,
} from "./account";

/**
 * E2Eの共通fixture（T-M7-05）。`accounts.create()` で作ったアカウントは、テスト終了時に
 * 成否にかかわらず作成分だけ削除する。DBは共有のため（playwright.config の workers: 1）
 * 他のテストのデータには触れない。
 */

export interface AccountFactory {
  create(label: string, options?: AccountOptions): Promise<TestAccount>;
}

export const test = base.extend<{ accounts: AccountFactory }>({
  accounts: async ({}, use) => {
    const created: TestAccount[] = [];
    await use({
      async create(label, options) {
        const account = await createTestAccount(label, options);
        created.push(account);
        return account;
      },
    });
    for (const account of created) await destroyTestAccount(account);
  },
});

export { expect };

/**
 * 画面が出したエラー表示だけを掴む。Next.js の route announcer
 * （`#__next-route-announcer__`）も `role="alert"` を持つため、素の `getByRole("alert")` は
 * 常に2要素へ当たって strict mode 違反になる。
 */
export function alertIn(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/**
 * ページ全体が横に何pxはみ出しているか（0なら横スクロールが出ない）。
 *
 * 絶対配置の要素（`sr-only` を含む）は、位置指定されていないスクロール容器では**クリップされず
 * ページ自体を伸ばす**。要素の矩形を1つずつ見ても気づけないため、ページ全体の値で判定する。
 */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * ログインフォームから認証してAppへ入る。Turnstileはローカルのテストキー
 * （`1x00000000000000000000AA`＝常に通過）で自動的に解決されるため、hidden の
 * `captcha_token` に値が入るまで待ってから送信する（空のまま送ると検証エラーになる）。
 */
export async function signIn(
  page: Page,
  account: TestAccount,
  options: { waitFor?: RegExp } = {},
): Promise<void> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), {
      timeout: 30_000,
      message: "Turnstileのトークンが入らない（challenges.cloudflare.com へ到達できない可能性）",
    })
    .not.toBe("");
  await page.locator('button[type="submit"]').click();
  // 契約状態によって遷移先が変わる（未契約は /plans。要件03 §2）。既定はアプリ本体。
  await page.waitForURL(options.waitFor ?? /\/app(\/|$|\?)/);
}

/**
 * jobを1件だけworkerで進める（ローカルではcronが動かないため明示的に叩く）。
 * `/api/jobs/run` は202を即返して after() で実行するので、完了は呼び出し側でpollする。
 */
export async function runJobNow(page: Page, jobId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const res = await page.request.post("/api/jobs/run", {
    headers: { authorization: `Bearer ${secret}` },
    data: { jobId },
  });
  expect(res.status(), "worker dispatch").toBe(202);
}

/* ---- Mailpit（ローカルのメール受信）--------------------------------------
 * サインアップ確認・パスワード再設定はどちらもメールのリンクを踏む必要がある。
 * 外部へは送信されず、`supabase start` が立てるMailpitが受け取る。
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** 宛先が一致する最新のメールを待つ（Mailpitは共有なので宛先で絞る）。 */
export async function waitForMail(to: string): Promise<MailpitMessage> {
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
export async function confirmUrlFromMail(messageId: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${messageId}`);
  expect(res.ok, "Mailpitからメール本文を取得できること").toBe(true);
  const body = (await res.json()) as { HTML?: string; Text?: string };
  const source = `${body.HTML ?? ""}\n${body.Text ?? ""}`;
  const match = /https?:\/\/[^\s"'<>]*\/auth\/confirm\?[^\s"'<>]+/.exec(source);
  expect(match, "確認メールに /auth/confirm のリンクが含まれること").not.toBeNull();
  // HTMLメールでは & が &amp; にエスケープされるため戻す。
  return (match as RegExpExecArray)[0].replace(/&amp;/g, "&");
}


