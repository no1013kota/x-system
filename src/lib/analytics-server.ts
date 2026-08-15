import "server-only";

import {
  buildDraftAnalytics,
  summarize,
  type AnalyticsDraftRow,
  type AnalyticsSummary,
  type DraftAnalytics,
  type FollowerPoint,
} from "./analytics";
import { pooledQueryable } from "./db/pool";
import { listSuggestions } from "./jobs/suggestion-jobs";

/**
 * 投稿実績の server-only 配線（SC-09, T-M5-15）。active Xアカウントの posted / 部分失敗(failed)で残存ID
 * を持つ draft を期間で読み、実績表示用に整形する。集計は表示時に行い別カラムへ保存しない（要件06 §8）。
 */

const pooledDb = pooledQueryable();

/** 所有者のみ。posted と、remaining を持つ failed を posted_at 期間で新しい順に返す。 */
export async function loadAnalyticsForUser(
  userId: string,
  xAccountId: string,
  periodDays: number,
): Promise<DraftAnalytics[]> {
  const { rows } = await pooledDb.query<AnalyticsDraftRow>(
    `select d.id, d.pattern, d.status, d.tweet_ids, d.last_post_error, d.thread,
            d.posted_at::text as posted_at, d.metrics_completed_at::text as metrics_completed_at,
            d.tweet_metrics
       from drafts d
       join x_accounts xa on xa.id = d.x_account_id
      where d.x_account_id = $1 and xa.user_id = $2
        and d.posted_at is not null
        and d.posted_at >= now() - ($3 || ' days')::interval
        and (d.status = 'posted'
             or (d.status = 'failed'
                 and jsonb_array_length(coalesce(d.last_post_error->'remaining_tweet_ids', '[]'::jsonb)) > 0))
      order by d.posted_at desc, d.id desc`,
    [xAccountId, userId, String(periodDays)],
  );
  return rows.map(buildDraftAnalytics);
}

export async function getAnalyticsSummaryForUser(
  userId: string,
  xAccountId: string,
  periodDays: number,
): Promise<AnalyticsSummary> {
  const drafts = await loadAnalyticsForUser(userId, xAccountId, periodDays);
  return summarize(drafts, periodDays);
}

export interface SuggestionGoodPost {
  tweetId: string;
  /** この投稿が良かった点（LLMの1文）。 */
  why: string;
  url: string;
}

/** advice の1項目（推奨値＋理由）。 */
export interface SuggestionAdviceItem<T> {
  recommended: T;
  reason: string;
}

/**
 * 新形式（evidence.format=2・T-M8-91）の表示形。
 * 旧形式（軸ベース・〜2026-08-15）の行は content と summary だけの縮退表示にする（legacy）。
 */
export interface SuggestionDisplay {
  kind: "v2" | "legacy";
  /** v2: 良かった投稿の特徴（summary）。legacy: 提案1文。 */
  content: string;
  goodPosts: SuggestionGoodPost[];
  advice: {
    pattern: SuggestionAdviceItem<string> | null;
    theme: SuggestionAdviceItem<string> | null;
    image: SuggestionAdviceItem<boolean> | null;
    prompt: { kind: string; content: string } | null;
  } | null;
  /** legacy行の根拠1文（v2では空）。 */
  legacySummary: string;
  createdAt: string;
}
export interface SuggestionsSection {
  suggestions: SuggestionDisplay[];
  /** queued/running な suggestion job があるか（「生成中」表示用）。 */
  generating: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function adviceItem<T>(v: unknown, pick: (x: unknown) => T | null): SuggestionAdviceItem<T> | null {
  if (typeof v !== "object" || v === null) return null;
  const rec = pick((v as Record<string, unknown>).recommended);
  const reason = str((v as Record<string, unknown>).reason);
  return rec === null || !reason ? null : { recommended: rec, reason };
}

/** 最新の成功 suggestion job の提案を表示形へ変換して返す（所有者のみ）。 */
export async function loadSuggestionsForUser(
  userId: string,
  xAccountId: string,
): Promise<SuggestionsSection> {
  const [rows, meta] = await Promise.all([
    listSuggestions(pooledDb, userId, xAccountId),
    pooledDb.query<{ handle: string; generating: boolean }>(
      `select xa.handle,
              exists (
                select 1 from generation_jobs gj
                 where gj.x_account_id = xa.id and gj.kind = 'suggestion'
                   and gj.status in ('queued', 'running')
              ) as generating
         from x_accounts xa where xa.id = $1 and xa.user_id = $2`,
      [xAccountId, userId],
    ),
  ]);

  const handle = meta.rows[0]?.handle ?? "i";
  const generating = meta.rows[0]?.generating ?? false;

  const suggestions: SuggestionDisplay[] = rows.map((r) => {
    const ev = r.evidence ?? {};
    if (ev.format === 2) {
      // 新形式（T-M8-91）。good_posts は外部の投稿も指せるため、本文はDBから引かずリンクと理由で示す。
      const goodPosts = (Array.isArray(ev.good_posts) ? ev.good_posts : [])
        .map((g) => {
          const id = str((g as Record<string, unknown>)?.id);
          const why = str((g as Record<string, unknown>)?.why);
          return id ? { tweetId: id, why, url: `https://x.com/${handle}/status/${id}` } : null;
        })
        .filter((g): g is SuggestionGoodPost => g !== null);
      const adv = (typeof ev.advice === "object" && ev.advice !== null ? ev.advice : {}) as Record<
        string,
        unknown
      >;
      const promptObj =
        typeof adv.prompt === "object" && adv.prompt !== null
          ? (adv.prompt as Record<string, unknown>)
          : null;
      return {
        kind: "v2" as const,
        content: r.content,
        goodPosts,
        advice: {
          pattern: adviceItem(adv.pattern, (x) => (typeof x === "string" ? x : null)),
          theme: adviceItem(adv.theme, (x) => (typeof x === "string" ? x : null)),
          image: adviceItem(adv.image, (x) => (typeof x === "boolean" ? x : null)),
          prompt:
            promptObj && str(promptObj.kind) && str(promptObj.content)
              ? { kind: str(promptObj.kind), content: str(promptObj.content) }
              : null,
        },
        legacySummary: "",
        createdAt: r.createdAt,
      };
    }
    // 旧形式（軸ベース）。刷新後に新しい実行をすれば置き換わるため、縮退表示で十分。
    return {
      kind: "legacy" as const,
      content: r.content,
      goodPosts: [],
      advice: null,
      legacySummary: str(ev.summary),
      createdAt: r.createdAt,
    };
  });
  return { suggestions, generating };
}

/** 所有者のみ。直近 days 日のフォロワー日次snapshotを日付昇順で返す（欠損日は点を作らない）。 */
export async function loadFollowerSnapshotsForUser(
  userId: string,
  xAccountId: string,
  days: number,
): Promise<FollowerPoint[]> {
  const { rows } = await pooledDb.query<{ date: string; count: number }>(
    `select fs.snapshot_date::text as date, fs.followers_count as count
       from follower_snapshots fs
       join x_accounts xa on xa.id = fs.x_account_id
      where fs.x_account_id = $1 and xa.user_id = $2
        and fs.snapshot_date >= (now() at time zone 'Asia/Tokyo')::date - ($3 || ' days')::interval
      order by fs.snapshot_date asc`,
    [xAccountId, userId, String(days)],
  );
  return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}
