import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 公開プロンプト集（T-M8-173／T-M8-175）。公式テンプレートと利用者作成プロンプトが
 * タブ切り替え＋ワード検索で見られ、「このプロンプトを利用する」が新規登録へつながることを見る。
 */
test("プロンプト集: タブごとに公式＋利用者作成が並び、ワード検索で絞れる", async ({
  accounts,
  page,
}) => {
  // 利用者作成のプロンプトを用意（自作パターン＝seed_key null）。
  const account = await accounts.create("gallery-src", { personaReady: true });
  const patternName = `E2E独自型${randomUUID().slice(0, 6)}`;
  await query(
    `insert into post_patterns
       (x_account_id, name, description, prompt, max_posts, max_posts_edit, placeholders)
     values ($1, $2, 'E2E用の説明文', '# タスク\nE2E用の独自プロンプト本文。{お題}', 2, 4,
             '[{"name": "お題"}]'::jsonb)`,
    [account.xAccountId, patternName],
  );

  // 既定タブ＝アカウント.md。公式テンプレートと、利用者のアカウント.md（匿名）が出る。
  await page.goto("/prompt-templates");
  await expect(page.getByRole("heading", { level: 1, name: "プロンプト集" })).toBeVisible();
  // ヘッダーは「ホーム＋ブログ」への遷移ボタンだけ（T-M8-190。現在地のタブ表示は無い）。
  const contentNav = page.getByRole("navigation", { name: "公開コンテンツ" });
  await expect(contentNav.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/");
  await expect(contentNav.getByRole("link", { name: "ブログ" })).toHaveAttribute("href", "/blog");
  await expect(contentNav.getByRole("link", { name: "プロンプト集" })).toHaveCount(0);
  // 項目名はすべて「アカウント.md」（T-M8-182）。
  await expect(page.getByRole("article", { name: /アカウント\.md/ }).first()).toBeVisible();
  await expect(page.getByText("公式").first()).toBeVisible();

  // 投稿プロンプトタブ: 公式6種＋利用者作成の自作型（題名・説明・匿名バッジ）。
  await page.getByRole("link", { name: "投稿プロンプト" }).click();
  await expect(page.getByRole("article", { name: /ニュース解説/ })).toBeVisible();
  await expect(page.getByRole("article", { name: new RegExp(patternName) })).toBeVisible();
  await expect(page.getByText("E2E用の説明文")).toBeVisible();
  // 差し込み欄（プレースホルダー）が分かる（T-M8-178）。公式p2と利用者作成の両方。
  // プレースホルダーの入力体験（T-M8-182）: 入力すると本文の {名前} がその場で置き換わる。
  const p2Card = page.getByRole("article", { name: "自分の考え・意見" });
  const p2Input = p2Card.getByLabel("{自分の考え}");
  await expect(p2Input).toBeVisible();
  await p2Input.fill("AIで作業時間を半分にした話");
  await expect(p2Card.locator("mark", { hasText: "AIで作業時間を半分にした話" })).toBeVisible();
  // 利用者作成の型にも入力欄が付く。
  const customCard = page.getByRole("article", { name: new RegExp(patternName) });
  await customCard.getByLabel("{お題}").fill("週次ふりかえり");
  await expect(customCard.locator("mark", { hasText: "週次ふりかえり" })).toBeVisible();
  await expect(page.getByText("利用者作成").first()).toBeVisible();
  // 識別子（ハンドル・メール）は出さない。
  await expect(page.getByText(account.handle)).toHaveCount(0);

  // ワード検索: 題名で絞ると1件になり、消すと戻る。
  const search = page.getByRole("searchbox");
  await search.fill(patternName);
  await expect(page.getByRole("article")).toHaveCount(1);
  await search.fill("存在しないワードxyz");
  await expect(page.getByText("一致するプロンプトはありません")).toBeVisible();
  await search.fill("");
  expect(await page.getByRole("article").count()).toBeGreaterThanOrEqual(7);

  // 画像プロンプトタブ: 公式PT-IMG。
  await page.getByRole("link", { name: "画像プロンプト" }).click();
  await expect(page.getByRole("article", { name: /画像生成プロンプト/ }).first()).toBeVisible();

  // 利用ボタンは新規登録へ。
  await expect(
    page.getByRole("link", { name: "このプロンプトを利用する" }).first(),
  ).toHaveAttribute("href", "/signup");
});

test("導線: LPヘッダーとappナビからプロンプト集へ辿れる（遷移マーク付き）", async ({
  accounts,
  page,
}) => {
  await page.goto("/");
  // ページ遷移リンクにはマーク（open_in_newアイコン）が付く（T-M8-175）。
  const lpLink = page.getByRole("link", { name: "プロンプト集" });
  await expect(lpLink.locator("svg")).toBeVisible();
  await lpLink.click();
  await expect(page).toHaveURL(/\/prompt-templates/);

  const account = await accounts.create("pt-link");
  await signIn(page, account);
  const navLink = page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "プロンプト集" });
  // アイコン2つ（項目アイコン＋遷移マーク）が付く。
  expect(await navLink.locator("svg").count()).toBeGreaterThanOrEqual(2);
  await navLink.click();
  await expect(page).toHaveURL(/\/prompt-templates/);
});
