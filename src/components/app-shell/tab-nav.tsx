import Link from "next/link";

import { cn } from "@/lib/utils";

import { TabLabel } from "./tab-nav-label";

export interface TabNavItem {
  value: string;
  label: string;
}

/**
 * URL駆動タブナビの `<nav>` クラスを算出する。共通土台 `flex gap-2 border-b` に、ページ固有の
 * 追加（ai-settings の `mt-7 gap-1 overflow-x-auto` 等）を cn(twMerge) で重ねる。gap のような
 * 競合は twMerge が後勝ちで解決するため、生成クラス集合は各ページの現行と等価（tab-nav.test.ts で検証）。
 */
export function tabNavClassName(extra?: string): string {
  return cn("flex gap-2 border-b border-hairline", extra);
}

/**
 * URL駆動タブナビの1リンクのクラスを算出する。共通土台＋アクティブ/非アクティブの色分けに、
 * ページ固有の追加（focus ring・shrink-0・hover 等）を extra/inactiveExtra で差し込む。
 */
export function tabLinkClassName(
  active: boolean,
  extra?: string,
  inactiveExtra?: string,
): string {
  // 選択中はキー色の下線（デザイン §形状）。状態の表明は `aria-current` 側が担うので、
  // ここは見た目だけを持つ。
  return cn(
    "border-b-2 px-4 py-2.5 text-[13.5px] font-medium transition-colors duration-150",
    extra,
    active
      ? "border-brand text-brand"
      : cn("border-transparent text-ink-2 hover:text-ink", inactiveExtra),
  );
}

/**
 * URL(searchParams)駆動のタブナビ（settings/posts/ai-settings 共通, 要件06 各画面のタブ）。
 * 押した直後のフィードバックは `TabLabel`（client・useLinkStatus）が担う。本体は
 * server component のまま（`hrefFor` が関数propsのため client 化できない）。
 * `active` と各 `item.value` の一致でアクティブ判定し `aria-current="page"` を付与、href は
 * `hrefFor(value)` で生成する。nav/リンクのページ固有クラスは className/linkClassName/
 * inactiveLinkClassName で吸収し、各画面の見た目を維持する。
 */
export function TabNav({
  active,
  className,
  hrefFor,
  inactiveLinkClassName,
  items,
  label,
  linkClassName,
}: {
  active: string;
  className?: string;
  hrefFor: (value: string) => string;
  inactiveLinkClassName?: string;
  items: readonly TabNavItem[];
  label: string;
  linkClassName?: string;
}) {
  return (
    <nav aria-label={label} className={tabNavClassName(className)}>
      {items.map((item) => (
        <Link
          aria-current={active === item.value ? "page" : undefined}
          className={tabLinkClassName(
            active === item.value,
            linkClassName,
            inactiveLinkClassName,
          )}
          href={hrefFor(item.value)}
          key={item.value}
        >
          <TabLabel label={item.label} />
        </Link>
      ))}
    </nav>
  );
}
