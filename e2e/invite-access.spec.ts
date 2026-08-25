import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 友達招待は契約前でも参加できる（T-M8-268・運営者の指示 2026-08-23）。
 *
 * 招待キャンペーンは「まだ使わないが紹介はしたい」人にも開いている必要がある。
 * ここは (1) LPからの入口 (2) 未ログインの行き先 (3) プラン未選択でも招待リンクが出ること、
 * の3点を守る（アクセス判定が契約状態で弾く形へ戻ると全部落ちる）。
 */

test("LPの招待タブは未ログインならログイン画面へ送り、ログイン後そのまま招待画面へ着く", async ({
  page,
}) => {
  await page.goto("/");
  // 見出しのCTA（モバイルでも見える本文セクション側）。
  await page
    .getByRole("link", { name: "招待リンクを受け取る" })
    .click();

  // 未ログインはログイン画面。戻り先が招待画面として保たれている。
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Finvite/);
  // ログイン画面から登録へも行ける（初めての人の受け皿・行き止まりにしない）。
  // 導線は1つだけ（T-M8-295で二重に出ていたのを解消した）。
  const signUpLink = page.getByRole("link", { name: "会員登録" });
  await expect(signUpLink).toHaveCount(1);
  // 登録後も招待画面へ戻れるよう next を引き継ぐ。
  await expect(signUpLink).toHaveAttribute("href", "/signup?next=%2Fapp%2Finvite");
});

test("プラン未選択（登録しただけ）でも招待画面で招待リンクを受け取れる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("invite-noplan");
  await query(
    `update profiles set plan = null, subscription_status = 'incomplete',
            current_period_end = null, trial_ends_at = null
      where id = $1`,
    [account.userId],
  );

  await signIn(page, account);
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  await page.goto("/app/invite");
  await expect(page.getByRole("heading", { name: "友達招待" })).toBeVisible();
  // 招待リンクはアカウントが無ければその場で作られる（契約に依存しない）。
  await expect(page.getByText("/r/", { exact: false }).first()).toBeVisible();
});

/**
 * プラン未登録では機能が使えない（T-M8-269・運営者の指示 2026-08-23）。
 *
 * **リダイレクトではなくその場でロックを見せる**（どこへ来たのか分かるまま理由を出す）。
 * 触れるのは友達招待と設定＞課金・プランだけ。ここが緩むと、費用の出る操作の入口が
 * 未契約者へ開く（実行はサーバー側で止まるが、押せてしまう時点で説明になっていない）。
 */
test("プラン未登録では機能画面と設定がロックされ、友達招待だけ使える（T-M8-269→T-M8-295）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plan-locked");
  await query(
    `update profiles set plan = null, subscription_status = 'incomplete',
            current_period_end = null, trial_ends_at = null
      where id = $1`,
    [account.userId],
  );
  await signIn(page, account);

  // ホームと機能画面はロック。理由と登録導線がその場に出る。
  for (const path of ["/app", "/app/news", "/app/posts", "/app/schedule", "/app/analytics"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    await expect(
      page.getByRole("heading", { name: "先にプランを登録してください" }),
      `${path} がロックされていない`,
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "プランを登録する" })).toBeVisible();
  }

  /*
    **設定は画面ごとロックする**（T-M8-295・運営者の指示 2026-08-25）。以前はタブを残して
    中身だけ差し替えていたが、一度も契約していない人には触れるものが無く、
    タブだけが並ぶ意味の無い画面だった。課金・プランのタブも出ない——登録の入口は
    このロック画面の「プランを登録する」（/plans）に1本化する。
  */
  for (const tab of ["general", "billing", "api-keys"]) {
    await page.goto(`/app/settings?tab=${tab}`);
    await expect(
      page.getByRole("heading", { name: "先にプランを登録してください" }),
      `設定(${tab}) がロックされていない`,
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "プランを登録する" })).toBeVisible();
  }
  // タブ自体が出ない（押せる先が無いのに並べない）。
  await expect(page.getByRole("link", { name: "課金・プラン" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Xアカウント", exact: true })).toHaveCount(0);

  // 友達招待はプラン未登録でも使える。
  await page.goto("/app/invite");
  await expect(page.getByRole("heading", { name: "友達招待" })).toBeVisible();
});

/**
 * 支払いが滞っている場合もロックする（T-M8-273・運営者の指示 2026-08-23）。
 *
 * **文言と導線がプラン未登録とは別**であることを固定する——プランはあるので
 * 「プランを登録してください」では直せない。行き先も /plans ではなく課金・プラン（Portal）。
 */
test("支払いが滞っている場合はロックし、お支払い情報の更新へ案内する（T-M8-273）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("payment-locked");
  await query(
    `update profiles set subscription_status = 'past_due', stripe_customer_id = 'cus_e2e_pastdue'
      where id = $1`,
    [account.userId],
  );
  await signIn(page, account);

  await page.goto("/app/posts");
  await expect(
    page.getByRole("heading", { name: "お支払い情報を更新してください" }),
  ).toBeVisible();
  // プラン登録の案内は出さない（プランはあるので直し方が違う）。
  await expect(page.getByRole("heading", { name: "先にプランを登録してください" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "お支払い情報を更新する" })).toHaveAttribute(
    "href",
    "/app/settings?tab=billing",
  );

  // 友達招待は支払いが滞っていても使える。
  await page.goto("/app/invite");
  await expect(page.getByRole("heading", { name: "友達招待" })).toBeVisible();

  // 課金・プランタブは開けて、支払い方法の更新へ行ける。
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();
});
