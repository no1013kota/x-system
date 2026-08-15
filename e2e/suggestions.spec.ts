import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-09 分析レポートの表示（要件06 §8、T-M8-94）。
 *
 * 提案の生成はX API・実AIを叩くためE2Eでは動かさず、`improvement_suggestions` を新形式
 * （evidence.format=2）で直接seedして表示だけを検証する:
 * - 総評・良かった投稿・アドバイス（型/テーマ/画像は**画面表記**で。内部キー p3/ai を出さない）
 * - プロンプト全文は fixture（premium）に表示され、コピー導線とAI設定へのリンクがある
 */

const EVIDENCE = {
  format: 2,
  good_posts: [{ id: "9000000000000001", why: "表示回数が3,200と最多だった" }],
  advice: {
    pattern: { recommended: "p3", reason: "手順を数字で示すノウハウ形式が伸びている" },
    theme: { recommended: "ai", reason: "AIツール紹介の題材が反応を得ている" },
    image: { recommended: true, reason: "画像付きの表示回数が上回った" },
    prompt: { kind: "p3", content: "# タスク\n読者が今日から実践できるノウハウを書く。書き出しは数字で始める。" },
  },
  window_days: 30,
  post_count: 12,
};

test("分析レポートは総評・良かった投稿・アドバイスが画面表記で出て、プロンプトをコピーできる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sug-v2");
  await query(
    `with job as (
       insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
       values ($1, 'suggestion', 'manual', 'succeeded', now()) returning id
     )
     insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
     select $1, job.id, $2, $3::jsonb from job`,
    [account.xAccountId, "朝8時台のノウハウ投稿の表示回数が突出していた", JSON.stringify(EVIDENCE)],
  );

  await signIn(page, account);
  await page.goto("/app/analytics");

  // 総評と良かった投稿。
  await expect(page.getByText("朝8時台のノウハウ投稿の表示回数が突出していた")).toBeVisible();
  const goodPost = page.getByRole("link", { name: "この投稿を開く" });
  await expect(goodPost).toBeVisible();
  await expect(goodPost).toHaveAttribute("href", /status\/9000000000000001/);
  await expect(page.getByText("表示回数が3,200と最多だった")).toBeVisible();

  // アドバイスは画面表記（POST_PATTERN_LABELS / postThemeLabel）で出す。内部キーは出さない。
  await expect(page.getByText("ノウハウ", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("AI", { exact: true })).toBeVisible();
  await expect(page.getByText("付ける", { exact: true })).toBeVisible();
  const panel = page.locator("section", { hasText: "分析レポート" });
  await expect(panel.getByText(/\bp3\b/)).toHaveCount(0);

  // プロンプト全文（fixtureはpremium）とコピー・AI設定への導線。
  await expect(page.getByText("# タスク", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "コピー" })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI設定で保存する" })).toHaveAttribute(
    "href",
    "/app/ai-settings?tab=prompts",
  );
});

test("standardにはプロンプト全文を出さず、mdプラン以上の案内を出す", async ({ accounts, page }) => {
  const account = await accounts.create("sug-std");
  await query(`update profiles set plan = 'standard', stripe_customer_id = $2 where id = $1`, [
    account.userId,
    `cus_e2e_${randomUUID().slice(0, 8)}`,
  ]);
  await query(
    `with job as (
       insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
       values ($1, 'suggestion', 'manual', 'succeeded', now()) returning id
     )
     insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
     select $1, job.id, $2, $3::jsonb from job`,
    [account.xAccountId, "総評テキスト", JSON.stringify(EVIDENCE)],
  );

  await signIn(page, account);
  await page.goto("/app/analytics");

  await expect(page.getByText("総評テキスト")).toBeVisible();
  // 貼り先（AI設定＞プロンプト）が使えないプランには全文もコピーも出さない。
  await expect(page.getByText("# タスク", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "コピー" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /プロンプトのカスタマイズ（mdプラン以上）/ }),
  ).toHaveAttribute("href", "/app/ai-settings?tab=prompts");
});

test("BYOKでAIキーが未登録なら、始まらない理由と登録導線を出す（T-M8-95）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sug-nokey");
  // fixtureはpremium。BYOK（md）へ変え、AIキーは登録しない → 毎朝の分析jobが作られない状態。
  await query(`update profiles set plan = 'md' where id = $1`, [account.userId]);

  await signIn(page, account);
  await page.goto("/app/analytics");

  await expect(page.getByText("分析にはAIのAPIキーが必要です。")).toBeVisible();
  await expect(page.getByRole("link", { name: "設定のAPIキー" })).toHaveAttribute(
    "href",
    "/app/settings?tab=api-keys",
  );
});
