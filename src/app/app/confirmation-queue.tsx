import Link from "next/link";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";

import type { DraftView } from "@/lib/drafts";

/**
 * SC-05 ホームの確認待ち下書きキュー（要件06 §1, T-M3-26）。未投稿の下書き（status=draft・警告付き含む）
 * を新しい順で一覧し、各行から SC-07 の該当下書きへ deep-link する。0件は空状態＋「今すぐ作成」導線。
 * 表示専用のため server component（クライアント JS 不要）。
 */

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export function ConfirmationQueueCard({ drafts }: { drafts: DraftView[] }) {
  if (drafts.length === 0) {
    return (
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">確認待ちの下書き</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          確認待ちの下書きはありません。新しい投稿を作成しましょう。
        </p>
        <Link
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          href="/app/posts?tab=create"
        >
          今すぐ作成
        </Link>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">確認待ちの下書き（{drafts.length}）</h2>
        <Link className="text-sm text-primary underline" href="/app/posts?tab=drafts">
          すべて見る
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {drafts.map((draft) => {
          const hasWarnings =
            draft.thread.some((p) => p.warnings.length > 0) ||
            draft.images.some((img) => img.status === "failed");
          return (
            <li key={draft.id}>
              <Link
                className="block rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50"
                href={`/app/posts?tab=drafts&draftId=${draft.id}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}
                  </span>
                  {hasWarnings ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                      要確認
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timeLabel(draft.updated_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {draft.thread[0]?.text ?? ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
