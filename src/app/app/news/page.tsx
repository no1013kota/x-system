import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppLockedPage } from "@/components/app-shell/plan-required";
import { loadAppLock } from "@/lib/auth/plan-gate-server";
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
    theme?: string | string[];
    impact?: string | string[];
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
 * 複数値パラメータを既知の値だけへ正規化する（T-M8-412）。
 * `?theme=a&theme=b`（繰り返し）と `?theme=a,b`（カンマ区切りの手打ち）の両方を受ける。
 */
function parseMulti(raw: string | string[] | undefined, allowed: readonly string[]): string[] {
  const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));
  return [...new Set(values)];
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
  /*
    ロック判定と操作中アカウントの解決は互いに独立なので**1波でまとめる**（T-M8-274）。
    直列にすると全遷移でDB往復が1本増える。ロック時に解決結果を捨てるのは軽い無駄だが、
    ロックは稀な状態で、待たされるのは毎回の通常利用のほう。
  */
  const [lock, activeId, params] = await Promise.all([
    loadAppLock(user.id),
    resolveActiveXAccountForUser(user.id),
    searchParams,
  ]);
  // 契約が有効でなければ開けない（T-M8-269→T-M8-273。理由で文言と導線が変わる）。
  if (lock) {
    return (
      <AppLockedPage
        description="6分野のニュースを毎日集め、そのまま投稿の題材にできます。"
        reason={lock}
        title="最新ニュース"
      />
    );
  }
  const window = parseWindow(params.from, params.to);
  // 上限もクランプする（10001以上はschemaが弾き、一時障害風の誤メッセージになる・T-M8-192）。
  const requestedPage = Math.min(
    10_000,
    Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  // 未知の値は黙って落とす（URL手打ちでエラー画面にしない）。複数選択はT-M8-412。
  const themes = parseMulti(params.theme, NEWS_CATEGORIES);
  const impacts = parseMulti(params.impact, NEWS_IMPACTS);

  let initial: NewsItemsPage = { items: [], page: 1, pageCount: 1, total: 0 };
  let initialError = false;
  try {
    initial = await listNewsItemsForUser({
      page: requestedPage,
      ...(themes.length > 0 ? { themes } : {}),
      ...(impacts.length > 0 ? { impacts } : {}),
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
        selected={{ themes, impacts }}
        window={window}
      />
    </main>
  );
}
