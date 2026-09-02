"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatJst, yen } from "@/lib/format";
import type { NewsItemsPage } from "@/lib/news-items";
import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import { newsCategoryLabel } from "@/lib/themes";
import { Badge, CategoryChip, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/**
 * SC-06 最新ニュース（T-M8-188・運営者の指示 2026-08-22）。
 *
 * **最新500件までを新着順（取得時刻の新しい順）が基本**で50件ずつのページ表示する。
 * 新着順のボタンは置かず、テーマ・インパクトの**選択式ソート**を置く：選ぶと一致する記事が
 * 先頭へ集まる（絞り込みではないので記事は消えない）。状態はURL（?page=&theme=&impact=）で
 * サーバー描画し、この部品は表示と「すぐに投稿作成」だけを持つ。
 */

const IMPACT_SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "high", label: "高" },
  { value: "mid", label: "中" },
  { value: "low", label: "低" },
];

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
  selected,
}: {
  page: NewsItemsPage;
  initialError: boolean;
  initialCreatedIds: string[];
  window: { from: string; to: string } | null;
  /** 選択式ソートの現在値（URL由来）。 */
  selected: { theme: string; impact: string };
}) {
  const router = useRouter();
  // 「作成済み」バッジ（下書き化済みのnews_item）。作成は投稿作成画面が担う（T-M8-210）。
  const created = new Set(initialCreatedIds);
  // 最新取得に失敗した場合は空扱いにせず注記する（要件06 §10）。
  const note = initialError
    ? "最新のニュースを取得できませんでした。時間をおいて再度お試しください。"
    : null;

  /** ?page=&theme=&impact= を組む（時間窓が付いていれば維持する）。 */
  function hrefFor(next: { page?: number; theme?: string; impact?: string }): string {
    const params = new URLSearchParams();
    const target = next.page ?? 1;
    if (target > 1) params.set("page", String(target));
    const theme = next.theme ?? selected.theme;
    const impact = next.impact ?? selected.impact;
    if (theme) params.set("theme", theme);
    if (impact) params.set("impact", impact);
    if (window) {
      params.set("from", window.from);
      params.set("to", window.to);
    }
    const qs = params.toString();
    return qs ? `/app/news?${qs}` : "/app/news";
  }

  /** ソート選択はページ1へ戻して反映する（選んだ結果が先頭に見えるように）。 */
  function applySort(next: { theme?: string; impact?: string }): void {
    router.push(hrefFor({ ...next, page: 1 }));
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
          最新のニュースを10分おきに自動取得し、500件までを新しい順に表示します。
        </p>
      )}

      {/* 選択式ソート（T-M8-188）。選ぶと一致する記事が先頭へ。URLで持つのでリロード・共有でも保たれる。 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-caption font-medium text-ink-2">
          テーマ
          <select
            className="mt-1 block h-10 min-w-40 rounded-lg border bg-background px-3 text-body text-ink"
            onChange={(event) => applySort({ theme: event.target.value })}
            value={selected.theme}
          >
            <option value="">指定なし（新着順）</option>
            {NEWS_FETCH_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {newsCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption font-medium text-ink-2">
          インパクト
          <select
            className="mt-1 block h-10 min-w-40 rounded-lg border bg-background px-3 text-body text-ink"
            onChange={(event) => applySort({ impact: event.target.value })}
            value={selected.impact}
          >
            <option value="">指定なし（新着順）</option>
            {IMPACT_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

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
        /*
          広い画面だけ2カラム（デザイン §形状・余白）。
          **`repeat(auto-fill, minmax(0,1fr))` は使わない**（T-M8-365）。最小幅が0だと
          `auto-fill` が入る限りトラックを作るため、**狭い画面でカードが数十pxまで潰れ**、
          中の固定幅（「すぐに投稿作成」ボタン）がはみ出してページごと横スクロールした。
          件数が増えるほど起きるので、**データが増えたときだけ落ちる**形になっていた。
        */
        <ul className="grid gap-3.5 xl:grid-cols-2">
          {page.items.map((item) => (
            /*
              **`min-w-0` が要る**（T-M8-365）。gridの子は既定で `min-width: auto` なので、
              中身（折り返せない長いURL等）より小さくならず、`break-words` を付けても
              **箱の方が広がってページごと横スクロールする**。
            */
            <li className={`${cardClassName} flex min-w-0 flex-col p-4`} key={item.id}>
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
              {/*
                **折り返せない長い文字列で横に伸びない**（T-M8-365）。見出しと本文はAIが書いた
                文章がそのまま入るので、長いURLや区切りの無い語が混ざりうる。`break-words` が
                無いと390pxで**ページ全体が横スクロールする**（実データが入っている通し実行でだけ
                mobile-layout が落ちて見つかった。単独実行では素通しだった）。
              */}
              <a
                className="mt-2 block text-sm font-bold leading-5 text-ink break-words hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item.title}
              </a>
              <p className="mt-1 text-body leading-5 text-ink-2 break-words">{item.summary}</p>
              <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                <span className="truncate text-caption text-ink-3">{domainOf(item.sourceUrl)}</span>
                <span className="ml-auto">
                  {created.has(item.id) ? (
                    <Badge tone="success">作成済み</Badge>
                  ) : (
                    /*
                      投稿作成画面へ遷移し、ニュース解説パターン＋{ニュース}への自動入力で
                      引き継ぐ（T-M8-210・運営者の指示 2026-08-22。以前はこの場でjobを作って
                      いたが、内容を確認・調整してから生成できる形へ）。
                    */
                    <Link
                      className="inline-flex h-9 items-center gap-1 rounded-card bg-brand-subtle px-3 text-body font-medium text-brand transition-colors duration-150 hover:bg-brand-subtle-hover"
                      href={`/app/posts?tab=create&news=${item.id}`}
                    >
                      <Icon name="bolt" size={15} />
                      すぐに投稿作成
                    </Link>
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
