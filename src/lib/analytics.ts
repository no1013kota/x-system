/**
 * 投稿実績の集計（K-1, SC-09, 要件06 §8, 要件05 §9, 要件02 §4.9, T-M5-15）。DBは注入し純粋に保つ。
 * tweet_id別の checkpoint（1/7/30）表示・スレッド合算（同一checkpoint取得済みIDのみ・欠損数併記）・
 * getAnalyticsSummary の集計を提供する。profile_clicks 取得不能は null（UIで `--`）。rollback削除IDは
 * 監査表示のみで合算から除外、部分失敗のremaining は「不完全なthread」として1行ずつ表示する。
 */

export const CHECKPOINT_DAYS = [1, 7, 30] as const;
export type CheckpointDay = (typeof CHECKPOINT_DAYS)[number];

export interface CheckpointMetrics {
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  profile_clicks: number | null;
  collected_at: string;
}

interface TweetMetricEntry {
  checkpoints?: Partial<Record<string, CheckpointMetrics>>;
  latest_checkpoint_days?: number | null;
  unavailable_at?: string | null;
}

export interface AnalyticsDraftRow {
  id: string;
  /** 生成時に写したパターン名（**内部IDは出さない**・T-M8-129 U3）。 */
  pattern_name: string;
  status: string;
  tweet_ids: string[];
  last_post_error: { remaining_tweet_ids?: string[]; deleted_tweet_ids?: string[] } | null;
  posted_at: string | null;
  metrics_completed_at: string | null;
  tweet_metrics: Record<string, TweetMetricEntry> | null;
  /** 本文（`tweet_ids`と同順）。どの投稿の実績かを識別するために表示する。 */
  thread?: { text?: string }[] | null;
}

export interface TweetAnalytics {
  tweetId: string;
  /** 該当ポストの本文（`tweet_ids`と同順で対応付け）。不明なら空文字。 */
  body: string;
  /** rollback削除確認済み（監査表示のみ・合算から除外）。 */
  auditOnly: boolean;
  /** X上で取得不能確定（合算から除外）。 */
  unavailable: boolean;
  /** checkpoint別の値（"1"/"7"/"30"）。 */
  checkpoints: Partial<Record<string, CheckpointMetrics>>;
}

export interface DraftAnalytics {
  draftId: string;
  pattern_name: string;
  postedAt: string | null;
  /** 先頭ポストの本文（カード見出しの識別用）。 */
  excerpt: string;
  /** 部分失敗でX上に残ったthread（「不完全なthread」表示）。 */
  incomplete: boolean;
  /** 30日checkpoint後などで回収終了。 */
  metricsCompleted: boolean;
  tweets: TweetAnalytics[];
}

/** draft行を実績表示用に整形する。posted=全tweet_id、failed=remaining（live）＋deleted（監査）。 */
export function buildDraftAnalytics(row: AnalyticsDraftRow): DraftAnalytics {
  const isFailed = row.status === "failed";
  const live = isFailed ? row.last_post_error?.remaining_tweet_ids ?? [] : row.tweet_ids ?? [];
  const audit = isFailed ? row.last_post_error?.deleted_tweet_ids ?? [] : [];
  const metrics = row.tweet_metrics ?? {};
  // 本文は tweet_ids と同順（要件06 §8）。部分失敗で一部しか採番されていなくても先頭から対応する。
  const bodies = new Map<string, string>();
  (row.tweet_ids ?? []).forEach((id, i) => {
    const text = row.thread?.[i]?.text;
    if (id && typeof text === "string") bodies.set(id, text);
  });
  const toTweet = (tweetId: string, auditOnly: boolean): TweetAnalytics => ({
    tweetId,
    body: bodies.get(tweetId) ?? "",
    auditOnly,
    unavailable: Boolean(metrics[tweetId]?.unavailable_at),
    checkpoints: metrics[tweetId]?.checkpoints ?? {},
  });
  const seen = new Set<string>();
  const tweets: TweetAnalytics[] = [];
  for (const id of live) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    tweets.push(toTweet(id, false));
  }
  for (const id of audit) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    tweets.push(toTweet(id, true));
  }
  return {
    draftId: row.id,
    pattern_name: row.pattern_name,
    postedAt: row.posted_at,
    excerpt: row.thread?.[0]?.text ?? "",
    incomplete: isFailed,
    metricsCompleted: Boolean(row.metrics_completed_at),
    tweets,
  };
}

/** 合算対象（監査でなく取得不能でもない）tweet。 */
function aggregatable(draft: DraftAnalytics): TweetAnalytics[] {
  return draft.tweets.filter((t) => !t.auditOnly && !t.unavailable);
}

/** 表示既定checkpoint = 合算対象で取得済みの最長（無ければ 1）。 */
export function defaultCheckpoint(draft: DraftAnalytics): CheckpointDay {
  const rows = aggregatable(draft);
  let best: CheckpointDay = 1;
  let found = false;
  for (const d of CHECKPOINT_DAYS) {
    if (rows.some((t) => t.checkpoints[String(d)])) {
      best = d;
      found = true;
    }
  }
  return found ? best : 1;
}

/**
 * 一覧全体の既定checkpoint = その時点の実績を持つ合算対象tweetが最も多い時点（同数なら長い方）。
 * 「取得済みの最長」を全draft横断で採ると、古い1件が30日を持つだけで直近投稿が全て未取得の表に
 * 見えてしまうため、最も多くの投稿を比較できる時点を初期表示にする（要件06 §8）。
 */
export function mostMeasuredCheckpoint(drafts: DraftAnalytics[]): CheckpointDay {
  let best: CheckpointDay = 1;
  let bestCount = 0;
  for (const d of CHECKPOINT_DAYS) {
    let count = 0;
    for (const draft of drafts) {
      count += aggregatable(draft).filter((t) => t.checkpoints[String(d)]).length;
    }
    if (count >= bestCount && count > 0) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export interface ThreadAggregate {
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  profile_clicks: number | null;
  /** 選択checkpointを取得済みの合算対象tweet数。 */
  present: number;
  /** 合算対象だが選択checkpoint未取得のtweet数（欠損）。 */
  missing: number;
}

const FIELDS = ["impressions", "likes", "reposts", "profile_clicks"] as const;

/**
 * スレッド合算（同一checkpointを取得済みの合算対象tweetだけで計算）。各fieldは全present値が非nullの時だけ
 * 合計し、1件でも取得不能(null)なら null（UIで `--`）。欠損（checkpoint未取得）数を併記する。
 */
export function aggregateThread(draft: DraftAnalytics, checkpoint: CheckpointDay): ThreadAggregate {
  const rows = aggregatable(draft);
  const key = String(checkpoint);
  const present = rows.filter((t) => t.checkpoints[key]);
  const sums: Record<string, number | null> = {};
  for (const f of FIELDS) {
    let total = 0;
    let anyNull = false;
    for (const t of present) {
      const v = t.checkpoints[key]?.[f];
      if (v === null || v === undefined) anyNull = true;
      else total += v;
    }
    sums[f] = present.length > 0 && !anyNull ? total : null;
  }
  return {
    impressions: sums.impressions,
    likes: sums.likes,
    reposts: sums.reposts,
    profile_clicks: sums.profile_clicks,
    present: present.length,
    missing: rows.length - present.length,
  };
}

export interface FollowerPoint {
  /** JST日付（YYYY-MM-DD）。 */
  date: string;
  count: number;
}

export interface FollowerSeriesSummary {
  latest: number | null;
  /** 期間内の最初のsnapshotからの増減（点が1件以下なら null）。 */
  delta: number | null;
  min: number | null;
  max: number | null;
  points: number;
}

/** フォロワー推移の要約（最新値・期間増減・最小/最大）。欠損日は点を作らずスキップ済み前提。 */
export function followerSeriesSummary(points: FollowerPoint[]): FollowerSeriesSummary {
  if (points.length === 0) {
    return { latest: null, delta: null, min: null, max: null, points: 0 };
  }
  const counts = points.map((p) => p.count);
  const latest = counts[counts.length - 1];
  return {
    latest,
    delta: points.length > 1 ? latest - counts[0] : null,
    min: Math.min(...counts),
    max: Math.max(...counts),
    points: points.length,
  };
}

export interface AnalyticsSummary {
  periodDays: number;
  postCount: number;
  checkpoints: Record<
    string,
    { tweets: number; impressions: number; likes: number; reposts: number; profile_clicks: number }
  >;
}

/**
 * 期間集計（getAnalyticsSummary 用）。合算対象tweetを checkpoint 別に集計する（各fieldは非null値のみ加算、
 * profile_clicks も非nullのみ）。別カラムへは保存しない（表示時集計）。
 */
export function summarize(drafts: DraftAnalytics[], periodDays: number): AnalyticsSummary {
  const checkpoints: AnalyticsSummary["checkpoints"] = {};
  for (const d of CHECKPOINT_DAYS) {
    checkpoints[String(d)] = { tweets: 0, impressions: 0, likes: 0, reposts: 0, profile_clicks: 0 };
  }
  for (const draft of drafts) {
    for (const t of aggregatable(draft)) {
      for (const d of CHECKPOINT_DAYS) {
        const c = t.checkpoints[String(d)];
        if (!c) continue;
        const bucket = checkpoints[String(d)];
        bucket.tweets += 1;
        if (c.impressions !== null) bucket.impressions += c.impressions;
        if (c.likes !== null) bucket.likes += c.likes;
        if (c.reposts !== null) bucket.reposts += c.reposts;
        if (c.profile_clicks !== null) bucket.profile_clicks += c.profile_clicks;
      }
    }
  }
  return { periodDays, postCount: drafts.length, checkpoints };
}
