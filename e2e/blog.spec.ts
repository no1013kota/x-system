import { listPublishedPosts } from "@/lib/blog/blog-files";

import { expect, horizontalOverflow, signIn, test } from "./fixtures/test";

/**
 * 公開ブログ（T-M8-184）。記事はリポジトリの `blog/*.md` なので、**いま公開されている記事を
 * 画面と同じ関数で数え**、一覧→記事本文→導線を実ブラウザで見る。記事0件なら「準備中」を確認する
 * （どちらの状態でも緑になる＝記事の増減で壊れない）。
 */
test("ブログ: 一覧→記事本文（Markdownの描画）→一覧へ戻る", async ({ page }) => {
  const posts = listPublishedPosts();

  await page.goto("/blog");
  await expect(page.getByRole("heading", { level: 1, name: "ブログ" })).toBeVisible();
  // ヘッダーは「ホーム＋もう片方」への遷移ボタンだけ（T-M8-190/199。ブランド表記・現在地タブは無い）。
  const contentNav = page.getByRole("navigation", { name: "公開コンテンツ" });
  await expect(contentNav.getByRole("link", { name: "ホーム" })).toHaveAttribute("href", "/");
  await expect(contentNav.getByRole("link", { name: "プロンプト集" })).toHaveAttribute(
    "href",
    "/prompt-templates",
  );
  await expect(contentNav.getByRole("link", { name: "ブログ" })).toHaveCount(0);
  await expect(page.locator("header").getByText("Exos AI", { exact: true })).toHaveCount(0);

  if (posts.length === 0) {
    await expect(page.getByText("準備中です")).toBeVisible();
    return;
  }

  // 一覧は新しい順。先頭の記事カードに題名・要約・日付が出る。
  const [first] = posts;
  const card = page.getByRole("article", { name: first.title });
  await expect(card).toBeVisible();
  await expect(card.getByText(first.description)).toBeVisible();
  await expect(card.locator(`time[datetime="${first.date}"]`)).toBeVisible();
  const titles = await page.getByRole("article").getByRole("heading", { level: 2 }).allTextContents();
  expect(titles).toEqual(posts.map((post) => post.title));

  // 記事本文。front matter の title が h1、本文の ## が h2 として描かれる。
  await card.getByRole("link", { name: first.title }).click();
  await expect(page).toHaveURL(new RegExp(`/blog/${first.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: first.title })).toBeVisible();
  // 本文の `## 見出し` がすべて h2 になる。コードブロック内の `##` は除き、見出し内の
  // 強調・コード・リンク記法は描画後の文字に合わせて外す。
  const sectionHeadings = [
    ...first.body.replace(/```[\s\S]*?```/g, "").matchAll(/^##\s+(.+?)\s*#*\s*$/gm),
  ].map((m) =>
    m[1]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim(),
  );
  for (const heading of sectionHeadings) {
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
  }
  expect(await horizontalOverflow(page), "記事本文がページを横に伸ばしている").toBe(0);
  // 記事末尾のCTAと戻り導線。
  await expect(page.getByRole("link", { name: "無料で始める" }).last()).toHaveAttribute(
    "href",
    "/signup",
  );
  await page.getByRole("link", { name: "ブログ一覧へ" }).click();
  await expect(page).toHaveURL(/\/blog$/);
});

test("ブログ: 存在しないslugは404、モバイル幅でも横に伸びない", async ({ page }) => {
  const response = await page.goto("/blog/this-article-does-not-exist");
  expect(response?.status()).toBe(404);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/blog");
  await expect(page.getByRole("heading", { level: 1, name: "ブログ" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
  const [first] = listPublishedPosts();
  if (first) {
    await page.goto(`/blog/${first.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: first.title })).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  }
});

test("導線: LPヘッダーとappナビからブログへ辿れる（遷移マーク付き）", async ({ accounts, page }) => {
  await page.goto("/");
  // 新LP（T-M8-420）はヘッダーとフッターの両方に同じリンクがあるので、ヘッダー側を見る。
  const lpLink = page.getByRole("banner").getByRole("link", { name: "ブログ" });
  await expect(lpLink.locator("svg")).toBeVisible();
  await lpLink.click();
  await expect(page).toHaveURL(/\/blog$/);

  const account = await accounts.create("blog-link");
  await signIn(page, account);
  const navLink = page
    .getByRole("navigation", { name: "メインナビゲーション" })
    .getByRole("link", { name: "ブログ" });
  expect(await navLink.locator("svg").count()).toBeGreaterThanOrEqual(2);
  await navLink.click();
  await expect(page).toHaveURL(/\/blog$/);
});
