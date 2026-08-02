"use client";

import { Popover } from "@base-ui/react/popover";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { formatJst } from "@/lib/format";
import type { NotificationView } from "@/lib/notifications";

/**
 * ヘッダの通知ベル＋一覧（要件05 §10・要件06 §2, O-2, T-M2-20）。未読件数バッジを出し、Popoverで
 * in_app 通知を新しい順に表示する。項目クリックで既読化し、link があれば対象画面へ遷移する。
 * 「すべて既読」で一括既読化し、未読数を即時更新する。閲覧・既読化のみ（作成・メールはジョブ系MS）。
 */
export function NotificationBell({
  initialUnread,
  initialItems,
  initialCursor,
}: {
  initialUnread: number;
  initialItems: NotificationView[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);

  const markReadLocal = (id: string) =>
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: "read" } : n)),
    );

  function openNotification(item: NotificationView) {
    if (!item.readAt) markReadLocal(item.id);
    startTransition(async () => {
      const res = await markNotificationReadAction({ notification_id: item.id });
      if (res.status === "success" && typeof res.unreadCount === "number") {
        setUnread(res.unreadCount);
      }
      if (item.link) {
        setOpen(false);
        router.push(item.link);
      }
    });
  }

  function markAll() {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? "read" })));
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  function loadMore() {
    if (!cursor || pending) return;
    startTransition(async () => {
      const res = await listNotificationsAction({ cursor });
      if (res.status === "success" && res.items) {
        const newItems = res.items;
        setItems((prev) => [...prev, ...newItems]);
        setCursor(res.nextCursor ?? null);
      }
    });
  }

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={unread > 0 ? `通知（未読${unread}件）` : "通知"}
        className="relative inline-flex size-9 items-center justify-center rounded-card text-ink-2 transition-colors duration-150 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="notifications" size={20} />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-danger-dot px-1 text-[10px] leading-4 font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-40" sideOffset={8}>
          <Popover.Popup className="w-[min(340px,calc(100vw-1rem))] overflow-hidden rounded-card border border-hairline bg-surface shadow-[var(--shadow-modal)] outline-none">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <p className="text-[13.5px] font-bold text-ink">通知</p>
              <button
                className="text-[11.5px] text-brand hover:underline disabled:opacity-50"
                disabled={pending || unread === 0}
                onClick={markAll}
                type="button"
              >
                すべて既読
              </button>
            </div>

            {items.length === 0 ? (
              <p className="px-4 py-9 text-center text-[12.5px] text-ink-2">
                通知はありません。
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-hairline overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      onClick={() => openNotification(item)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          item.readAt ? "bg-transparent" : "bg-brand"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-[11px] text-ink-3">
                          {formatJst(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {cursor ? (
              <div className="border-t p-2">
                <button
                  className="w-full rounded-md py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  disabled={pending}
                  onClick={loadMore}
                  type="button"
                >
                  {pending ? "読み込み中…" : "もっと見る"}
                </button>
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
