import { expect, horizontalOverflow, test } from "./fixtures/test";

/**
 * SC-01 LP（T-M8-74, design_handoff_lp）。導線の実動作と出現演出をブラウザで確認する。
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

  // FAQはネイティブdetailsで開閉できる。
  // 回答の全文ではなく<details>の開閉状態を見る（文言を1文字直すたびにE2Eが落ちるのを避ける。
  // 文言そのものは landing-page.test.ts が担当する）。
  // 質問文そのものではなく「自動投稿への不安に答えるFAQ」を探す（文言は磨かれ続けるため）。
  const faq = page.locator("details").filter({ hasText: /投稿されませんか/ });
  await expect(faq).toHaveCount(1);
  await expect(faq).not.toHaveAttribute("open", /.*/);
  await faq.locator("summary").click();
  await expect(faq).toHaveAttribute("open", /.*/);
  await expect(faq.getByText("されません。", { exact: false })).toBeVisible();

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

/**
 * JSが1行も動かなくてもLPが読める（T-M8-76）。
 *
 * 以前は出現演出を IntersectionObserver で行っており、初期状態が `opacity:0` だったため、
 * **JSのロード失敗・CSPブロック・JS無効のいずれでもLPがヘッダーだけの白紙**になった。
 * LPは新規登録の唯一の入口なので、これは申込みが黙って0件になることを意味する。
 * サーバーは200を返しテストも緑だったので、運営者が気付く経路は無かった（CLAUDE.md 原則1）。
 * `javaScriptEnabled: false` はその状態を最も安く再現できる。
 */
test.describe("JSが動かない環境", () => {
  test.use({ javaScriptEnabled: false });

  test("LPの主要な内容とCTAがすべて読める（白紙にならない）", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "無料で始める" }).first()).toBeVisible();

    // **`toBeVisible()` では足りない。** Playwright は `opacity:0` の要素を可視と判定するため、
    // 旧実装（JSが解除するまで opacity:0）でも上の2行は通ってしまう。この不具合の本体は
    // 「そこにあるのに読めない」ことなので、**実際に計算された opacity** まで見る。
    // aria-hidden の装飾（ヒーローモックのクロスフェード）は読ませる情報ではないので除く。
    const unreadable = await page.locator("main *").evaluateAll((els) =>
      els
        .filter((el) => {
          if (el.closest('[aria-hidden="true"]')) return false;
          const text = (el.textContent || "").trim();
          if (!text) return false;
          const style = getComputedStyle(el);
          return Number(style.opacity) < 0.99 || style.visibility === "hidden";
        })
        .map((el) => (el.textContent || "").trim().slice(0, 30)),
    );
    expect(unreadable, "JS無効で読めない要素がLPにある").toEqual([]);

    // 検査が空振りしていないこと（要素が0個なら上のfilterは常に空になる）。
    expect(await page.locator("main *").count()).toBeGreaterThan(50);

    // 主要セクションの本文が実際に読める。文言ではなく「その節が出ていること」を見る。
    for (const pattern of [
      /こんな悩みはありませんか/, // 01 課題
      /4つの仕事を引き受けます/, // 02 できること
      /1周でまわります/, // 03 しくみ
      /始め方は4ステップ/, // 04 使い方
      /無料トライアル/, // 05 料金
      /初回のみ/, // 申込前確認事項（法定開示）
      /気になることは/, // 06 FAQ
    ]) {
      await expect(page.getByText(pattern).first()).toBeVisible();
    }
  });
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
