/**
 * SUGGEST 入力集計（K-2, プロンプト §6.15/§4.2, 要件04 §12, T-M5-17）。LLMを使わない純粋なコード集計。
 * 直近30日の posted / 部分失敗(remaining)投稿から、比較checkpoint（7日取得済みが3件以上なら7日、
 * 未満なら1日）を選び、異なる経過日数を混ぜずに `<stats>`（型×時間帯セルの件数・平均impressions）と
 * `<posts>`（tweet_id単位・最大50件・本文冒頭100字/型/JST投稿時刻/impressions）を組み立てる。
 * rollback削除済み・unavailable の tweet_id は除外する。テーマの事前集計はしない（PT-SUGGESTが本文から判断）。
 */

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
  stats: SuggestionStatCell[];
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
function livePairs(d: SuggestionInputDraft): { id: string; body: string }[] {
  const isFailed = d.status === "failed";
  const deleted = new Set(d.last_post_error?.deleted_tweet_ids ?? []);
  const liveSet = isFailed ? new Set(d.last_post_error?.remaining_tweet_ids ?? []) : null;
  const pairs: { id: string; body: string }[] = [];
  d.tweet_ids.forEach((id, i) => {
    if (!id || deleted.has(id)) return;
    if (liveSet && !liveSet.has(id)) return; // failed は remaining のみ
    if (d.tweet_metrics?.[id]?.unavailable_at) return;
    pairs.push({ id, body: (d.thread[i]?.text ?? "").slice(0, 100) });
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
    for (const { id, body } of livePairs(d)) {
      const imp = d.tweet_metrics?.[id]?.checkpoints?.[String(checkpoint)]?.impressions;
      if (imp === null || imp === undefined) continue;
      out.push({ tweetId: id, body, pattern: d.pattern, postedAtMs, jstHour: hour, jstLabel: label, impressions: imp });
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

  return { checkpoint_days: checkpoint, metric: SUGGEST_METRIC, stats, posts };
}
