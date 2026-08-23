import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 課金タブの解約済み分岐（T-M8-264・要件06 SC-11）。
 *
 * 実際のStripe呼び出し（再開の成立）は `resume.test.ts`（中核）と
 * `resume/route.db.test.ts`（配線・実DB反映）が担う。ここは**ページの分岐**——
 * canceled かつ Stripe顧客ありのとき PortalButton ではなく「プランを再開」が出ること——を守る。
 * この分岐が壊れると、解約済み利用者にはPortalの行き止まり（「プランを変更」を押しても
 * Portalトップが開くだけ）が再発する（T-M8-264が直した状態そのもの）。ボタンは押さない
 * （押すと実Stripeへ向かうため。分岐の描画だけを固定する）。
 */
test("解約済み＋Stripe顧客ありの課金タブは「プランを再開」を出し、Portal導線を出さない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("billing-canceled");
  await query(
    `update profiles
        set subscription_status = 'canceled', stripe_customer_id = 'cus_e2e_canceled',
            current_period_end = now() - interval '1 day'
      where id = $1`,
    [account.userId],
  );

  // 解約後は機能画面を見せないため、ログイン直後は /plans に着地する（T-M8-266）。
  await signIn(page, account, { waitFor: /\/plans(\/|$|\?)/ });
  await page.goto("/app/settings?tab=billing");

  await expect(page.getByText("解約済み")).toBeVisible();
  await expect(page.getByRole("button", { name: "プランを再開" })).toBeVisible();
  await expect(page.getByRole("link", { name: "別のプランを選ぶ" })).toHaveAttribute("href", "/plans");
  // Portal導線（canceledでは行き止まり）は出ない。
  await expect(page.getByRole("button", { name: "プランを変更" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解約する" })).toHaveCount(0);
});
