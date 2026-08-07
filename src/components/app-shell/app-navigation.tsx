"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

function isCurrentPath(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

/**
 * 左サイドバーのナビ（T-M8-04）。
 *
 * 選択中は淡いキー色の下地＋キー色の文字＋塗りアイコン（デザイン §レイアウト骨格）。
 * 選択状態は `aria-current="page"` を正とし、**見た目のクラスを状態の表明に使わない**。
 */
export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={mobile ? "メインナビゲーション（モバイル）" : "メインナビゲーション"}
      className={mobile ? "grid grid-cols-7" : "space-y-0.5 px-3"}
    >
      {APP_NAVIGATION_ITEMS.map((item) => {
        const current = isCurrentPath(pathname, item.href);
        const stateClass = current
          ? "bg-brand-subtle text-brand"
          : "text-ink-2 hover:bg-black/[0.03] hover:text-ink";
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={
              mobile
                ? `flex min-h-16 flex-col items-center justify-center gap-1 rounded-card px-0.5 text-[11px] leading-tight font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${stateClass}`
                : `flex min-h-10 items-center gap-2.5 rounded-card px-3 text-body font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${stateClass}`
            }
            href={item.href}
            key={item.href}
          >
            <Icon filled={current} name={item.icon} size={mobile ? 20 : 19} />
            <span className={mobile ? "" : "leading-tight"}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
