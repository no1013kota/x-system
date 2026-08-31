import "server-only";

import { z } from "zod";

import { runTextGeneration } from "@/lib/ai/pipeline";
import { recordProviderCalls } from "@/lib/db/api-usage-ledger";
import { pooledQueryable } from "@/lib/db/pool";
import { purposeTextModel } from "@/lib/ai/model-catalog";
import { resolveNewsProvider } from "@/lib/ai/resolve-provider-server";
import { createDeadline } from "@/lib/jobs/deadline";
import type { NewsCategory } from "@/lib/news";
import { SYS_NEWS_SUM } from "@/lib/prompts/gen-prompts";
import { newsCategoryLabel } from "@/lib/themes";

import { clampSummary, clampTitle } from "./item-rules";

/**
 * RSS新着の要約・impact判定（T-M8-380）。
 *
 * **モデルは analysis 層（Sonnet級）で固定**（T-M8-384・運営者の指示 2026-08-31）。
 * 当初は mechanical（Haiku級）だったが、要約とimpact判定は「観察して要約する」処理で、
 * model-catalog.ts の分類では analysis に当たる。英語記事の日本語化・impactの見極めは
 * 利用者の画面と投稿素材に直結するため品質側へ倒す（費用差は月+$10前後・新着数に比例）。
 * Web検索なしなので構造化出力（jsonSchema）が使える。原価は台帳へ記録（原則4・keyPrefixで冪等）。
 */

export interface ArticleForSummary {
  url: string;
  source: string;
  title: string;
  snippet: string;
  publishedAt: string | null;
}

export interface SummarizedArticle {
  url: string;
  title: string;
  summary: string;
  impact: "high" | "mid" | "low";
}

const outputSchema = z.object({
  items: z.array(
    z.object({
      url: z.string(),
      title: z.string().min(1),
      summary: z.string().min(1),
      impact: z.enum(["high", "mid", "low"]),
    }),
  ),
});

/** 構造化出力に渡すJSON Schema（zodと同じ形を手書き。ズレたらzod検証で落ちて分かる）。 */
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "title", "summary", "impact"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          impact: { type: "string", enum: ["high", "mid", "low"] },
        },
      },
    },
  },
} as const;

/**
 * 新着記事を要約する。**失敗したら null を返す**（例外にしない）——呼び出し側が
 * フィードの生情報でフォールバック保存する（要約が死んでもニュースは止めない・原則1）。
 */
export async function summarizeArticles(
  category: NewsCategory,
  articles: ArticleForSummary[],
  opts: { ledgerKey: string; now?: () => number },
): Promise<SummarizedArticle[] | null> {
  if (articles.length === 0) return [];
  const deadline = createDeadline();
  const { textGen, provider, model } = resolveNewsProvider({ deadline });
  const summaryModel = purposeTextModel("analysis", provider) ?? model;
  const system = SYS_NEWS_SUM.replace(
    "{{category_ja}}",
    newsCategoryLabel(category),
  );
  const user = `<articles>\n${JSON.stringify(
    articles.map((a) => ({
      url: a.url,
      source: a.source,
      title: a.title,
      snippet: a.snippet,
      published_at: a.publishedAt,
    })),
  )}\n</articles>`;

  try {
    const result = await runTextGeneration({
      provider: textGen,
      providerId: provider,
      request: {
        system: [system],
        user,
        jsonSchema: OUTPUT_JSON_SCHEMA,
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: outputSchema,
      model: summaryModel,
      operation: "text_generation",
      now: opts.now,
    });
    await recordProviderCalls(pooledQueryable(), result.usage.calls, { userId: null, keyPrefix: opts.ledgerKey });

    // urlの突き合わせ: 出力に無い記事は呼び出し側がフォールバックで埋める。
    const byUrl = new Map(result.parsed.items.map((i) => [i.url, i]));
    return articles.flatMap((a) => {
      const m = byUrl.get(a.url);
      if (!m) return [];
      return [
        {
          url: a.url,
          title: clampTitle(m.title),
          summary: clampSummary(m.summary),
          impact: m.impact,
        },
      ];
    });
    // eslint-disable-next-line no-restricted-syntax -- 要約の失敗はフォールバック保存（呼び出し側）が答え。内訳は台帳とoutcomeに残る
  } catch {
    return null;
  }
}
