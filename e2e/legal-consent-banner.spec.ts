import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * T-M8-134（運営者の不具合報告・2026-08-18）。
 *
 * 規約の版が上がると `requireLegalConsent` が生成・投稿・スケジュール保存を全部止めるが、
 * **同意画面 `/app/consent` への導線がコード上どこにも無かった**。運営者はスケジュール保存で
 * 「利用規約等の更新内容をご確認ください。」とだけ言われ、打つ手が無い状態になった。
 *
 * ここで守る契約は「**止まっている理由と、直す場所が画面から辿れる**」（CLAUDE.md 原則2）。
 * ロジック単体は `app-banners.test.ts` が見るので、こちらは**導線が実際に繋がっていること**を見る。
 */
test("規約が更新されたら、常設バナーから同意画面へ行けて、同意すると消える", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("legal-consent-banner");
  // fixtureは現行版で同意済みにするので、**古い版に戻して**再同意が要る状態を作る。
  await query(
    `update profiles set terms_version = '2020-01-01', privacy_version = '2020-01-01' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  // 常設バナーが出ている。**止まっていることを本文で言う**（「確認してください」だけにしない）。
  const banner = page.getByRole("complementary", {
    name: "利用規約とプライバシーポリシーが更新されました",
  });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("スケジュールの保存は実行できません");

  // バナーから同意画面へ行ける（これが無かったのが不具合の本体）。
  await banner.getByRole("link", { name: "内容を確認する" }).click();
  await expect(page).toHaveURL(/\/app\/consent$/);

  // 同意すると `/app` へ戻り、バナーが消える。
  await page.getByRole("checkbox", { name: /利用規約/ }).check();
  await page.getByRole("checkbox", { name: /プライバシーポリシー/ }).check();
  await page.getByRole("button", { name: "同意して続ける" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("complementary", { name: /更新されました$/ }),
  ).toHaveCount(0);

  const [profile] = await query<{ terms_version: string }>(
    `select terms_version from profiles where id = $1`,
    [account.userId],
  );
  expect(profile.terms_version, "同意が記録されている").not.toBe("2020-01-01");
});

/**
 * **運営者が実際に踏んだ経路をそのまま再現する**（2026-08-18の報告）。
 * スケジュール保存が「利用規約等の更新内容をご確認ください。」だけで終わっていた。
 * 失敗の知らせに**どこへ行けば直るか**が入り、同じ画面に同意への導線があること。
 */
test("スケジュール保存が同意で止まるとき、直す場所が画面に出ている", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("legal-consent-schedule");
  await query(
    `update profiles set terms_version = '2020-01-01', privacy_version = '2020-01-01' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/schedule");

  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await page.getByRole("radio", { name: /ニュース解説/ }).first().check();
  await page.getByRole("checkbox", { name: "月", exact: true }).check();
  await page.getByLabel("テーマ").selectOption("other");
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 失敗の知らせが**行き先を言う**（以前は「ご確認ください」で終わっていた）。
  await expect(page.getByText("画面上部の案内から同意してください")).toBeVisible();
  // その行き先が同じ画面にある。
  await expect(
    page
      .getByRole("complementary", { name: /更新されました$/ })
      .getByRole("link", { name: "内容を確認する" }),
  ).toBeVisible();
});

/**
 * **同意が済んでいる利用者にバナーを出さない。** 常設バナーは目立つ場所を占めるので、
 * 誤検知すると「読んでも消えない警告」になって以後まるごと無視されるようになる。
 */
test("同意済みなら再同意バナーは出ない", async ({ accounts, page }) => {
  const account = await accounts.create("legal-consent-ok");
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  await expect(page.getByRole("radio", { name: /ニュース解説/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: /更新されました$/ })).toHaveCount(0);
});
