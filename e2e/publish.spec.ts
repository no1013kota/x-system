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
