import { EmptyNotice } from "@/components/app-shell/page-state";
import type { DraftView } from "@/lib/drafts";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";

/**
 * SC-07 履歴タブ（投稿済み下書きの閲覧専用一覧, T-M3-22, 要件06 §7/§8）。
 * 投稿日時・自動/手動（posted_mode）・パターン・各tweetのXリンクを表示する。本文・順序は編集不可。
 * 通知リンク `/app/posts?tab=history&draftId=...` で対象履歴を直接開けるよう deep-link を強調する。
 */

const MODE_LABEL: Record<string, string> = { auto: "自動投稿", manual: "手動投稿" };

function timeLabel(iso: string | null): string {
  if (!iso) return "-";
  return formatJst(iso);
}

/** X 上ポストへのpermalink。handle が空でも開ける i/status 形式にフォールバックする。 */
function tweetUrl(handle: string | null, tweetId: string): string {
  const user = handle ? handle.replace(/^@/, "") : "i";
  return `https://x.com/${user}/status/${tweetId}`;
}

export function HistoryList({
  drafts,
  handle,
  selectedDraftId,
}: {
  drafts: DraftView[];
  handle: string | null;
  selectedDraftId?: string;
}) {
  if (drafts.length === 0) {
    return (
      <EmptyNotice>
        投稿履歴はまだありません。下書きを投稿すると、ここに表示されます。
      </EmptyNotice>
    );
  }
  return (
    <ul className="space-y-4">
      {drafts.map((draft) => (
        <HistoryCard
          draft={draft}
          handle={handle}
          highlighted={draft.id === selectedDraftId}
          key={draft.id}
        />
      ))}
    </ul>
  );
}

function HistoryCard({
  draft,
  handle,
  highlighted,
}: {
  draft: DraftView;
  handle: string | null;
  highlighted: boolean;
}) {
  return (
    <li
      className={`scroll-mt-24 rounded-2xl border bg-card p-5 shadow-sm ${
        highlighted ? "ring-2 ring-ring" : ""
      }`}
      id={`draft-${draft.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}</span>
        {draft.posted_mode ? (
          <span className="rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {MODE_LABEL[draft.posted_mode] ?? draft.posted_mode}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{timeLabel(draft.posted_at)}</span>
      </div>

      <ol className="mt-3 space-y-2">
        {draft.thread.map((post, index) => (
          <li className="rounded-lg border bg-background p-3" key={post.local_id}>
            <p className="text-sm whitespace-pre-wrap">{post.text}</p>
            {draft.tweet_ids[index] ? (
              <a
                className="mt-1.5 inline-block text-xs text-primary underline"
                href={tweetUrl(handle, draft.tweet_ids[index])}
                rel="noopener noreferrer"
                target="_blank"
              >
                Xで見る（ポスト{index + 1}）
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </li>
  );
}
