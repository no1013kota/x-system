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
  // ログイン画面から新規登録へも行ける（初めての人の受け皿・行き止まりにしない）。
  await expect(page.getByRole("link", { name: "新規登録" })).toBeVisible();
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

  // 登録しただけでもアプリ本体へ入れる（以前は /plans へ弾かれていた）。
  await signIn(page, account);
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  await page.goto("/app/invite");
  await expect(page.getByRole("heading", { name: "友達招待" })).toBeVisible();
  // 招待リンクはアカウントが無ければその場で作られる（契約に依存しない）。
  await expect(page.getByText("/r/", { exact: false }).first()).toBeVisible();
});
