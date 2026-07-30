import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-10 AI設定のうち**ベースmd編集**と**学習ソース**（要件06 §9・§3.6、T-M7-26）。
 *
 * どちらも未カバーだった。学習ソースの分析（LRN）は実APIを叩くのでE2Eでは走らせず、
 * **画面とDBの状態遷移**だけを検証する（分析結果の中身は `npm run smoke:live` の範囲外でもあり、
 * ここでは扱わない）。ベースmd編集はAIを使わない操作なので最後まで通す。
 */

const VALID_BASE_MD = [
  "# 発信定義書（ベースmd）",
  "",
  "## 1. ペルソナ",
  "- 発信者: E2Eテスト用の発信者",
  "",
  "## 2. 発信テーマ",
  "- 主テーマ: テスト",
  "",
  "## 3. トーン&マナー",
  "- 文末: です・ます調",
  "",
  "## 4. やらないこと",
  "- テストに関係ない話はしない",
  "",
  "## 5. 文体・自分らしさ",
  "- よく使う語彙: 「確認します」",
  "",
  "## 6. 参考にする型",
  "- 伸びた投稿の型: 結論から書く",
  "",
].join("\n");

test("ベースmdを編集して保存でき、versionが上がって履歴に残る", async ({ accounts, page }) => {
  const account = await accounts.create("base-md");
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=base-md");

  const editor = page.getByLabel("ベースmd本文");
  await expect(editor).toBeVisible();

  const marker = `E2E-${randomUUID().slice(0, 8)}`;
  await editor.fill(VALID_BASE_MD.replace("テスト用の発信者", `テスト用の発信者 ${marker}`));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  // 保存できたことが画面で分かる（versionつき）
  await expect(page.getByText("保存しました", { exact: false })).toBeVisible({ timeout: 20_000 });

  // DBに反映され、versionが上がっている
  const [saved] = await query<{ base_md: string; version: number }>(
    `select base_md, base_md_version as version from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(saved.base_md, "編集内容が保存されていること").toContain(marker);
  expect(saved.version, "versionが上がること").toBeGreaterThan(1);

  // 変更履歴に残る（いつでも戻せる）
  const versions = await query<{ n: string }>(
    `select count(*)::text as n from base_md_versions where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(Number(versions[0].n), "履歴が作られること").toBeGreaterThan(0);
  // 見出しと説明文の2箇所に出るため見出しだけを見る。
  await expect(page.getByRole("heading", { name: "変更履歴" })).toBeVisible();
});

test("見出し構造が壊れた内容は保存されず、何を直せばよいか分かる", async ({ accounts, page }) => {
  const account = await accounts.create("base-md-invalid");
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=base-md");

  const editor = page.getByLabel("ベースmd本文");
  await expect(editor).toBeVisible();

  // 「## 3.」を落とした状態（6見出しが揃っていない）
  await editor.fill(VALID_BASE_MD.replace("## 3. トーン&マナー", "### 3. トーン&マナー"));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  // 何が悪いかが具体的に出る（「エラー」だけで終わらせない）
  await expect(page.getByText("見出し構造が不正です", { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // 保存されていない
  const [row] = await query<{ base_md: string; version: number }>(
    `select base_md, base_md_version as version from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(row.version, "失敗時はversionが上がらないこと").toBe(1);
  expect(row.base_md, "壊れた内容が保存されていないこと").not.toContain("### 3.");
});

test("学習ソースを追加すると分析中として並び、削除できる", async ({ accounts, page }) => {
  const account = await accounts.create("learning");
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=learning");

  await expect(page.getByRole("heading", { name: "参考ソースを追加" })).toBeVisible();

  // 追加（分析はAIを呼ぶため、ここでは受け付けられて pending になることだけを見る）
  const handle = `e2e_ref_${randomUUID().slice(0, 6)}`;
  await page.locator('input[type="url"], input[placeholder^="https://x.com"]').first().fill(
    `https://x.com/${handle}`,
  );
  await page.getByRole("button", { name: "追加", exact: true }).click();

  // DBに登録され、分析待ちになる
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(
            `select status::text as status from learning_sources
              where x_account_id = $1 and url like $2 and removed_at is null`,
            [account.xAccountId, `%${handle}%`],
          )
        )[0]?.status,
      { timeout: 20_000, message: "学習ソースが登録されること" },
    )
    .toBe("pending");

  // 画面にも「分析中」として出る（進行が分かる）
  await expect(page.getByText(handle, { exact: false })).toBeVisible();

  // 分析が終わった状態にしてから削除する（AIは呼ばない）
  await query(
    `update learning_sources set status = 'analyzed',
        analysis_summary = jsonb_build_object('style', 'テスト')
      where x_account_id = $1 and url like $2`,
    [account.xAccountId, `%${handle}%`],
  );
  await page.reload();

  // 削除は確認ダイアログを挟む（誤操作でベースmdの知見を失わないため）
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "削除", exact: true }).first().click();

  // 削除処理に入る（removing → 生成の一時停止案内が出る）
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(
            `select status::text as status from learning_sources
              where x_account_id = $1 and url like $2`,
            [account.xAccountId, `%${handle}%`],
          )
        )[0]?.status,
      { timeout: 20_000, message: "削除処理へ入ること" },
    )
    .not.toBe("analyzed");
});
