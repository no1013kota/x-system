import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_NEWS_CONFIG } from "@/lib/config-defaults";
import { NEWS_WINDOW_MAX_HOURS, type NewsItemsPage } from "@/lib/news-items";
import { listNewsItemsForUser } from "@/lib/news-items-server";
import { getSettingsForUser } from "@/lib/settings-server";

import { NewsBrowser } from "./news-browser";

export const metadata: Metadata = { title: "ニュース | Space AI" };

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

  const settings = await getSettingsForUser(user.id);
  const config = settings?.newsConfig ?? {
    categories: [...DEFAULT_NEWS_CONFIG.categories],
    impact_filter: [...DEFAULT_NEWS_CONFIG.impact_filter],
    max_items: DEFAULT_NEWS_CONFIG.max_items,
  };

  const { from, to } = await searchParams;
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8">
      <h1 className="text-xl font-bold tracking-tight">ニュース</h1>
      <NewsBrowser
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
