import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * プロンプトを複数持って使う1つを選ぶ（T-M8-332・運営者の指示 2026-08-27）。
 *
 * **画面で「使用中」と出ているものが、生成が実際に読む場所と同じ中身であること**を、
 * 画面操作 → DB の順で通しで見る。ここが崩れると、画面には新しい文章が出ているのに
 * 生成は古い文章で動き続ける（原則1）。
 */
test("画像プロンプトを追加して使用中を切り替えると、生成が読む上書きが入れ替わる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("preset-image");
  await signIn(page, account);
  await page.goto("/app/prompts?sec=image-prompt");

  // 最初は「いま効いている内容」が使用中の1件として並ぶ。
  await expect(page.getByText("使用中", { exact: true })).toBeVisible();

  const marker = `E2E-${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "プロンプトを追加" }).click();
  await page.locator("#new-preset-name").fill("写実寄り");
  await page.locator("#new-preset-content").fill(`写実的な写真として描写する。${marker}`);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(toastIn(page).getByText("を追加しました")).toBeVisible({ timeout: 20_000 });

  // **追加しただけでは切り替わらない**（押した覚えのない切り替えを起こさない）。
  expect(
    await query<{ n: string }>(
      `select count(*)::text n from prompt_templates where x_account_id = $1 and kind = 'image'`,
      [account.xAccountId],
    ),
  ).toEqual([{ n: "0" }]);

  await page.getByRole("button", { name: "使用中にする" }).click();
  await expect(toastIn(page).getByText("を使用中にしました")).toBeVisible({ timeout: 20_000 });

  const [override] = await query<{ content: string }>(
    `select content from prompt_templates where x_account_id = $1 and kind = 'image'`,
    [account.xAccountId],
  );
  expect(override?.content, "使用中にしたのに生成が読む上書きが入っていない").toContain(marker);
});

/** 6見出しの正しい形（保存できる最小の本文）。 */
function validBaseMd(marker: string): string {
  return [
    "# 発信定義書（アカウント.md）",
    "",
    `## 1. 発信者\n${marker} の発信者`,
    "",
    "## 2. 対象読者\nテスト読者",
    "",
    "## 3. トーン&マナー\nていねい",
    "",
    "## 4. 発信テーマ\nAI",
    "",
    "## 5. 実績・知見\nなし",
    "",
    "## 6. NG事項\nなし",
    "",
  ].join("\n");
}

test("アカウント.mdは複数持てて、使用中の1件だけが生成に使われる", async ({ accounts, page }) => {
  const account = await accounts.create("preset-base-md");
  await signIn(page, account);
  await page.goto("/app/prompts?sec=account-md");

  const inUseBody = page.getByLabel("アカウント.mdの本文");
  await expect(inUseBody).toBeVisible();
  await expect(inUseBody).toBeVisible();
  const marker = `E2E-${randomUUID().slice(0, 8)}`;

  await page.getByRole("button", { name: "プロンプトを追加" }).click();
  await page.locator("#new-preset-name").fill("別人格");
  // 見出しが揃っていない本文は受け付けない（何を直せばよいかが画面に出る）。
  await page.locator("#new-preset-content").fill(`# 発信定義書\n${marker} だけの本文`);
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("見出しの形が合っていません", { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // 正しい形なら追加できる。
  await page.locator("#new-preset-content").fill(validBaseMd(marker));
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(toastIn(page).getByText("を追加しました")).toBeVisible({ timeout: 20_000 });

  const [before] = await query<{ base_md: string }>(
    `select base_md from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(before.base_md, "追加しただけで生成が変わってはいけない").not.toContain(marker);

  await page.getByRole("button", { name: "使用中にする" }).click();
  await expect(toastIn(page).getByText("を使用中にしました")).toBeVisible({ timeout: 20_000 });

  const [after] = await query<{ base_md: string; base_md_version: number }>(
    `select base_md, base_md_version from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(after.base_md, "使用中にしたのに生成が読む本文が古いまま").toContain(marker);
  // 切り替えも版として残るので、いつでも戻せる。
  expect(after.base_md_version).toBeGreaterThan(1);
});
