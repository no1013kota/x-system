import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
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
  await page.goto("/app/ai-settings?tab=base-md");

  const editor = page.getByLabel("アカウント.md本文");
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
  // 見出しと説明文の2箇所に出るため見出しだけを見る。
  await expect(page.getByRole("heading", { name: "変更履歴" })).toBeVisible();
});

test("見出し構造が壊れた内容は保存されず、何を直せばよいか分かる", async ({ accounts, page }) => {
  const account = await accounts.create("base-md-invalid");
  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=base-md");

  const editor = page.getByLabel("アカウント.md本文");
  await expect(editor).toBeVisible();

  // 「## 3.」を落とした状態（6見出しが揃っていない）
  await editor.fill(VALID_BASE_MD.replace("## 3. トーン&マナー", "### 3. トーン&マナー"));
  await page.getByRole("button", { name: "保存", exact: true }).click();

  // 何が悪いかが具体的に出る（「エラー」だけで終わらせない）
  await expect(page.getByText("見出し構造が不正です", { exact: false })).toBeVisible({
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
  await page.locator('input[type="url"], input[placeholder^="https://x.com"]').first().fill(
    `https://x.com/${handle}`,
  );
  await page.getByRole("button", { name: "追加", exact: true }).click();

  // **成功したことが利用者に分かる**（T-M8-18）。以前は追加が通っても画面は無言で、
  // 一覧に行が増えたことに気づけるかどうかに委ねていた。
  await expect(toastIn(page)).toContainText("学習ソースを追加しました");

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

test("通常プランではアカウント.md・プロンプトが鍵付きで案内され、行き先が1つに絞られる（T-M8-20）", async ({
  accounts,
  page,
}) => {
  // 「まだ何も無い（＝自分で埋められる）」と「このプランでは開けない（＝契約を変えるしかない）」を
  // 同じ空状態で出していた。前者だと思った利用者は設定画面を探しに行って行き止まりになる。
  const account = await accounts.create("md-locked");
  // **`stripe_customer_id` を必ず入れる**（T-M8-89）。fixtureはこれをNULLのままにするが、
  // 実際の契約者は必ず顧客が紐づいている。NULLのままだと `/plans` が送り返さないため、
  // 「アップグレードを押してもホームへ戻るだけ」という実利用者だけが踏む状態を再現できない。
  await query(`update profiles set plan = 'standard', stripe_customer_id = $2 where id = $1`, [
    account.userId,
    `cus_e2e_${account.userId.slice(0, 8)}`,
  ]);

  await signIn(page, account);
  await page.goto("/app/ai-settings?tab=base-md");

  await expect(
    page.getByRole("heading", { name: /アカウント.mdの確認・編集は mdプラン以上/ }),
  ).toBeVisible();
  // 行き先はStripeのプラン選択（Portal `intent=update`）。Portalセッションはサーバーで作るため
  // `href` を先に決められず、リンクではなくボタンで出す。**`/plans` へのリンクへ戻したら落ちる**
  // ——契約者は `/plans` から `/app` へ送り返されるので、押しても何も起きない導線になる。
  const upgrade = page.getByRole("button", { name: "プランをアップグレード" });
  await expect(upgrade).toBeVisible();
  await expect(page.getByRole("link", { name: /アップグレード/ })).toHaveCount(0);

  // プロンプトタブも同じ扱い。
  await page.goto("/app/ai-settings?tab=prompts");
  await expect(
    page.getByRole("heading", { name: /プロンプトのカスタマイズは mdプラン以上/ }),
  ).toBeVisible();
});

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

  const add = page.getByRole("button", { name: "追加", exact: true });
  await expect(add).toBeDisabled();
  await expect(page.getByText("XのURLを入力すると追加できます。")).toBeVisible();

  await page.getByRole("textbox", { name: "URL" }).fill("https://x.com/example");
  await expect(add).toBeEnabled();
  await expect(page.getByText("XのURLを入力すると追加できます。")).toHaveCount(0);
});
