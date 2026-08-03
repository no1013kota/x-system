import Link from "next/link";

import { formatJst } from "@/lib/format";
import type { NewsCategory } from "@/lib/news";
import type { NewsItemView } from "@/lib/news-items";
import { newsCategoryLabel } from "@/lib/themes";

import { Badge, CategoryChip } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * SC-05 ホームの「重要ニュース」（要件06 §1・§1.4, T-M7-06）。利用者のニュース設定の分野で
 * インパクト「高」のものだけを新しい順に数件示し、本文はSC-06へ、原文は外部リンクで開く。
 * 表示専用（投稿作成はSC-06で行う）。取得失敗時は §10 に従い更新できなかったことを注記する。
 */

export function ImportantNewsCard({
  items,
  loadFailed,
}: {
  items: NewsItemView[];
  /** 最新の取得に失敗した（一覧は空か古い可能性がある）。 */
  loadFailed: boolean;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>重要ニュース</CardTitle>
          <Link
            className="text-[12px] font-medium text-brand underline-offset-2 hover:underline"
            href="/app/news"
          >
            ニュースを見る
          </Link>
        </CardHeader>
        <CardBody className="pt-0">
          <p className="text-[12.5px] leading-5 text-ink-2">
          {loadFailed
            ? "ニュースを取得できませんでした。時間をおいて開き直すか、ニュース画面で確認してください。"
            : "設定したテーマで、インパクトが高い新着はまだありません。テーマやインパクトの条件は通知設定で変更できます。"}
        </p>
          {loadFailed ? null : (
            <Link
              className="mt-3.5 inline-flex h-9 items-center justify-center rounded-card border border-hairline px-4 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-black/[0.03]"
              href="/app/settings?tab=notifications"
            >
              ニュース設定を変更
            </Link>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>重要ニュース</CardTitle>
        <Link
          className="text-[12px] font-medium text-brand underline-offset-2 hover:underline"
          href="/app/news"
        >
          すべて見る
        </Link>
      </CardHeader>
      <CardBody className="pt-0">
        {loadFailed ? (
          <p className="mb-2 text-[11.5px] text-ink-3">
            最新の取得に失敗したため、前回までの内容を表示しています。
          </p>
        ) : null}
        <ul className="space-y-2">
        {items.map((item) => (
            <li className="rounded-card border border-hairline p-3" key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip category={item.category}>
                  {newsCategoryLabel(item.category as NewsCategory)}
                </CategoryChip>
                <Badge tone="warn">インパクト高</Badge>
                {item.publishedAt ? (
                  <span className="ml-auto text-[11.5px] text-ink-3 tabular-nums">
                    {formatJst(item.publishedAt)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[14px] font-bold leading-5 text-ink">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-ink-2">{item.summary}</p>
              <a
                className="mt-2 inline-block text-[11.5px] text-brand underline-offset-2 hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                元記事を読む
              </a>
            </li>
        ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-ink-3">
          このニュースから投稿を作るには「すべて見る」からニュース画面を開いてください。
        </p>
      </CardBody>
    </Card>
  );
}
