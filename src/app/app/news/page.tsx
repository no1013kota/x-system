import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import {
  NEWS_IMPACTS,
  NEWS_WINDOW_MAX_HOURS,
  type NewsItemsPage,
} from "@/lib/news-items";
import { NEWS_CATEGORIES } from "@/lib/news";
import {
  listCreatedNewsItemIdsForAccount,
  listNewsItemsForUser,
} from "@/lib/news-items-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { NewsBrowser } from "./news-browser";
import { pageTitleClassName } from "@/components/ui/card";

export const metadata: Metadata = { title: "ニュース | Exos AI" };

interface NewsPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    page?: string;
    theme?: string;
    impact?: string;
  }>;
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
 * SC-06 最新ニュース（T-M8-188・運営者の指示 2026-08-22）。
 * 最新500件までを新着順基本・50件ずつのページで表示する。テーマ・インパクトは選択式ソート
 * （選んだ値が先頭へ。絞り込み・表示件数は廃止。通知の条件は設定＞通知が持つ。
 * 取得は従来どおりで費用不変）。
 */
export default async function NewsPage({ searchParams }: NewsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activeId, params] = await Promise.all([
    resolveActiveXAccountForUser(user.id),
    searchParams,
  ]);
  const window = parseWindow(params.from, params.to);
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // 未知の値は黙って「指定なし」へ落とす（URL手打ちでエラー画面にしない）。
  const theme = (NEWS_CATEGORIES as readonly string[]).includes(params.theme ?? "")
    ? (params.theme as (typeof NEWS_CATEGORIES)[number])
    : undefined;
  const impact = (NEWS_IMPACTS as readonly string[]).includes(params.impact ?? "")
    ? (params.impact as (typeof NEWS_IMPACTS)[number])
    : undefined;

  let initial: NewsItemsPage = { items: [], page: 1, pageCount: 1, total: 0 };
  let initialError = false;
  try {
    initial = await listNewsItemsForUser({
      page: requestedPage,
      ...(theme ? { theme } : {}),
      ...(impact ? { impact } : {}),
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
        selected={{ theme: theme ?? "", impact: impact ?? "" }}
        window={window}
      />
    </main>
  );
}
