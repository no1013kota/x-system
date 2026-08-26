import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * 複数Xアカウントの切り替え（A-6, 要件06 §2/§3, T-M8-31）。
 *
 * **切り替えたら中身も入れ替わることまで見る。** 「切り替えた表示になる」だけでは足りない。
 * 下書き・履歴・スケジュールがアカウント単位で分離されているのが要件（PRD A-6）なので、
 * 2つ目のアカウントに別のデータを置いて、画面が本当に入れ替わるかを確かめる。
 */

/** 同じ利用者へ2つ目のXアカウントを足す（1つ目は fixture が作る）。 */
async function addSecondAccount(userId: string): Promise<{ id: string; handle: string }> {
  const suffix = randomUUID().slice(0, 8);
  const handle = `e2e_second_${suffix}`;
  const [row] = await query<{ id: string }>(
    `insert into x_accounts
       (user_id, x_user_id, handle, name, auth_type, status,
        access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
        token_expires_at, base_md, base_md_version)
     values ($1, $2, $3, '2つ目のアカウント', 'managed', 'active',
             'e2e-fake', 'e2e-fake',
             array['tweet.read','tweet.write','users.read','offline.access'],
             now() + interval '1 hour', '# 発信定義書\n\n2つ目用。', 1)
     returning id`,
    [userId, `x-second-${suffix}`, handle],
  );
  return { id: row.id, handle };
}

async function addDraft(xAccountId: string, text: string): Promise<void> {
  await query(
    `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), $2::jsonb, $2::jsonb, 'draft')`,
    [
      xAccountId,
      JSON.stringify([
        { local_id: "p1", text, weighted_length: text.length * 2, sources: [], warnings: [] },
      ]),
    ],
  );
}

async function addPosted(xAccountId: string, text: string): Promise<void> {
  const tweetId = `sw-${randomUUID().slice(0, 8)}`;
  await query(
    `insert into drafts
       (x_account_id, pattern_id, thread, initial_thread, status, posted_mode, posted_at, root_tweet_id, tweet_ids)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), $2::jsonb, $2::jsonb, 'posted', 'manual', now() - interval '1 day', $3, $4::jsonb)`,
    [
      xAccountId,
      JSON.stringify([
        { local_id: "p1", text, weighted_length: text.length * 2, sources: [], warnings: [] },
      ]),
      tweetId,
      JSON.stringify([tweetId]),
    ],
  );
}

test("設定のXアカウント一覧から操作対象を切り替えられ、下書き・履歴・スケジュールも入れ替わる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("switch", { personaReady: true });
  const second = await addSecondAccount(account.userId);

  const firstDraft = `1つ目の下書き ${randomUUID().slice(0, 6)}`;
  const secondDraft = `2つ目の下書き ${randomUUID().slice(0, 6)}`;
  const firstPosted = `1つ目の投稿済み ${randomUUID().slice(0, 6)}`;
  const secondPosted = `2つ目の投稿済み ${randomUUID().slice(0, 6)}`;
  await addDraft(account.xAccountId, firstDraft);
  await addDraft(second.id, secondDraft);
  await addPosted(account.xAccountId, firstPosted);
  await addPosted(second.id, secondPosted);
  await query(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, enabled)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{1}', '09:00', 'draft', 'ai', true)`,
    [second.id],
  );

  await signIn(page, account);

  // 1つ目が操作中。下書きも履歴も1つ目のものだけ。
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(firstDraft)).toBeVisible();
  await expect(page.getByText(secondDraft)).toHaveCount(0);

  // 一覧から切り替える（ヘッダーのメニューを探させない）
  await page.goto("/app/settings?tab=x-accounts");
  const secondRow = page.locator("li", { hasText: `@${second.handle}` });
  await secondRow.getByRole("button", { name: "このアカウントを操作する" }).click();
  await expect(toastIn(page)).toContainText(`@${second.handle} に切り替えました`);

  // サイドバー下部のアカウント表示も追従する（ヘッダー廃止でそこへ移った・T-M8-328）。
  // **どのアカウントを操作中かが常に見えていること**が要点（誤アカウント投稿を防ぐ・要件06 §2）。
  await expect(
    page.getByRole("button", { name: new RegExp(`@${second.handle}`) }).last(),
  ).toBeVisible();

  // 下書きが入れ替わる
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(secondDraft)).toBeVisible();
  await expect(page.getByText(firstDraft)).toHaveCount(0);

  // 履歴も入れ替わる
  await page.goto("/app/posts?tab=history");
  await expect(page.getByText(secondPosted)).toBeVisible();
  await expect(page.getByText(firstPosted)).toHaveCount(0);

  // スケジュールも2つ目のものになる（1つ目にはスロットが無い）
  await page.goto("/app/schedule");
  await expect(page.getByText("ノウハウ・ハウツー").first()).toBeVisible();

  // 戻せる（行き止まりにしない）
  await page.goto("/app/settings?tab=x-accounts");
  const firstRow = page.locator("li", { hasText: `@${account.handle}` });
  await firstRow.getByRole("button", { name: "このアカウントを操作する" }).click();
  // **切り替えの完了を待ってから遷移する。** `click()` は Server Action の受理を待たないので、
  // 直後に `page.goto` すると in-flight のPOSTが中断され、切替先（`profiles.active_x_account_id`）
  // がDBへ届かないまま次の画面を見に行く。上の1回目と同じ形に揃える。
  // CPU負荷をかけて `--repeat-each=8` で走らせると実際に半分落ちた（負荷の無い手元では出ない）。
  await expect(toastIn(page)).toContainText(`@${account.handle} に切り替えました`);
  await page.goto("/app/posts?tab=drafts");
  await expect(page.getByText(firstDraft)).toBeVisible();
});

/**
 * 状態は**色でも**分かること（T-M8-36）。
 *
 * M8で `Badge` の tone 名を className へ文字列展開してしまい、`class="... success"` という
 * 存在しないユーティリティになって「有効」「要再連携」「停止中」「エラー」が全部同じ見た目に
 * なっていた。**typecheck・lint・既存E2Eはすべて緑**で、色が消えたことは誰も見ていなかった。
 *
 * クラス名ではなく**実際に計算された背景色**を見る。クラス名を確かめても、Tailwindが
 * そのユーティリティを持たなければ色は出ないので、同じ見落としが再発する。
 */
test("Xアカウントの状態は色でも区別できる（要再連携が有効と同じ見た目にならない）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("tone", { personaReady: true });
  const second = await addSecondAccount(account.userId);
  await query(`update x_accounts set status = 'expired' where id = $1`, [second.id]);

  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");
  await expect(page.getByRole("heading", { name: "Xアカウント" })).toBeVisible();

  const activeChip = page
    .locator("li", { hasText: `@${account.handle}` })
    .getByText("有効", { exact: true });
  const expiredChip = page
    .locator("li", { hasText: `@${second.handle}` })
    .getByText("要再連携（トークン失効）", { exact: true });
  await expect(activeChip).toBeVisible();
  await expect(expiredChip).toBeVisible();

  // **poll してから比べる**（T-M8-51）。1発勝負だと、落ちたときに「一瞬だけ透明だった」のか
  // 「ずっと透明」なのかが分からず原因を切り分けられない。
  const background = (locator: typeof activeChip) =>
    locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  for (const [label, chip] of [
    ["有効", activeChip],
    ["要再連携", expiredChip],
  ] as const) {
    await expect
      .poll(() => background(chip), { message: `${label} のチップに tone の背景色が当たること` })
      .not.toBe("rgba(0, 0, 0, 0)");
  }
  // 2つの状態が同じ色にならないこと
  expect(await background(activeChip)).not.toBe(await background(expiredChip));
});
