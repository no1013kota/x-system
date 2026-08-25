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
    // メール確認は省略中（T-M8-202）。登録と同時にアプリ本体へ着地する（T-M8-268）。
    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 30_000 });

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

/**
 * **契約状態を変えても招待は使える**（T-M8-300・運営者の指示 2026-08-25
 * 「様々なアカウント状況を仮定して、網羅的かつ完全にテストしてください」）。
 *
 * 招待は契約を必要としない（要件03 §2.1・T-M8-269）。ところが機能画面のロックは
 * 契約状態で決まるので、**ロックの条件を変えるたびに招待まで巻き込む**危険がある
 * （実際 T-M8-295 で設定画面をロックしたとき、招待だけは残す判断が要った）。
 * ここで全状態を並べて、招待が開けることとリンクが出ることを固定する。
 */
for (const state of [
  { label: "プラン未登録", plan: null, status: "incomplete" },
  { label: "無料トライアル中", plan: "premium", status: "trialing" },
  { label: "契約中", plan: "premium", status: "active" },
  { label: "解約済み", plan: "premium", status: "canceled" },
  { label: "支払いが滞っている", plan: "premium", status: "past_due" },
] as const) {
  test(`友達招待は「${state.label}」でも開けて招待リンクが出る（T-M8-300）`, async ({
    accounts,
    page,
  }) => {
    const account = await accounts.create(`invite-state-${state.status}`);
    await query(
      `update profiles
          set plan = $2::plan_type, subscription_status = $3,
              current_period_end = now() + interval '10 days'
        where id = $1`,
      [account.userId, state.plan, state.status],
    );
    await signIn(page, account);
    await page.goto("/app/invite");

    await expect(
      page.getByRole("heading", { level: 1, name: "友達招待" }),
      `${state.label} で招待画面が開けない`,
    ).toBeVisible();
    // リンクが出ないと共有しようがない（招待アカウントは画面を開いた時点で自動発行される）。
    await expect(page.getByText(/\/r\/[a-z2-9]{8}/)).toBeVisible();
    // ロック画面へ倒れていないこと（契約を求める文言が出ていたら巻き込まれている）。
    await expect(page.getByRole("heading", { name: "先にプランを登録してください" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "お支払い情報を更新してください" })).toHaveCount(0);
  });
}

/**
 * 自己招待は成立しない（T-M8-300）。自分のリンクを踏んでから登録し直す人は実際に居るが、
 * 成立させると**自分に報酬を払う**ことになる。Cookieは付くが帰属だけが起きない、を固定する。
 */
test("自分の招待リンクを踏んでも自分には帰属しない（T-M8-300）", async ({ accounts, page }) => {
  const account = await accounts.create("invite-self");
  await signIn(page, account);
  await page.goto("/app/invite");
  const link = await page.getByText(/\/r\/[a-z2-9]{8}/).innerText();
  const code = link.trim().split("/r/")[1]!;

  await page.goto(`/r/${code}`);
  // Cookieは付く（踏んだ事実は残る）。帰属していないことをDBで確かめる。
  const cookie = (await page.context().cookies()).find((c) => c.name === "exos_ref");
  expect(cookie?.value, "招待Cookieが付いていない").toBe(code);

  const rows = await query<{ n: string }>(
    `select count(*)::text as n from affiliate_attributions where referred_user_id = $1`,
    [account.userId],
  );
  expect(rows[0]?.n, "自分自身へ帰属してはいけない").toBe("0");
});
