import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * T-M8-129 U4b。設定＞プロンプト＞投稿作成プロンプト＝**パターン管理**。
 * プルダウンをやめて全件並べ、追加・編集・削除ができることを実ブラウザで確かめる。
 */
test("パターン管理: 全件が並び、追加・編集・削除ができる", async ({ accounts, page }) => {
  const account = await accounts.create("pattern-manage");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=prompts&sec=post-prompt");

  // **プルダウンは無い**。既定6件がすべて並ぶ。
  await expect(page.getByRole("combobox", { name: "プロンプト種別" })).toHaveCount(0);
  for (const name of [
    "ニュース解説",
    "自分の考え・意見",
    "ノウハウ・ハウツー",
    "トレンド便乗",
    "引用ポスト",
    "週次まとめ",
  ]) {
    await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
  }

// 追加。**プロンプト欄には雛形が入っている**（空欄から書き始めさせない・T-M8-130）。
  await page.getByRole("button", { name: "パターンを追加" }).click();
  await expect(page.locator("#new-prompt")).toHaveValue(
    /# 投稿内容[\s\S]*# 手順・Web検索有無[\s\S]*# 構成と分量とスレッド数[\s\S]*# 語り口/,
  );
  // **分量はプロンプトから読む**（T-M8-132）。雛形は「2スレッド目」まで＝最大3ポスト。
  await expect(page.getByText("このプロンプトはメイン＋スレッド2（最大3ポスト）")).toBeVisible();

  // 入力項目（プレースホルダー）を1つ足し、プロンプトへ {自分の考え} を書く。
// 新規作成カード内のボタンを指す（各パターンのカードにも同じボタンがある）。
  const newCard = page.locator("section", { hasText: "新しいパターン" });
  await newCard.getByRole("button", { name: "プレースホルダーを追加" }).click();
  await page.locator("#new-placeholder-0").fill("自分の考え");
  await page.locator("#new-name").fill("実験パターン");
  await page
    .locator("#new-prompt")
    .fill(
      "# 投稿内容\n実験用のプロンプト\n\n# 構成と分量とスレッド数\nメインポスト：\n\n# 語り口\n{自分の考え} を踏まえる",
    );
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByRole("heading", { level: 3, name: "実験パターン" })).toBeVisible();

  const [created] = await query<{ id: string; name: string; prompt: string }>(
    `select id, name, prompt from post_patterns where x_account_id = $1 and seed_key is null`,
    [account.xAccountId],
  );
const [createdRow] = await query<{ max_posts: number }>(
    `select max_posts from post_patterns where x_account_id = $1 and seed_key is null`,
    [account.xAccountId],
  );
  expect(created.name).toBe("実験パターン");
  expect(created.prompt).toContain("実験用のプロンプト");
  // スレッド数0 → 総1ポスト（DBは総ポスト数で持つ）。
  expect(createdRow.max_posts).toBe(1);

  // 編集（名前を変える）
  await page.locator(`#pattern-${created.id}-name`).fill("実験パターン改");
  await page
    .locator("li", { hasText: "実験パターン改" })
    .getByRole("button", { name: "保存" })
    .click();
  await expect(page.getByRole("heading", { level: 3, name: "実験パターン改" })).toBeVisible();

  // 同じ名前で追加しようとすると理由が出る
  await page.getByRole("button", { name: "パターンを追加" }).click();
  await page.locator("#new-name").fill("実験パターン改");
  await page.locator("#new-prompt").fill("# タスク\n別の内容");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("同じ名前のパターンがすでにあります")).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();

  // 削除（確認ダイアログで何が起きるかを説明する）
  await page
    .locator("li", { hasText: "実験パターン改" })
  .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(page.getByText("過去の下書き・履歴の表示は名前のまま残ります")).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "実験パターン改" })).toHaveCount(0);
  expect(
    (
      await query<{ n: string }>(
        `select count(*)::text n from post_patterns where x_account_id = $1 and seed_key is null`,
        [account.xAccountId],
      )
    )[0].n,
  ).toBe("0");
});

test("画像プロンプトの画面にプルダウンを置かない", async ({ accounts, page }) => {
  const account = await accounts.create("image-prompt");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=prompts&sec=image-prompt");
  await expect(page.getByRole("combobox", { name: "プロンプト種別" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "画像プロンプト" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "プロンプト本文" })).toBeVisible();
});

/**
 * T-M8-139。**「再読み込み」で編集対象がすり替わらない。**
 *
 * `listPromptTemplates` が p1〜p6 も返していたため、再読み込み後の一覧の先頭が p1 になり、
 * 画面が「ニュース解説」の編集画面へ変わっていた。そのまま保存すると
 * **投稿パターンのプロンプトを画像プロンプトの本文で上書きした**（利用者のデータが壊れる）。
 */
test("画像プロンプトの画面は再読み込みしても対象が変わらず、投稿パターンを壊さない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("image-prompt-reload");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=prompts&sec=image-prompt");

  const body = page.getByRole("textbox", { name: "プロンプト本文" });
  await expect(body).toBeVisible();
  const before = await body.inputValue();

  await page.getByRole("button", { name: /再読み込み/ }).first().click();

  // 見出しも本文も変わらない（p1「ニュース解説」へ移らない）。
  await expect(page.getByRole("heading", { level: 3, name: "画像プロンプト" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ニュース解説" })).toHaveCount(0);
  await expect(body).toHaveValue(before);

  // 投稿パターンのプロンプトは触られていない。
  const [p1] = await query<{ prompt: string | null }>(
    `select prompt from post_patterns where x_account_id = $1 and seed_key = 'p1'`,
    [account.xAccountId],
  );
  expect(p1.prompt, "p1 が画像プロンプトで上書きされていない").toBeNull();
});
