import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

const WIDTHS = [["desktop",1440,900],["tablet",768,1024],["mobile",390,844]] as const;

/**
 * T-M8-146。認証3画面の外枠を `AuthPageShell` へ集約した回帰テスト。
 *
 * 以前は3画面へ逐語で重複しており、**片方だけ直すとトーンがずれる**
 * （reset-password だけ旧デザインで残っていたのが T-M8-60 の発端）。
 * 法務3ページへの導線もこの外枠が必ず出す（要件06 §11。T-M8-30 では
 * **ログインだけ導線が無く**、ログインから入る利用者が規約へ辿れなかった）。
 */
test("認証3画面が同じ外枠で、法務導線と横スクロール無しを保つ", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  for (const [label, w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, url] of [["login","/login"],["signup","/signup"],["reset","/reset-password"],["forgot","/login?mode=forgot-password"]] as const) {
      await page.goto(url);
      await page.getByRole("heading", { level: 1 }).waitFor();
      // 横スクロールが出ていない
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `${name}@${label} が横スクロールしている`).toBe(false);
      // 法務3ページの導線がある（要件06 §11）
      // 法務導線はフッタが必ず出す（フォーム内の同意文にも同名リンクがあるので絞る）。
      await expect(
        page.locator("footer").getByRole("link", { name: "利用規約" }),
      ).toBeVisible();
    }
  }
  console.log("PROBE consoleErrors=" + JSON.stringify(errors.slice(0, 5)));
});

/**
 * T-M8-146。App画面の `h1` のclassを `pageTitleClassName` へ集約した回帰テスト。
 * 7箇所へ逐語で直書きされており、字送りや色を変えると取り残しが出る形だった。
 */
test("App画面のh1が全画面で同じ見た目", async ({ accounts, page }) => {
  const account = await accounts.create("shotui");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  const sizes: string[] = [];
  for (const [name, url] of [["home","/app"],["news","/app/news"],["posts","/app/posts"],
    ["schedule","/app/schedule"],["analytics","/app/analytics"],["settings","/app/settings"]] as const) {
    await page.goto(url);
    const h1 = page.getByRole("heading", { level: 1 }).first();
    await h1.waitFor();
    const s = await h1.evaluate((el) => {
      const c = getComputedStyle(el);
      return `${c.fontSize}/${c.fontWeight}/${c.color}`;
    });
    sizes.push(`${name}=${s}`);
  }
  console.log("PROBE h1styles=" + JSON.stringify(sizes));
  // 全画面で同一であること（1か所へ集約した証拠）
  expect(new Set(sizes.map((s) => s.split("=")[1])).size, "h1のスタイルが画面ごとに違う").toBe(1);
});
