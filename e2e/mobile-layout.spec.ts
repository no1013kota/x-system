import { expect, horizontalOverflow, signIn, test } from "./fixtures/test";

/**
 * スマホ幅で画面が横に伸びないこと（T-M7-26）。
 *
 * 2026-07-31、`/plans` の比較表が390px幅で**ページ全体を183px横スクロールさせていた**。表は
 * `overflow-x-auto` の中にあり一見正しいが、セルの `sr-only`（`position: absolute`）に位置指定された
 * 先祖が無く、包含ブロックが初期包含ブロックになるためスクロール容器にクリップされていなかった。
 *
 * 単体テストでも既存のE2Eでも出ない（レイアウトはブラウザでしか計算されず、要素を個別に見ても
 * 各要素は画面内に収まっている）。**運営者がスマホで開いて初めて気づく**種類なので、
 * 主要画面をまとめて機械で見張る。
 */

const WIDTH = 390; // iPhone 14/15 相当（実利用で最も狭いあたり）

test("ログイン後の主要画面が横に伸びない（390px）", async ({ accounts, page }) => {
  const account = await accounts.create("mobile");
  await signIn(page, account);
  await page.setViewportSize({ width: WIDTH, height: 844 });

  for (const path of [
    "/app",
    "/app/posts",
    "/app/news",
    "/app/schedule",
    "/app/analytics",
    "/app/ai-settings",
    "/app/settings",
  ]) {
    await page.goto(path);
    // 主要な中身が出てからでないと、描画途中の幅を測ってしまう。
    await expect(page.getByRole("main")).toBeVisible();
    expect(await horizontalOverflow(page), `${path} が横に伸びないこと`).toBeLessThanOrEqual(0);
  }
});

test("未ログインで見える画面が横に伸びない（390px）", async ({ page }) => {
  await page.setViewportSize({ width: WIDTH, height: 844 });

  for (const path of [
    "/",
    "/login",
    "/signup",
    "/reset-password",
    // このspecを生んだ当の画面（比較表が183px横スクロールしていた）。巡回から漏れていた。
    "/plans",
    "/terms",
    "/privacy",
    "/legal/commercial-transactions",
  ]) {
    // Turnstileが通信を続けるため `networkidle` は待たない（永久に落ち着かない）。
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    expect(await horizontalOverflow(page), `${path} が横に伸びないこと`).toBeLessThanOrEqual(0);
  }
});

/**
 * 入力欄のfont-sizeがモバイル幅で16px以上あること（T-M8-70）。
 *
 * iOS Safariは**font-size<16pxの入力欄にフォーカスすると画面を自動ズーム**し、閉じても拡大が
 * 残る。以前は38箇所中37箇所が13〜14pxで、スマホでは入力のたびにズーム→手で戻す状態だった。
 * 対策は globals.css の無層メディアクエリ1本（個別クラスでは付け忘れが出る）。ここでは
 * 入力欄が多い代表2画面で、実際に計算されたfont-sizeを機械で確かめる。
 */
test("モバイル幅では入力欄のfont-sizeが16px以上（iOSズーム防止）", async ({ accounts, page }) => {
  const account = await accounts.create("mobile-input", { personaReady: true });
  await signIn(page, account);
  await page.setViewportSize({ width: WIDTH, height: 844 });

  for (const path of ["/app/posts?tab=create", "/app/settings?tab=notifications"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    const small = await page.$$eval(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea',
      (els) =>
        els
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => `${el.tagName}#${el.id || el.getAttribute("aria-label") || "?"}`),
    );
    expect(small, `${path} に16px未満の入力欄が無いこと`).toEqual([]);
  }
});
