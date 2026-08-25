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
  /*
    **トライアルは使い切った解約済み**にする（`trial_ends_at` を過去にする）。
    fixtureの既定は `trial_ends_at = now() + 7 days` で、消し忘れると T-M8-278 の
    「残りの期間で再開」分岐に入り、ボタンが「無料トライアルを再開」になる（下のテストが担当）。
  */
  await query(
    `update profiles
        set subscription_status = 'canceled', stripe_customer_id = 'cus_e2e_canceled',
            current_period_end = now() - interval '1 day',
            trial_ends_at = now() - interval '1 day'
      where id = $1`,
    [account.userId],
  );

  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await expect(page.getByText("解約済み")).toBeVisible();
  await expect(page.getByRole("button", { name: "プランを再開" })).toBeVisible();
  await expect(page.getByRole("link", { name: "別のプランを選ぶ" })).toHaveAttribute("href", "/plans");
  // Portal導線（canceledでは行き止まり）は出ない。
  await expect(page.getByRole("button", { name: "プランを変更" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解約する" })).toHaveCount(0);
});

/**
 * トライアル中に解約した人が期限内に戻ってきた場合（T-M8-278）。
 * **新しく配り直すのではなく残りの期間で再開する**ことが、押す前に読めること。
 * 「プランを再開」（有料・その場で請求が始まる）と取り違えると、無料のつもりが課金される／
 * その逆で使えるはずの残り期間を捨てることになる。
 */
test("解約済みでもトライアルが残っていれば「無料トライアルを再開」と残り期限が出る（T-M8-278）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("billing-canceled-trial");
  await query(
    `update profiles
        set subscription_status = 'canceled', stripe_customer_id = 'cus_e2e_canceled_trial',
            current_period_end = now() - interval '1 day',
            trial_ends_at = now() + interval '5 days'
      where id = $1`,
    [account.userId],
  );

  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await expect(page.getByText("解約済み")).toBeVisible();
  await expect(page.getByRole("button", { name: "無料トライアルを再開" })).toBeVisible();
  // 有料の再開ボタンと取り違えないこと。
  await expect(page.getByRole("button", { name: "プランを再開" })).toHaveCount(0);
  await expect(page.getByText(/残りの期間で.*再開します。期間中は料金が発生しません。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "プランを変更" })).toHaveCount(0);
});
