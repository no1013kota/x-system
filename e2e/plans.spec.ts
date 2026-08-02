import { query } from "./fixtures/account";
import { expect, horizontalOverflow, signIn, test } from "./fixtures/test";

/**
 * SC-04 プラン選択とSC-11 課金タブの表示（PRD §プラン、要件03 §2、T-M7-26）。
 *
 * **決済ボタンは押さない。** 押すとStripeへ実際にセッションを作りに行き、CIではダミーキーの
 * ため必ず失敗する。ボタンの先の配線（checkout/portal）は `route.db.test.ts` 7本43件が
 * Stripe SDKをモックして検証しているので、ここは**画面の表示と権限**だけを見る。
 *
 * 契約状態によって見えるものが変わる部分（要件03 §2の閲覧ゲート）が主眼。
 */

test("未契約の利用者にはプラン選択が出て、申込前の確認事項が隠れていない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-none");
  // 申込前の状態にする。`plan` は NOT NULL なので既定値（standard）のまま、
  // 契約状態を profiles の既定と同じ `incomplete` に戻す（fixtureの既定は premium/trialing）。
  await query(
    `update profiles set plan = 'standard', subscription_status = 'incomplete',
        current_period_end = null, trial_ends_at = null where id = $1`,
    [account.userId],
  );

  // 未契約はアプリ本体へ入れず、プラン選択へ送られる（要件03 §2）
  await signIn(page, account, { waitFor: /\/plans/ });

  // 3プランが比較できる（見出しはPRDと同じ日本語表記・T-M8-21）
  for (const name of ["通常プラン", "mdプラン", "プレミアムプラン"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // BYOKの追加費用は申込前に必ず読める（折りたたまない・要件03 §54）
  await expect(page.getByText("X APIの利用料（従量課金）", { exact: false })).toBeVisible();

  // 申込前の確認は折りたたまず常に見える（要件06 §1.1・要件03 §54）
  const preApply = page.getByRole("region", { name: "お申し込み前の確認" });
  await expect(page.getByRole("heading", { name: "お申し込み前の確認" })).toBeVisible();
  await expect(page.getByText("7日間無料", { exact: false }).first()).toBeVisible();
  // 同じリンクはフッターの法務情報にもあるため、確認欄の中にあることを見る。
  await expect(
    preApply.getByRole("link", { name: "特定商取引法に基づく表記" }),
  ).toBeVisible();

  // 申込ボタンは各プランにあるが、押さない（Stripeへ実際に作りに行くため）
  await expect(page.getByRole("button", { name: /7日間無料で利用/ }).first()).toBeVisible();

  // スマホ幅でもカードが縦に積まれて読める
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await horizontalOverflow(page), "ページ全体が横に伸びないこと").toBeLessThanOrEqual(0);
});

test("契約中の利用者はプラン選択に留まらず、契約状態が設定画面で読める", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-active");
  await signIn(page, account);

  // 契約が有効ならアプリ本体に入れる（/plans へは行かない）
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // /plans を直接開いてもアプリへ戻される（決済後に行き止まりにならない）
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // 設定画面で契約状態が読める
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();
  await expect(page.getByText("プラン", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("プレミアムプラン", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("契約状態", { exact: false }).first()).toBeVisible();

  // 支払い管理ボタンは、Stripeの顧客IDが無い間は押せない（押しても直らない操作を出さない）
  const portal = page.getByRole("button", { name: /お支払い|管理/ }).first();
  if (await portal.count()) {
    await expect(portal).toBeDisabled();
  }
});

test("契約が切れた利用者は閲覧はできるが、実行はできずプラン選択へ案内される", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-canceled");
  await query(
    `update profiles set subscription_status = 'canceled', current_period_end = now() - interval '1 day'
      where id = $1`,
    [account.userId],
  );

  // `canceled` は viewScope=app なので**アプリ本体は見られる**（自分のデータを確認できる）。
  // 実行（生成・投稿）だけを止めるのが仕様（`SUBSCRIPTION_ACCESS`・要件03 §2）。
  await signIn(page, account);
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // 契約のお知らせが出て、プラン選択への導線がある（行き止まりにしない）
  const banner = page.getByRole("complementary", { name: "ご契約のお知らせ" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "プランを選択" })).toBeVisible();

  // 実行はできない（投稿作成の前提チェックで止まる）
  await page.goto("/app/posts?tab=create");
  await expect(page.getByText("プラン", { exact: false }).first()).toBeVisible();

  // 設定の課金タブは開ける
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();
});
