import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * T-M8-134（運営者の指摘・2026-08-18）。
 *
 * 1. **削除は各パターンのカードの中に置く。** 以前は「選んでいる型」を消す独立ボタンが
 *    リストの下にあり、消したいものを一度選んでから下のボタンを探す必要があった。
 * 2. **確認ダイアログの暗幕がヘッダーまで覆う。** 暗幕に `z-index` が無く、
 *    `sticky z-20` のヘッダーが上に残って**ヘッダーだけ明るいまま**だった。
 *    これはブラウザで実際に重なりを測らないと分からない（要素の存在検査では通ってしまう）。
 */
test("投稿作成: 削除は各カードの中にあり、確認の暗幕がヘッダーまで覆う", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("pattern-card-delete");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  // 既定6件が並び、**それぞれのカードに**削除がある（選択しなくても押せる）。
  const newsCard = page.getByRole("button", { name: "「ニュース解説」を削除" });
  const opinionCard = page.getByRole("button", { name: "「自分の考え・意見」を削除" });
  await expect(newsCard).toBeVisible();
  await expect(opinionCard).toBeVisible();

  // 削除ボタンはカードの内側にある（枠からはみ出していない）。
  const cardBox = await page
    .locator("label", { has: page.getByRole("radio", { name: /ニュース解説/ }) })
    .boundingBox();
  const buttonBox = await newsCard.boundingBox();
  expect(cardBox, "パターンのカードが見つからない").not.toBeNull();
  expect(buttonBox, "削除ボタンが見つからない").not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(cardBox!.y);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);

  /*
    **押しても選択は動かない**（label の中にボタンを入れると、消す直前に選択が移る）。
    ダイアログが開くと背面は `aria-hidden` になり `getByRole` から消えるので、
    ここは素のCSSで拾う（役割で探すと「見つからない」で落ちる）。
  */
  const checked = page.locator('input[name="pattern"]:checked');
  const before = await checked.getAttribute("value");
  await newsCard.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await checked.getAttribute("value")).toBe(before);

  /*
    暗幕がヘッダーを覆っているかを**実際の重なりで**確かめる。
    ヘッダーの中心にある点を拾い、そこに居る一番上の要素が暗幕であること。
    z-index を戻すとヘッダー側が拾われて落ちる。
  */
  const headerBox = await page.locator("header").first().boundingBox();
  expect(headerBox, "ヘッダーが見つからない").not.toBeNull();
  const covered = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const style = el ? getComputedStyle(el) : null;
      return {
        tag: el?.tagName ?? null,
        position: style?.position ?? null,
        background: style?.backgroundColor ?? null,
      };
    },
    { x: headerBox!.x + headerBox!.width / 2, y: headerBox!.y + headerBox!.height / 2 },
  );
  // ヘッダー(`<header>`)ではなく暗幕(fixed の div)が最前面に来ている。
  expect(covered.tag, "ヘッダーが暗幕より前面に残っている").not.toBe("HEADER");
  expect(covered.position).toBe("fixed");
  // 黒の半透明であること。Tailwind v4 は `oklab(0 0 0 / 0.55)` を出すので色空間を決め打ちしない。
  expect(covered.background, "暗幕が透明で暗くなっていない").toMatch(
    /^(rgba?\(0, ?0, ?0|oklab\(0 0 0)/,
  );
  expect(covered.background, "暗幕のalphaが0（見た目が変わらない）").not.toMatch(/\/ 0\)|, 0\)$/);

  // 実際に消せる（確認 → 一覧から消える）。
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("radio", { name: /ニュース解説/ })).toHaveCount(0);
  await expect(newsCard).toHaveCount(0);

  const rows = await query<{ name: string }>(
    `select name from post_patterns where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(rows.map((r) => r.name)).not.toContain("ニュース解説");
});

/**
 * **スケジュール画面には削除を出さない**（T-M8-134）。
 * 予約を組み立てている最中にその型を消せると、いま編集中の枠の足元が崩れる。
 */
test("スケジュール: パターンのカードに削除は出ない", async ({ accounts, page }) => {
  const account = await accounts.create("pattern-card-no-delete");
  await signIn(page, account);
  await page.goto("/app/schedule");

  // パターンの選択肢は追加フォームを開くと出る。
  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await expect(page.getByRole("radio", { name: /ニュース解説/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /」を削除$/ })).toHaveCount(0);
});
