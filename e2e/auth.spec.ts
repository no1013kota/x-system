import { randomUUID } from "node:crypto";

import { createUnconfirmedAuthUser, destroyUserByEmail, query } from "./fixtures/account";
import {
  alertIn,
  expect,
  signIn,
  test,
  openAccountMenu,
} from "./fixtures/test";

/**
 * A-1/A-2 サインアップ→ログイン（PRD §A、要件03 §1、要件06 SC-01/SC-02）。
 *
 * メール確認（6桁コード）はT-M8-202で省略中（登録即ログイン）。コード画面・自動再送の経路は
 * 「未確認アカウントのログイン」テストが未確認ユーザー（Admin APIで作成）経由で守り続ける。
 * Turnstile・同意チェック・確認後の遷移先が絡む全利用者の最初の経路。
 *
 * メールはローカルのMailpit（`supabase start` が起動）が受け取り、外部へは送信されない。
 */

test("サインアップは確認コードなしで完了し、そのままアプリへ着地する（T-M8-202→T-M8-268）", async ({ page }) => {
  const suffix = `signup-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;
  const turnstileErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("Turnstile")) turnstileErrors.push(error.message);
  });

  try {
    await page.goto("/signup");
    await page.locator('input[name="email"]:not([type="hidden"])').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_confirmation"]').fill(password);
    await page.locator('input[name="terms_accepted"]').check();
    await page.locator('input[name="privacy_acknowledged"]').check();

    // Turnstileのテストキーがtokenを入れるまで待つ（空のまま送ると検証エラー）。
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), {
        timeout: 30_000,
        message: "Turnstileのトークンが入らない",
      })
      .not.toBe("");
    await page.getByRole("button", { name: "メールアドレスで登録" }).click();

    /*
      メール確認は省略（T-M8-202・運営者の決定 2026-08-22）。登録と同時にセッションが張られ、
      **そのままアプリ本体へ着地し、成功の文言が出る**（T-M8-268で行き先を /plans から /app へ。
      いきなり料金表へ送らず、中を見てもらってから実行時にプランへ案内する）。
      確認コード画面には入らない。
      （戻す場合の挙動は supabase/config.toml と scripts/auth-settings.mjs のコメント参照。
      コード検証・再送のUIは次のテストが未確認ユーザー経由で引き続き検証している。）
    */
    await expect(page).toHaveURL(/\/app(\/|$|\?)/, { timeout: 30_000 });
    await expect(page.getByText("登録が完了しました", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toHaveCount(0);
    expect(turnstileErrors, "Turnstileの設定エラーが発生しないこと").toEqual([]);

    // 登録と同時にconfirmedになっている。
    const [created] = await query<{ confirmed_at: string | null }>(
      `select email_confirmed_at as confirmed_at from auth.users where email = $1`,
      [email],
    );
    expect(created.confirmed_at, "登録と同時にemail_confirmed_atが入ること").not.toBeNull();

    // 同意は profiles に記録されている（要件03 §1）
    const [profile] = await query<{ terms_version: string | null }>(
      `select terms_version from profiles where email = $1`,
      [email],
    );
    expect(profile?.terms_version, "利用規約バージョンが記録されること").toBeTruthy();

    // 未契約は /plans に留められる（App Shellのヘッダへ到達できない）ので、
    // この画面のログアウトから抜けられること（PRD A-2・T-M7-19）。
    // ヘッダー廃止でアカウントメニューの中へ移った（T-M8-328）。
    await openAccountMenu(page);
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login/);
    // sessionが破棄されており、保護routeへ戻れない
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await expect
      .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.locator('button[type="submit"]').click();
    // 未契約でもアプリ本体へ入る（T-M8-268。実行しようとしたときにプランへ案内する）。
    await expect(page).toHaveURL(/\/app(\/|$|\?)/);

    // 直接開いても弾かれない（閲覧は契約状態で止めない）。
    await page.goto("/app/posts?tab=drafts");
    await expect(page).toHaveURL(/\/app\/posts/);
  } finally {
    await destroyUserByEmail(email);
  }
});

/**
 * **ログインでは登録の有無を明かす**（T-M8-295・運営者の指示 2026-08-25。それ以前は逆だった）。
 *
 * 元は列挙対策で有無を伏せていたが、登録していない人が「入力内容を確認してください」を見て
 * 正しいパスワードを探し続ける状態になっていた（運営者が実際に踏んだ）。判断の材料:
 * - **新規登録は既に「登録済み」を明かしている**（T-M8-149）ので、ログインだけ伏せても分かる
 * - ログインは Turnstile の通過が必須で、総当たりの列挙は難しい
 * - **パスワード再設定は従来どおり伏せる**（メールを送る経路なので、存在確認と同時に
 *   第三者へメールを送りつける手段になり得る。`password-reset.spec.ts` が固定している）
 * 伏せる方へ戻すときは、この3点をまとめて見直すこと。
 */
test("未登録のメールでは登録が無いと伝え、新規登録へ案内する", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(`e2e-nobody-${randomUUID().slice(0, 8)}@example.com`);
  await page.locator('input[type="password"]').fill("Wrong-Password-1");
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
    .not.toBe("");
  await page.locator('button[type="submit"]').click();

  // /app へは入れない
  await expect(page).not.toHaveURL(/\/app(\/|$)/);
  const alert = alertIn(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("登録されていません");
});

test("未確認アカウントでもコード画面なしでログインできる（登録時に確認を求めないため）", async ({
  page,
}) => {
  const suffix = `unconfirmed-login-${randomUUID().slice(0, 8)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = `E2e-${suffix}-Pw1`;

  try {
    /*
      未確認アカウントをAdmin APIで作る（T-M8-202以降、画面からの登録は即confirmedになる）。
      **以前はこの経路が6桁コード画面へ回されていた**（T-M8-377・運営者の指摘 2026-08-30）。
      新規登録は確認なしで完了する設定なので、ログインでも確認を求めない——
      ログイン時にその場で確認済みへ揃え、そのままアプリへ入れることを守る。
    */
    await createUnconfirmedAuthUser(email, password);

    await page.goto("/login");
    const loginForm = page.getByTestId("login-form");
    await loginForm.locator('input[type="email"]').fill(email);
    await loginForm.locator('input[type="password"]').fill(password);
    await expect
      .poll(() => loginForm.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
      .not.toBe("");
    await page.getByTestId("login-submit").click();

    // コード画面を出さず、契約なしの着地（/plans）かアプリ本体へ入る。
    await expect(page).toHaveURL(/\/(app|plans)(\/|$|\?)/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "確認コードを入力してください" })).toHaveCount(0);

    // DB上も確認済みへ揃っている（次回以降のログインで同じ分岐を通らない）。
    const rows = await query<{ confirmed: boolean }>(
      `select email_confirmed_at is not null as confirmed from auth.users where email = $1`,
      [email],
    );
    expect(rows[0]?.confirmed).toBe(true);
  } finally {
    await destroyUserByEmail(email);
  }
});

test("アプリ内のどの画面からでもアカウントメニューのログアウトで抜けられる", async ({ accounts, page }) => {
  const account = await accounts.create("signout");
  await signIn(page, account);

  // ホーム以外の画面からでも到達できる（ヘッダはApp Shell共通・要件06 §2）
  await page.goto("/app/posts?tab=drafts");
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);

  // session破棄後は保護routeへ戻れない（要件03 §1）
  await page.goto("/app/posts");
  await expect(page).toHaveURL(/\/login/);
});

/**
 * 登録済みのメールで再登録したとき、原因が分かること（T-M8-127）。
 *
 * 以前は「登録を完了できませんでした。入力内容を確認し、時間をおいて再度お試しください。」
 * だけが出ていた。**登録済みは待っても直らない**ので、この文言は嘘であり、利用者は同じ操作を
 * 繰り返す。Supabaseは確認済みメールに対して 422 `user_already_exists` を返すので、
 * それを言い分ける（2026-08-18にローカルで実応答を確認）。
 */
test("登録済みのメールで再登録すると、そう分かってログインへ行ける（T-M8-127）", async ({
  accounts,
  page,
}) => {
  // fixtureの利用者は確認済みで作られる（＝運営者が踏んだ状態と同じ）。
  const account = await accounts.create("dup-signup");

  await page.goto("/signup");
  await page.locator('input[name="email"]:not([type="hidden"])').fill(account.email);
  await page.locator('input[name="password"]').fill(`Dup-${randomUUID().slice(0, 8)}-Pw1`);
  await page
    .locator('input[name="password_confirmation"]')
    .fill(await page.locator('input[name="password"]').inputValue());
  await page.locator('input[name="terms_accepted"]').check();
  await page.locator('input[name="privacy_acknowledged"]').check();
  await expect
    .poll(() => page.locator('input[name="captcha_token"]').inputValue(), { timeout: 30_000 })
    .not.toBe("");
  await page.getByRole("button", { name: "メールアドレスで登録" }).click();

  const notice = alertIn(page);
  await expect(notice.getByText("既に登録されています", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  // 待っても直らないので「時間をおいて」と言わない。
  await expect(notice.getByText("時間をおいて", { exact: false })).toHaveCount(0);
  // 行き止まりにしない。
  await expect(notice.getByRole("link", { name: "ログイン画面へ" })).toBeVisible();
});
