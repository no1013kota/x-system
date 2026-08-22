import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * ヘッダの通知ベル（O-2, 要件06 §2, T-M8-32）。
 *
 * 押した瞬間に閉じて遷移することと、未読数がその場で減ることを固定する。以前は**既読化の
 * サーバ往復を待ってから**閉じて遷移していたため、押しても何も起きない時間があった。
 */
test("通知を押すと即座に閉じて遷移し、未読数がその場で減る", async ({ accounts, page }) => {
  const account = await accounts.create("bell", { personaReady: true });
  const marker = randomUUID().slice(0, 6);
  await query(
    `insert into notifications (user_id, type, title, body, link, in_app_enabled)
     values ($1,'error',$2,'APIキーが無効です。','/app/settings?tab=api-keys',true),
            ($1,'summary',$3,'本日のまとめです。',null,true)`,
    [account.userId, `失敗しました ${marker}`, `まとめ ${marker}`],
  );

  await signIn(page, account);

  const bell = page.getByRole("button", { name: /通知/ });
  await expect(bell).toContainText("2");
  await bell.click();

  // リンクの無い通知は押せる形にしない（押しても何も起きないボタンを出さない）
  const summaryRow = page.locator("li", { hasText: `まとめ ${marker}` });
  await expect(summaryRow.getByRole("button")).toHaveCount(0);

  // リンクのある通知を押す → 閉じて遷移し、未読が減る
  await page.locator("li button", { hasText: `失敗しました ${marker}` }).click();
  await page.waitForURL(/tab=api-keys/);
  // ポップアップが閉じている（遷移先=統合設定のgeneralタブにも li>button があるため、通知行で特定する・T-M8-104）
  await expect(page.locator("li button", { hasText: `失敗しました ${marker}` })).toHaveCount(0);
  await expect(bell).toContainText("1");

  // DBでも既読になっている（見た目だけ変えて終わりにしない）
  await expect
    .poll(
      async () =>
        (
          await query<{ n: number }>(
            `select count(*)::int as n from notifications where user_id = $1 and read_at is not null`,
            [account.userId],
          )
        )[0].n,
      { timeout: 10_000, message: "押した通知がDBでも既読になること" },
    )
    .toBe(1);
});

test("すべて既読で未読バッジが消え、DBにも反映される", async ({ accounts, page }) => {
  const account = await accounts.create("bell-all", { personaReady: true });
  await query(
    `insert into notifications (user_id, type, title, body, link, in_app_enabled)
     select $1,'news','ニュース ' || g::text,'本文','/app/news',true
       from generate_series(1,3) g`,
    [account.userId],
  );

  await signIn(page, account);
  const bell = page.getByRole("button", { name: /通知/ });
  await expect(bell).toContainText("3");
  await bell.click();
  await page.getByRole("button", { name: "すべて既読" }).click();

  await expect(bell).not.toContainText("3");
  await expect
    .poll(
      async () =>
        (
          await query<{ n: number }>(
            `select count(*)::int as n from notifications where user_id = $1 and read_at is null`,
            [account.userId],
          )
        )[0].n,
      { timeout: 10_000, message: "すべて既読がDBへ反映されること" },
    )
    .toBe(0);
});

// （メール再送のテストはT-M8-222で削除——メール通知機能ごと廃止）

/**
 * 通知が指す下書きが、押したときにはもう無いことがある（T-M8-115）。
 *
 * 「投稿に失敗しました」は `?tab=drafts&draftId=…` を指すが、通知を押すのは数時間〜数日あと。
 * そのあいだに下書きは投稿されて履歴へ移るか、破棄されて消えている。以前は**ただの一覧が
 * 出るだけで説明が無く**、利用者からは「押しても何も起きなかった」ように見えていた。
 */
test("通知が指す下書きが別のタブへ移っていたら、行き先を出す（T-M8-115）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("notif-moved");
  const [draft] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern_id, status, thread, initial_thread, tweet_ids)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), 'posted', $2::jsonb, $2::jsonb, '["9100000000000001"]'::jsonb)
     returning id`,
    [
      account.xAccountId,
      JSON.stringify([{ local_id: "1", text: "投稿済みの本文", weighted_length: 7, warnings: [] }]),
    ],
  );

  await signIn(page, account);
  // 通知のリンクと同じ形で開く（下書きタブを指しているが、実体は履歴にある）。
  await page.goto(`/app/posts?tab=drafts&draftId=${draft.id}`);

  await expect(page.getByText("お探しの投稿は履歴に移っています。")).toBeVisible();
  await expect(page.getByRole("link", { name: "履歴を開く" })).toHaveAttribute(
    "href",
    "/app/posts?tab=history",
  );
});

test("通知が指す下書きが消えていたら、そう分かる（T-M8-115）", async ({ accounts, page }) => {
  const account = await accounts.create("notif-gone");
  await signIn(page, account);
  await page.goto("/app/posts?tab=drafts&draftId=00000000-0000-0000-0000-000000000001");

  await expect(page.getByText("お探しの投稿は見つかりませんでした。")).toBeVisible();
});
