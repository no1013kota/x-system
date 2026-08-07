import Link from "next/link";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { primaryLinkClassName } from "@/components/ui/link-button";
import type { DraftView } from "@/lib/drafts";

/**
 * SC-05 ホームの確認待ち下書きキュー（要件06 §1, T-M3-26）。未投稿の下書き（status=draft・警告付き含む）
 * を新しい順で一覧し、各行から SC-07 の該当下書きへ deep-link する。0件は空状態＋「今すぐ作成」導線。
 * 表示専用のため server component（クライアント JS 不要）。
 *
 * 見た目は新デザイン（T-M8-06）。器は `components/ui/card` を使い、余白・角丸を直書きしない。
 */

export function ConfirmationQueueCard({
  drafts,
  total,
}: {
  drafts: DraftView[];
  /** 総数（表示はlimit付きで取得するため、件数はこちらが正・T-M8-67）。 */
  total: number;
}) {
  if (drafts.length === 0) {
    return (
      <Card>
        <CardBody>
          <CardTitle>確認待ちの下書き</CardTitle>
          <p className="mt-1.5 text-body leading-5 text-ink-2">
            確認待ちの下書きはありません。
          </p>
          <Link className={`mt-3.5 ${primaryLinkClassName}`} href="/app/posts?tab=create">
            今すぐ作成
          </Link>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>確認待ちの下書き（{total}）</CardTitle>
        <Link
          className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline"
          href="/app/posts?tab=drafts"
        >
          すべて見る
        </Link>
      </CardHeader>
      <CardBody className="pt-0">
        <ul className="space-y-2">
          {drafts.map((draft) => {
            const hasWarnings =
              draft.thread.some((p) => p.warnings.length > 0) ||
              draft.images.some((img) => img.status === "failed");
            return (
              <li key={draft.id}>
                <Link
                  className="block rounded-card border border-hairline p-3 transition-colors duration-150 hover:bg-black/[0.02]"
                  href={`/app/posts?tab=drafts&draftId=${draft.id}`}
                >
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">
                      {POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}
                    </Badge>
                    {hasWarnings ? <Badge tone="warn">要確認</Badge> : null}
                    <span className="ml-auto text-caption text-ink-3 tabular-nums">
                      {formatJst(draft.updated_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-body leading-5 text-ink-2">
                    {draft.thread[0]?.text ?? ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
        {total > drafts.length ? (
          // 全件は取得しない（T-M8-67）。切り捨てを黙らせず、残りの行き先を示す。
          <p className="mt-2 text-caption text-ink-3">
            ほか{total - drafts.length}件は「すべて見る」からご確認ください。
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
