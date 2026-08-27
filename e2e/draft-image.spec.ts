import { randomUUID } from "node:crypto";

import { deleteTestImage, query, uploadTestImage } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 生成画像プレビューの描画（要件06 §6、T-M7-22 の回帰・T-M7-26）。
 *
 * **要素があることではなく、ブラウザが実際に読み込めたことを見る。** 2026-07-27、CSPの
 * `img-src` が署名URL（ローカルSupabaseの http オリジン）を弾き、生成画像が必ず非表示に
 * なっていた。DOMには `<img>` が存在し、エラーも出ず、`naturalWidth` だけが 0 だった。
 * 当時この経路をE2Eが一度も踏んでいなかったため、人が画面を見るまで誰も気付けなかった。
 *
 * 画像生成jobは実APIを叩くのでE2Eでは動かさない。**実物のPNGをStorageへ置き**、それを指す
 * 下書きを作って描画だけを検証する（生成そのものは `npm run smoke:live` が見る）。
 */

interface Seeded {
  draftId: string;
  storagePath: string;
}

/** ready な画像を1枚持つ下書きを作る。Storageへ実物のPNGも置く。 */
async function seedDraftWithImage(account: {
  userId: string;
  xAccountId: string;
}): Promise<Seeded> {
  const localId = randomUUID();
  const draftId = randomUUID();
  // 本番と同じ階層（user/xAccount/draft/local_id.png）に置く。
  const storagePath = `${account.userId}/${account.xAccountId}/${draftId}/${localId}.png`;
  await uploadTestImage(storagePath);

  const thread = [
    {
      local_id: "p1",
      text: "画像付きの下書きです。プレビューが表示されることを確認します。",
      weighted_length: 32,
      sources: [],
      warnings: [],
    },
  ];
  const images = [
    {
      local_id: localId,
      post_local_id: "p1",
      status: "ready",
      provider: "openai",
      mime_type: "image/png",
      size_bytes: 4096,
      storage_path: storagePath,
    },
  ];
  await query(
    `insert into drafts (id, x_account_id, pattern_id, thread, initial_thread, status, images)
     values ($1, $2, (select id from post_patterns where x_account_id = $2 and seed_key = 'p2'), $3::jsonb, $3::jsonb, 'draft', $4::jsonb)`,
    [draftId, account.xAccountId, JSON.stringify(thread), JSON.stringify(images)],
  );
  return { draftId, storagePath };
}

test("生成画像プレビューが実際に読み込めて表示される", async ({ accounts, page }) => {
  const account = await accounts.create("draft-image");
  const seeded = await seedDraftWithImage(account);

  /**
   * このテストが見張るのは**生成画像が実際に読み込めること**（CSP・署名URL, T-M7-22）。
   * 画面遷移に伴う次の2つは不具合ではないので数えない（T-M8-04で整理）。
   *
   * - `net::ERR_ABORTED`: Next.js は先読み（RSC prefetch）を遷移時に打ち切る。**設計どおり**で、
   *   サイドバーのリンクが増えるほど発生する。
   * - 開発サーバの `loading.tsx` チャンク: Turbopack が動的に挿入するscriptが `strict-dynamic`
   *   に弾かれる。**本番ビルドでは発生しないことを実際に確認済み**（`next build` + `next start`
   *   で全E2Eを実行して再現しなかった）。利用者に影響しない開発時だけの事象。
   *
   * **画像に関するCSP違反・読み込み失敗は従来どおり失敗させる。**
   */
  const isBenign = (text: string) =>
    text.includes("net::ERR_ABORTED") || text.includes("src_app_app_loading_tsx");

  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isBenign(m.text())) consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) => {
    const text = `requestfailed: ${r.failure()?.errorText} ${r.url().slice(0, 60)}`;
    if (!isBenign(text) && !isBenign(r.url())) consoleErrors.push(text);
  });

  try {
    await signIn(page, account);

    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/app/posts?tab=drafts&draftId=${seeded.draftId}`);

      const img = page.getByAltText("生成画像プレビュー");
      await expect(img, `${label}: プレビューのimgが出ること`).toBeVisible();

      // **ここが本題**: 要素の存在ではなく、ブラウザが実際にデコードできたこと。
      // CSP違反・署名URL失効・デコード失敗はすべて naturalWidth === 0 に現れる。
      const loaded = await img.evaluate((el: HTMLImageElement) => ({
        complete: el.complete,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
        renderWidth: Math.round(el.getBoundingClientRect().width),
      }));
      expect(loaded.naturalWidth, `${label}: 画像が読み込めていること（CSP/署名URL）`).toBeGreaterThan(0);
      expect(loaded.naturalHeight, `${label}: 高さも取れていること`).toBeGreaterThan(0);
      expect(loaded.renderWidth, `${label}: 実際に描画されていること`).toBeGreaterThan(0);

      // 画像を入れてもページが横にはみ出さない
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${label}: 横スクロールが出ないこと`).toBeLessThanOrEqual(0);
    }

    // CSP違反はコンソールエラーとして出るため、0件であることも確かめる
    expect(consoleErrors, `コンソールエラー: ${consoleErrors.join(" / ")}`).toEqual([]);
  } finally {
    await deleteTestImage(seeded.storagePath);
  }
});

test("画像生成に失敗した下書きは「画像なし」と分かる形で出る", async ({ accounts, page }) => {
  const account = await accounts.create("draft-image-failed");
  const thread = [
    { local_id: "p1", text: "画像生成が失敗した下書きです。", weighted_length: 16, sources: [], warnings: [] },
  ];
  // 失敗時は storage_path が空で status=failed（image-generation の persistImageFailure と同じ形）。
  const images = [
    { local_id: randomUUID(), post_local_id: "p1", status: "failed", storage_path: "" },
  ];
  const [draft] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status, images)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), $2::jsonb, $2::jsonb, 'draft', $3::jsonb) returning id`,
    [account.xAccountId, JSON.stringify(thread), JSON.stringify(images)],
  );

  await signIn(page, account);
  await page.goto(`/app/posts?tab=drafts&draftId=${draft.id}`);

  // 本文は読めて、画像だけが失敗したと分かる（行き止まりにしない）
  await expect(page.getByText("画像生成が失敗した下書きです。")).toBeVisible();
  // バッジ（カード上部）とプレースホルダ（画像の場所）の2箇所に出る作りなので first を見る。
  await expect(page.getByText("画像なし（生成失敗）").first()).toBeVisible();
  await expect(page.getByAltText("生成画像プレビュー")).toHaveCount(0);
});

/**
 * 自分の画像を下書きへ添える（T-M8-353・運営者の指示 2026-08-28）。
 *
 * **画面から選んだファイルが、実際にStorageへ入って表示されるところまで見る。**
 * サーバー側の検証（形式・大きさ）は単体テストが見るので、ここでは
 * 「ブラウザのファイル選択 → Server Action → 署名URL → 描画」という**繋がり**を見る。
 * ここが切れると、押しても何も起きない・画像だけ出ない、という形で静かに壊れる。
 */
test("下書きに自分の画像をアップロードでき、外せる", async ({ accounts, page }) => {
  const account = await accounts.create("draft-image-upload");
  const thread = [
    { local_id: "p1", text: "画像を自分で添える下書きです。", weighted_length: 16, sources: [], warnings: [] },
  ];
  const [draft] = await query<{ id: string }>(
    `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status, images)
     values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), $2::jsonb, $2::jsonb, 'draft', '[]'::jsonb) returning id`,
    [account.xAccountId, JSON.stringify(thread)],
  );

  await signIn(page, account);
  await page.goto(`/app/posts?tab=drafts&draftId=${draft.id}`);

  // 画像が無い下書きでも入口が出る（無いと「AIに作らせるしかない」と受け取られる）。
  const label = page.getByText("画像をアップロード", { exact: true });
  await expect(label).toBeVisible();

  const sharp = (await import("sharp")).default;
  const png = await sharp({
    create: { width: 240, height: 135, channels: 3, background: { r: 200, g: 210, b: 240 } },
  })
    .png()
    .toBuffer();
  await page.locator(`#draft-image-${draft.id}`).setInputFiles({
    name: "mine.png",
    mimeType: "image/png",
    buffer: png,
  });

  // **実際に読み込めるところまで見る**（要素の存在では足りない・T-M7-22）。
  const img = page.getByAltText("生成画像プレビュー");
  await expect(img).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth),
      { message: "アップロードした画像がブラウザで読み込めること", timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  // 生成物と自分の画像を区別して出す（どちらが投稿されるか分かるように）。
  await expect(page.getByText("自分でアップロードした画像です。")).toBeVisible();

  // DBにも1枚だけ入る（投稿に使われるのは1枚なので、足さずに置き換える）。
  const [row] = await query<{ n: string; provider: string }>(
    `select jsonb_array_length(images)::text as n, images->0->>'provider' as provider
       from drafts where id = $1`,
    [draft.id],
  );
  expect(row.n).toBe("1");
  expect(row.provider).toBe("upload");

  // 外すと画像なしへ戻る。
  await page.getByRole("button", { name: "画像を外す" }).click();
  await expect(page.getByAltText("生成画像プレビュー")).toHaveCount(0, { timeout: 20_000 });
  const [after] = await query<{ n: string }>(
    `select jsonb_array_length(images)::text as n from drafts where id = $1`,
    [draft.id],
  );
  expect(after.n).toBe("0");
});
