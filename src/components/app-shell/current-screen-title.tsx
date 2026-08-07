"use client";

import { usePathname } from "next/navigation";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

/**
 * トップバー左の現在画面名（T-M8-04・デザイン §レイアウト骨格）。
 *
 * ナビ項目の定義を唯一の出どころにする。**ここへ画面名を別途書かない**——2か所で
 * 管理するとナビとトップバーで表示がずれる（既存の `pattern-labels` で実際に起きた型）。
 */
export function CurrentScreenTitle() {
  const pathname = usePathname();
  // より長く一致する項目を優先する（`/app` が全ルートに前方一致するため）。
  const item = [...APP_NAVIGATION_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((nav) => (nav.href === "/app" ? pathname === nav.href : pathname.startsWith(nav.href)));

  return (
    <span className="hidden text-body font-medium text-ink lg:inline">{item?.label ?? ""}</span>
  );
}
