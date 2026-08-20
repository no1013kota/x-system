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

  // プランカードが plans.ts の価格・上限を実際に描画している（T-M8-171でカードへ変えた）。
  const pricing = page.locator("#pricing");
  await expect(pricing).toContainText("¥3,980");
  await expect(pricing).toContainText("AIクレジット1000");
  await expect(pricing.getByText(/1日あたり 約\d/).first()).toBeVisible();
  // プランごとの申込導線が3本あり、**無料で試せることが主文**になっている（T-M8-126）。
  const signupLinks = pricing.getByRole("link", { name: /7日間無料で試す/ });
  expect(await signupLinks.count()).toBeGreaterThanOrEqual(3);
  // 無料の条件（初回のみ・カード登録・解約すれば無料）を同じ場所で言う（景表法・要件03 §54）。
  await expect(pricing.getByText(/初回のみ7日間/).first()).toBeVisible();
  await expect(pricing.getByText("カード登録が必要", { exact: false }).first()).toBeVisible();
  // BYOK注記は折りたたみなしで最初から見えている
  // BYOKのAPI実費はスタンダードカードの「APIキーの用意」行が唯一の常時表示（T-M8-171）。
  await expect(pricing.getByText(/ご自身のAPI課金/).first()).toBeVisible();

  // FAQは**折りたたまない**（2026-08-20 運営者の指示）。質問と回答が最初から見えていること。
  // 質問文そのものではなく「自動投稿への不安に答えるFAQ」を探す（文言は磨かれ続けるため。
  // 文言そのものは landing-page.test.ts が担当する）。
  await expect(page.getByText(/投稿されませんか/)).toBeVisible();
  await expect(page.getByText("されません。", { exact: false })).toBeVisible();
  // クリックしないと読めない状態へ戻っていないこと（LPで最も読まれるべき内容を隠さない）。
  await expect(page.locator("details")).toHaveCount(0);

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

    /**
     * 6つの節がすべて描かれていること。**節の見出しラベル（01〜06＋名前）で見る**。
     *
     * 以前は各節の本文コピーを正規表現で当てていたため、**文言を整えるたびにこのテストが落ちた**
     * （2026-08-17、運営者が課題としくみの見出しを書き直してCIが赤くなった）。守りたいのは
     * 「JSが動かなくてもLPが白紙にならない」ことで、コピーの一致ではない。ラベルは節の識別子で、
     * コピー修正では変わらない。
     */
    for (const label of ["コンセプト", "できること", "しくみ", "初めかた", "料金", "よくある質問"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // 法定開示は文言そのものが要件なので、ここだけは literal を見る（消えたら落とす）。
    for (const pattern of [/無料トライアル/, /初回のみ/]) {
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

/**
 * リリース記念キャンペーンの見せ方（T-M8-118）。
 *
 * **取り消し線に「通常価格」と書かない。** 景品表示法の二重価格表示は、通常価格として示すなら
 * 実際にその価格で相当期間販売した実績が必要で、この3プランにその実績は無い（キャンペーン価格での
 * 販売のみ・T-M8-168）。将来価格として「キャンペーン終了後」と示す形を固定する。
 */
test("料金カードに半額バッジと終了後価格が出て、「通常価格」とは書かない（T-M8-118）", async ({
  page,
}) => {
  await page.goto("/");
  const pricing = page.locator("#pricing");

  // 全プランにバッジが出る（件数は固定しない。プランが増減しても意図は変わらない）。
  const badges = pricing.getByText("リリース記念 半額");
  await expect(badges.first()).toBeVisible();
  expect(await badges.count()).toBeGreaterThanOrEqual(3);

  // 請求額（大きい方）と終了後価格（取り消し線）が両方読める。
  await expect(pricing.getByText("3,980", { exact: false }).first()).toBeVisible();
  await expect(pricing.getByText("キャンペーン終了後", { exact: false }).first()).toBeVisible();
  await expect(pricing.locator(".line-through").filter({ hasText: "7,960" }).first()).toBeVisible();

  // 景表法: 「通常価格」の語を使わない。
  await expect(pricing.getByText("通常価格")).toHaveCount(0);
});
