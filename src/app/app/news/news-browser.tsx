"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { createDraftFromNewsAction } from "@/app/actions/generation-jobs";
import { listNewsItemsAction } from "@/app/actions/news";
import { updateNewsConfigAction } from "@/app/actions/settings";
import {
  clampNewsMaxItems,
  NEWS_MAX_ITEMS_MAX,
  NEWS_MAX_ITEMS_MIN,
} from "@/lib/config-defaults";
import { formatJst } from "@/lib/format";
import type { NewsItemView } from "@/lib/news-items";
import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import { THEME_OPTIONS } from "@/lib/themes";
import { Badge, CategoryChip, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

const IMPACTS: { id: string; label: string }[] = [
  { id: "high", label: "高" },
  { id: "mid", label: "中" },
  { id: "low", label: "低" },
];

const IMPACT_LABEL = new Map<string, string>(IMPACTS.map((i) => [i.id, i.label]));

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

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function NewsBrowser({
  initialItems,
  initialCursor,
  initialError,
  initialCreatedIds,
  newsConfig,
  window,
}: {
  initialItems: NewsItemView[];
  initialCursor: string | null;
  initialError: boolean;
  initialCreatedIds: string[];
  newsConfig: { categories: string[]; impacts: string[]; maxItems: number };
  window: { from: string; to: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<NewsItemView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [categories, setCategories] = useState<string[]>(newsConfig.categories);
  const [impacts, setImpacts] = useState<string[]>(newsConfig.impacts);
  const [maxItems, setMaxItems] = useState<number>(newsConfig.maxItems);
  const [created, setCreated] = useState<Set<string>>(new Set(initialCreatedIds));
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // 最新取得に失敗した場合は前回成功分を残したまま注記する（要件06 §10）。
  const [note, setNote] = useState<string | null>(
    initialError ? "最新のニュースを取得できませんでした。時間をおいて再度お試しください。" : null,
  );
  const toast = useToast();
  // 既定は**取得している分野**すべて・インパクト高中。既定より絞っているときだけ「条件を戻す」を出す。
  // 発信テーマ（THEME_OPTIONS・6テーマ）とは別で、記事が来ない分野は絞り込みにも出さない（T-M7-55）。
  const allCategories: string[] = [...NEWS_FETCH_CATEGORIES];
  const filterThemes = THEME_OPTIONS.filter((t) => allCategories.includes(t.newsCategory));
  const narrowedFilter =
    categories.length < allCategories.length || impacts.length < 2 || !impacts.includes("high");

  /**
   * 操作の結果はトーストへ（T-M8-18）。**以前は `role="status"` 固定で、失敗も成功として
   * 読み上げられていた。** 画面に残すのは「いま何が表示されているか」（取得失敗の注記・
   * 入力検証）だけにする。
   */
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

  function resetFilter() {
    setCategories(allCategories);
    setImpacts(["high", "mid"]);
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
            href: "/app/ai-settings?tab=learning",
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

  const baseQuery = () => ({
    categories,
    impacts,
    limit: maxItems,
    ...(window ?? {}),
  });

  function applyConfig() {
    if (categories.length === 0 || impacts.length === 0) {
      setNote("テーマとインパクトを各1件以上選択してください。");
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
        notify(saved.message || "設定を保存できませんでした。");
        return;
      }
      const res = await listNewsItemsAction(baseQuery());
      if (res.status === "success" && res.items) {
        setItems(res.items);
        setCursor(res.nextCursor ?? null);
        notify("表示条件を保存しました。ニュース通知もこの条件で届きます。", { tone: "success" });
      } else {
        // 取得失敗は**画面の状態**なので注記として残す（トーストは消えてしまう）。
        setNote("最新のニュースを取得できませんでした。表示は前回の内容です。");
      }
    });
  }

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const res = await listNewsItemsAction({ ...baseQuery(), cursor });
      if (res.status === "success" && res.items) {
        const newItems = res.items;
        setItems((prev) => [...prev, ...newItems]);
        setCursor(res.nextCursor ?? null);
        const createdIds = res.createdNewsItemIds;
        if (createdIds?.length) {
          setCreated((prev) => {
            const next = new Set(prev);
            for (const id of createdIds) next.add(id);
            return next;
          });
        }
      } else {
        setNote("続きを取得できませんでした。時間をおいて再度お試しください。");
      }
    });
  }

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
          過去7日分のニュースを表示します（10時〜20時の間、2時間おきに自動取得）。
        </p>
      )}

      <section aria-label="絞り込み" className={`${cardClassName} space-y-3 p-4`}>
        {/*
          「保存され通知にも使われる」の前置きは置かない（T-M8-66）。保存されることは
          ボタンラベル「この条件で表示して保存」が、通知への影響は保存直後のトーストが伝える。
        */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground">テーマ</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {filterThemes.map((t) => {
              const active = categories.includes(t.newsCategory);
              return (
                <button
                  aria-pressed={active}
                  className={`rounded-pill border px-3 py-1 text-[12.5px] font-medium transition-colors duration-150 ${active ? "border-brand bg-brand text-white" : "border-hairline bg-surface text-ink-2 hover:bg-black/[0.03]"}`}
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
                  className={`rounded-pill border px-3 py-1 text-[12.5px] font-medium transition-colors duration-150 ${active ? "border-brand bg-brand text-white" : "border-hairline bg-surface text-ink-2 hover:bg-black/[0.03]"}`}
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
              max={NEWS_MAX_ITEMS_MAX}
              min={NEWS_MAX_ITEMS_MIN}
              onChange={(e) => setMaxItems(clampNewsMaxItems(Number(e.target.value)))}
              type="number"
              value={maxItems}
            />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={pending}
            onClick={applyConfig}
            type="button"
          >
            この条件で表示して保存
          </button>
        </div>
      </section>

      {/*
        ここに残すのは**画面の状態**だけ（取得失敗の注記・入力検証）。操作の結果はトーストへ。
        以前は両方をここへ出しており、`role="status"` 固定だったため失敗も成功として
        読み上げられていた（T-M8-18）。
      */}
      {note ? (
        <Notice tone="warn"
          role="alert">
          {note}
        </Notice>
      ) : null}

      {items.length === 0 ? (
        <div className={`${cardClassName} px-4 py-11 text-center text-[12.5px] text-ink-2`}>
          {window ? (
            <p>この時間帯に該当するニュースはありません。</p>
          ) : narrowedFilter ? (
            <>
              <p>この条件に一致するニュースはありません。テーマやインパクトを増やしてみてください。</p>
              <button
                className="mt-3 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent"
                disabled={pending}
                onClick={resetFilter}
                type="button"
              >
                絞り込みを既定に戻す
              </button>
            </>
          ) : (
            <p>まだ表示できるニュースがありません。次の自動取得までお待ちください。</p>
          )}
        </div>
      ) : (
        // 2カラム。`minmax(0,1fr)` で長いタイトルによる潰れを防ぐ（デザイン §形状・余白）。
        <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(0,1fr))] xl:grid-cols-2">
          {items.map((item) => (
            <li
              className={`${cardClassName} flex flex-col p-4`}
              key={item.id}
            >
              <div className="flex items-center gap-2">
                <CategoryChip category={item.category} />
                <Badge tone={IMPACT_TONE[item.impact] ?? "neutral"}>
                  {IMPACT_LABEL.get(item.impact) ?? item.impact}
                </Badge>
                {item.publishedAt ? (
                  <span className="ml-auto text-[11.5px] text-ink-3 tabular-nums">
                    {formatDate(item.publishedAt)}
                  </span>
                ) : null}
              </div>
              <a
                className="mt-2 block text-[14px] font-bold leading-5 text-ink hover:underline"
                href={item.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item.title}
              </a>
              <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{item.summary}</p>
              <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
                <span className="truncate text-[11.5px] text-ink-3">{domainOf(item.sourceUrl)}</span>
                <span className="ml-auto">
                  {created.has(item.id) ? (
                    <Badge tone="success">作成済み</Badge>
                  ) : (
                    <button
                      className="inline-flex h-8 items-center gap-1 rounded-card bg-brand-subtle px-3 text-[12.5px] font-medium text-brand transition-colors duration-150 hover:bg-brand-subtle-hover disabled:opacity-50"
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
