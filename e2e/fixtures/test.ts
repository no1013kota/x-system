import { expect, test as base, type Page } from "@playwright/test";

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
 * ログインフォームから認証してAppへ入る。Turnstileはローカルのテストキー
 * （`1x00000000000000000000AA`＝常に通過）で自動的に解決されるため、hidden の
 * `captcha_token` に値が入るまで待ってから送信する（空のまま送ると検証エラーになる）。
 */
export async function signIn(page: Page, account: TestAccount): Promise<void> {
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
  await page.waitForURL(/\/app(\/|$|\?)/);
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
