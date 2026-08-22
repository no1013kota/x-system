import Link from "next/link";

import { formatJst } from "@/lib/format";
import type { NewsItemView } from "@/lib/news-items";

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
            className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline"
            href="/app/news"
          >
            ニュースを見る
          </Link>
        </CardHeader>
        <CardBody className="pt-0">
          <p className="text-body leading-5 text-ink-2">
          {loadFailed
            ? "ニュースを取得できませんでした。時間をおいて開き直すか、ニュース画面で確認してください。"
            : // 条件の変え方は直下の「ニュース設定を変更」ボタンが示す。文で繰り返さない（T-M8-66）。
              "インパクトが高い新着はまだありません。"}
        </p>
          {loadFailed ? null : (
            <Link
              // ホームの他の操作ボタンとトーンを揃える（brand-subtle・運営者の指摘 2026-08-22）。
              className="mt-3.5 inline-flex h-9 items-center justify-center rounded-card bg-brand-subtle px-4 text-body font-medium text-brand transition-colors duration-150 hover:bg-brand-subtle-hover"
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
          className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline"
          href="/app/news"
        >
          すべて見る
        </Link>
      </CardHeader>
      <CardBody className="pt-0">
        {loadFailed ? (
          <p className="mb-2 text-caption text-ink-3">
            最新の取得に失敗したため、前回までの内容を表示しています。
          </p>
        ) : null}
        <ul className="space-y-2">
        {items.map((item) => (
            <li className="rounded-card border border-hairline p-3" key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryChip category={item.category} />
                <Badge tone="warn">インパクト高</Badge>
                {item.publishedAt ? (
                  <span className="ml-auto text-caption text-ink-3 tabular-nums">
                    {formatJst(item.publishedAt)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm font-bold leading-5 text-ink">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-body leading-5 text-ink-2">{item.summary}</p>
              <a
                className="mt-2 inline-block text-caption text-brand underline-offset-2 hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                元記事を読む
              </a>
            </li>
        ))}
        </ul>
      </CardBody>
    </Card>
  );
}
