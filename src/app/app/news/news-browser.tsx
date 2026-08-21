"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { createDraftFromNewsAction } from "@/app/actions/generation-jobs";
import { formatJst, yen } from "@/lib/format";
import type { NewsItemsPage, NewsSort } from "@/lib/news-items";
import { Badge, CategoryChip, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

/**
 * SC-06 最新ニュース（T-M8-187・運営者の指示 2026-08-21）。
 *
 * **保存されている全件**を50件ずつのページで表示し、新着・テーマ・インパクトで並び替える。
 * 旧仕様の「分野・インパクトの絞り込み＋表示件数の保存」は廃止した（通知の条件は設定が持つ。
 * 取得は従来どおりなので費用は変わらない）。並び替え・ページはURL（?sort=&page=）で
 * サーバー描画し、この部品は表示と「すぐに投稿作成」だけを持つ。
 */

const IMPACT_LABEL = new Map<string, string>([
  ["high", "高"],
  ["mid", "中"],
  ["low", "低"],
]);

/** インパクトの色。意味で選ぶ（高=注意を引く／中=情報／低=補助）。 */
const IMPACT_TONE: Record<string, BadgeTone> = {
  high: "warn",
  mid: "info",
  low: "neutral",
};

const SORT_TABS: { value: NewsSort; label: string }[] = [
  { value: "date", label: "新着順" },
  { value: "category", label: "テーマ順" },
  { value: "impact", label: "インパクト順" },
];

/** 出典のドメインだけを出す（デザインはカードのフッタにドメインを置く）。 */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return formatJst(iso);
}

export function NewsBrowser({
  page,
  initialError,
  initialCreatedIds,
  window,
}: {
  page: NewsItemsPage;
  initialError: boolean;
  initialCreatedIds: string[];
  window: { from: string; to: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<Set<string>>(new Set(initialCreatedIds));
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // 最新取得に失敗した場合は空扱いにせず注記する（要件06 §10）。
  const [note] = useState<string | null>(
    initialError ? "最新のニュースを取得できませんでした。時間をおいて再度お試しください。" : null,
  );
  const toast = useToast();

  /** ?sort=&page= を保ってURLを組む（時間窓が付いていれば維持する）。 */
  function hrefFor(next: { sort?: NewsSort; page?: number }): string {
    const params = new URLSearchParams();
    const sort = next.sort ?? page.sort;
    if (sort !== "date") params.set("sort", sort);
    const target = next.page ?? 1;
    if (target > 1) params.set("page", String(target));
    if (window) {
      params.set("from", window.from);
      params.set("to", window.to);
    }
    const qs = params.toString();
    return qs ? `/app/news?${qs}` : "/app/news";
  }

  function notify(
    message: string,
    options: { href?: string | null; label?: string; tone?: "error" | "success" } = {},
  ) {
    const tone = options.tone ?? "error";
    toast.show({
      tone,
      title: tone === "success" ? message : "実行できませんでした",
      description: tone === "success" ? undefined : message,
      ...(options.href ? { action: { href: options.href, label: options.label ?? "設定を開く" } } : {}),
    });
  }

  function generate(newsItemId: string) {
    if (created.has(newsItemId) || pending) return;
    setGeneratingId(newsItemId);
    startTransition(async () => {
      // 冪等: news_item ごとに固定 request_key（再送で同じjobを返す）。画像は既定OFF。
      const res = await createDraftFromNewsAction({
        request_key: `news-draft:${newsItemId}`,
        news_item_id: newsItemId,
      });
      setGeneratingId(null);
      if (res.status === "success") {
        setCreated((prev) => new Set(prev).add(newsItemId));
        // 生成は1分ほどかかる。どこで結果を見られるかまで示す（要件06 §10）。
        notify("生成を開始しました。1分ほどで下書きに追加されます。", {
          href: "/app/posts?tab=create",
          label: "進行状況を見る",
          tone: "success",
        });
      } else {
        // 競合系は「再読み込み」では直らないため、原因別に次の操作を示す。
        const reason = res.details?.reason;
        const path = res.details?.settingsPath;
        if (reason === "too_many_active_jobs") {
          notify("同時に生成できるのは5件までです。作成中の下書きが仕上がってから、もう一度お試しください。", {
            href: "/app/posts?tab=create",
            label: "進行状況を見る",
          });
        } else if (reason === "learning_removing") {
          notify("学習ソースの更新中は生成を開始できません。完了後にもう一度お試しください。", {
            href: "/app/settings?tab=account",
            label: "学習ソースを見る",
          });
        } else {
          notify(res.message || "生成を開始できませんでした。", {
            href: typeof path === "string" ? path : null,
          });
        }
      }
    });
  }

  const pager = page.pageCount > 1 && (
    <nav aria-label="ページ" className="flex flex-wrap items-center justify-center gap-3">
      {page.page > 1 ? (
        <Link
          className="inline-flex min-h-10 items-center gap-1 rounded-card border border-hairline bg-surface px-4 text-sm font-medium text-ink hover:bg-black/[0.03]"
          href={hrefFor({ page: page.page - 1 })}
        >
          <Icon aria-hidden="true" name="chevron_right" size={15} className="rotate-180" />
          前の50件
        </Link>
      ) : null}
      <span className="text-caption text-ink-2 tabular-nums">
        {page.page} / {page.pageCount}ページ（全{yen(page.total)}件）
      </span>
      {page.page < page.pageCount ? (
        <Link
          className="inline-flex min-h-10 items-center gap-1 rounded-card border border-hairline bg-surface px-4 text-sm font-medium text-ink hover:bg-black/[0.03]"
          href={hrefFor({ page: page.page + 1 })}
        >
          次の50件
          <Icon aria-hidden="true" name="chevron_right" size={15} />
        </Link>
      ) : null}
    </nav>
  );

  return (
    <div className="mt-4 space-y-4">
      {window ? (
        <Notice className="flex flex-wrap items-center justify-between gap-2" tone="info">
          <span>
            通知でお知らせした時間帯（{formatDate(window.from)}〜{formatDate(window.to)}）のニュースを表示しています。
          </span>
          <Link className="font-medium underline underline-offset-2" href="/app/news">
            すべてのニュースを表示
          </Link>
        </Notice>
      ) : (
        // 集約仕様・通知の配信条件は一覧を見る操作に不要なため書かない（T-M8-66）。
        <p className="text-sm text-muted-foreground">
          保存されているニュースをすべて表示します（10時〜20時の間、2時間おきに自動取得）。
        </p>
      )}

      {/* 並び替え（T-M8-187）。URLで持つのでリロード・共有でも保たれる。 */}
      <nav aria-label="並び替え" className="flex flex-wrap gap-2">
        {SORT_TABS.map((tab) => {
          const active = page.sort === tab.value;
          return (
            <Link
              aria-current={active ? "true" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-pill border px-3.5 text-body font-medium transition-colors duration-150",
                active
                  ? "border-brand bg-brand text-white"
                  : "border-hairline bg-surface text-ink-2 hover:bg-black/[0.03]",
              )}
              href={hrefFor({ sort: tab.value, page: 1 })}
              key={tab.value}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* ここに残すのは**画面の状態**だけ。操作の結果はトーストへ（T-M8-18）。 */}
      {note ? (
        <Notice role="alert" tone="warn">
          {note}
        </Notice>
      ) : null}

      {page.items.length === 0 ? (
        <div className={`${cardClassName} px-4 py-11 text-center text-body text-ink-2`}>
          {window ? (
            <p>この時間帯に該当するニュースはありません。</p>
          ) : (
            <p>まだ表示できるニュースがありません。次の自動取得までお待ちください。</p>
          )}
        </div>
      ) : (
        // 2カラム。`minmax(0,1fr)` で長いタイトルによる潰れを防ぐ（デザイン §形状・余白）。
        <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(0,1fr))] xl:grid-cols-2">
          {page.items.map((item) => (
            <li className={`${cardClassName} flex flex-col p-4`} key={item.id}>
              <div className="flex items-center gap-2">
                <CategoryChip category={item.category} />
                <Badge tone={IMPACT_TONE[item.impact] ?? "neutral"}>
                  {IMPACT_LABEL.get(item.impact) ?? item.impact}
                </Badge>
                {item.publishedAt ? (
                  <span className="ml-auto text-caption text-ink-3 tabular-nums">
                    {formatDate(item.publishedAt)}
                  </span>
                ) : null}
              </div>
              <a
                className="mt-2 block text-sm font-bold leading-5 text-ink hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item.title}
              </a>
              <p className="mt-1 text-body leading-5 text-ink-2">{item.summary}</p>
              <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                <span className="truncate text-caption text-ink-3">{domainOf(item.sourceUrl)}</span>
                <span className="ml-auto">
                  {created.has(item.id) ? (
                    <Badge tone="success">作成済み</Badge>
                  ) : (
                    <button
                      className="inline-flex h-9 items-center gap-1 rounded-card bg-brand-subtle px-3 text-body font-medium text-brand transition-colors duration-150 hover:bg-brand-subtle-hover disabled:opacity-50"
                      disabled={pending}
                      onClick={() => generate(item.id)}
                      type="button"
                    >
                      <Icon name="bolt" size={15} />
                      {generatingId === item.id ? "生成を開始中…" : "すぐに投稿作成"}
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pager}
    </div>
  );
}
