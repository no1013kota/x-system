import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * T-M8-135（運営者の指示・2026-08-18）。
 *
 * **予約でも投稿作成と同じことができる**: パターンを追加でき、生成プロンプトを確認・編集でき、
 * 参考URL・プレースホルダー・追加指示を枠に保存できる。
 * 並び順も指定どおり（運営者の指示 2026-08-31: パターン→パターンを追加→生成プロンプト→
 * プレースホルダー→共通の入力（テーマ→参考URL→追加指示）→曜日→時刻→モード）。
 *
 * 保存が実DBへ入るところまで見る——画面が受け取っても列へ入らなければ、
 * 次に開いたとき黙って消えている（CLAUDE.md 原則1）。
 */
test("予約フォームの並び順が指定どおりで、生成入力が保存される", async ({ accounts, page }) => {
  const account = await accounts.create("sched-inputs");
  // 契約中のプランを設定する（未契約はプロンプト編集がロックされる・T-M8-168）。
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "スケジュールを追加" }).click();

  // プレースホルダーを持つパターン（自分の考え・意見）を選ぶと「プレースホルダー」の枠が出る。
  await page.getByRole("radio", { name: /自分の考え・意見/ }).check();
  const opinion = page.getByLabel("自分の考え（任意）");
  await expect(opinion).toBeVisible();

  /*
    並び順（フォーム内のラベルを上から拾う・運営者の指示 2026-08-31）:
    型に属する入力（プレースホルダー）が先、共通の入力（テーマ・参考URL・追加指示）が後。
    それぞれ囲み＋見出しでどちらのグループかが分かる。
  */
  const order = await page.evaluate(() => {
    const form = [...document.querySelectorAll("h2,h3")]
      .find((h) => h.textContent?.includes("新しいスケジュール"))?.parentElement;
    const wanted = [
      "パターン", "パターンを追加", "生成プロンプト", "プレースホルダー",
      "共通の入力", "テーマ", "参考URL", "追加指示", "曜日", "時刻", "モード",
    ];
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const s = (n.textContent ?? "").trim();
        for (const w of wanted) if (s.startsWith(w) && !out.includes(w)) out.push(w);
      }
      n.childNodes.forEach(walk);
    };
    if (form) walk(form);
    return out;
  });
  expect(order).toEqual([
    "パターン", "パターンを追加", "生成プロンプト", "プレースホルダー",
    "共通の入力", "テーマ", "参考URL", "追加指示", "曜日", "時刻", "モード",
  ]);

  // プロンプト編集欄はインラインで見えている（折りたたみは廃止・T-M8-203）。
  const promptBox = page.getByLabel(/生成プロンプト（自分の考え・意見）/);
  await expect(promptBox).toBeVisible();
  await expect(promptBox).toHaveValue(/\{自分の考え\}/);

  // この予約にだけ使うプロンプトへ変更する。
  await promptBox.fill("# タスク\nこの予約だけの指示。本人の考え: {自分の考え}");
  await page.getByRole("radio", { name: "この予約にだけ使う" }).check();

  /*
    プレースホルダーの増減が入力欄へリアルタイムに反映される（T-M8-186）。
    {切り口} を足すと欄が現れ、消すと欄も消える（値は本文にある名前だけ保存される）。
  */
  await promptBox.fill(
    "# タスク\nこの予約だけの指示。本人の考え: {自分の考え} 切り口: {切り口}",
  );
  const angle = page.getByLabel("切り口（任意）");
  await expect(angle).toBeVisible();
  await angle.fill("初心者向け");
  await promptBox.fill("# タスク\nこの予約だけの指示。本人の考え: {自分の考え}");
  await expect(page.getByLabel("切り口（任意）")).toHaveCount(0);

  await opinion.fill("私はこう考える");
  await page.getByLabel("参考URL（任意）").fill("https://example.com/a");
  await page.getByLabel("追加指示（任意）").fill("冒頭に「検証:」を付ける");
  await page.getByLabel("テーマ").selectOption("other");
  await page.getByRole("checkbox", { name: "月", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 実DBへ入っていること。
  await expect(page.getByRole("button", { name: "スケジュールを追加" })).toBeVisible();
  const [saved] = await query<{
    source_url: string | null;
    placeholder_values: Record<string, string>;
    prompt_override: string | null;
    instructions: string | null;
  }>(
    `select source_url, placeholder_values, prompt_override, instructions
       from schedule_slots where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(saved.source_url).toBe("https://example.com/a");
  expect(saved.placeholder_values).toEqual({ 自分の考え: "私はこう考える" });
  expect(saved.prompt_override).toContain("この予約だけの指示");
  expect(saved.instructions).toBe("冒頭に「検証:」を付ける");
  // パターン本体は書き換えていない（「この予約にだけ」を選んだので）。
  const [pattern] = await query<{ prompt: string | null }>(
    `select prompt from post_patterns where x_account_id = $1 and seed_key = 'p2'`,
    [account.xAccountId],
  );
  expect(pattern.prompt, "「この予約にだけ」はパターンを書き換えない").toBeNull();
});

/** 予約画面からパターンを追加でき、そのまま選択された状態になる（T-M8-135）。 */
test("予約画面からパターンを追加でき、そのまま選ばれる", async ({ accounts, page }) => {
  const account = await accounts.create("sched-add-pattern");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "スケジュールを追加" }).click();

  await page.getByRole("button", { name: "パターンを追加" }).click();
  await page.locator('[id^="slot-new-pattern-"][id$="-name"]').fill("予約から作った型");
  await page
    .locator('[id^="slot-new-pattern-"][id$="-prompt"]')
    .fill("# 投稿内容\n予約から作った型\n\n# 構成と分量とスレッド数\nメインポスト：\n\n# 語り口\n淡々と");
  await page.getByRole("button", { name: "追加", exact: true }).click();

  const radio = page.getByRole("radio", { name: /予約から作った型/ });
  await expect(radio).toBeVisible();
  await expect(radio).toBeChecked();

  const [saved] = await query<{ name: string }>(
    `select name from post_patterns where x_account_id = $1 and seed_key is null`,
    [account.xAccountId],
  );
  expect(saved.name).toBe("予約から作った型");
});

// 旧standard（編集不可プラン）の検証はT-M8-168で削除した（プラン自体を撤廃。全プランが編集可能になった）。

/**
 * 「パターンに保存して他でも使う」を選んだときは**パターン本体**が書き換わる（T-M8-135）。
 *
 * この経路はテストが無く、Server Action のキー名を間違えていても
 * **型検査を通り、押すと必ず失敗する**状態だった（Actionの引数は `unknown`）。
 * 保存先が2つあるので、どちらを選んだかで結果が変わることを実DBで固定する。
 */
test("「パターンに保存」を選ぶとパターン本体が書き換わり、枠の上書きは残らない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("sched-prompt-save");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await page.getByRole("radio", { name: /自分の考え・意見/ }).check();

  const promptBox = page.getByLabel(/生成プロンプト（自分の考え・意見）/);
  await promptBox.fill("# タスク\nパターンごと書き換えた指示。本人の考え: {自分の考え}");
  await page.getByRole("radio", { name: "パターンに保存して他でも使う" }).check();
  await page.getByLabel("テーマ").selectOption("other");
  await page.getByRole("checkbox", { name: "火", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 保存に失敗すると枠が作られないので、まず枠ができたことを見る。
  await expect(page.getByRole("button", { name: "スケジュールを追加" })).toBeVisible();
  const [slot] = await query<{ prompt_override: string | null }>(
    `select prompt_override from schedule_slots where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(slot, "枠が作られていない（プロンプト保存で失敗した可能性）").toBeDefined();
  expect(slot.prompt_override, "パターンに保存したら枠の上書きは持たない").toBeNull();

  const [pattern] = await query<{ prompt: string | null }>(
    `select prompt from post_patterns where x_account_id = $1 and seed_key = 'p2'`,
    [account.xAccountId],
  );
  expect(pattern.prompt, "パターン本体が書き換わっている").toContain("パターンごと書き換えた指示");
});

/**
 * 予約画面で**追加した直後**のパターンにプロンプトを保存できる（T-M8-135）。
 *
 * 自分で作ったパターンは `prompt` が必ず非nullなので、画面が
 * 「上書きはまだ無い」として保存しにいくと楽観ロックの `prompt is null` 条件に当たって
 * **必ず衝突する**。作成時の `updated_at` を画面へ返すことで直した経路の回帰テスト。
 */
test("追加した直後のパターンにもプロンプトを保存できる", async ({ accounts, page }) => {
  const account = await accounts.create("sched-new-then-save");
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "スケジュールを追加" }).click();

  await page.getByRole("button", { name: "パターンを追加" }).click();
  await page.locator('[id^="slot-new-pattern-"][id$="-name"]').fill("追加直後の型");
  await page
    .locator('[id^="slot-new-pattern-"][id$="-prompt"]')
    .fill("# 投稿内容\n最初の内容\n\n# 構成と分量とスレッド数\nメインポスト：");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByRole("radio", { name: /追加直後の型/ })).toBeChecked();

  // そのまま生成プロンプトを直して「パターンに保存」する（編集欄はインラインで見えている）。
  const promptBox = page.getByLabel(/生成プロンプト（追加直後の型）/);
  await promptBox.fill("# 投稿内容\n保存し直した内容\n\n# 構成と分量とスレッド数\nメインポスト：");
  await page.getByRole("radio", { name: "パターンに保存して他でも使う" }).check();
  await page.getByLabel("テーマ").selectOption("other");
  await page.getByRole("checkbox", { name: "水", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  await expect(page.getByRole("button", { name: "スケジュールを追加" })).toBeVisible();
  const [pattern] = await query<{ prompt: string | null }>(
    `select prompt from post_patterns where x_account_id = $1 and name = '追加直後の型'`,
    [account.xAccountId],
  );
  expect(pattern.prompt, "楽観ロックで衝突せず保存できている").toContain("保存し直した内容");
});

/** 参考URLは投稿作成と同じ条件（https のみ）。画面ごとに通る値が違わない（T-M8-135）。 */
test("参考URLは https 以外を受け付けない", async ({ accounts, page }) => {
  const account = await accounts.create("sched-url-scheme");
  await signIn(page, account);
  await page.goto("/app/schedule");
  await page.getByRole("button", { name: "スケジュールを追加" }).click();
  await page.getByLabel("参考URL（任意）").fill("http://example.com/a");
  await page.getByLabel("テーマ").selectOption("other");
  await page.getByRole("checkbox", { name: "木", exact: true }).check();
  await page.getByRole("button", { name: "作成", exact: true }).click();

  // 保存されない（枠が作られない）。
  const rows = await query<{ n: string }>(
    `select count(*)::text n from schedule_slots where x_account_id = $1`,
    [account.xAccountId],
  );
  expect(rows[0].n, "http:// のURLで枠が作られてしまっている").toBe("0");
});
