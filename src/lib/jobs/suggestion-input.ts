/**
 * SUGGEST 入力集計（K-2, プロンプト §6.15/§4.2, 要件04 §12, T-M5-17）。LLMを使わない純粋なコード集計。
 * 直近30日の posted / 部分失敗(remaining)投稿から、比較checkpoint（7日取得済みが3件以上なら7日、
 * 未満なら1日）を選び、異なる経過日数を混ぜずに `<stats>`（型×時間帯セルの件数・平均impressions）と
 * `<posts>`（tweet_id単位・最大50件・本文冒頭100字/型/JST投稿時刻/impressions）を組み立てる。
 * rollback削除済み・unavailable の tweet_id は除外する。テーマの事前集計はしない（PT-SUGGESTが本文から判断）。
 *
 * 集計する軸（T-M7-38）: 型×時間帯に加えて、**加重文字数帯・改行の塊数・画像の有無・URLの有無**。
 * 伸びを左右する主要な変数がこれらだからで、軸が無いと「投稿を短くした」「改行を入れた」等の
 * 改善が効いたかを実績で確かめられない（2026-08-01のプロンプト改善T-M7-37/41の検証手段）。
 * 軸ごとに独立して集計する（多次元セルにすると50件では大半がcount=1になり判断材料にならない）。
 */

import { weightedLength } from "../post/text-metrics";

export const SUGGEST_PERIOD_DAYS = 30;
export const SUGGEST_MAX_POSTS = 50;
export const SUGGEST_MIN_GROUP = 3;
export const SUGGEST_METRIC = "impressions" as const;
const DAY_MS = 86_400_000;

interface CheckpointValue {
  impressions: number | null;
}

export interface SuggestionInputDraft {
  pattern: string;
  /** 添付画像の枚数（0なら画像なし）。画像の有無を軸にするために持つ（T-M7-38）。 */
  imageCount?: number;
  postedAt: string | null;
  /** 投稿順の本文（tweet_ids と同順で対応）。 */
  thread: { text?: string }[];
  tweet_ids: string[];
  status: string;
  last_post_error: { remaining_tweet_ids?: string[]; deleted_tweet_ids?: string[] } | null;
  tweet_metrics: Record<
    string,
    { checkpoints?: Partial<Record<string, CheckpointValue>>; unavailable_at?: string | null }
  > | null;
}

export interface SuggestionStatCell {
  pattern: string;
  time_bucket: string;
  count: number;
  avg_impressions: number;
}

/** 軸1つ分の集計（値ごとの件数と平均）。 */
export interface SuggestionAxisCell {
  value: string;
  count: number;
  avg_impressions: number;
}

/** 分析軸の名前。`evidence.axis` と対応させる。 */
export const SUGGESTION_AXES = ["pattern_time", "length", "line_blocks", "image", "url"] as const;
export type SuggestionAxis = (typeof SUGGESTION_AXES)[number];

/**
 * 加重文字数の帯。境界は投稿生成の目標（加重240＝約120字・T-M7-41）に合わせる。
 * これにより「目標内に収めた投稿は伸びたか」を実績で確認できる。
 */
export function lengthBucket(weighted: number): string {
  if (weighted <= 160) return "短(〜160)";
  if (weighted <= 240) return "中(161〜240)";
  return "長(241〜)";
}

/** 改行の塊数（空行区切り）。3以上はまとめる。 */
export function lineBlockBucket(text: string): string {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== "").length;
  if (blocks <= 1) return "1";
  if (blocks === 2) return "2";
  return "3+";
}

/** 本文にURLを含むか（Xは外部リンクの露出を抑える傾向があるため軸に入れる）。 */
export function hasUrl(text: string): boolean {
  return /https?:\/\//.test(text);
}

export interface SuggestionPost {
  tweet_id: string;
  body: string;
  pattern: string;
  posted_at_jst: string;
  impressions: number;
}

export interface SuggestionInput {
  checkpoint_days: 1 | 7;
  metric: typeof SUGGEST_METRIC;
  /** 型×時間帯のセル（従来の軸）。 */
  stats: SuggestionStatCell[];
  /** 追加の軸ごとの集計（T-M7-38）。軸名 → 値ごとの件数と平均。 */
  axes: Record<Exclude<SuggestionAxis, "pattern_time">, SuggestionAxisCell[]>;
  posts: SuggestionPost[];
}

interface QualifyingTweet {
  tweetId: string;
  body: string;
  pattern: string;
  postedAtMs: number;
  jstHour: number;
  jstLabel: string;
  impressions: number;
  /** 加重文字数（本文全体。`body` は表示用に100字で切るため別に持つ）。 */
  weighted: number;
  /** 改行の塊数の帯。 */
  lineBlocks: string;
  hasImage: boolean;
  hasUrl: boolean;
}

/** JST時刻（UTC+9）。argless Date は使わず ISO から純粋に算出する。 */
function jstParts(iso: string): { hour: number; label: string } {
  const jst = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  const h = jst.getUTCHours();
  const m = jst.getUTCMinutes();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { hour: h, label: `${pad(h)}:${pad(m)}` };
}

/** JST時刻を3時間バケット（"0-3"〜"21-24"）へ。 */
function timeBucket(jstHour: number): string {
  const start = Math.floor(jstHour / 3) * 3;
  return `${start}-${start + 3}`;
}

/** 集計対象の live tweet_id と本文（tweet_ids↔thread 同順対応）。rollback削除・unavailable は除外。 */
function livePairs(d: SuggestionInputDraft): { id: string; body: string; full: string }[] {
  const isFailed = d.status === "failed";
  const deleted = new Set(d.last_post_error?.deleted_tweet_ids ?? []);
  const liveSet = isFailed ? new Set(d.last_post_error?.remaining_tweet_ids ?? []) : null;
  const pairs: { id: string; body: string; full: string }[] = [];
  d.tweet_ids.forEach((id, i) => {
    if (!id || deleted.has(id)) return;
    if (liveSet && !liveSet.has(id)) return; // failed は remaining のみ
    if (d.tweet_metrics?.[id]?.unavailable_at) return;
    // 形の計測は全文で行う（`body` は表示用に100字で切る）。
    const full = d.thread[i]?.text ?? "";
    pairs.push({ id, body: full.slice(0, 100), full });
  });
  return pairs;
}

/** 指定checkpointを取得済み（impressions 非null）の対象tweet群を、直近30日に限定して返す。 */
function qualifying(drafts: SuggestionInputDraft[], checkpoint: 1 | 7, nowMs: number): QualifyingTweet[] {
  const cutoff = nowMs - SUGGEST_PERIOD_DAYS * DAY_MS;
  const out: QualifyingTweet[] = [];
  for (const d of drafts) {
    if (!d.postedAt) continue;
    const postedAtMs = new Date(d.postedAt).getTime();
    if (postedAtMs < cutoff) continue;
    const { hour, label } = jstParts(d.postedAt);
    for (const { id, body, full } of livePairs(d)) {
      const imp = d.tweet_metrics?.[id]?.checkpoints?.[String(checkpoint)]?.impressions;
      if (imp === null || imp === undefined) continue;
      out.push({
        tweetId: id,
        body,
        pattern: d.pattern,
        postedAtMs,
        jstHour: hour,
        jstLabel: label,
        impressions: imp,
        weighted: weightedLength(full),
        lineBlocks: lineBlockBucket(full),
        // 画像は下書き単位で付くため、その下書きの全ポストを「画像あり」として数える。
        hasImage: (d.imageCount ?? 0) > 0,
        hasUrl: hasUrl(full),
      });
    }
  }
  return out;
}

/** 比較checkpoint = 7日取得済みが3件以上なら7、未満なら1（異なる経過日数を混ぜない・要件04 §12）。 */
export function chooseCheckpoint(drafts: SuggestionInputDraft[], nowMs: number): 1 | 7 {
  return qualifying(drafts, 7, nowMs).length >= SUGGEST_MIN_GROUP ? 7 : 1;
}

/** PT-SUGGEST の <stats>/<posts> を組み立てる（同一checkpointのみ・最大50件）。 */
export function buildSuggestionInput(drafts: SuggestionInputDraft[], nowMs: number): SuggestionInput {
  const checkpoint = chooseCheckpoint(drafts, nowMs);
  const selected = qualifying(drafts, checkpoint, nowMs)
    .sort((a, b) => b.postedAtMs - a.postedAtMs)
    .slice(0, SUGGEST_MAX_POSTS);

  const posts: SuggestionPost[] = selected.map((t) => ({
    tweet_id: t.tweetId,
    body: t.body,
    pattern: t.pattern,
    posted_at_jst: t.jstLabel,
    impressions: t.impressions,
  }));

  const cells = new Map<string, { pattern: string; time_bucket: string; count: number; sum: number }>();
  for (const t of selected) {
    const bucket = timeBucket(t.jstHour);
    const key = `${t.pattern}|${bucket}`;
    const cell = cells.get(key) ?? { pattern: t.pattern, time_bucket: bucket, count: 0, sum: 0 };
    cell.count += 1;
    cell.sum += t.impressions;
    cells.set(key, cell);
  }
  const stats: SuggestionStatCell[] = [...cells.values()]
    .map((c) => ({
      pattern: c.pattern,
      time_bucket: c.time_bucket,
      count: c.count,
      avg_impressions: Math.round(c.sum / c.count),
    }))
    .sort((a, b) => (a.pattern === b.pattern ? a.time_bucket.localeCompare(b.time_bucket) : a.pattern.localeCompare(b.pattern)));

  const axisOf = (key: Exclude<SuggestionAxis, "pattern_time">, t: QualifyingTweet): string => {
    if (key === "length") return lengthBucket(t.weighted);
    if (key === "line_blocks") return t.lineBlocks;
    if (key === "image") return t.hasImage ? "あり" : "なし";
    return t.hasUrl ? "あり" : "なし";
  };
  const axes = Object.fromEntries(
    (["length", "line_blocks", "image", "url"] as const).map((key) => {
      const buckets = new Map<string, { count: number; sum: number }>();
      for (const t of selected) {
        const value = axisOf(key, t);
        const cell = buckets.get(value) ?? { count: 0, sum: 0 };
        cell.count += 1;
        cell.sum += t.impressions;
        buckets.set(value, cell);
      }
      const cells: SuggestionAxisCell[] = [...buckets.entries()]
        .map(([value, c]) => ({
          value,
          count: c.count,
          avg_impressions: Math.round(c.sum / c.count),
        }))
        .sort((a, b) => a.value.localeCompare(b.value));
      return [key, cells];
    }),
  ) as SuggestionInput["axes"];

  return { checkpoint_days: checkpoint, metric: SUGGEST_METRIC, stats, axes, posts };
}
