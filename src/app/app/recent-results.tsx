import Link from "next/link";

import type { AnalyticsSummary } from "@/lib/analytics";
import { formatJst } from "@/lib/format";
import type { RecentPostView } from "@/lib/home/overview-server";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * SC-05 ホームの「直近の実績」（要件06 §1・§8・§10, T-M7-03）。直近7日の投稿件数と投稿翌日時点の
 * 表示回数を示し、最近の投稿から X 上のポストと SC-07 履歴へ deep-link する。未計測は0件と区別して
 * 「投稿の翌日から記録」と明示する（要件06 §8の `--`＝取得不能とも混同させない）。
 */

const MODE_LABEL: Record<string, string> = { auto: "自動投稿", manual: "手動投稿" };

/** X 上ポストへのpermalink。handle が空でも開ける i/status 形式にフォールバックする。 */
function tweetUrl(handle: string | null, tweetId: string): string {
  return `https://x.com/${handle ? handle.replace(/^@/, "") : "i"}/status/${tweetId}`;
}

export function RecentResultsCard({
  handle,
  posts,
  summary,
}: {
  handle: string | null;
  posts: RecentPostView[];
  /** 直近7日の集計（SC-09と同じ `getAnalyticsSummaryForUser`）。 */
  summary: AnalyticsSummary;
}) {
  if (posts.length === 0) {
    return (
      <Card as="section" className="px-5 py-4">
        <CardTitle>直近の実績</CardTitle>
        <p className="mt-2 text-body leading-5 text-ink-2">
          まだ投稿がありません。投稿すると、表示回数などの実績がここに表示されます。
        </p>
        <Link
          className={`mt-4 ${primaryLinkClassName}`}
          href="/app/posts?tab=create"
        >
          今すぐ作成
        </Link>
      </Card>
    );
  }

  const day1 = summary.checkpoints["1"];
  const measured = (day1?.tweets ?? 0) > 0;

  return (
    <Card as="section" className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>直近の実績</CardTitle>
        <Link className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline" href="/app/analytics">
          分析を見る
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">直近{summary.periodDays}日の投稿</dt>
          <dd className="text-lg font-semibold tabular-nums">{summary.postCount}件</dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">表示回数（投稿翌日時点の合計）</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {measured ? (
              day1.impressions.toLocaleString()
            ) : (
              <span className="text-base font-normal text-muted-foreground">未取得</span>
            )}
          </dd>
        </div>
      </dl>
      {measured ? null : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          表示回数は投稿の翌日から自動で記録されます。
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {posts.map((post) => (
          <li className="rounded-card border border-hairline p-3" key={post.draftId}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{post.patternName}</Badge>
              {post.postedMode ? (
                <span className="text-xs text-muted-foreground">
                  {MODE_LABEL[post.postedMode] ?? post.postedMode}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatJst(post.postedAt)}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-body leading-5 text-ink-2">{post.excerpt}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link
                className="inline-flex items-center py-2 -my-2 text-brand underline-offset-2 hover:underline"
                href={`/app/posts?tab=history&draftId=${post.draftId}`}
              >
                履歴で開く
              </Link>
              {post.firstTweetId ? (
                <a
                  className="inline-flex items-center py-2 -my-2 text-brand underline-offset-2 hover:underline"
                  href={tweetUrl(handle, post.firstTweetId)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Xで見る
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
