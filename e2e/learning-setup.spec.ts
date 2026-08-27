import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 参考ソースからアカウント設定を作る（T-M8-344・運営者の指示 2026-08-27）。
 *
 * **アカウント設定を保存する前から参考ソースを登録でき、そこから設定を作れる。**
 * 以前は「先にアカウント設定を保存しないと参考ソースの欄が出ない」順序だったため、
 * 「誰に何を発信するか」を言葉にできない人はそこで止まっていた。
 *
 * 実AIは呼ばない（押すと分析が走り費用が出る）。ここで守るのは
 * **画面の順序・押せる／押せない理由・押した後の状態表示**の3つ。
 */
test("アカウント設定が未保存でも参考ソースを登録でき、作るボタンが理由つきで出る", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("learn-setup");
  // アカウント設定が未保存の状態にする（連携直後と同じ）。
  await query(
    `update x_accounts set base_md = '', base_md_version = 0, settings = '{}'::jsonb where id = $1`,
    [account.xAccountId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=account");

  /*
    **並びはアカウント設定 → 参考ソース**（T-M8-349・運営者の指示 2026-08-28）。
    反映を押すと上のフォームへ内容が入り、そこで確認して保存する流れなので、
    「入れる場所」→「入れる材料」の順に置く。**「アカウント設定」という見出しは無い**
    （T-M8-346。タブ名と同じ言葉を画面内で繰り返さない）。
  */
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("h2")].map((h) => (h.textContent ?? "").trim()),
  );
  expect(order.slice(0, 2)).toEqual(["ペルソナ", "テーマ"]);
  expect(order).toContain("参考ソースからアカウント設定を作る");
  expect(order).not.toContain("アカウント設定");
  // 対象アカウントはタブの直下（編集を始める前に見えている必要がある）。
  await expect(page.getByText(/対象アカウント: @/)).toBeVisible();

  // 材料が無いので押せない。**理由が画面に出る**（無効化だけにしない・T-M8-37）。
  const apply = page.getByRole("button", { name: "アカウント設定を反映する" });
  await expect(apply).toBeDisabled();
  await expect(
    page.getByText("XのURLを入れると押せます（参考アカウントか参考投稿）。"),
  ).toBeVisible();

  /*
    記入欄はこの時点で使える（アカウント設定の保存を待たない）。**欄ごとの「追加」は無い**——
    URLを入れれば下の1つのボタンで登録から反映まで進む（T-M8-346）。
    **上限は入力の前に出す**（T-M8-349。押してから弾かれない）。
  */
  const refAccount = page.getByRole("textbox", { name: "参考アカウント" }).first();
  await expect(refAccount).toBeEnabled();
  await expect(page.getByText("（0 / 3件）")).toBeVisible();
  await expect(page.getByText("（0 / 10件）")).toBeVisible();
  await refAccount.fill("https://x.com/example");
  await expect(apply).toBeEnabled();

  // 欄は増やせる（1件では足りない人がいる）。増やしても実行ボタンは1つのまま。
  await page.getByRole("button", { name: /参考投稿の欄を増やす/ }).click();
  await expect(page.getByRole("textbox", { name: "参考投稿" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "アカウント設定を反映する" })).toHaveCount(1);
});
