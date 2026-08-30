import { z } from "zod";

import { stripProviderMarkup } from "@/lib/ai/gen-output";
import {
  META_TOO_OLD_MAX_AGE_H,
  META_TOO_OLD_MIN_AGE_H,
  REASON_TOO_OLD,
} from "@/lib/news-outcome";

/**
 * ニュースitemの受け入れ規則（T-M8-380で `jobs/news-research.ts` から移設）。
 *
 * 取得手段がAIリサーチからRSS巡回へ変わっても、**保存してよいitemの規定は変えない**——
 * 画面（一覧・重要ニュース・投稿生成の材料）が読む形はここが正本のまま。
 * 過去の実測に基づく判断（上限・許容・落とし方）のコメントは移設元から引き継ぐ。
 */

/**
 * titleの受理上限60字（T-M8-47）。プロンプトの目標（30字）と受理の限界を分ける——
 * 英語ソースの見出しは実測38〜56字で、30字上限だと分野が0件になった（2026-08-04実測）。
 * 表示は折り返すだけでレイアウトは壊れない。
 */
export const NEWS_TITLE_MAX_LENGTH = 60;
/**
 * summaryの受理上限200字（要決定D-12 案B・2026-07-28）。120字ではモデルが安定して守れず
 * 分野ごと全滅が実測で2回連続発生した（T-M7-25）。表示側は `line-clamp-2`。
 */
export const NEWS_SUMMARY_MAX_LENGTH = 200;

/**
 * `published_at` をISO 8601（オフセット付き）へ寄せる。寄せられなければ `undefined` を返し、
 * **itemそのものは残す**（任意項目のために本体を失わないため）。
 * 受け付ける形: `2026-07-28` / `2026-07-28T09:43:00` / `2026-07-28 09:43:00` / 既にISOのもの。
 */
export function normalizePublishedAt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  const iso = value.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(iso)) return `${iso}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** 引用タグの除去（T-M8-06）。文字列以外はそのまま通し、判定は schema 本体に任せる。 */
function stripMarkupLoose(value: unknown): unknown {
  return typeof value === "string" ? stripProviderMarkup(value) : value;
}

export const newsItemSchema = z.object({
  title: z.preprocess(stripMarkupLoose, z.string().min(1).max(NEWS_TITLE_MAX_LENGTH)),
  summary: z.preprocess(stripMarkupLoose, z.string().min(1).max(NEWS_SUMMARY_MAX_LENGTH)),
  /*
    **http/https だけ受ける**（T-M8-366）。`source_url` は画面で `<a href>` として描かれる。
    `z.url()` は `data:`・`ftp:`・`javascript:` も通すため、素材由来の不正URLが混ざると
    リンクに載る。正規のニュースURLは必ず http(s) なので入口で落とす（多層防御）。
  */
  source_url: z.url().refine((u) => /^https?:\/\//i.test(u), {
    error: "source_url must be http(s)",
  }),
  impact: z.enum(["high", "mid", "low"]),
  // 任意項目なので、形式が違っても item ごと捨てない（正規化できなければ落とすだけ）。
  published_at: z.preprocess(normalizePublishedAt, z.iso.datetime({ offset: true }).optional()),
});

export type NewsItemOut = z.infer<typeof newsItemSchema>;

/**
 * 規定を満たす item だけを残す。落とした件数と**理由**を返す（0件が「該当なし」か
 * 「全滅」かを呼び出し側が説明できるように・T-M7-24）。
 */
export function pickValidItems(
  raw: unknown[],
  max: number,
): {
  items: NewsItemOut[];
  dropped: number;
  reasons: Record<string, number>;
  rejected: { reasons: string[]; raw: unknown }[];
} {
  const items: NewsItemOut[] = [];
  const reasons: Record<string, number> = {};
  const rejected: { reasons: string[]; raw: unknown }[] = [];
  let dropped = 0;
  for (const candidate of raw) {
    const parsed = newsItemSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      dropped++;
      const itemReasons: string[] = [];
      for (const issue of parsed.error.issues) {
        const key = `${issue.path.join(".") || "(root)"}:${issue.code}`;
        reasons[key] = (reasons[key] ?? 0) + 1;
        itemReasons.push(key);
      }
      rejected.push({ raw: candidate, reasons: itemReasons });
    }
    if (items.length >= max) break;
  }
  return { items, dropped, reasons, rejected };
}

/** 未来日時の許容幅（分）。未来のまま保存すると重要ニュース枠に居座り続ける（T-M7-40）。 */
export const PUBLISHED_AT_FUTURE_TOLERANCE_MIN = 5;

/**
 * 取得窓より何時間古いものまで許すか。日付だけの記事（00:00補完）や日をまたいだ更新を
 * 正当に落とさないための緩衝（2026-07-31の実測に基づく・移設元コメント参照）。
 */
export const PUBLISHED_AT_AGE_SLACK_HOURS = 24;

export interface RecencyPolicyResult {
  items: NewsItemOut[];
  dropped: number;
  reasons: Record<string, number>;
  futureAdjusted: number;
}

/**
 * 取得窓に対する新しさで item を選別する。
 * - 未来: `published_at` を落として item は残す（並びだけ取得時刻へ寄せる）
 * - 古すぎ（窓＋24時間より前）: 捨てる（「今のニュース」として出すと誤解させる）
 * - 日時なし: 残す（判定材料が無いだけで内容は有効）
 */
export function applyRecencyPolicy(
  items: NewsItemOut[],
  opts: { now: Date; hours: number },
): RecencyPolicyResult {
  const nowMs = opts.now.getTime();
  const futureLimit = nowMs + PUBLISHED_AT_FUTURE_TOLERANCE_MIN * 60_000;
  const oldestAllowed = nowMs - (opts.hours + PUBLISHED_AT_AGE_SLACK_HOURS) * 3_600_000;
  const kept: NewsItemOut[] = [];
  const reasons: Record<string, number> = {};
  let dropped = 0;
  let futureAdjusted = 0;
  const tooOldAgesH: number[] = [];

  for (const item of items) {
    if (!item.published_at) {
      kept.push(item);
      continue;
    }
    const ts = new Date(item.published_at).getTime();
    if (Number.isNaN(ts)) {
      kept.push({ ...item, published_at: undefined });
      continue;
    }
    if (ts > futureLimit) {
      kept.push({ ...item, published_at: undefined });
      futureAdjusted += 1;
      continue;
    }
    if (ts < oldestAllowed) {
      dropped += 1;
      reasons[REASON_TOO_OLD] = (reasons[REASON_TOO_OLD] ?? 0) + 1;
      tooOldAgesH.push((nowMs - ts) / 3_600_000);
      continue;
    }
    kept.push(item);
  }

  if (tooOldAgesH.length > 0) {
    reasons[META_TOO_OLD_MIN_AGE_H] = Math.round(Math.min(...tooOldAgesH) * 10) / 10;
    reasons[META_TOO_OLD_MAX_AGE_H] = Math.round(Math.max(...tooOldAgesH) * 10) / 10;
  }
  return { items: kept, dropped, reasons, futureAdjusted };
}

/** 文字数上限へ切り詰める（規定で捨てるのではなく、載る形へ直す側の道具）。 */
export function clampTitle(raw: string): string {
  const t = stripProviderMarkup(raw).trim();
  return t.length <= NEWS_TITLE_MAX_LENGTH ? t : `${t.slice(0, NEWS_TITLE_MAX_LENGTH - 1)}…`;
}

export function clampSummary(raw: string): string {
  const t = stripProviderMarkup(raw).trim();
  return t.length <= NEWS_SUMMARY_MAX_LENGTH ? t : `${t.slice(0, NEWS_SUMMARY_MAX_LENGTH - 1)}…`;
}
