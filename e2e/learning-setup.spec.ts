import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 参考ソースからアカウント設定を作る（T-M8-344・運営者の指示 2026-08-27）。
 *
 * **アカウント設定を保存する前から参考ソースを登録でき、そこから設定を作れる。**
 * 以前は「先にアカウント設定を保存しないと参考ソースの欄が出ない」順序だったため、
 * 「誰に何を発信するか」を言葉にできない人はそこで止まっていた。
 *
 * 実AIは呼ばない（押すと分析が走り費用が出る）。ここで守るのは
 * **画面の順序・押せる／押せない理由・押した後の状態表示**の3つ。
 */
test("アカウント設定が未保存でも参考ソースを登録でき、作るボタンが理由つきで出る", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("learn-setup");
  // アカウント設定が未保存の状態にする（連携直後と同じ）。
  await query(
    `update x_accounts set base_md = '', base_md_version = 0, settings = '{}'::jsonb where id = $1`,
    [account.xAccountId],
  );
  await signIn(page, account);
  // 置き場所は プロンプト＞アカウント.md（T-M8-400・運営者の指示 2026-09-01。設定タブは廃止）。
  await page.goto("/app/prompts?sec=account-md");

  /*
    **並びは参考アカウント → ペルソナ〜**（T-M8-356→T-M8-400）。
    材料を入れてから中身を確認する流れが、上から下へ一直線になる。
    **「アカウント設定」という見出しは無い**（T-M8-346。同じ言葉を画面内で繰り返さない）。
  */
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("h2")].map((h) => (h.textContent ?? "").trim()),
  );
  expect(order[0]).toBe("参考アカウントからアカウント設定を作る");
  // 入口の対比（T-M8-406）: 参考アカウント → 自由入力 → ペルソナ の順。
  expect(order[1]).toBe("自由入力でアカウント設定を作る");
  expect(order.indexOf("ペルソナ")).toBeGreaterThan(1);
  expect(order).not.toContain("アカウント設定");
  // 対象アカウントは先頭（編集を始める前に見えている必要がある）。
  await expect(page.getByText(/対象アカウント: @/)).toBeVisible();

  // 材料が無いので押せない。**理由が画面に出る**（無効化だけにしない・T-M8-37）。
  const apply = page.getByRole("button", { name: "アカウント設定を反映する" });
  await expect(apply).toBeDisabled();
  await expect(page.getByText("XアカウントのURLを入れると押せます。")).toBeVisible();

  /*
    記入欄はこの時点で使える（アカウント設定の保存を待たない）。**欄ごとの「追加」は無い**——
    URLを入れれば下の1つのボタンで登録から反映まで進む（T-M8-346）。
    **上限は入力の前に出す**（T-M8-349。押してから弾かれない）。
  */
  const refAccount = page.getByRole("textbox", { name: "参考アカウント" }).first();
  await expect(refAccount).toBeEnabled();
  await expect(page.getByText("（0 / 3件）")).toBeVisible();
  // **参考投稿の欄は無い**（T-M8-400。投稿の型はパターン追加の「参考投稿からAIで作る」が担う）。
  await expect(page.getByRole("textbox", { name: "参考投稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /参考投稿の欄を増やす/ })).toHaveCount(0);
  await refAccount.fill("https://x.com/example");
  await expect(apply).toBeEnabled();

  // 欄は増やせる（1件では足りない人がいる）。増やしても実行ボタンは1つのまま。
  await page.getByRole("button", { name: /参考アカウントの欄を増やす/ }).click();
  await expect(page.getByRole("textbox", { name: "参考アカウント" })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "アカウント設定を反映する" })).toHaveCount(1);
});

/**
 * **反映した内容がアカウント設定の欄に入る**（T-M8-356・運営者の報告 2026-08-28）。
 *
 * 反映は保存前の提案（`x_accounts.settings_proposal`）としてDBへ入り、画面がそれを
 * フォームへ読み込む。**ここが切れていた**——フォームの初期値は `useState` なので、
 * `router.refresh()` で新しい提案を渡しても、すでにmountされた画面は古い値のままだった。
 * 押しても欄に何も入らない、という形で静かに壊れる（原則1）。
 *
 * AIは呼ばない（提案はmd_mergeが書くので、ここでは同じ形の行を直接入れて描画を見る）。
 */
test("反映した内容（提案）がアカウント設定の欄に入り、保存するまで確定しない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("learn-proposal");
  const proposal = {
    ng: { rules: [], topics: [], words: [] },
    persona: {
      audience: "提案された読者",
      speaker: "提案された発信者",
      value: "提案された価値",
    },
    themes: { free_text: "", primary: ["ai"], secondary: [] },
    tone: {
      emoji_max_per_post: 1,
      emoji_policy: "limited",
      first_person: "私",
      hashtags_max: 0,
      sentence_style: "です・ます調",
      thread_numbering: true,
    },
  };
  await query(
    `update x_accounts set settings_proposal = $2::jsonb where id = $1`,
    [account.xAccountId, JSON.stringify(proposal)],
  );

  await signIn(page, account);
  await page.goto("/app/prompts?sec=account-md");

  // 欄が提案の値で埋まっている（ここが本題）。
  await expect(page.getByLabel("発信者")).toHaveValue("提案された発信者");
  await expect(page.getByLabel("対象読者")).toHaveValue("提案された読者");
  await expect(page.getByLabel("提供価値")).toHaveValue("提案された価値");
  // **まだ保存されていない**ことを画面が言う。
  await expect(page.getByText("まだ保存されていません。")).toBeVisible();

  /*
    **取り消す道がある**（T-M8-360）。気に入らない反映から抜ける方法が無いと、
    開くたびに「まだ保存されていません」が出るのに消せない状態になる。
  */
  await page
    .getByRole("button", { name: "この反映を取り消して、保存済みの内容に戻す" })
    .click();
  await expect(page.getByText("まだ保存されていません。")).toHaveCount(0, { timeout: 20_000 });
  const [discarded] = await query<{ proposal: unknown }>(
    `select settings_proposal as proposal from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(discarded.proposal, "取り消したら提案は残らない").toBeNull();

  // もう一度提案を入れて、今度は保存で確定させる。
  await query(`update x_accounts set settings_proposal = $2::jsonb where id = $1`, [
    account.xAccountId,
    JSON.stringify(proposal),
  ]);
  await page.reload();
  await expect(page.getByLabel("発信者")).toHaveValue("提案された発信者");

  // 保存で確定し、提案は消える（開き直すたびに「反映しました」が出続けない）。
  await page.getByRole("button", { name: "アカウント設定を保存" }).click();
  await expect(page.getByText("まだ保存されていません。")).toHaveCount(0, { timeout: 20_000 });
  /*
    **保存すると本棚の一番下にアカウント.mdが1件増えて使用中になる**（T-M8-411・運営者の指示 2026-09-01）。
    トーストがそう言い、一覧の末尾のカードが「アカウント設定 vN」で「使用中」バッジを持つ。
  */
  await expect(page.getByText("を下の一覧に追加し、使用中にしました", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  const cards = page.locator("li").filter({ hasText: /アカウント設定 v\d+/ });
  await expect(cards).toHaveCount(1, { timeout: 20_000 });
  await expect(cards.first().getByText("使用中", { exact: true })).toBeVisible();
  const [presetRows] = await query<{ n: string }>(
    `select count(*)::text as n from prompt_presets where x_account_id = $1 and kind = 'base_md' and is_default and name like 'アカウント設定 v%'`,
    [account.xAccountId],
  );
  expect(presetRows.n).toBe("1");
  const [row] = await query<{ speaker: string; proposal: unknown }>(
    `select settings->'persona'->>'speaker' as speaker, settings_proposal as proposal
       from x_accounts where id = $1`,
    [account.xAccountId],
  );
  expect(row.speaker).toBe("提案された発信者");
  expect(row.proposal).toBeNull();
});
