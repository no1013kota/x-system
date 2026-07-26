import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-09 分析（要件06 §8、T-M7-04）。metrics収集jobはX APIを叩くためE2Eでは動かさず、
 * `drafts.tweet_metrics` を直接seedして**既定の計測時点の選び方と識別性**を検証する。
 *
 * T-M7-04 で「取得済みの最長」→「その時点の実績を持つポストが最も多い時点」へ仕様変更した。
 * 古い1件が30日を持つだけで直近投稿が空表に見える、という退行を防ぐのがこのテストの主眼。
 */

interface Checkpoint {
  impressions: number;
}

/** posted な draft を1件作る。checkpoints は "1"/"7"/"30" の別。 */
async function seedPostedDraft(
  xAccountId: string,
  body: string,
  checkpoints: Partial<Record<"1" | "7" | "30", Checkpoint>>,
  daysAgo: number,
): Promise<string> {
  const tweetId = `e2e${randomUUID().replace(/-/g, "").slice(0, 15)}`;
  const entries: Record<string, unknown> = {};
  for (const [days, value] of Object.entries(checkpoints)) {
    entries[days] = {
      impressions: value.impressions,
      likes: 1,
      reposts: 0,
      profile_clicks: 0,
      collected_at: new Date().toISOString(),
    };
  }
  const thread = [{ local_id: "p1", text: body, weighted_length: body.length, sources: [], warnings: [] }];
  const [row] = await query<{ id: string }>(
    `insert into drafts
       (x_account_id, pattern, thread, initial_thread, status, tweet_ids,
        posted_mode, posted_at, tweet_metrics)
     values ($1, 'p3', $2::jsonb, $2::jsonb, 'posted', jsonb_build_array($3::text),
             'manual', now() - make_interval(days => $4),
             jsonb_build_object($3::text, jsonb_build_object('checkpoints', $5::jsonb)))
     returning id`,
    [xAccountId, JSON.stringify(thread), tweetId, daysAgo, JSON.stringify(entries)],
  );
  return row.id;
}

test("既定の計測時点は実績を持つポストが最も多い時点になり、直近投稿が空表にならない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("analytics");
  const run = randomUUID().slice(0, 6);

  // 直近の3件は1日の実績のみ。古い1件だけが30日まで持つ。
  // 「取得済みの最長」を既定にすると30日が選ばれ、直近3件が「未取得」で埋まってしまう。
  await seedPostedDraft(account.xAccountId, `${run} 直近A`, { "1": { impressions: 111 } }, 1);
  await seedPostedDraft(account.xAccountId, `${run} 直近B`, { "1": { impressions: 222 } }, 2);
  await seedPostedDraft(account.xAccountId, `${run} 直近C`, { "1": { impressions: 333 } }, 3);
  await seedPostedDraft(
    account.xAccountId,
    `${run} 古い`,
    { "1": { impressions: 9 }, "7": { impressions: 9 }, "30": { impressions: 9 } },
    40,
  );

  await signIn(page, account);
  await page.goto("/app/analytics");

  // 既定は「投稿後1日」（4件が1日の実績を持ち、30日は1件だけ）
  const selected = page.getByRole("button", { name: "投稿後1日" });
  await expect(selected).toHaveClass(/bg-foreground/);

  // 直近投稿の実績が数値として出ている（空表になっていない）
  await expect(page.getByText("111", { exact: false }).first()).toBeVisible();

  // 本文冒頭で対象を識別できる（tweet_idの生値ではない・T-M7-04）
  await expect(page.getByText(`${run} 直近A`, { exact: false }).first()).toBeVisible();

  // 30日へ切り替えると、30日の実績を持たない直近投稿は「未取得」になる
  await page.getByRole("button", { name: "投稿後30日" }).click();
  await expect(page.getByText("未取得").first()).toBeVisible();
});

test("投稿実績が無いアカウントは空状態で行き止まりにならない", async ({ accounts, page }) => {
  const account = await accounts.create("analytics-empty");
  await signIn(page, account);
  await page.goto("/app/analytics");

  await expect(
    page.getByText("まだ投稿実績はありません。", { exact: false }),
  ).toBeVisible();
});
