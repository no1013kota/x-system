import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import {
  NEWS_SORTS,
  NEWS_WINDOW_MAX_HOURS,
  type NewsItemsPage,
  type NewsSort,
} from "@/lib/news-items";
import {
  listCreatedNewsItemIdsForAccount,
  listNewsItemsForUser,
} from "@/lib/news-items-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { NewsBrowser } from "./news-browser";
import { pageTitleClassName } from "@/components/ui/card";

export const metadata: Metadata = { title: "ニュース | Exos AI" };

interface NewsPageProps {
  searchParams: Promise<{ from?: string; to?: string; page?: string; sort?: string }>;
}

/** from/to が揃い最大24時間以内の妥当な窓なら返す。不正・不揃いは null（全件表示へ）。 */
function parseWindow(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) return null;
  const span = t - f;
  if (span <= 0 || span > NEWS_WINDOW_MAX_HOURS * 3600 * 1000) return null;
  return { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}

/**
 * SC-06 最新ニュース（T-M8-187・運営者の指示 2026-08-21）。
 * 保存されている全件を50件ずつのページで表示し、新着・テーマ・インパクトで並び替える。
 * 絞り込み・表示件数の設定は廃止した（通知の条件は設定＞通知が持つ。取得は従来どおりで費用不変）。
 */
export default async function NewsPage({ searchParams }: NewsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activeId, params] = await Promise.all([
    resolveActiveXAccountForUser(user.id),
    searchParams,
  ]);
  const window = parseWindow(params.from, params.to);
  const sort: NewsSort = (NEWS_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as NewsSort)
    : "date";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let initial: NewsItemsPage = { items: [], page: 1, pageCount: 1, total: 0, sort };
  let initialError = false;
  try {
    initial = await listNewsItemsForUser({
      page: requestedPage,
      sort,
      ...(window ?? {}),
    });
  } catch {
    initialError = true;
  }
  const createdIds = activeId
    ? await listCreatedNewsItemIdsForAccount(
        activeId,
        initial.items.map((i) => i.id),
      )
    : [];

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <h1 className={pageTitleClassName}>最新ニュース</h1>
      <NewsBrowser
        initialCreatedIds={createdIds}
        initialError={initialError}
        page={initial}
        window={window}
      />
    </main>
  );
}
