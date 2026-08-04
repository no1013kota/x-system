import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-07 下書き→投稿→履歴（要件06 §4・§7）。X_POSTING_MODE=dry_run のため実際のXへは投稿されず、
 * ダミーのtweet_idで posted まで進む。確認ダイアログを挟むこと、履歴へ移ることをDBまで確認する。
 */

const THREAD = [
  {
    local_id: "p1",
    text: "E2Eテストの下書きです。投稿すると履歴へ移動します。",
    weighted_length: 50,
    sources: [],
    warnings: [],
  },
];

test("下書きを確認ダイアログ経由で投稿すると履歴に移る", async ({ accounts, page }) => {
  const account = await accounts.create("publish");
  const [draft] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern, thread, initial_thread, status)
     values ($1, 'p3', $2::jsonb, $2::jsonb, 'draft') returning id`,
    [account.xAccountId, JSON.stringify(THREAD)],
  );

  await signIn(page, account);
  await page.goto("/app/posts?tab=drafts");
  const card = page.locator(`#draft-${draft.id}`);
  await expect(card).toBeVisible();

  // 確認なしでは投稿しない
  await card.getByRole("button", { name: "投稿", exact: true }).click();
  await expect(page.getByText("この内容で投稿しますか？")).toBeVisible();
  await page.getByRole("button", { name: "投稿する" }).click();

  // workerは publishDraftAction の after() が起動する。終端までDBをpollする。
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(`select status from drafts where id = $1`, [draft.id])
        )[0]?.status,
      { timeout: 30_000, message: "draft が posted になること" },
    )
    .toBe("posted");

  const [posted] = await query<{ tweet_ids: string[]; posted_mode: string | null }>(
    `select tweet_ids, posted_mode::text as posted_mode from drafts where id = $1`,
    [draft.id],
  );
  expect(posted.tweet_ids.length).toBe(THREAD.length);
  expect(posted.posted_mode).toBe("manual");

  // 履歴タブに移り、Xのポストへのリンクを持つ
  await page.goto(`/app/posts?tab=history&draftId=${draft.id}`);
  const history = page.locator(`#draft-${draft.id}, li`, { hasText: "E2Eテストの下書きです" }).first();
  await expect(history).toBeVisible();
  // 履歴からXのポストへ到達できること。**表示されているリンク**を見る（T-M8-14）。
  // 各ポストのリンクは折りたたみの中にあり既定では非表示なので、`:visible` を付けないと
  // 隠れている方を拾って落ちる。利用者が実際に押せるのは行の「Xで表示」。
  await expect(
    page.locator(`a[href^="https://x.com/${account.handle}/status/"]:visible`).first(),
  ).toBeVisible();
});

/**
 * Xへ1件も出さずに止めた下書きは、**理由が見えて、そのまま直せる**こと（T-M8-51）。
 *
 * T-M8-39 で加重280超過のサーバー側ゲートを足したとき、2つの欠陥を作っていた。
 * (1) `setDraftFailed` で `status=failed` にしたため `editable` が false になり、
 *     `tweet_ids` が空なので複製もできず——**編集も複製も投稿もできない行き止まり**になった。
 *     失敗メッセージ自身が「編集して短くしてから投稿してください」と言っているのに実行できない。
 * (2) `DraftView.last_post_error` に `message` が無く、丁寧に書いた文言が**どこにも出なかった**。
 *     「Xへは1件も投稿していない」が伝わらないと、利用者はXを見に行くまで確認できない。
 */
test("Xへ出さずに止めた下書きは理由が見えて、そのまま編集できる（T-M8-51）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("publish-reason", { personaReady: true });
  const marker = `長すぎる下書き ${Date.now().toString(36)}`;
  const overLength = "あ".repeat(150);
  await query(
    `insert into drafts (x_account_id, pattern, thread, initial_thread, status, last_post_error)
     values ($1,'p1',$2::jsonb,$2::jsonb,'draft',$3::jsonb)`,
    [
      account.xAccountId,
      JSON.stringify([
        { local_id: "p1", text: marker, weighted_length: 20, sources: [], warnings: [] },
        {
          local_id: "p2",
          text: overLength,
          weighted_length: 300,
          sources: [],
          warnings: ["length_exceeded"],
        },
      ]),
      JSON.stringify({
        code: "length_exceeded",
        message:
          "2本目の本文が長すぎます（上限280・いま300）。編集して短くしてから投稿してください。Xへの投稿は1件も行っていません。",
      }),
    ],
  );

  await signIn(page, account);
  await page.goto("/app/posts?tab=drafts");
  // 下書きカードは `li[id^="draft-"]`。中のポストも `li` なので入れ子を避けて特定する。
  const card = page.locator('li[id^="draft-"]', { hasText: marker });
  await expect(card).toBeVisible();

  // 理由がそのまま読める（何本目・Xへ出ていない）
  const reason = card.getByRole("alert");
  await expect(reason).toContainText("2本目");
  await expect(reason).toContainText("Xへの投稿は1件も行っていません");

  // 言われたとおり編集できる（行き止まりにしない）
  await expect(card.getByRole("button", { name: "編集" })).toBeEnabled();

  // 超過しているあいだ投稿はさせない（編集導線だけを出す・要件06 §7）
  await expect(card.getByRole("button", { name: "投稿する" })).toHaveCount(0);
  await expect(card.getByText("280字を超えている", { exact: false })).toBeVisible();
});
