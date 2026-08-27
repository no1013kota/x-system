import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import type { Page } from "@playwright/test";

import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * SC-10 AI設定のうち**アカウント.md編集**と**学習ソース**（要件06 §9・§3.6、T-M7-26）。
 *
 * どちらも未カバーだった。学習ソースの分析（LRN）は実APIを叩くのでE2Eでは走らせず、
 * **画面とDBの状態遷移**だけを検証する（分析結果の中身は `npm run smoke:live` の範囲外でもあり、
 * ここでは扱わない）。アカウント.md編集はAIを使わない操作なので最後まで通す。
 */

const VALID_BASE_MD = [
  "# 発信定義書（アカウント.md）",
  "",
  "## 1. ペルソナ",
  "- 発信者: E2Eテスト用の発信者",
  "",
  "## 2. 発信テーマ",
  "- 主テーマ: テスト",
  "",
  "## 3. トーン&マナー",
  "- 文末: です・ます調",
  "",
  "## 4. やらないこと",
  "- テストに関係ない話はしない",
  "",
  "## 5. 文体・自分らしさ",
  "- よく使う語彙: 「確認します」",
  "",
  "## 6. 参考にする型",
  "- 伸びた投稿の型: 結論から書く",
  "",
].join("\n");

test("アカウント.mdを編集して保存でき、versionが上がって履歴に残る", async ({ accounts, page }) => {
  const account = await accounts.create("base-md");
  await signIn(page, account);
  await page.goto("/app/prompts?sec=account-md");

  // 複数持てるようになったので、**使用中の1件**を編集する（T-M8-332）。
  const editor = page.getByLabel("アカウント.mdの本文");
  await expect(editor).toBeVisible();

  const marker = `E2E-${randomUUID().slice(0, 8)}`;
  await editor.fill(VALID_BASE_MD.replace("テスト用の発信者", `テスト用の発信者 ${marker}`));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  // 保存できたことが画面で分かる（versionつき）
  await expect(page.getByText("保存しました", { exact: false })).toBeVisible({ timeout: 20_000 });

  // DBに反映され、versionが上がっている
  const [saved] = await query<{ base_md: string; version: number }>(
    `select base_md, base_md_version as version from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(saved.base_md, "編集内容が保存されていること").toContain(marker);
  expect(saved.version, "versionが上がること").toBeGreaterThan(1);

  // 変更履歴に残る（いつでも戻せる）
  const versions = await query<{ n: string }>(
    `select count(*)::text as n from base_md_versions where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(Number(versions[0].n), "履歴が作られること").toBeGreaterThan(0);
  // 履歴は本文の下に残る（学習・アカウント設定の反映もここに出る）。
  await expect(page.getByRole("heading", { name: /変更履歴/ })).toBeVisible();
});

test("見出し構造が壊れた内容は保存されず、何を直せばよいか分かる", async ({ accounts, page }) => {
  const account = await accounts.create("base-md-invalid");
  await signIn(page, account);
  await page.goto("/app/prompts?sec=account-md");

  const editor = page.getByLabel("アカウント.mdの本文");
  await expect(editor).toBeVisible();

  // 「## 3.」を落とした状態（6見出しが揃っていない）
  await editor.fill(VALID_BASE_MD.replace("## 3. トーン&マナー", "### 3. トーン&マナー"));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  // 何が悪いかが具体的に出る（「エラー」だけで終わらせない）
  await expect(page.getByText("見出しの形が合っていません", { exact: false })).toBeVisible({
    timeout: 20_000,
  });

  // 保存されていない
  const [row] = await query<{ base_md: string; version: number }>(
    `select base_md, base_md_version as version from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(row.version, "失敗時はversionが上がらないこと").toBe(1);
  expect(row.base_md, "壊れた内容が保存されていないこと").not.toContain("### 3.");
});

test("学習ソースを追加すると分析中として並び、削除できる", async ({ accounts, page }) => {
  const account = await accounts.create("learning");
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=persona"); // 参考ソースはアカウント設定タブの一番下（T-M8-103）

  await expect(page.getByRole("heading", { name: "参考ソースを追加" })).toBeVisible();

  // 追加（分析はAIを呼ぶため、ここでは受け付けられて pending になることだけを見る）
  const handle = `e2e_ref_${randomUUID().slice(0, 6)}`;
  // 入力欄・追加ボタンは種別ごとに分かれている（T-M8-112）。
  await page.getByLabel("参考アカウント", { exact: true }).fill(`https://x.com/${handle}`);
  await page.getByRole("button", { name: "参考アカウントを追加" }).click();

  // **成功したことが利用者に分かる**（T-M8-18）。以前は追加が通っても画面は無言で、
  // 一覧に行が増えたことに気づけるかどうかに委ねていた。
  await expect(toastIn(page)).toContainText("参考アカウントを追加しました");

  // DBに登録され、分析待ちになる
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(
            `select status::text as status from learning_sources
              where x_account_id = $1 and url like $2 and removed_at is null`,
            [account.xAccountId, `%${handle}%`],
          )
        )[0]?.status,
      { timeout: 20_000, message: "学習ソースが登録されること" },
    )
    .toBe("pending");

  // 画面にも「分析中」として出る（進行が分かる）
  await expect(page.getByText(handle, { exact: false })).toBeVisible();

  // 分析が終わった状態にしてから削除する（AIは呼ばない）。
  //
  // **実行中の分析jobも終端させる。** 削除は「同一アカウントに queued/running の学習jobがあれば
  // job_conflict」で弾く仕様（要件05 §8）。追加時にdispatchされたjobが残っていると削除が通らず、
  // 環境によって結果が変わる（2026-08-01、CIはダミーキーでjobが残り続けて落ちた。手元は実キーで
  // jobが早く終わるため通っていた）。状態を作るテストなので、前提を揃えてから操作する。
  await query(
    `update generation_jobs set status = 'canceled', finished_at = now()
      where x_account_id = $1 and kind = 'learning_analysis' and status in ('queued','running')`,
    [account.xAccountId],
  );
  await query(
    `update learning_sources set status = 'analyzed',
        analysis_summary = jsonb_build_object('style', 'テスト')
      where x_account_id = $1 and url like $2`,
    [account.xAccountId, `%${handle}%`],
  );
  await page.reload();

  // 削除は確認ダイアログを挟む（誤操作でアカウント.mdの知見を失わないため）
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "削除", exact: true }).first().click();

  // 削除処理に入る（removing → 生成の一時停止案内が出る）
  await expect
    .poll(
      async () =>
        (
          await query<{ status: string }>(
            `select status::text as status from learning_sources
              where x_account_id = $1 and url like $2`,
            [account.xAccountId, `%${handle}%`],
          )
        )[0]?.status,
      { timeout: 20_000, message: "削除処理へ入ること" },
    )
    .not.toBe("analyzed");
});

// 旧standard（編集不可プラン）の検証はT-M8-168で削除した（プラン自体を撤廃。全プランが編集可能になった）。

/**
 * URL未入力の「追加」が**完全に無反応**だった問題（T-M8-37）。
 *
 * `add()` は先頭で `if (!url.trim()) return;` と黙って抜けており、ボタンは押せる状態だった。
 * 押してもトースト無し・強調無し・進行表示無しで、利用者からは壊れているのか自分の操作が
 * 悪いのか区別できなかった（CLAUDE.md 原則1）。同じ画面の他の操作は全てトーストを出しており、
 * ここだけが例外だった。
 */
test("URLが空のあいだ「追加」は押せず、理由が画面に出る（T-M8-37）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("learning-empty-url", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=persona"); // 参考ソースはアカウント設定タブの一番下（T-M8-103）

  const add = page.getByRole("button", { name: "参考アカウントを追加" });
  await expect(add).toBeDisabled();
  // 理由は欄ごとに出る（参考アカウント・参考投稿の2欄・T-M8-112）。
  await expect(page.getByText("XのURLを入力すると追加できます。")).toHaveCount(2);

  await page.getByLabel("参考アカウント", { exact: true }).fill("https://x.com/example");
  await expect(add).toBeEnabled();
  // 入力した側だけ理由が消える（もう片方は残る）。
  await expect(page.getByText("XのURLを入力すると追加できます。")).toHaveCount(1);
});

/**
 * 保存後に画面が「保存中…」のまま固まらないこと（T-M8-68）。
 *
 * `startTransition` の中で `setTemplates` 等の更新と `router.refresh()` を並べていた。
 * 保存自体は終わってトーストも出ているのに、**サーバー側の再取得が終わるまで
 * transition が pending のまま**で、入力欄もボタンも触れない状態が続いていた。
 * 利用者からは「保存が遅い／固まった」に見え、連打や再読み込みの原因になる。
 *
 * 同じ形の `router.refresh()` でも、transition 内で `setState` を呼んでいない画面
 * （AIモデル設定）は待たされない。**書き方で決まるので画面ごとに実測する**。
 *
 * **再取得をわざと遅らせて検証する。** 手元のDBは速いので、遅延を入れないと
 * 修正前のコードでもたまたま通ってしまい退行ガードにならない（実際に一度そうなった）。
 * 遅いのは利用者の回線でも本番でも普通に起きる状況で、そこで固まらないことが要件。
 * refresh 自体は残してあるので画面の鮮度は落ちていない。
 */

/** `router.refresh()` が出すRSC取得だけを遅らせる（保存のServer Actionには触らない）。 */
async function delayRscRefresh(page: Page, ms: number) {
  await page.route(
    (url) => url.searchParams.has("_rsc"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.continue();
    },
  );
}
test("プロンプトを保存すると、成功が出た時点でもう次の操作ができる（T-M8-68）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("prompt-pending");
  await signIn(page, account);
  await page.goto("/app/prompts?sec=post-prompt");

  // 投稿作成プロンプトはパターン管理（全件を並べる）になった（T-M8-129 U4b）。
  // **保存の成功が出た時点で次の操作ができる**という判断は変わらない。
  const card = page.locator("li", { hasText: "ニュース解説" }).first();
  const editor = card.getByLabel(/生成プロンプト/);
  await expect(editor).toBeVisible();
  await editor.fill(`${await editor.inputValue()}\n<!-- E2E-${randomUUID().slice(0, 8)} -->`);

  await delayRscRefresh(page, 3_000);
  await card.getByRole("button", { name: "保存", exact: true }).click();

  await expect(toastIn(page).getByText("を保存しました")).toBeVisible({ timeout: 20_000 });
  // 成功が出た時点で、同じカードの操作がまだ触れること（＝再取得を待って固まっていない）。
  expect(await editor.isDisabled(), "成功が出た時点で本文を続けて編集できること").toBe(false);
  expect(
    await card.getByRole("button", { name: "保存", exact: true }).isDisabled(),
    "成功が出た時点で保存が押せること",
  ).toBe(false);
});
