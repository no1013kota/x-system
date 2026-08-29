import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 運営ダッシュボード /admin（T-M8-373）。
 *
 * 守るのは2つ。
 * 1. **運営者以外には存在ごと隠れる**（404）。「権限がありません」を出すと
 *    管理画面のURLが当たりだと教えることになる。ここが崩れると全利用者の
 *    メール・原価・解約理由が見える——このスイートで最も落ちてはいけない検査。
 * 2. **運営者には数字が出る**。ゲートの向き（===）を逆に壊しても(1)は緑のままなので、
 *    通れる側も検査しないと「誰も見られない管理画面」に気付けない。
 */

test("運営者以外がログインして開いても404（存在を教えない）", async ({ accounts, page }) => {
  const account = await accounts.create("admin-outsider");
  await signIn(page, account);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("運営ダッシュボード")).toHaveCount(0);
});

test("未ログインはログイン画面へ送られる", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("運営者（SUPPORT_EMAILの利用者）にはKPIが表示される", async ({ accounts, page }) => {
  const operatorEmail = process.env.SUPPORT_EMAIL;
  expect(operatorEmail, "SUPPORT_EMAIL が .env に必要です（devサーバの起動条件でもある）").toBeTruthy();

  /*
    運営者メールの残骸が居ると auth.users unique で作成に失敗するため先に消す。
    ローカル・CIのテストDB専用の操作（本番の運営者を消す経路はここには無い——
    E2EのDB接続はローカルのSupabaseに固定されている）。
    `usage_events`／`usage_counters` は profiles を on delete **restrict** で参照する台帳なので
    先に消す（follower_snapshots のFKと同型・T-M8-364で踏んだ）。
  */
  await query(
    `delete from usage_events where user_id in (select id from auth.users where email = $1)`,
    [operatorEmail],
  );
  await query(
    `delete from usage_counters where user_id in (select id from auth.users where email = $1)`,
    [operatorEmail],
  );
  await query(`delete from auth.users where email = $1`, [operatorEmail]);
  const account = await accounts.create("admin-operator", { email: operatorEmail });
  await signIn(page, account);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "運営ダッシュボード" })).toBeVisible();
  // いまどの環境のデータかが出る（E2Eは常に development＝ローカル・T-M8-374）。
  const envNav = page.getByRole("navigation", { name: "環境の切替" });
  await expect(envNav.getByText("ローカル")).toBeVisible();
  // 他環境へは移動リンク（DBが分離されているため横断表示はしない）。
  await expect(envNav.getByRole("link", { name: "本番" })).toHaveAttribute(
    "href",
    "https://exosai.net/admin",
  );
  // サマリカード（MRR・原価・粗利）とファネルが出る。
  await expect(page.getByText("MRR（月間経常収益）")).toBeVisible();
  await expect(page.getByText("今月の粗利（MRR−原価）")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ファネル（いまいる利用者の到達段階）" }),
  ).toBeVisible();
  // ファネルには少なくとも自分（登録1人以上）が入る。
  const registered = page.getByRole("row").filter({ hasText: "登録" }).first();
  await expect(registered).toBeVisible();

  // 利用者一覧に自分（運営者）の行が代表データ付きで出る（T-M8-374）。
  await expect(
    page.getByRole("heading", { name: /利用者一覧/ }),
  ).toBeVisible();
  const myRow = page.getByRole("row").filter({ hasText: operatorEmail! });
  await expect(myRow.first()).toBeVisible();

  // ページがスマホ幅で横に溢れない（管理画面も外で見ることがある）。
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "横スクロールが出ないこと").toBeLessThanOrEqual(0);
});
