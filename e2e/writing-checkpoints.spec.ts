import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * 書き方のチェックポイント（T-M8-447・運営者の指示 2026-09-06）。
 *
 * プロンプト＞アカウント.md の画面でチェックを入れると、生成が読む列（`x_accounts.writing_checkpoints`）に
 * その条項の ID が入り、外すと消えること。画面の見た目と生成が読む場所が一致していることを守る（原則1）。
 */
test("アカウント.md 画面のチェックを切り替えると、生成が読む選択がそのまま保存される", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("checkpoints", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/prompts?sec=account-md");

  const heading = page.getByRole("heading", {
    name: "書き方のチェックポイント",
  });
  await expect(heading).toBeVisible();

  // 最初は何も選んでいない。
  expect(
    await query<{ ids: unknown }>(
      `select writing_checkpoints as ids from x_accounts where id = $1`,
      [account.xAccountId],
    ),
  ).toEqual([{ ids: [] }]);

  const first = page.locator('input[name^="checkpoint-ai-"]').first();
  const firstId = (await first.getAttribute("name"))!.replace(
    "checkpoint-",
    "",
  );
  await first.check({ force: true });
  await expect(
    toastIn(page).getByText("チェックポイントを保存しました"),
  ).toBeVisible({ timeout: 20_000 });
  expect(
    await query<{ ids: unknown }>(
      `select writing_checkpoints as ids from x_accounts where id = $1`,
      [account.xAccountId],
    ),
  ).toEqual([{ ids: [firstId] }]);

  // 再読み込みしても保たれる（保存が DB に届いている）。
  await page.reload();
  await expect(
    page.locator(`input[name="checkpoint-${firstId}"]`),
  ).toBeChecked();

  await page
    .locator(`input[name="checkpoint-${firstId}"]`)
    .uncheck({ force: true });
  await expect(
    toastIn(page).getByText("チェックポイントを保存しました"),
  ).toBeVisible({ timeout: 20_000 });
  expect(
    await query<{ ids: unknown }>(
      `select writing_checkpoints as ids from x_accounts where id = $1`,
      [account.xAccountId],
    ),
  ).toEqual([{ ids: [] }]);
});
