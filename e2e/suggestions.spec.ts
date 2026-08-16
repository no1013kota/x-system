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
  // **実際にレポートへ出ていた形**（英語の項目名と内部ID）を入れる。画面では日本語に直る（T-M8-114）。
  good_posts: [{ id: "9000000000000001", why: "冒頭3200impressionsで最多。p3の型が効いた" }],
  advice: {
    account_md: {
      content: "# 発信定義書\n## 1. ペルソナ\nE2E提案の中身\n## 2. 発信テーマ\n## 3. トンマナ\n## 4. NG\n## 5. 学習\n## 6. その他",
      reason: "ペルソナへ実績の強みを反映",
    },
    pattern: { recommended: "p3", reason: "手順を数字で示すノウハウ形式が伸びている" },
    theme: { recommended: "ai", reason: "AIツール紹介の題材が反応を得ている" },
    image: { recommended: true, reason: "画像付きの表示回数が上回った" },
    prompt: { kind: "p3", content: "# タスク\n読者が今日から実践できるノウハウを書く。書き出しは数字で始める。" },
  },
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

  // 良かった投稿の実体（本文・数値）。画面に出るので保存済みタイムラインから引ける必要がある。
  await query(
    `insert into x_timeline_posts
       (x_account_id, tweet_id, text, posted_at, impressions, likes, reposts, replies, has_image, pattern, theme)
     values ($1, '9000000000000001', $2, now() - interval '2 days', 3200, 45, 12, 7, true, 'p3', 'ai')`,
    [account.xAccountId, "E2Eの良かった投稿の本文。手順を数字で示した。"],
  );

  await signIn(page, account);
  await page.goto("/app/analytics");

  // ① まとめ。
  await expect(page.getByText("朝8時台のノウハウ投稿の表示回数が突出していた")).toBeVisible();

  // ② 良かった投稿: 開かなくても本文と数値が読める（T-M8-114）。
  await expect(page.getByText("E2Eの良かった投稿の本文。手順を数字で示した。")).toBeVisible();
  const goodPost = page.getByRole("link", { name: /Xで開く/ });
  await expect(goodPost).toBeVisible();
  await expect(goodPost).toHaveAttribute("href", /status\/9000000000000001/);
  await expect(goodPost).toHaveAttribute("target", "_blank");
  await expect(page.getByText("3,200", { exact: false }).first()).toBeVisible();

  // 英語の項目名と内部IDが画面に出ない（AIの本文をそのまま出さない・T-M8-114）。
  const report = page.locator("section", { hasText: "分析レポート" });
  await expect(report.getByText(/impressions/i)).toHaveCount(0);
  await expect(page.getByText("表示3200回", { exact: false })).toBeVisible();

  // 段の見出しが3つ並ぶ（順序が読み取れる）。
  for (const heading of ["まとめ", "良かった投稿", "近づけるための設定"]) {
    await expect(report.getByRole("heading", { name: heading })).toBeVisible();
  }

  // ③ アドバイスは画面表記（POST_PATTERN_LABELS / postThemeLabel）で出す。内部キーは出さない。
  // 投稿カード側にも型・テーマのバッジが出るため、推奨の一覧（dl）に絞って見る。
  const advice = report.locator("dl");
  await expect(advice.getByText("ノウハウ", { exact: false }).first()).toBeVisible();
  await expect(advice.getByText("AI", { exact: true })).toBeVisible();
  await expect(advice.getByText("付ける", { exact: true })).toBeVisible();
  await expect(report.getByText(/(^|[^0-9A-Za-z_])p3(?![0-9A-Za-z_])/)).toHaveCount(0);

  // 2つの編集提案（fixtureはpremium）: アカウント.md提案と投稿作成プロンプト（T-M8-106）。
  await expect(page.getByText("アカウント.mdへの編集提案", { exact: false })).toBeVisible();
  await expect(page.getByText("E2E提案の中身", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "設定で編集する" })).toHaveAttribute(
    "href",
    "/app/settings?tab=prompts&sec=account-md",
  );
  await expect(page.getByText("# タスク", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "コピー" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "設定で保存する" })).toHaveAttribute(
    "href",
    "/app/settings?tab=prompts&sec=post-prompt",
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
  // 貼り先（設定＞プロンプト）が使えないプランには2提案とも全文もコピーも出さない。
  await expect(page.getByText("# タスク", { exact: false })).toHaveCount(0);
  await expect(page.getByText("E2E提案の中身", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "コピー" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /プロンプトのカスタマイズ（mdプラン以上）/ }),
  ).toHaveAttribute("href", "/app/settings?tab=prompts&sec=post-prompt");
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
