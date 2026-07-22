"use client";

import {
  CalendarDays,
  ChartNoAxesCombined,
  Home,
  Newspaper,
  Sparkles,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  APP_NAVIGATION_ITEMS,
  type AppNavigationIcon,
} from "./navigation-items";

const ICONS: Record<AppNavigationIcon, LucideIcon> = {
  ai: Sparkles,
  analytics: ChartNoAxesCombined,
  home: Home,
  news: Newspaper,
  posts: SquarePen,
  schedule: CalendarDays,
};

function isCurrentPath(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={mobile ? "メインナビゲーション（モバイル）" : "メインナビゲーション"}
      className={mobile ? "grid grid-cols-6" : "space-y-1 px-3"}
    >
      {APP_NAVIGATION_ITEMS.map((item) => {
        const Icon = ICONS[item.icon];
        const current = isCurrentPath(pathname, item.href);
        return (
          <Link
            aria-current={current ? "page" : undefined}
            className={
              mobile
                ? `flex min-h-16 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${
                    current
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                  }`
                : `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    current
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
                  }`
            }
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
