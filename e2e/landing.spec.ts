import { expect, horizontalOverflow, test } from "./fixtures/test";

/**
 * SC-01 LP（T-M8-74, design_handoff_space_ai_lp）。導線の実動作と出現演出をブラウザで確認する。
 * 固定文言・禁止表現・plans.ts参照はソース検査（landing-page.test.ts）が守るので、ここでは
 * 「クリックすると実際にそこへ行く／見える」ことだけを見る。
 */

test("LPの導線: CTA・アンカー・プラン価格・FAQ・法務リンク", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { level: 1 })).toContainText("X運用の毎日を");

  // 会員登録・ログインへの導線（ヘッダー）
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "無料で始める" })).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(header.getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/login");

  // 副CTA「料金を見る」で #pricing まで実際にスクロールする
  await page.getByRole("link", { name: "料金を見る" }).click();
  await expect(page.locator("#pricing")).toBeInViewport();

  // プランカードが plans.ts の価格・上限を実際に描画している
  const pricing = page.locator("#pricing");
  await expect(pricing).toContainText("2,980円");
  await expect(pricing).toContainText("通常投稿200件");
  await expect(pricing.getByRole("link", { name: "無料で始める" })).toHaveCount(3);
  // BYOK注記は折りたたみなしで最初から見えている
  await expect(pricing.getByText("APIキーをご自身でご用意いただく方式")).toBeVisible();

  // FAQはネイティブdetailsで開閉できる
  const answer = page.getByText("されません。既定は「下書きまで」モードです。", { exact: false });
  await expect(answer).not.toBeVisible();
  await page.getByText("勝手に投稿されませんか？").click();
  await expect(answer).toBeVisible();

  // 法務3リンク（LegalFooterLinks）
  const footer = page.getByRole("contentinfo");
  for (const [href, name] of [
    ["/terms", "利用規約"],
    ["/privacy", "プライバシーポリシー"],
    ["/legal/commercial-transactions", "特定商取引法に基づく表記"],
  ] as const) {
    await expect(footer.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});

test("スクロールで要素が出現する（IntersectionObserver）", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const target = page.locator("#safety [data-reveal]").first();
  await target.scrollIntoViewIfNeeded();
  // 出現後は opacity が1になる（transition 650ms を待つ）
  await expect(target).toHaveCSS("opacity", "1");
});

test("reduced-motion では全要素が即時表示され、3幅で横に伸びない", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1180, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // スクロールしていないのに、ページ下部の要素も opacity:1（motion-reduce のCSSが効いている）
    const hidden = await page.$$eval(
      "[data-reveal]",
      (els) => els.filter((el) => getComputedStyle(el).opacity !== "1").length,
    );
    expect(hidden, `${width}px: 出現待ちで隠れたままの要素が無い`).toBe(0);

    expect(await horizontalOverflow(page), `${width}px で横に伸びない`).toBeLessThanOrEqual(0);
  }
});
