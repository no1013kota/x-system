import { EmptyNotice } from "@/components/app-shell/page-state";
import { Badge } from "@/components/ui/badge";
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
    // デザイン H-1 は6列のテーブル。**本文が読めなくなるのは機能低下**なので、
    // 内容セルに折りたたみを残して全文へ到達できるようにする（表示の既定は1行）。
    <div className="overflow-x-auto rounded-card border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full min-w-[52rem] text-[12.5px]">
        <thead>
          <tr className="border-b border-hairline text-left text-[11.5px] text-ink-2">
            <th className="px-4 py-2.5 font-medium">投稿日時</th>
            <th className="px-2 py-2.5 font-medium">型</th>
            <th className="px-2 py-2.5 font-medium">実行</th>
            <th className="px-2 py-2.5 font-medium">内容</th>
            <th className="px-2 py-2.5 font-medium">形式</th>
            <th className="px-4 py-2.5 font-medium">ステータス</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <HistoryRow
              draft={draft}
              handle={handle}
              highlighted={draft.id === selectedDraftId}
              key={draft.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({
  draft,
  handle,
  highlighted,
}: {
  draft: DraftView;
  handle: string | null;
  highlighted: boolean;
}) {
  const posted = draft.tweet_ids.length;
  const total = draft.thread.length;
  // 一部だけ投稿できた場合はロールバック済み（要件06）。成功と区別して黄色で示す。
  const rolledBack = posted > 0 && posted < total;
  const firstTweetId = draft.tweet_ids[0];

  return (
    <tr
      className={`border-b border-hairline last:border-0 align-top ${
        highlighted ? "bg-brand-subtle/40" : ""
      }`}
      id={`draft-${draft.id}`}
    >
      <td className="px-4 py-3 whitespace-nowrap text-ink-2 tabular-nums">
        {timeLabel(draft.posted_at)}
      </td>
      <td className="px-2 py-3">
        <Badge>{POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}</Badge>
      </td>
      <td className="px-2 py-3 whitespace-nowrap text-ink-2">
        {draft.posted_mode ? (MODE_LABEL[draft.posted_mode] ?? draft.posted_mode) : "—"}
      </td>
      <td className="max-w-[26rem] px-2 py-3">
        <details>
          <summary className="cursor-pointer truncate text-ink">
            {draft.thread[0]?.text ?? ""}
          </summary>
          <ol className="mt-2 space-y-2">
            {draft.thread.map((post, index) => (
              <li className="rounded-card border border-hairline p-2.5" key={post.local_id}>
                <p className="whitespace-pre-wrap text-ink-2">{post.text}</p>
                {draft.tweet_ids[index] ? (
                  <a
                    className="mt-1.5 inline-block text-[11.5px] text-brand underline-offset-2 hover:underline"
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
        </details>
      </td>
      <td className="px-2 py-3 whitespace-nowrap text-ink-2">
        {total > 1 ? `スレッド(${total})` : "単発"}
      </td>
      <td className="px-4 py-3">
        {rolledBack ? (
          <>
            <Badge tone="warn">ロールバック済み</Badge>
            <p className="mt-1 text-[11px] leading-4 text-warn-fg">
              {posted + 1}/{total}ポスト目の送信に失敗 — 投稿済み{posted}件をロールバック削除（下書きは保持）
            </p>
          </>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Badge tone="success">成功</Badge>
            {firstTweetId ? (
              <a
                className="text-[11.5px] text-brand underline-offset-2 hover:underline"
                href={tweetUrl(handle, firstTweetId)}
                rel="noopener noreferrer"
                target="_blank"
              >
                Xで表示
              </a>
            ) : null}
          </span>
        )}
      </td>
    </tr>
  );
}
