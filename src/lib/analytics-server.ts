import "server-only";

import {
  buildDraftAnalytics,
  summarize,
  type AnalyticsDraftRow,
  type AnalyticsSummary,
  type DraftAnalytics,
  type FollowerPoint,
} from "./analytics";
import { humanizeReportText } from "./analytics/humanize-report";
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
    `select d.id, d.pattern_name, d.status, d.tweet_ids, d.last_post_error, d.thread,
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
  /**
   * 保存済みタイムラインから引いた投稿の実体（T-M8-114）。
   * **リンクだけでは「どの投稿の話か」が画面で分からない**（開かないと確認できない）ため、
   * 本文の冒頭と数値をその場に出す。取得前・削除済み・保存上限より古い投稿では null。
   */
  post: {
    text: string;
    postedAt: string | null;
    /** Xは投稿から30日を過ぎると表示回数を返さないため null がありうる（0ではない）。 */
    impressions: number | null;
    likes: number | null;
    reposts: number | null;
    replies: number | null;
    hasImage: boolean;
    /** このアプリで作った投稿だけ付く（外部投稿は null）。**表示名**で持つ（T-M8-129 U3）。 */
    patternName: string | null;
    theme: string | null;
  } | null;
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
    /** アカウント.mdの編集提案（T-M8-106。未作成アカウントや旧レポートは null）。 */
    accountMd: { content: string; reason: string } | null;
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
  // 理由は読み物なので日本語へ直す（T-M8-114）。
  return rec === null || !reason ? null : { recommended: rec, reason: humanizeReportText(reason) };
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

  /**
   * 良かった投稿の実体をまとめて引く（T-M8-114）。全レポートぶんのIDを1クエリで取り、
   * レポートごとに引かない（N+1にしない）。保存対象外・削除済みのIDは単に見つからず、
   * その投稿はリンクと理由だけの表示へ落ちる（欠けても他を巻き添えにしない）。
   */
  const wantedIds = [
    ...new Set(
      rows.flatMap((r) =>
        r.evidence?.format === 2 && Array.isArray(r.evidence.good_posts)
          ? r.evidence.good_posts.map((g) => str((g as Record<string, unknown>)?.id)).filter(Boolean)
          : [],
      ),
    ),
  ];
  const postById = new Map<string, NonNullable<SuggestionGoodPost["post"]>>();
  if (wantedIds.length > 0) {
    const { rows: postRows } = await pooledDb.query<{
      tweet_id: string;
      text: string;
      posted_at: Date | string | null;
      impressions: string | null;
      likes: number | null;
      reposts: number | null;
      replies: number | null;
      has_image: boolean;
      pattern_name: string | null;
      theme: string | null;
    }>(
      `select tweet_id, text, posted_at, impressions, likes, reposts, replies,
              has_image, pattern_name, theme
         from x_timeline_posts
        where x_account_id = $1 and tweet_id = any($2::text[])`,
      [xAccountId, wantedIds],
    );
    for (const p of postRows) {
      postById.set(p.tweet_id, {
        text: p.text,
        postedAt: p.posted_at ? new Date(p.posted_at).toISOString() : null,
        // impressions は bigint なので pg は文字列で返す。null（30日超で提供なし）は 0 にしない。
        impressions: p.impressions === null ? null : Number(p.impressions),
        likes: p.likes,
        reposts: p.reposts,
        replies: p.replies,
        hasImage: p.has_image,
        patternName: p.pattern_name,
        theme: p.theme,
      });
    }
  }

  const suggestions: SuggestionDisplay[] = rows.map((r) => {
    const ev = r.evidence ?? {};
    if (ev.format === 2) {
      // 新形式（T-M8-91）。good_posts は外部の投稿も指せるため、本文はDBから引かずリンクと理由で示す。
      const goodPosts = (Array.isArray(ev.good_posts) ? ev.good_posts : [])
        .map((g) => {
          const id = str((g as Record<string, unknown>)?.id);
          const why = str((g as Record<string, unknown>)?.why);
          return id
            ? {
                tweetId: id,
                why: humanizeReportText(why),
                url: `https://x.com/${handle}/status/${id}`,
                post: postById.get(id) ?? null,
              }
            : null;
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
      const accountMdObj =
        typeof adv.account_md === "object" && adv.account_md !== null
          ? (adv.account_md as Record<string, unknown>)
          : null;
      return {
        kind: "v2" as const,
        content: humanizeReportText(r.content),
        goodPosts,
        advice: {
          pattern: adviceItem(adv.pattern, (x) => (typeof x === "string" ? x : null)),
          theme: adviceItem(adv.theme, (x) => (typeof x === "string" ? x : null)),
          image: adviceItem(adv.image, (x) => (typeof x === "boolean" ? x : null)),
          prompt:
            promptObj && str(promptObj.kind) && str(promptObj.content)
              ? { kind: str(promptObj.kind), content: str(promptObj.content) }
              : null,
          accountMd:
            accountMdObj && str(accountMdObj.content)
              ? {
                  // content は利用者が保存する成果物なので**そのまま渡す**。reason だけ読み物。
                  content: str(accountMdObj.content),
                  reason: humanizeReportText(str(accountMdObj.reason)),
                }
              : null,
        },
        legacySummary: "",
        createdAt: r.createdAt,
      };
    }
    // 旧形式（軸ベース）。刷新後に新しい実行をすれば置き換わるため、縮退表示で十分。
    return {
      kind: "legacy" as const,
      content: humanizeReportText(r.content),
      goodPosts: [],
      advice: null,
      legacySummary: humanizeReportText(str(ev.summary)),
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
