import { z } from "zod";

import type { ProviderCall } from "../ai/normalize";
import { runTextGeneration } from "../ai/pipeline";
import type { TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import {
  providerCallToUsageEvent,
  recordExternalApiUsage,
} from "../db/api-usage-ledger";
import type { NewsCategory } from "../news";
import { SYS_NEWS } from "../prompts/gen-prompts";
import { newsCategoryLabel } from "../themes";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";

/**
 * NEWS実行モジュール（1分野・運営側, プロンプト設計書 §6.10/§4.2/§5.6/§7, 要件04 §2/§6, T-M4-10）。
 * SYS-NEWS を起動時刻由来の `{{hours}}` で組み立て（各回が直近数時間を重ねて取得＝3回に1回成功で欠落なし。
 * D-3/ADR-0003）、Web検索付きで生成→zod検証（コードフェンス除去＋修復call 1回は runTextGeneration が担う）
 * →provider call を原価台帳（external_api_usage_events, user_id=null）へ冪等記録する。
 *
 * NEWS は generation_jobs へ保存しない（要件04 §2）。providerは運営 NEWS_TEXT_PROVIDER 固定で解決し
 * （resolveNewsKey・要件01 §7）、無効時は失敗させ別providerへ自動切替しない。呼び出し側（T-M4-11 の
 * news-fetch route）が6分野を最大3並列で回し分野別にcommitする。本モジュールは1分野の実行に専念する。
 */

export const NEWS_MAX_ITEMS = 5;
const KNOWN_URLS_WINDOW_HOURS = 48;
const KNOWN_URLS_LIMIT = 200;
const NEWS_WEB_SEARCH_MAX_USES = 5;

const newsItemSchema = z.object({
  title: z.string().min(1).max(30),
  summary: z.string().min(1).max(120),
  source_url: z.url(),
  impact: z.enum(["high", "mid", "low"]),
  published_at: z.iso.datetime({ offset: true }).optional(),
});

/** SYS-NEWS 応答契約（最大5件・空配列許容, §6.10/§7）。 */
export const newsOutputSchema = z.object({
  items: z.array(newsItemSchema).max(NEWS_MAX_ITEMS),
});

export type NewsItemOut = z.infer<typeof newsItemSchema>;

/**
 * `{{hours}}` 切替（§6.10）。JST 9/10/11時起動は前日18:00始点で夜間・稼働終了間際を補完するため
 * それぞれ 15/16/17（=起動時刻から前日18:00までの時間数）、12:00〜20:00起動は直近3時間ラップの 3。
 */
export function newsLookbackHours(jstHour: number): number {
  if (jstHour >= 9 && jstHour <= 11) return jstHour + 6;
  return 3;
}

/** UTC時刻→JSTの時（0-23）。 */
export function jstHourOf(now: Date): number {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
}

export interface NewsResearchDeps {
  db: Queryable;
  /** 解決済み NEWS provider アダプタ（server配線は resolveNewsKey→アダプタ構築）。 */
  textGen: TextGen;
  model: string;
  /** 起動時刻。`{{hours}}` 算出に使う（テストで固定可能）。 */
  clock: Date;
  /** 原価台帳の冪等keyプレフィックス（例 `news:{window_key}:{category}`）。call連番を付す。 */
  ledgerKeyPrefix: string;
  /** latency計測用（既定 Date.now）。 */
  now?: () => number;
  makeDeadline?: () => Deadline;
  webSearchMaxUses?: number;
}

export interface NewsResearchResult {
  items: NewsItemOut[];
  usage: GenerationUsage;
  hours: number;
}

/** 直近48時間に取得済みの同分野 source_url（<known_urls> 用・重複除外）。 */
async function loadKnownUrls(db: Queryable, category: NewsCategory): Promise<string[]> {
  const { rows } = await db.query<{ source_url: string }>(
    `select source_url from news_items
      where category = $1 and fetched_at > now() - make_interval(hours => $2)
      order by fetched_at desc
      limit $3`,
    [category, KNOWN_URLS_WINDOW_HOURS, KNOWN_URLS_LIMIT],
  );
  return rows.map((r) => r.source_url);
}

/** provider call を原価台帳へ冪等記録する（user_id=null・job外NEWS。要件02 §3.17・§5.6）。 */
async function recordNewsUsage(
  deps: NewsResearchDeps,
  calls: ProviderCall[],
): Promise<void> {
  for (let seq = 0; seq < calls.length; seq++) {
    await recordExternalApiUsage(
      deps.db,
      providerCallToUsageEvent(calls[seq], {
        userId: null,
        idempotencyKey: `${deps.ledgerKeyPrefix}:${seq}`,
      }),
    );
  }
}

/** 1分野のニュースリサーチを実行する。 */
export async function researchNews(
  category: NewsCategory,
  deps: NewsResearchDeps,
): Promise<NewsResearchResult> {
  const hours = newsLookbackHours(jstHourOf(deps.clock));
  const knownUrls = await loadKnownUrls(deps.db, category);

  const system = SYS_NEWS.replaceAll("{{category_ja}}", newsCategoryLabel(category))
    .replaceAll("{{hours}}", String(hours))
    .replaceAll("{{n}}", String(NEWS_MAX_ITEMS));
  const user = `<known_urls>\n${knownUrls.join("\n")}\n</known_urls>`;

  const deadline = (deps.makeDeadline ?? createDeadline)();
  // Web検索併用のため構造化出力(jsonSchema)は使わず、JSON出力指示＋コード検証へフォールバックする（§5.1）。
  const result = await runTextGeneration({
    provider: deps.textGen,
    request: {
      system: [system],
      user,
      webSearch: { maxUses: deps.webSearchMaxUses ?? NEWS_WEB_SEARCH_MAX_USES },
      timeoutMs: deadline.callTimeoutMs(),
    },
    schema: newsOutputSchema,
    model: deps.model,
    operation: "text_generation",
    now: deps.now,
  });

  await recordNewsUsage(deps, result.usage.calls);
  return { items: result.parsed.items, usage: result.usage, hours };
}
