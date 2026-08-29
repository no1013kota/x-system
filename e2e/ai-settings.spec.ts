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
  "## 5. 参考にする型",
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

  // 変更履歴は廃止した（T-M8-362）。戻したいときは本棚で別の本文を選ぶ。
  await expect(page.getByRole("heading", { name: /変更履歴/ })).toHaveCount(0);
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
  await page.goto("/app/ai-settings?tab=persona"); // 参考ソースはアカウント設定タブの先頭（T-M8-344）

  /*
    **登録専用のボタンは無い**（T-M8-346）。記入して「アカウント設定を作る」を押すと、
    登録 → 分析 → 反映まで1つの操作として進む。ここで見るのは登録が受け付けられて
    pending になるところまで（分析はAIを呼ぶので走らせきらない）。
  */
  const handle = `e2e_ref_${randomUUID().slice(0, 6)}`;
  await page.getByRole("textbox", { name: "参考アカウント" }).first().fill(`https://x.com/${handle}`);
  await page.getByRole("button", { name: "アカウント設定を反映する" }).click();

  /*
    **押した結果が画面に出る**（T-M8-18／原則1）。ここでは一覧に「分析待ち」の行が増えることで見る。
    「アカウント設定を書き換え中です」の表示は分析が終わるまでの間だけ出るもので、
    E2EはダミーのAIキーで動くため分析が即座に終わって（材料0件で）消える——
    このテストで押さえると、実装ではなく鍵の有無で結果が変わる。
  */
  /*
    **状態は指定しない**（T-M8-358）。E2EはダミーのX/AIキーで動くので、分析jobが
    その場で失敗して `pending` を通り越していることがある。ここで見たいのは
    「登録が受け付けられて一覧に出ること」で、**通り過ぎる途中の状態を掴もうとすると
    速さで結果が変わる**（実際にフルスイートで `failed` を掴んで落ちた）。
  */
  await expect(page.getByRole("listitem").filter({ hasText: handle })).toBeVisible();

  // DBにも登録されている（状態は問わない）。
  await expect
    .poll(
      async () =>
        (
          await query<{ n: string }>(
            `select count(*)::text as n from learning_sources
              where x_account_id = $1 and url like $2 and removed_at is null`,
            [account.xAccountId, `%${handle}%`],
          )
        )[0]?.n,
      { timeout: 20_000, message: "学習ソースが登録されること" },
    )
    .toBe("1");

  // 分析が終わった状態にしてから削除する（AIは呼ばない）。
  //
  /*
    **実行中の学習系jobを終端させる。** 削除は「同一アカウントに queued/running の学習jobがあれば
    job_conflict」で弾く仕様（要件05 §8）。追加時にdispatchされたjobが残っていると削除が通らず、
    環境によって結果が変わる（2026-08-01、CIはダミーキーでjobが残り続けて落ちた。手元は実キーで
    jobが早く終わるため通っていた）。状態を作るテストなので、前提を揃えてから操作する。

    **`md_merge` も含める**（T-M8-357）。反映のボタンは「登録→分析→反映」まで進むので、
    分析がダミーキーで即失敗すると、そのまま反映の `md_merge` が起票される。
    `learning_analysis` だけを畳んでいたため、**タイミング次第で削除だけが弾かれて**いた
    （フルスイートでだけ稀に落ちる形。単独で回すと反映まで進む前に削除が走って通っていた）。
  */
  /*
    **先に画面を作り直して、反映の待ちループを止める**（T-M8-358）。
    ボタンを押した画面は「分析が終わるのを待って反映を起票する」ループを回しているので、
    先にjobを畳むと**その瞬間に「終わった」と判断して `md_merge` を起票する**——
    畳んだ側から新しいjobが生えて、削除だけが弾かれる。順番が結果を決めるので、
    ループを捨ててから状態を作る。
  */
  await page.reload();
  await query(
    `update generation_jobs set status = 'canceled', finished_at = now()
      where x_account_id = $1 and kind in ('learning_analysis', 'md_merge')
        and status in ('queued','running')`,
    [account.xAccountId],
  );
  await query(
    `update learning_sources set status = 'analyzed',
        analysis_summary = jsonb_build_object('style', 'テスト')
      where x_account_id = $1 and url like $2`,
    [account.xAccountId, `%${handle}%`],
  );
  // 残っていないことを確かめてから進む（残っていれば削除は job_conflict で弾かれる）。
  await expect
    .poll(
      async () =>
        (
          await query<{ n: string }>(
            `select count(*)::text as n from generation_jobs
              where x_account_id = $1 and kind in ('learning_analysis', 'md_merge')
                and status in ('queued','running')`,
            [account.xAccountId],
          )
        )[0]?.n,
      { timeout: 20_000, message: "学習系jobが残っていないこと" },
    )
    .toBe("0");
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

/*
  URL未入力で押せない理由を出すこと（T-M8-37）の検証は `learning-setup.spec.ts` へ移した。
  欄ごとの「追加」ボタンが無くなり（T-M8-346）、押せる／押せないの判定が
  「アカウント設定を作る」1つになったため、同じことを2か所で見る意味がなくなった。
*/

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
