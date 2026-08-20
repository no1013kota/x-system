import { expect, signIn, test } from "./fixtures/test";

/**
 * 公開プロンプト集（T-M8-173）。実際に使うテンプレートの全文が公開され、
 * 「このプロンプトを利用する」が新規登録へつながることを見る。
 */
test("プロンプト集: 8件の全文と登録導線が出る", async ({ page }) => {
  await page.goto("/prompt-templates");
  await expect(page.getByRole("heading", { level: 1, name: "プロンプト集" })).toBeVisible();

  // アカウント.md＋投稿6種＋画像の8件。
  await expect(page.getByRole("article")).toHaveCount(8);
  for (const name of ["ニュース解説", "週次まとめ", "画像生成プロンプト"]) {
    await expect(page.getByRole("article", { name: new RegExp(name) })).toBeVisible();
  }
  // 本文が正本から実際に描画されている（PT-P1の書き出し）。
  await expect(page.getByText("# タスク").first()).toBeVisible();

  // 利用ボタンは新規登録へ。
  const use = page.getByRole("link", { name: "このプロンプトを利用する" });
  expect(await use.count()).toBe(8);
  await expect(use.first()).toHaveAttribute("href", "/signup");
});

test("導線: LPヘッダーとappナビからプロンプト集へ辿れる", async ({ accounts, page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "プロンプト集" }).click();
  await expect(page).toHaveURL(/\/prompt-templates/);

  const account = await accounts.create("pt-link");
  await signIn(page, account);
  await page.getByRole("navigation", { name: "メインナビゲーション" }).getByRole("link", { name: "プロンプト集" }).click();
  await expect(page).toHaveURL(/\/prompt-templates/);
});
