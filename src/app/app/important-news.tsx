import Link from "next/link";

import { formatJst } from "@/lib/format";
import type { NewsCategory } from "@/lib/news";
import type { NewsItemView } from "@/lib/news-items";
import { newsCategoryLabel } from "@/lib/themes";

/**
 * SC-05 ホームの「重要ニュース」（要件06 §1・§1.4, T-M7-06）。利用者のニュース設定の分野で
 * インパクト「高」のものだけを新しい順に数件示し、本文はSC-06へ、原文は外部リンクで開く。
 * 表示専用（投稿作成はSC-06で行う）。取得失敗時は §10 に従い更新できなかったことを注記する。
 */

const cardClassName = "rounded-2xl border bg-card p-6 shadow-sm";

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
      <section className={cardClassName}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">重要ニュース</h2>
          <Link className="text-sm text-primary underline" href="/app/news">
            ニュースを見る
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {loadFailed
            ? "ニュースを取得できませんでした。時間をおいて開き直すか、ニュース画面で確認してください。"
            : "設定した分野で、インパクトが高い新着はまだありません。分野やインパクトの条件は通知設定で変更できます。"}
        </p>
        {loadFailed ? null : (
          <Link
            className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium"
            href="/app/settings?tab=notifications"
          >
            ニュース設定を変更
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className={cardClassName}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">重要ニュース</h2>
        <Link className="text-sm text-primary underline" href="/app/news">
          すべて見る
        </Link>
      </div>
      {loadFailed ? (
        <p className="mt-2 text-xs text-muted-foreground">
          最新の取得に失敗したため、前回までの内容を表示しています。
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li className="rounded-lg border bg-background p-3" key={item.id}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-0.5 font-medium">
                {newsCategoryLabel(item.category as NewsCategory)}
              </span>
              <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                インパクト高
              </span>
              {item.publishedAt ? (
                <span className="ml-auto text-muted-foreground">{formatJst(item.publishedAt)}</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-medium">{item.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
            <a
              className="mt-2 inline-block text-xs text-primary underline"
              href={item.sourceUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              元記事を読む
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        このニュースから投稿を作るには「すべて見る」からニュース画面を開いてください。
      </p>
    </section>
  );
}
