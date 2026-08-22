import { randomUUID } from "node:crypto";

import { destroyUserByEmail, query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * 招待プログラム（T-M8-174。正本: docs/cp/invite_cp.md）。
 * リンク→Cookie→登録での帰属と、/app/invite の表示・口座登録を実ブラウザで見る。
 */

test("招待リンクで30日Cookieが付き、そのまま登録すると招待者へ紐づく", async ({
  accounts,
  context,
  page,
}) => {
  // 招待者と招待コードを用意。
  const inviter = await accounts.create("invite-owner");
  const code = `e2e${randomUUID().slice(0, 6).replace(/-/g, "")}`;
  await query(
    `insert into affiliate_accounts (user_id, code) values ($1, $2)`,
    [inviter.userId, code],
  );

  // /r/{code} → LPへ送られ、Cookieが付く。
  await page.goto(`/r/${code}`);
  await expect(page).toHaveURL(/\/$/);
  const cookie = (await context.cookies()).find((c) => c.name === "exos_ref");
  expect(cookie?.value).toBe(code);

  // そのまま画面から登録する（auth.spec と同じ手順）。
  const suffix = `inv-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;
  try {
    await page.goto("/signup");
    await page.locator('input[name="email"]:not([type="hidden"])').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_confirmation"]').fill(password);
    await page.locator('input[name="terms_accepted"]').check();
    await page.locator('input[name="privacy_acknowledged"]').check();
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.getByRole("button", { name: "メールアドレスで登録" }).click();
    // メール確認は省略中（T-M8-202）。登録と同時にプラン選択へ着地する。
    await expect(page).toHaveURL(/\/plans/, { timeout: 30_000 });

    // 登録の時点で帰属が記録される。
    const [attribution] = await query<{ affiliate_account_id: string }>(
      `select att.affiliate_account_id
         from affiliate_attributions att
         join auth.users u on u.id = att.referred_user_id
        where u.email = $1`,
      [email],
    );
    expect(attribution, "登録が招待者へ紐づくこと").toBeTruthy();
  } finally {
    await destroyUserByEmail(email);
  }
});

/*
 * T-M8-191のフォールバック（確認コード検証時の紐づけ）はメール確認の省略（T-M8-202）で
 * 休眠中のためE2Eを外した。確認を戻したら、git履歴のテスト
 * 「登録時に紐づけできなくても、確認コード検証時にCookieがあれば紐づく」を復元すること。
 */
test("友達招待ページ: リンク・報酬率・ランクが出て、銀行口座を登録できる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("invite-page");
  await signIn(page, account);
  await page.goto("/app/invite");

  await expect(page.getByRole("heading", { level: 1, name: "友達招待" })).toBeVisible();
  // 招待リンク（自動発行されたコード）と現在の報酬率（初期ランク30%・2026-08-22改定）。
  await expect(page.getByText(/\/r\/[a-z2-9]{8}/)).toBeVisible();
  await expect(page.getByText("現在の報酬率").first()).toBeVisible();
  await expect(page.getByText("30%").first()).toBeVisible();
  // ランク表に5段が出る。
  for (const rate of ["35%", "40%", "45%", "50%"]) {
    await expect(page.getByText(rate, { exact: true }).first()).toBeVisible();
  }
  // 口座未登録の案内が出る。
  await expect(page.getByText("銀行口座を登録してください")).toBeVisible();

  // 口座を登録すると保存トーストが出て、末尾4桁だけが表示される。
  await page.getByText("銀行口座を登録する").click();
  await page.getByLabel("銀行名").fill("三井住友銀行");
  await page.getByLabel("支店名").fill("渋谷支店");
  await page.getByLabel("口座番号").fill("7654321");
  await page.getByLabel("口座名義（カナ）").fill("テスト タロウ");
  await page.getByRole("button", { name: "口座を登録する" }).click();
  await expect(toastIn(page)).toContainText("振込先口座を保存しました。");
  await expect(page.getByText("****4321", { exact: false })).toBeVisible();
  await expect(page.getByText("7654321")).toHaveCount(0);
});
