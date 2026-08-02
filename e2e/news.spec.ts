import { randomUUID } from "node:crypto";

import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * SC-06 ニュース一覧とSC-05 ホームの重要ニュース（要件06 §1.4・§5、T-M7-06）。
 *
 * NEWSジョブは実APIを叩くためE2Eでは動かさず、`news_items` を直接seedして
 * **表示・絞り込み・出し分け**だけを検証する。`news_items` は利用者に紐づかない共通表なので、
 * 一意なタイトルで識別し、テスト終了時に投入分だけを消す。
 */

interface SeedItem {
  id: string;
  category: "ai" | "investment";
  impact: "high" | "mid" | "low";
  title: string;
  minutesAgo: number;
}

/**
 * 投入したidを覚えて後片付けする。
 *
 * **既存の全行より新しい時刻で入れる**（`minutesAgo` は投入分どうしの並び順のみを決める）。
 * `news_items` は利用者に紐づかない共通表で、ホームの重要ニュースは
 * `coalesce(published_at, fetched_at)` の降順で上位3件しか出さない。ローカルDBに実データが
 * あると3件に入れず落ちる。2026-07-31、**AIが1時間先の日時を返した実ニュース**が最上位に
 * 居座り、この理由で1件落ちた（published_at をコード側で検証していない件は T-M7-40）。
 */
async function seedNews(items: SeedItem[]): Promise<void> {
  // 基準時刻はバッチで1回だけ求める。1件ごとに求めると直前の投入分が最大値になり、並び順が反転する。
  const [{ base }] = await query<{ base: string }>(
    `select (greatest(
              now(),
              coalesce((select max(coalesce(published_at, fetched_at)) from news_items), now())
            ) + interval '1 minute')::text as base`,
  );
  for (const item of items) {
    await query(
      `insert into news_items (id, category, title, summary, source_url, impact, published_at, fetched_at)
       values ($1, $2::news_category, $3, $4, $5, $6::impact_level,
               $8::timestamptz + make_interval(mins => 60 - $7), now())`,
      [
        item.id,
        item.category,
        item.title,
        // 要約にタイトルを含めない。含めると getByText がタイトルと要約の2要素に当たる。
        "E2Eのニュース要約テキスト。",
        `https://example.com/e2e-news/${item.id}`,
        item.impact,
        item.minutesAgo,
        base,
      ],
    );
  }
}

async function removeNews(ids: string[]): Promise<void> {
  // ホームやP-6が参照した痕跡（drafts.source_news_item_id）は作らないので単純削除で足りる。
  await query(`delete from news_items where id = any($1::uuid[])`, [ids]);
}

test("ニュース一覧は既定の分野・インパクトで絞られ、絞り込みを変えると追従する", async ({
  accounts,
  page,
}) => {
  const run = randomUUID().slice(0, 8);
  const items: SeedItem[] = [
    { id: randomUUID(), category: "ai", impact: "high", title: `E2E-${run} AI重要`, minutesAgo: 5 },
    { id: randomUUID(), category: "ai", impact: "low", title: `E2E-${run} AI軽微`, minutesAgo: 10 },
    {
      id: randomUUID(),
      category: "investment",
      impact: "high",
      title: `E2E-${run} 投資重要`,
      minutesAgo: 15,
    },
  ];

  try {
    await seedNews(items);
    const account = await accounts.create("news");
    await signIn(page, account);
    await page.goto("/app/news");

    // 既定は全分野・high+mid（要件02 §3.4）。low は出ない。
    await expect(page.getByText(`E2E-${run} AI重要`)).toBeVisible();
    await expect(page.getByText(`E2E-${run} 投資重要`)).toBeVisible();
    await expect(page.getByText(`E2E-${run} AI軽微`)).toHaveCount(0);

    // 分野トグルを外して「この条件で表示して保存」を押すと、対象外が消える。
    // トグルだけでは取り直さない（保存と一覧再取得が同じ操作にまとまっている・要件06 §3.4）。
    const filter = page.getByRole("region", { name: "絞り込み" });
    await filter.getByRole("button", { name: "投資", exact: true }).click();
    await filter.getByRole("button", { name: "この条件で表示して保存" }).click();
    await expect(page.getByText(`E2E-${run} 投資重要`)).toHaveCount(0);
    await expect(page.getByText(`E2E-${run} AI重要`)).toBeVisible();

    // 条件は news_config として保存され、通知にも使われる（副作用の明示）。
    const [saved] = await query<{ categories: string[] }>(
      `select news_config->'categories' as categories from profiles where id = $1`,
      [account.userId],
    );
    expect(saved.categories, "外した分野が保存されていないこと").not.toContain("investment");
  } finally {
    await removeNews(items.map((i) => i.id));
  }
});

test("ホームの重要ニュースは high だけを新しい順に最大3件出す", async ({ accounts, page }) => {
  const run = randomUUID().slice(0, 8);
  // high 4件（3件表示の上限を超える）＋ mid 1件。midはホームでは出ない（常にhigh固定）。
  const items: SeedItem[] = [
    { id: randomUUID(), category: "ai", impact: "high", title: `E2E-${run} 高1`, minutesAgo: 1 },
    { id: randomUUID(), category: "ai", impact: "high", title: `E2E-${run} 高2`, minutesAgo: 2 },
    { id: randomUUID(), category: "investment", impact: "high", title: `E2E-${run} 高3`, minutesAgo: 3 },
    { id: randomUUID(), category: "investment", impact: "high", title: `E2E-${run} 高4`, minutesAgo: 4 },
    { id: randomUUID(), category: "ai", impact: "mid", title: `E2E-${run} 中1`, minutesAgo: 1 },
  ];

  try {
    await seedNews(items);
    const account = await accounts.create("news-home");
    await signIn(page, account);

    const card = page.getByRole("heading", { name: "重要ニュース" });
    await expect(card).toBeVisible();

    // 新しい順に3件。4件目とmidは出ない。
    await expect(page.getByText(`E2E-${run} 高1`)).toBeVisible();
    await expect(page.getByText(`E2E-${run} 高2`)).toBeVisible();
    await expect(page.getByText(`E2E-${run} 高3`)).toBeVisible();
    await expect(page.getByText(`E2E-${run} 高4`)).toHaveCount(0);
    await expect(page.getByText(`E2E-${run} 中1`)).toHaveCount(0);
  } finally {
    await removeNews(items.map((i) => i.id));
  }
});
