import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-08 スケジュールの停止→再開（要件06 §1・要件05 §7）。画面操作の結果がDBまで反映され、
 * 停止したまま削除しか残らない行き止まりにならないことを確認する。
 */

test("スロットを停止して再開でき、DBの enabled が追従する", async ({ accounts, page }) => {
  const account = await accounts.create("schedule");
  const [slot] = await query<{ id: string }>(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, enabled)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{1,3,5}', '19:00', 'draft', 'other', true) returning id`,
    [account.xAccountId],
  );
  await signIn(page, account);
  await page.goto("/app/schedule");

  const row = page.locator("li", { hasText: "ノウハウ" }).first();
  await expect(row.getByText("次回", { exact: false })).toBeVisible();

  await row.getByRole("button", { name: "停止" }).click();
  await expect(row.getByText("停止中（実行されません）")).toBeVisible();
  expect(
    (await query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [slot.id]))[0]
      .enabled,
  ).toBe(false);

  await row.getByRole("button", { name: "再開" }).click();
  await expect(row.getByText("停止中（実行されません）")).toHaveCount(0);
  expect(
    (await query<{ enabled: boolean }>(`select enabled from schedule_slots where id = $1`, [slot.id]))[0]
      .enabled,
  ).toBe(true);
});

/**
 * 「スケジュールをすべて停止」→「すべて再開」（T-M8-233・運営者の指示 2026-08-23）。
 *
 * ここでしか見えないのは**画面の出し分け**（停止中は停止ボタンではなく再開ボタンが出る）と
 * **同意チェックが無いと再開できない**こと。DB側の往復は schedule-slots.db.test.ts が見る。
 */
test("すべて停止で下書き枠も止まり、すべて再開で戻る（個別に止めた枠は戻らない）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("stop-all", { automationConsent: true });
  const slotIds = await query<{ id: string; mode: string }>(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, enabled)
     values
       ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{1}', '19:00', 'auto', 'other', true),
       ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{2}', '20:00', 'draft', 'other', true),
       ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{3}', '21:00', 'draft', 'other', false)
     returning id, mode`,
    [account.xAccountId],
  );
  const enabledOf = async () =>
    Object.fromEntries(
      (
        await query<{ id: string; enabled: boolean }>(
          `select id, enabled from schedule_slots where x_account_id = $1`,
          [account.xAccountId],
        )
      ).map((r) => [r.id, r.enabled]),
    );

  await signIn(page, account);
  await page.goto("/app/schedule");

  await page.getByRole("button", { name: "スケジュールをすべて停止" }).click();
  await page.getByRole("button", { name: "すべて停止", exact: true }).click();
  await expect(page.getByRole("button", { name: "スケジュールをすべて再開" })).toBeVisible();

  const stopped = await enabledOf();
  expect(Object.values(stopped).every((v) => v === false), "下書き枠が止まっていない").toBe(true);

  // 再開: 自動投稿を含むので同意チェックが要る（外したままでは押せない）。
  await page.getByRole("button", { name: "スケジュールをすべて再開" }).click();
  const confirm = page.getByRole("button", { name: "すべて再開", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox").check();
  await confirm.click();
  await expect(page.getByRole("button", { name: "スケジュールをすべて停止" })).toBeVisible();

  const resumed = await enabledOf();
  const manuallyStopped = slotIds[2].id;
  expect(resumed[slotIds[0].id], "自動投稿の枠が戻っていない").toBe(true);
  expect(resumed[slotIds[1].id], "下書きの枠が戻っていない").toBe(true);
  expect(resumed[manuallyStopped], "個別に止めた枠が勝手に復活した").toBe(false);
});

test("本日の投稿上限に達したら、投稿を試す前にバナーで分かる（要決定D-15 案A）", async ({
  accounts,
  page,
}) => {
  // 上限そのものは前からあったが、判定が投稿jobの中にしか無く**投稿しようとして初めて分かる**
  // 状態だった。50件を積んで、画面を開いた時点で分かることを確かめる。
  const account = await accounts.create("daily-limit", { personaReady: true });
  await query(
    `insert into usage_events
       (user_id, x_account_id, month, counter_type, operation, delta, reason, idempotency_key)
     select $1, $2, to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM'),
            'post_normal', 'post_create', 1, 'consume', 'e2e-daily-' || g::text
       from generate_series(1, 50) g`,
    [account.userId, account.xAccountId],
  );

  await signIn(page, account);
  const banner = page.getByRole("complementary", { name: "本日の投稿上限に達しました" });
  await expect(banner).toBeVisible();
  // 何件までか・いつ再開するか・自動実行はどうなるかが読める（行き止まりにしない）。
  await expect(banner).toContainText("翌日0:00（JST）");
  await expect(banner).toContainText("下書きの作成まで続きます");

  // 画面を移っても出続ける（App Shell の常設バナー）。
  await page.goto("/app/posts?tab=create");
  await expect(page.getByRole("complementary", { name: "本日の投稿上限に達しました" })).toBeVisible();
});

test("スケジュールにテーマを設定でき、行に出てDBへ入る（T-M8-28）", async ({ accounts, page }) => {
  // テーマはAIへ渡す指示になる。画面で選べても保存されなければ意味が無いので、DBまで見る。
  const account = await accounts.create("slot-theme", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/schedule");

  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await page.getByRole("radio", { name: "ノウハウ" }).check();
  // 選択肢は運用テーマ＋その他のみ（T-M8-100）。運用外テーマは新規に選べない。
  await page.getByLabel("テーマ", { exact: true }).selectOption("sns");
  await page.getByRole("checkbox", { name: "月", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 行にテーマが出る（編集画面を開かないと分からない状態にしない）
  await expect(page.getByText("SNS運用", { exact: true }).first()).toBeVisible();

  await expect
    .poll(
      async () =>
        (
          await query<{ theme: string | null }>(
            `select theme from schedule_slots where x_account_id = $1`,
            [account.xAccountId],
          )
        )[0]?.theme,
      { message: "テーマがDBへ保存されること" },
    )
    .toBe("sns");
});

/**
 * 週間表のセルで `aria-label` と `title` が一致すること（R38）。
 *
 * 以前は同一のテンプレートが2度書かれており、支援技術向けの名前と視覚的な補足が
 * ズレても typecheck・lint・E2E のどれも落ちなかった。同じ関数を通す形にしたので、
 * 実ブラウザで一致を見張る。
 */
test("週間表のセルは読み上げ名と補足が一致する（R38）", async ({ accounts, page }) => {
  const account = await accounts.create("slot-label", { personaReady: true });
  await query(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, image_enabled, enabled, theme)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), '{1,3}', '09:00', 'draft', false, true, 'ai')`,
    [account.xAccountId],
  );

  await signIn(page, account);
  await page.goto("/app/schedule");

  // 週間表のセルだけを見る（画面には他にも aria-label を持つ要素がある）。
  const cells = page.locator("[data-slot-cell]");
  const count = await cells.count();
  expect(count, "検査対象のセルが見つからない").toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i);
    const [label, title] = await Promise.all([
      cell.getAttribute("aria-label"),
      cell.getAttribute("title"),
    ]);
    expect(label, "読み上げ名が空").toBeTruthy();
    expect(title, `読み上げ名と補足がズレている: ${label} / ${title}`).toBe(label);
  }
});

/**
 * T-M8-129 U3b。**画面に内部ID（`p1`）を出さない**（要件06 §1.0）。
 *
 * パターンはアカウント別マスタ（`post_patterns`）になり、画面は名前だけを出す。
 * 自作パターンが選択肢に現れることも同時に確かめる——ここが崩れると
 * 「作れるのにどこにも出てこない」状態になり、利用者は何も気付けない。
 */
test("パターンは名前で表示・選択でき、自作パターンも選択肢に出る", async ({ accounts, page }) => {
  const account = await accounts.create("pattern-ui");
  // 自作パターンを1件作る（画面はDBから選択肢を引く）。
  await query(
    `insert into post_patterns (x_account_id, name, description, prompt, max_posts, max_posts_edit, sort_order)
     values ($1, 'E2E自作パターン', '検証用', '# タスク\n検証用のプロンプト', 2, 4, 5)`,
    [account.xAccountId],
  );
  await query(
    `insert into schedule_slots (x_account_id, pattern_id, weekdays, time_jst, mode, theme, enabled)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), '{1,3,5}', '19:00', 'draft', 'other', true)`,
    [account.xAccountId],
  );
  await signIn(page, account);
  await page.goto("/app/schedule");

  // 既存の枠は**名前**で出る（旧enumのIDは出さない）。
  await expect(page.getByText("ノウハウ・ハウツー").first()).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body, "内部IDが画面に出ていない").not.toMatch(/(^|[^0-9A-Za-z_])p[1-6](?![0-9A-Za-z_])/);

  // 追加フォームの選択肢に自作パターンが並ぶ。
  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await expect(page.getByRole("radio", { name: /E2E自作パターン/ })).toBeVisible();
  await page.getByRole("radio", { name: /E2E自作パターン/ }).check();
await page.getByRole("checkbox", { name: "月", exact: true }).check();
  await page.getByLabel("テーマ").selectOption("other");
await page.getByRole("button", { name: "作成", exact: true }).click();

  // 保存された枠が自作パターンを指している（表示も名前）。
  // **一覧の行**（`li`）で確かめる——選択肢のラベルにも同じ文字列があるため。
  await expect(page.locator("li", { hasText: "E2E自作パターン" }).first()).toBeVisible();
  const [saved] = await query<{ name: string }>(
    `select p.name from schedule_slots s join post_patterns p on p.id = s.pattern_id
      where s.x_account_id = $1 and p.seed_key is null`,
    [account.xAccountId],
  );
  expect(saved?.name).toBe("E2E自作パターン");
});
