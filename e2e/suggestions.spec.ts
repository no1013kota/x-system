import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-09 改善提案の分析軸表示（要件06 §8、T-M7-38）。
 *
 * 提案の生成は実APIを叩くためE2Eでは動かさず、`improvement_suggestions` を直接seedして
 * **どの軸で差が出たかが画面表記で出ること**（内部キーを出さないこと）だけを検証する。
 * 軸が無いと、投稿の書き方を変えた効果を運営者が実績で確かめられない。
 */

test("改善提案に分析軸が画面表記で出る（T-M7-38）", async ({ accounts, page }) => {
  const account = await accounts.create("axis");
  const tweetId = `e2e${randomUUID().replace(/-/g, "").slice(0, 15)}`;
  const thread = [
    { local_id: "p1", text: "短い投稿", weighted_length: 8, sources: [], warnings: [] },
  ];
  const checkpoints = {
    "7": { impressions: 500, likes: 1, reposts: 0, profile_clicks: 0, collected_at: new Date().toISOString() },
  };
  await query(
    `insert into drafts
       (x_account_id, pattern, thread, initial_thread, status, tweet_ids,
        posted_mode, posted_at, tweet_metrics)
     values ($1, 'p2', $2::jsonb, $2::jsonb, 'posted', jsonb_build_array($3::text),
             'manual', now() - interval '8 days',
             jsonb_build_object($3::text, jsonb_build_object('checkpoints', $4::jsonb)))`,
    [account.xAccountId, JSON.stringify(thread), tweetId, JSON.stringify(checkpoints)],
  );
  const [job] = await query<{ id: string }>(
    `insert into generation_jobs (x_account_id, kind, trigger, status, input, finished_at)
     values ($1, 'suggestion', 'manual', 'succeeded', '{}'::jsonb, now()) returning id`,
    [account.xAccountId],
  );
  await query(
    `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
     values ($1, $2, $3, $4::jsonb)`,
    [
      account.xAccountId,
      job.id,
      "投稿を短く収めると表示回数が伸びています",
      JSON.stringify({
        axis: "length",
        tweet_ids: [tweetId],
        metric: "impressions",
        checkpoint_days: 7,
        diff_pct: 40,
        window_days: 30,
        summary: "短い投稿の平均が長い投稿より40%高い",
      }),
    ],
  );

  await signIn(page, account);
  await page.goto("/app/analytics");
  await expect(page.getByText("投稿を短く収めると", { exact: false })).toBeVisible();
  // 内部キー（length）ではなく日本語表記が出る（要件06 §8）
  await expect(page.getByText("投稿の長さ", { exact: true })).toBeVisible();
  await expect(page.getByText("length", { exact: true })).toHaveCount(0);
});
