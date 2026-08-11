import { expect, test } from "@playwright/test";

/**
 * OSをダークにしている閲覧者でも配色が変わらないこと（F11）。
 *
 * ダークモードは持たない（PRD §3.2）。`playwright.config.ts` は `colorScheme` を
 * 設定していない＝既定 light なので、**この経路はこれまで1度も検証されていなかった**。
 *
 * 守りたいのは `globals.css` の `@custom-variant dark (&:is(.dark *));` である。これは
 * Tailwind v4 の `dark` バリアント既定（`@media (prefers-color-scheme: dark)`）を
 * クラス方式へ上書きしており、`.dark` を付ける箇所が無いので `dark:*` は発火しない。
 * 消すと既定へ戻り、**OSダークの閲覧者だけ** `button.tsx` の outline/ghost/destructive の
 * 枠と背景が暗くなってライト配色の中で浮く。
 *
 * 画面上に outline ボタンが出ている状態を作るのは条件が多いので、`button.tsx` が使っている
 * のと同じユーティリティを持つ**検査用の要素を挿し込んで**、バリアントが発火するかを直接見る。
 * 画面の偶然（たまたまその画面にそのボタンがあるか）に依存させない。
 */

/** `button.tsx` の outline バリアントが実際に持つ `dark:` ユーティリティ。 */
const PROBE_CLASSES = "border-border bg-background dark:border-input dark:bg-input/30";

async function probeColors(page: import("@playwright/test").Page) {
  return page.evaluate((classes) => {
    const el = document.createElement("div");
    el.className = classes;
    el.setAttribute("data-dark-probe", "1");
    document.body.appendChild(el);
    const style = getComputedStyle(el);
    const out = {
      background: style.backgroundColor,
      border: style.borderTopColor,
      // ページ自体の地の色も見る（トークン側の取り違えを拾う）。
      body: getComputedStyle(document.body).backgroundColor,
    };
    el.remove();
    return out;
  }, PROBE_CLASSES);
}

test("OSがダークでも配色が変わらない（dark: バリアントが発火しない）", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const light = await probeColors(page);
  // 値が取れていること自体を確かめる（空だと比較が無意味になる）。
  expect(light.background, "検査用要素の背景色が取れていない").not.toBe("");
  expect(light.border).not.toBe("");

  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await probeColors(page);

  expect(
    dark,
    "OSダークで色が変わる＝@custom-variant dark が失われ prefers-color-scheme 既定へ戻っている",
  ).toEqual(light);
});
