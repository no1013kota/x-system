"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import type { NotificationView } from "@/lib/notifications";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

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
        setItems((prev) => [...prev, ...res.items!]);
        setCursor(res.nextCursor ?? null);
      }
    });
  }

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={unread > 0 ? `通知（未読${unread}件）` : "通知"}
        className="relative inline-flex size-10 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 ? (
          <span className="absolute top-1.5 right-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-destructive-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-40" sideOffset={8}>
          <Popover.Popup className="w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border bg-background shadow-lg outline-none">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold">通知</p>
              <button
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={pending || unread === 0}
                onClick={markAll}
                type="button"
              >
                すべて既読
              </button>
            </div>

            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                通知はありません。
              </p>
            ) : (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      onClick={() => openNotification(item)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          item.readAt ? "bg-transparent" : "bg-sky-500"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {formatTime(item.createdAt)}
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
