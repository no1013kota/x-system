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
  // **Stripeの顧客が紐づいていることが「契約中」の条件**（T-M8-54）。
  // 顧客が無いまま送り返すと、設定＞課金の「プランを選ぶ」を押してもホームへ戻るだけで
  // 何もできない行き止まりになるため、`/plans` は顧客がある契約者だけを送り返す。
  await query(`update profiles set stripe_customer_id = 'cus_e2e_plans_active' where id = $1`, [
    account.userId,
  ]);
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

  // キー登録不要のプランでも、APIキータブが行き止まりにならない（何が付くかが読める・T-M8-25）
  await page.goto("/app/settings?tab=api-keys");
  await expect(page.getByRole("heading", { name: /キー登録不要/ })).toBeVisible();
  await expect(page.getByText("生成枠")).toBeVisible();
  await page.goto("/app/settings?tab=billing");
  // `goto` の直後に `count()` を取ると描画前を見てしまうので、先に見出しを待つ。
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();

  // プラン管理の導線は**必ずどこかへ着く**（T-M8-29）。Stripeの顧客があれば「プランを変更」
  // 「解約する」の2つ（T-M8-31 でやりたいことを先に選ばせる形にした）、顧客が無ければ
  // 料金プランへのリンクに切り替える（T-M8-54）。
  const update = page.getByRole("button", { name: "プランを変更" });
  const cancel = page.getByRole("button", { name: "解約する" });
  const choose = page.getByRole("link", { name: "プランを選ぶ" });
  const routes = (await update.count()) + (await cancel.count()) + (await choose.count());
  expect(routes, "プラン管理の導線がある").toBeGreaterThan(0);
  if (await choose.count()) await expect(choose).toHaveAttribute("href", "/plans");
  // 顧客がある契約者なら、変更と解約の両方が出る
  if (!(await choose.count())) {
    await expect(update).toBeVisible();
    await expect(cancel).toBeVisible();
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

/**
 * プラン変更・解約の結果を**押す前に**読めること（T-M8-55）。
 *
 * 利用者からの質問「プラン変更を完了したらいつからプラン変更になりますか？支払いはどう変わりますか？」
 * が画面から読めなかった。金額と時期が変わる操作なので、Stripeへ移動する前に示す。
 * 文言はStripe側の設定（`setup-stripe-portal.mjs`）と1対1で対応する。
 */
test("プラン変更で何が起きるかを押す前に読める（T-M8-55）", async ({ accounts, page }) => {
  const account = await accounts.create("plan-effects");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_effects',
        current_period_end = '2026-08-12T00:00:00Z' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await expect(page.getByRole("button", { name: "プランを変更" })).toBeVisible();
  // 上位＝即時＋日割り、下位＝期間末（日付つき）、解約＝期間末まで使える
  await expect(page.getByText("すぐに切り替わります")).toBeVisible();
  await expect(page.getByText("差額は日割りで計算され", { exact: false })).toBeVisible();
  await expect(page.getByText("2026年8月12日に切り替わります")).toBeVisible();
  await expect(page.getByText("2026年8月12日まで使えて、その後停止します")).toBeVisible();
  // トライアル中は終了日が変わらないことを添える
  await expect(
    page.getByText("トライアルの終了日（2026年8月12日）は変わりません"),
  ).toBeVisible();

  // **Markdownの記号が画面に出ていない**（強調は要素で表す・実際に `**` が出た）
  await expect(page.getByText("**", { exact: false })).toHaveCount(0);

  // 解約予約済みなら、説明とボタンの両方が切り替わる（T-M8-57）。
  // 予約済みなのに「解約する」を出し続けると同じ操作を促すことになるため、
  // 取り消し（StripeのPortalトップにある「プランを続ける」）へ導線を替える。
  await query(`update profiles set cancel_at_period_end = true where id = $1`, [account.userId]);
  await page.reload();
  await expect(page.getByText("2026年8月12日に解約されます")).toBeVisible();
  await expect(page.getByText("2026年8月12日まで使えて、その後停止します")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解約する" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "解約予定を取り消す" })).toBeVisible();
  await expect(page.getByText("期間終了日に解約予定")).toBeVisible();
});
