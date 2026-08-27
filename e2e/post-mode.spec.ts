import { expect, signIn, test } from "./fixtures/test";

/**
 * 投稿作成の「生成したあと」（T-M8-331・運営者の指示 2026-08-27）。
 *
 * **「生成する」は押し切らない。** 押すと本物のAIを呼ぶ（費用が出る）。ここで守りたいのは
 * 「作る前に行き先を決められること」と「投稿へ進む指定では同意を先に求めること」なので、
 * 同意モーダルが出るところまでを見る（同意を確定すると生成が始まるため確定しない）。
 *
 * 画面の文言・並び・押せる／押せないは**E2Eでしか守られていない**（単体テストは描画しない）。
 */
test("モードは追加指示の下にあり、予約は日時を選べる。過去日時は理由が出て押せない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("post-mode");
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  // 追加指示 → 生成したあと → 画像生成 の順で並ぶ（運営者の指示の並び）。
  const order = await page.evaluate(() => {
    const wanted = ["追加指示", "生成したあと", "画像を生成する"];
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const s = (n.textContent ?? "").trim();
        for (const w of wanted) if (s.startsWith(w) && !out.includes(w)) out.push(w);
      }
      n.childNodes.forEach(walk);
    };
    walk(document.body);
    return out;
  });
  expect(order).toEqual(["追加指示", "生成したあと", "画像を生成する"]);

  // 既定は下書き。日時欄は出ていない。
  await expect(page.getByRole("radio", { name: "下書きに置く" })).toBeChecked();
  await expect(page.getByLabel("投稿する日時")).toHaveCount(0);

  // 予約投稿を選ぶと日時欄が既定値（現在＋5分）付きで出る。
  await page.getByRole("radio", { name: "予約投稿" }).check();
  const at = page.getByLabel("投稿する日時");
  await expect(at).toBeVisible();
  await expect(at).not.toHaveValue("");

  // 過ぎた日時は理由が出て、生成ボタンが押せない（押すまで分からない失敗を作らない）。
  await at.fill("2020-01-01T09:00");
  await expect(page.getByText("1分以上先の日時を指定してください。")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成して予約する" })).toBeDisabled();
});

test("すぐに投稿は、同意していなければ生成の前に同意を求める", async ({ accounts, page }) => {
  // 既定のテストアカウントは自動投稿に同意していない状態で作る。
  const account = await accounts.create("post-mode-consent", { automationConsent: false });
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  // テーマは必須（未選択だと押せない・T-M8-29）。
  await page.getByLabel("テーマ", { exact: true }).selectOption("investment");
  await page.getByRole("radio", { name: "すぐに投稿" }).check();
  await page.getByRole("button", { name: "生成してすぐに投稿する" }).click();

  // 同意モーダルが出る（ここで止まる＝AIは呼ばれない）。
  await expect(page.getByText("自動投稿を有効にします")).toBeVisible();
  await expect(page.getByRole("button", { name: "同意して生成する" })).toBeDisabled();
});
