"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/ui/icon";
import type { AppShellSwitcherAccount, SwitchAccountAction } from "@/lib/app-shell/types";

/**
 * サイドバー下部のアカウントメニュー（T-M8-328・運営者の指示 2026-08-27）。
 *
 * **ヘッダーを廃止したので、ヘッダーが持っていた導線をここへ集めた。**
 * 押すと「Xアカウントの切替」「設定の各タブ」「ログアウト」が開く。
 * 設定はナビの1枠を使うほど毎日触るものではないため、ここへ畳んだ。
 *
 * Server Action は**propsで受け取る**（App Shellの依存方向・`dependency-boundaries.test.ts`）。
 * client component が `@/app/actions/*` を直接importすると検査で落ちる。
 */
export interface AccountMenuSettingsLink {
  href: string;
  label: string;
}

export function AccountMenu({
  accounts,
  activeId,
  settingsLinks,
  signOutAction,
  switchAccountAction,
}: {
  accounts: AppShellSwitcherAccount[];
  activeId: string | null;
  settingsLinks: readonly AccountMenuSettingsLink[];
  signOutAction: () => Promise<void>;
  switchAccountAction: SwitchAccountAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const active = accounts.find((a) => a.id === activeId) ?? null;

  // 外側クリックと Esc で閉じる。開いたままページ遷移すると迷子になるため。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function switchTo(id: string) {
    startTransition(async () => {
      await switchAccountAction({ x_account_id: id });
      setOpen(false);
      // 表示中画面のサーバーコンポーネント（一覧・集計）を選択中アカウントで取り直す。
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-11 w-full items-center gap-2.5 rounded-card px-3 text-left text-body font-medium text-ink-2 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {active?.profileImageUrl ? (
          // 外部画像は next/image を通さない（CSPと署名URLの都合・既存の切替UIと同じ扱い）。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
            height={28}
            src={active.profileImageUrl}
            width={28}
          />
        ) : (
          <Icon aria-hidden="true" name="account_circle" size={22} />
        )}
        <span className="min-w-0 flex-1 truncate">
          {active ? `@${active.handle}` : "アカウント"}
        </span>
        <Icon aria-hidden="true" className="text-ink-3" name="unfold_more" size={16} />
      </button>

      {open ? (
        <div
          className="absolute bottom-[calc(100%+6px)] left-2 right-2 z-40 overflow-hidden rounded-card border border-hairline bg-surface shadow-[0_4px_16px_rgba(0,0,0,0.1)]"
          role="menu"
        >
          {accounts.length > 0 ? (
            <div className="border-b border-hairline p-1.5">
              <p className="px-2 py-1 text-caption font-bold text-ink-3">Xアカウント</p>
              {accounts.map((account) => {
                const current = account.id === activeId;
                return (
                  <button
                    aria-current={current ? "true" : undefined}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-card px-2 text-left text-sm disabled:opacity-60 ${
                      current ? "bg-brand-subtle text-brand" : "text-ink-2 hover:bg-black/[0.03]"
                    }`}
                    disabled={pending || current}
                    key={account.id}
                    onClick={() => switchTo(account.id)}
                    role="menuitem"
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">@{account.handle}</span>
                    {current ? <Icon aria-hidden="true" name="check" size={15} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="p-1.5">
            <p className="px-2 py-1 text-caption font-bold text-ink-3">設定</p>
            {settingsLinks.map((link) => (
              <Link
                className="flex min-h-9 items-center rounded-card px-2 text-sm text-ink-2 hover:bg-black/[0.03] hover:text-ink"
                href={link.href}
                key={link.href}
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <form action={signOutAction} className="border-t border-hairline p-1.5">
            <button
              className="flex min-h-9 w-full items-center gap-2 rounded-card px-2 text-left text-sm text-ink-2 hover:bg-black/[0.03] hover:text-ink"
              role="menuitem"
              type="submit"
            >
              <Icon aria-hidden="true" name="output" size={16} />
              ログアウト
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
