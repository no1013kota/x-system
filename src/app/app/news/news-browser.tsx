"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { listNewsItemsAction } from "@/app/actions/news";
import { updateNewsConfigAction } from "@/app/actions/settings";
import type { NewsItemView } from "@/lib/news-items";
import { THEME_OPTIONS } from "@/lib/themes";

const IMPACTS: { id: string; label: string }[] = [
  { id: "high", label: "高" },
  { id: "mid", label: "中" },
  { id: "low", label: "低" },
];

const CATEGORY_LABEL = new Map<string, string>(THEME_OPTIONS.map((t) => [t.newsCategory, t.label]));
const IMPACT_LABEL = new Map<string, string>(IMPACTS.map((i) => [i.id, i.label]));

const IMPACT_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  mid: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function NewsBrowser({
  initialItems,
  initialCursor,
  initialError,
  newsConfig,
  window,
}: {
  initialItems: NewsItemView[];
  initialCursor: string | null;
  initialError: boolean;
  newsConfig: { categories: string[]; impacts: string[]; maxItems: number };
  window: { from: string; to: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<NewsItemView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [categories, setCategories] = useState<string[]>(newsConfig.categories);
  const [impacts, setImpacts] = useState<string[]>(newsConfig.impacts);
  const [maxItems, setMaxItems] = useState<number>(newsConfig.maxItems);
  // 最新取得に失敗した場合は前回成功分を残したまま注記する（要件06 §10）。
  const [note, setNote] = useState<string | null>(
    initialError ? "最新のニュースを取得できませんでした。時間をおいて再度お試しください。" : null,
  );

  const baseQuery = () => ({
    categories,
    impacts,
    limit: maxItems,
    ...(window ?? {}),
  });

  function applyConfig() {
    if (categories.length === 0 || impacts.length === 0) {
      setNote("分野とインパクトを各1件以上選択してください。");
      return;
    }
    startTransition(async () => {
      // 表示条件を news_config として保存し（要件02 §4.2）、その条件で一覧を取り直す。
      const saved = await updateNewsConfigAction({
        categories,
        impact_filter: impacts,
        max_items: maxItems,
      });
      if (saved.status === "error") {
        setNote(saved.message || "設定を保存できませんでした。");
        return;
      }
      const res = await listNewsItemsAction(baseQuery());
      if (res.status === "success" && res.items) {
        setItems(res.items);
        setCursor(res.nextCursor ?? null);
        setNote(null);
      } else {
        // 取得失敗時は前回成功分を保持し注記する。
        setNote("最新のニュースを取得できませんでした。表示は前回の内容です。");
      }
    });
  }

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const res = await listNewsItemsAction({ ...baseQuery(), cursor });
      if (res.status === "success" && res.items) {
        setItems((prev) => [...prev, ...res.items!]);
        setCursor(res.nextCursor ?? null);
      } else {
        setNote("続きを取得できませんでした。時間をおいて再度お試しください。");
      }
    });
  }

  return (
    <div className="mt-4 space-y-4">
      {window ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <span>
            通知の時間窓（{formatDate(window.from)}〜{formatDate(window.to)}）のニュースを表示しています。
          </span>
          <Link className="font-medium underline underline-offset-2" href="/app/news">
            すべてのニュースを表示
          </Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          過去7日分のニュースを表示します。ニュースはJST 9:00〜20:00の取得時刻ごとに最大1件へ集約され、
          設定条件に一致する新着が0件の時刻には届きません。
        </p>
      )}

      <section aria-label="絞り込み" className="space-y-3 rounded-xl border bg-background p-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">分野</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEME_OPTIONS.map((t) => {
              const active = categories.includes(t.newsCategory);
              return (
                <button
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-sm ${active ? "border-foreground bg-foreground text-background" : "hover:bg-accent"}`}
                  key={t.newsCategory}
                  onClick={() => setCategories((prev) => toggle(prev, t.newsCategory))}
                  type="button"
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground">インパクト</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {IMPACTS.map((i) => {
              const active = impacts.includes(i.id);
              return (
                <button
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1 text-sm ${active ? "border-foreground bg-foreground text-background" : "hover:bg-accent"}`}
                  key={i.id}
                  onClick={() => setImpacts((prev) => toggle(prev, i.id))}
                  type="button"
                >
                  {i.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">表示件数</span>
            <input
              className="mt-1 w-24 rounded-md border px-2 py-1"
              max={100}
              min={1}
              onChange={(e) => setMaxItems(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              type="number"
              value={maxItems}
            />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            disabled={pending}
            onClick={applyConfig}
            type="button"
          >
            この設定で表示・保存
          </button>
        </div>
      </section>

      {note ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          {note}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
          該当するニュースはありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li className="rounded-xl border bg-background p-4" key={item.id}>
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs">
                  {CATEGORY_LABEL.get(item.category) ?? item.category}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${IMPACT_BADGE[item.impact] ?? "bg-muted"}`}>
                  {IMPACT_LABEL.get(item.impact) ?? item.impact}
                </span>
                {item.publishedAt ? (
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(item.publishedAt)}</span>
                ) : null}
              </div>
              <a
                className="mt-2 block font-medium hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item.title}
              </a>
              <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          className="w-full rounded-lg border py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={pending}
          onClick={loadMore}
          type="button"
        >
          {pending ? "読み込み中…" : "もっと見る"}
        </button>
      ) : null}
    </div>
  );
}
