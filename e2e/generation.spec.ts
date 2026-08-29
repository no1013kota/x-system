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
       (x_account_id, kind, trigger, pattern_id, status, progress_stage, attempt, started_at, request_key)
     values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p3'), 'running', 'writing', 1, now(), $2)
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

/**
 * **実AIを叩くので既定では実行しない**（T-M8-32）。
 *
 * 「生成する」を押すと Server Action が job を作り、`after()` が worker へ渡して**本物のAIを呼ぶ**
 * （1回あたり約$0.13）。`release:check` はE2Eを含むため、既定で実行すると保存前チェックのたびに
 * 課金される。`check:providers` と同じ形で **明示的に有効化したときだけ**走らせる。
 *
 *   E2E_LIVE_AI=1 npm run test:e2e -- e2e/generation.spec.ts
 */
const LIVE_AI = process.env.E2E_LIVE_AI === "1";

(LIVE_AI ? test : test.skip)("投稿作成でテーマを選ぶと、そのテーマが生成jobへ渡る（T-M8-28・実AI）", async ({ accounts, page }) => {
  // 画面で選べても、AIへ渡る入力に入っていなければ何も変わらない。job の input まで見る。
  const account = await accounts.create("gen-theme", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  await page.getByLabel("テーマ", { exact: true }).selectOption("investment");
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
      { timeout: 20_000, message: "テーマが生成jobの入力へ入ること" },
    )
    .toBe("investment");
});

test("テーマを選ばないと生成を始められず、理由が画面に出る（T-M8-29 / T-M8-37）", async ({
  accounts,
  page,
}) => {
  // 「指定なし」を既定にすると、選んだつもりで選んでいない状態が起きる。必須にした（T-M8-29）。
  //
  // T-M8-37: 以前は**押せてしまい**、サーバーの `z.enum` で弾かれて「入力内容を確認してください」
  // という**どの項目が悪いか分からない**トーストが5秒で消えるだけだった。フィールドの強調も無く、
  // 非エンジニアの運営者には原因を辿る手段が無かった。**押す前に止め、理由を画面に置く。**
  const account = await accounts.create("gen-theme-required", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  const generate = page.getByRole("button", { name: /生成する/ });
  await expect(generate).toBeDisabled();
  await expect(page.getByText("テーマを選ぶと生成できます。")).toBeVisible();

  // jobは作られない
  await expect
    .poll(
      async () =>
        (
          await query<{ n: number }>(
            `select count(*)::int as n from generation_jobs where x_account_id = $1`,
            [account.xAccountId],
          )
        )[0].n,
      { timeout: 5_000, message: "テーマ未選択では生成jobが作られないこと" },
    )
    .toBe(0);

  // 選べば押せる状態になり、理由の文字も消える（実際に生成させると本物のAIを叩いて課金される
  // ので、ここでは押せる状態になることまでを見る。jobが作られる側は上の実AIテストが担当する）。
  await page.getByLabel("テーマ", { exact: true }).selectOption("other");
  await expect(generate).toBeEnabled();
  await expect(page.getByText("テーマを選ぶと生成できます。")).toHaveCount(0);
});

/**
 * 投稿作成画面のプロンプト表示・編集（T-M8-92・md/premium）。
 *
 * 実際の生成はAI課金が出るため押さず、次を固定する:
 * - 選択中の型の解決済みプロンプト（system default）が表示される
 * - 編集すると「この生成にだけ使う／保存して以後の生成にも使う」を選べ、「元に戻す」で破棄できる
 * - 型を切り替えると編集は破棄される（別の型へ持ち越さない）
 */
test("プロンプトをインラインで表示・編集でき、型の切替で編集が破棄される（T-M8-92/203）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("prompt-edit");
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

  /*
    折りたたみ「生成に使うプロンプト」（アカウント.md/投稿の型/画像の3タブ）はT-M8-203で廃止。
    選択中パターンの編集欄が**開かなくても見えている**こと、アカウント.md・画像の編集が
    この画面に無い（設定＞プロンプトへ集約）ことを固定する。
  */
  await expect(page.locator("details", { hasText: "生成に使うプロンプト" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "プロンプトの種類" })).toHaveCount(0);

  // 既定パターン（p1）の解決済み本文がインラインで見えている。
  const editor = page.getByLabel(/生成プロンプト（.+）/);
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(/# タスク/);
  await expect(editor).toHaveValue(/ニュース/);

  // {名前} の説明カラウトが目立つ形で出ている（T-M8-203）。
  await expect(page.getByText("その名前の入力欄がこの下に自動で出ます", { exact: false })).toBeVisible();

  // 編集 → 適用方法の選択と「元に戻す」が現れる。
  await editor.fill("# タスク\nE2E編集テスト");
  await expect(page.getByLabel("この生成にだけ使う")).toBeChecked();
  await expect(page.getByLabel("保存して以後の生成にも使う")).toBeVisible();

  // 型を切り替えると編集は破棄され、切替先のプロンプトが入る。
  await page.getByRole("radio", { name: /考え・意見/ }).check();
  await expect(editor).not.toHaveValue(/E2E編集テスト/);

  // 「元に戻す」でも破棄できる。
  await editor.fill("別の編集");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByRole("button", { name: "元に戻す" })).toHaveCount(0);
});

// 旧standard（編集不可プラン）の検証はT-M8-168で削除した（プラン自体を撤廃。全プランが編集可能になった）。

/**
 * 生成中に画面を開き直したとき Hydration mismatch が出ないこと（T-M8-113）。
 *
 * `release:check` のE2Eでまれに「server rendered text didn't match the client」が出ていた。
 * 出所は投稿作成画面の **「経過 0:07」の秒カウンタ**。`useState(() => Date.now())` の初期値は
 * **サーバー描画時と、ブラウザが後から追いつく（hydration）時の2回**評価されるので、その間に
 * 秒が変わると表示が食い違う。生成中に再訪したときだけ出るため再現が難しく、放置すると
 * 本当の不整合が起きても同じ警告に紛れて気付けなくなる。
 *
 * **JSの到着をわざと遅らせて秒を必ず跨がせる。** 遅らせないと、手元では両者が同じ秒に収まって
 * しまい修正前のコードでも通ってしまう（実測で確認した）。回線の遅い利用者では普通に起きる。
 */
test("生成中に開き直しても画面のつなぎ目でズレが出ない（T-M8-113）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("hydration");
  await seedRunningJob(account.xAccountId);
  await signIn(page, account);

  const mismatches: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/hydrat|didn't match|did not match/i.test(text)) mismatches.push(text);
  });
  page.on("pageerror", (err) => {
    if (/hydrat|didn't match|did not match/i.test(err.message)) mismatches.push(err.message);
  });

  // サーバー描画のあと、ブラウザがJSで追いつくまでを2秒あける（＝秒が必ず変わる）。
  await page.route(/\/_next\/static\/chunks\/.*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  await page.goto("/app/posts?tab=create");
  await expect(page.getByRole("button", { name: "生成中…" })).toBeVisible({ timeout: 30_000 });
  // hydrationが終わって経過表示が動き出すまで見届ける。
  await expect(page.getByText(/経過 \d+:\d\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/経過 0:0[2-9]|経過 0:[1-5]\d/)).toBeVisible({ timeout: 30_000 });

  expect(mismatches, "サーバー描画とブラウザの表示が食い違わないこと").toEqual([]);
});

/**
 * T-M8-130。**投稿作成画面からパターンを追加できる**（運営者の指示・2026-08-18）。
 *
 * 投稿を作ろうとして「この型が無い」と気付くのはこの画面なので、ここで作れないと
 * 設定画面へ往復することになり、目的（投稿を作る）が中断する。
 * 追加したらそのまま選択された状態になることまで確かめる。
 */
test("投稿作成画面からパターンを追加でき、そのまま選択された状態になる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("pattern-inline");
  // 契約中のプランを設定する（未契約はプロンプト編集がロックされる・T-M8-168）。
  await query(`update profiles set plan = 'premium' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/posts?tab=create");

await page.getByRole("button", { name: "パターンを追加" }).click();
  // 追加中は既存パターンのアクティブが外れる（T-M8-203。フォームが2つの対象を同時に指さない）。
  // **パターンの選択肢だけを見る**（T-M8-331で「生成したあと」のラジオが同じ画面に増えた）。
  await expect(
    page.getByRole("group", { name: "パターン" }).getByRole("radio", { checked: true }),
  ).toHaveCount(0);
  // 追加中は生成できない（理由も画面に出る）。
  await expect(page.getByText("パターンを追加中です", { exact: false })).toBeVisible();
  // プロンプト欄には雛形が入っている（空欄から書き始めさせない）。
  await expect(page.locator("#new-pattern-prompt")).toHaveValue(
    /# 投稿内容[\s\S]*# 構成と分量とスレッド数[\s\S]*# 語り口/,
  );
  // プレースホルダーは手入力欄ではなく、プロンプトの {対象読者} から自動で導出される（T-M8-194）。
  await page.locator("#new-pattern-name").fill("画面から作った型");
  await page
    .locator("#new-pattern-prompt")
    .fill(
      "# 投稿内容\n画面から作った型のプロンプト\n\n# 構成と分量とスレッド数\nメインポスト：\n\n# 語り口\n{対象読者} に向けて書く",
    );
  // 書いた時点で {対象読者} の入力欄が自動で出る（T-M8-194/203。グレー小の列挙は出さない・2026-08-22）。
  await expect(page.getByLabel("対象読者（任意）")).toBeVisible();
  await page.getByRole("button", { name: "追加", exact: true }).click();

  // 追加した型が選択肢に出て、選ばれている。
  const radio = page.getByRole("radio", { name: /画面から作った型/ });
  await expect(radio).toBeVisible();
  await expect(radio).toBeChecked();

const [saved] = await query<{
    name: string;
    max_posts: number;
    prompt: string;
    placeholders: { name: string }[];
  }>(
    `select name, max_posts, prompt, placeholders from post_patterns
      where x_account_id = $1 and seed_key is null`,
    [account.xAccountId],
  );
  expect(saved.name).toBe("画面から作った型");
  // 「メインポスト：」だけ＝スレッド0 → 総1ポスト（プロンプトから読む）。
  expect(saved.max_posts).toBe(1);
  expect(saved.prompt).toContain("画面から作った型のプロンプト");
  expect(saved.placeholders).toEqual([{ name: "対象読者" }]);

// **プレースホルダーの入力欄が投稿作成画面に出る**（{対象読者} に入る旨も書いてある）。
  await expect(page.getByLabel("対象読者（任意）")).toBeVisible();
  await expect(page.getByText("{対象読者} に入ります", { exact: false })).toBeVisible();

  /*
    **この画面から削除もできる**（T-M8-133）。何が起きるかを確認ダイアログで先に示す。
    削除は各パターンのカードの中にあり、読み上げ名にパターン名が入る（T-M8-134）。
  */
  await page.getByRole("button", { name: "「画面から作った型」を削除" }).click();
  await expect(page.getByText("過去の下書き・履歴は残ります")).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("radio", { name: /画面から作った型/ })).toHaveCount(0);
  expect(
    (
      await query<{ n: string }>(
        `select count(*)::text n from post_patterns where x_account_id = $1 and seed_key is null`,
        [account.xAccountId],
      )
    )[0].n,
  ).toBe("0");
});
