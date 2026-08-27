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
       (x_account_id, tweet_id, text, posted_at, impressions, likes, reposts, replies, has_image, pattern_name, theme)
     values ($1, '9000000000000001', $2, now() - interval '2 days', 3200, 45, 12, 7, true, 'ノウハウ・ハウツー', 'ai')`,
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
  for (const heading of ["まとめ", "良かった投稿", "良かった投稿に近づくプロンプト設定"]) {
    await expect(report.getByRole("heading", { name: heading, exact: true })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "プロンプト画面で編集する" })).toHaveAttribute(
    "href",
    "/app/prompts?sec=account-md",
  );
  await expect(page.getByText("# タスク", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "コピー" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "プロンプト画面で保存する" })).toHaveAttribute(
    "href",
    "/app/prompts?sec=post-prompt",
  );
});

// 旧standard（編集不可プラン）の検証はT-M8-168で削除した（プラン自体を撤廃。全プランが編集可能になった）。

test("BYOKでAIキーが未登録なら、始められない理由と登録導線を出す（T-M8-95）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sug-nokey");
  // fixtureはpremium。BYOKへ変え、AIキーは登録しない → 「分析を開始」しても起票されない状態。
  await query(`update profiles set plan = 'standard' where id = $1`, [account.userId]);

  await signIn(page, account);
  await page.goto("/app/analytics");

  await expect(page.getByText("分析にはAIのAPIキーが必要です。")).toBeVisible();
  await expect(page.getByRole("link", { name: "設定のAPIキー" })).toHaveAttribute(
    "href",
    "/app/settings?tab=api-keys",
  );

  // 押した結果も言葉で返る（原則1）。BYOK未登録は起票ゲートで弾かれ、jobは作られない。
  await page.getByRole("button", { name: "分析を開始" }).click();
  await expect(page.getByText("分析を開始できませんでした")).toBeVisible();
});

/**
 * 「分析を開始」ボタン（K-2/K-3, T-M8-255）。毎朝の自動実行の廃止後、起票の入口はこれだけ。
 * 生成そのものはX API・実AIを叩くためE2Eでは完走しない（dispatchされたjobは後段で失敗してよく、
 * 失敗までの時間も不定）。押した直後の状態に依存する検証はせず、
 * (1) 押すと suggestion job が trigger='manual'・1日1回の冪等キーで作られること
 * (2) 実行中（queued）はボタンが「分析中…」で押せないこと（DBへ直接seedして確定させる）
 * を分けて確認する。
 */
test("「分析を開始」でjobが trigger='manual' で起票される（T-M8-255）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sug-start");

  await signIn(page, account);
  await page.goto("/app/analytics");

  await page.getByRole("button", { name: "分析を開始" }).click();
  await expect(page.getByText("分析を開始しました")).toBeVisible();

  // 起票の実体（statusはdispatch結果次第で動くため見ない）。
  const rows = await query<{ trigger: string; request_key: string }>(
    `select trigger::text as trigger, request_key from generation_jobs
      where x_account_id = $1 and kind = 'suggestion'`,
    [account.xAccountId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].trigger).toBe("manual");
  expect(rows[0].request_key).toMatch(/^sug-manual:/);
});

test("分析の実行中はボタンが「分析中…」になり押せない（T-M8-255）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sug-busy");
  // dispatchを伴わずに実行中の状態を作る（dev環境ではtickが動かないため回収されない）。
  await query(
    `insert into generation_jobs (x_account_id, kind, trigger, status)
     values ($1, 'suggestion', 'manual', 'queued')`,
    [account.xAccountId],
  );

  await signIn(page, account);
  await page.goto("/app/analytics");

  await expect(page.getByRole("button", { name: "分析中…" })).toBeDisabled();
});
