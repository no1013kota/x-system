import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { alertIn, expect, signIn, test } from "./fixtures/test";

/**
 * SC-04 投稿作成の進行表示と失敗理由（要件06 §3・§10、T-M7-02）。
 *
 * **「生成する」は押さない。** 押すと実際にAI providerを呼ぶため、費用が発生し、結果が毎回変わり、
 * 1分近くかかる。ここで守りたい契約は「jobの状態が画面へ正しく出るか」なので、`generation_jobs` を
 * 直接seedして進行→失敗の表示を検証する。生成そのもののリクエスト形状は
 * `npm run check:providers`（provider契約テスト）が担当する。
 *
 * T-M7-02 の要点: handlerがerrorを保存する前に失敗しても汎用文で潰さず、保存された理由を出す。
 * 2026-07-27 の実障害（Web検索の400で P-6 が全滅）でも、画面に出たのは保存済みの理由だった。
 */

/** 進行中（running）の投稿生成jobを作る。 */
async function seedRunningJob(xAccountId: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `insert into generation_jobs
       (x_account_id, kind, trigger, pattern, status, progress_stage, attempt, started_at, request_key)
     values ($1, 'post_generation', 'manual', 'p3', 'running', 'writing', 1, now(), $2)
     returning id`,
    [xAccountId, `e2e-${randomUUID()}`],
  );
  return row.id;
}

test("進行中は生成中と分かり、失敗すると保存された理由が汎用文の代わりに出る", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("generation");
  const jobId = await seedRunningJob(account.xAccountId);

  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  // 進行中は送信ボタンが「生成中…」になり、二重に開始できない
  const submit = page.getByRole("button", { name: "生成中…" });
  await expect(submit).toBeVisible();
  await expect(submit).toBeDisabled();

  // handlerが保存した理由をDBへ置く（前提不足の例）。画面はポーリングで追従する。
  const reason = "AI APIキーが未登録のため生成できません。設定から登録してください。";
  await query(
    `update generation_jobs
        set status = 'failed', finished_at = now(),
            error = jsonb_build_object('code', 'api_key_required', 'message', $2::text,
                                       'stage', 'writing', 'retryable', false)
      where id = $1`,
    [jobId, reason],
  );

  // 汎用文（「生成に失敗しました。時間をおいて…」）ではなく保存された理由が出る
  const alert = alertIn(page);
  await expect(alert).toContainText(reason, { timeout: 30_000 });
  await expect(alert).not.toContainText("生成に失敗しました。時間をおいて再試行してください。");

  // 押しても直らない失敗では「再試行する」を出さず、解決先へ送る（要件06 §10）
  await expect(page.getByRole("button", { name: "再試行する" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "設定を確認する" })).toBeVisible();
});

test("理由が保存されないまま失敗した場合も行き止まりにせず再試行を出す", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("generation-generic");
  const jobId = await seedRunningJob(account.xAccountId);

  await signIn(page, account);
  await page.goto("/app/posts?tab=create");
  await expect(page.getByRole("button", { name: "生成中…" })).toBeVisible();

  // 分類できなかった失敗（T-M7-02 の fallbackJobError と同じ形）
  await query(
    `update generation_jobs
        set status = 'failed', finished_at = now(),
            error = jsonb_build_object('code', 'job_failed',
                                       'message', '時間をおいて再度お試しください。設定や入力もご確認ください。'::text,
                                       'retryable', false)
      where id = $1`,
    [jobId],
  );

  await expect(alertIn(page)).toContainText("時間をおいて再度お試しください。", {
    timeout: 30_000,
  });
  // 原因不明なので再試行に意味があり、ボタンを出す
  await expect(page.getByRole("button", { name: "再試行する" })).toBeVisible();
});

test("投稿作成で分野を選ぶと、その分野が生成jobへ渡る（T-M8-28）", async ({ accounts, page }) => {
  // 画面で選べても、AIへ渡る入力に入っていなければ何も変わらない。job の input まで見る。
  const account = await accounts.create("gen-theme", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  await page.getByLabel("分野（任意）").selectOption("investment");
  await page.getByRole("button", { name: /生成する/ }).click();

  await expect
    .poll(
      async () =>
        (
          await query<{ theme: string | null }>(
            `select input->>'theme' as theme from generation_jobs
              where x_account_id = $1 and kind = 'post_generation'`,
            [account.xAccountId],
          )
        )[0]?.theme,
      { timeout: 20_000, message: "分野が生成jobの入力へ入ること" },
    )
    .toBe("investment");
});
