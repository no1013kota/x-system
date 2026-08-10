import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_NEWS_CONFIG } from "@/lib/config-defaults";
import { NEWS_WINDOW_MAX_HOURS, type NewsItemsPage } from "@/lib/news-items";
import {
  listCreatedNewsItemIdsForAccount,
  listNewsItemsForUser,
} from "@/lib/news-items-server";
import { getSettingsForUser } from "@/lib/settings-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { NewsBrowser } from "./news-browser";

export const metadata: Metadata = { title: "ニュース | Exos AI" };

interface NewsPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

/** from/to が揃い最大24時間以内の妥当な窓なら返す。不正・不揃いは null（既定7日表示へ）。 */
function parseWindow(from?: string, to?: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t)) return null;
  const span = t - f;
  if (span <= 0 || span > NEWS_WINDOW_MAX_HOURS * 3600 * 1000) return null;
  return { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // user.id にしか依存しない3つは並列に取得する（T-M8-67。以前は4段直列）。
  const [settings, activeId, { from, to }] = await Promise.all([
    getSettingsForUser(user.id),
    resolveActiveXAccountForUser(user.id),
    searchParams,
  ]);
  const config = settings?.newsConfig ?? {
    categories: [...DEFAULT_NEWS_CONFIG.categories],
    impact_filter: [...DEFAULT_NEWS_CONFIG.impact_filter],
    max_items: DEFAULT_NEWS_CONFIG.max_items,
  };

  const window = parseWindow(from, to);

  let initial: NewsItemsPage = { items: [], nextCursor: null };
  let initialError = false;
  try {
    initial = await listNewsItemsForUser({
      categories: config.categories,
      impacts: config.impact_filter,
      limit: config.max_items,
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
      <h1 className="text-[20px] font-bold tracking-tight text-ink">ニュース</h1>
      <NewsBrowser
        initialCreatedIds={createdIds}
        initialCursor={initial.nextCursor}
        initialError={initialError}
        initialItems={initial.items}
        newsConfig={{
          categories: config.categories,
          impacts: config.impact_filter,
          maxItems: config.max_items,
        }}
        window={window}
      />
    </main>
  );
}
