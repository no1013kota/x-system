"use client";

import { Popover } from "@base-ui/react/popover";
import { Icon } from "@/components/ui/icon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  retryNotificationEmailAction,
} from "@/app/actions/notifications";
import { useToast } from "@/components/ui/toast";
import { formatJst } from "@/lib/format";
import type { NotificationView } from "@/lib/notifications";

/**
 * ヘッダの通知ベル＋一覧（要件05 §10・要件06 §2, O-2, T-M2-20）。未読件数バッジを出し、Popoverで
 * in_app 通知を新しい順に表示する。「すべて既読」で一括既読化し、未読数を即時更新する。
 * 閲覧・既読化のみ（作成・メールはジョブ系MS）。
 *
 * ## 押した瞬間に動かす（T-M8-32）
 *
 * 以前は**既読化のサーバ往復を待ってから**閉じて遷移していた（手元で370ms、デプロイ先では
 * 1〜2秒）。押しても何も起きない時間があると、利用者はもう一度押すか壊れたと思う。
 * **閉じる・遷移は即座に行い、既読化は投げるだけ**にする（失敗しても次に開いたときに未読のまま
 * 出るので、取り返しがつく）。
 *
 * リンクの無い通知は押せる形にしない。押しても何も起きないものをボタンにすると、
 * 反応しないアプリだと受け取られる（既読は「すべて既読」で行える）。
 *
 * ## メール送信の失敗をここに出す（T-M8-40）
 *
 * `email_status = 'failed'` は終端状態で、`recoverQueuedEmails`（queued のみ対象）も拾わない。
 * **通知の中身はアプリ内に残るが、メールは黙って届かないまま**になる。再送する関数は
 * 実装済みだったのに呼び出し元が無く、コード上どこからも到達できない状態だった。
 * 通知は一覧の入口がここだけなので、ここに再送を置く。
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
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);

  const markReadLocal = (id: string) =>
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: "read" } : n)),
    );

  function openNotification(item: NotificationView & { link: string }) {
    // 先に見た目を確定させる（サーバの応答を待たない）。
    if (!item.readAt) {
      markReadLocal(item.id);
      setUnread((n) => Math.max(0, n - 1));
    }
    setOpen(false);
    // 同じ画面へのリンクは `push` だけでは何も起きない。再取得して「押した結果」を見せる。
    if (item.link === `${pathname}${search ? `?${search}` : ""}`) router.refresh();
    else router.push(item.link);
    // 既読化は投げるだけ。落ちても次に開いたとき未読のまま出るので取り返しがつく。
    void markNotificationReadAction({ notification_id: item.id });
  }

  function markAll() {
    // 表示はここで確定させる。`router.refresh()` は呼ばない——開いたままページ全体を
    // 再取得すると重く、ポップアップがちらつく（未読数はこのstateが持っている）。
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? "read" })));
    void markAllNotificationsReadAction();
  }

  /**
   * メールの再送。行そのものは（リンクがあれば）ボタンなので、**入れ子にせず兄弟として置く**。
   * `<button>` の中に `<button>` は不正なHTMLで、クリックの伝播も壊れる。
   */
  function retryEmail(id: string) {
    startTransition(async () => {
      const res = await retryNotificationEmailAction({ notification_id: id });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "メールの再送を予約しました" });
        // 押した結果を見せる。もう一度押せる状態のままにしない。
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, emailStatus: "queued" } : n)));
      } else {
        toast.show({
          tone: "error",
          title: "再送できませんでした",
          description: res.message ?? "少し時間をおいてからもう一度お試しください。",
        });
      }
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
                {items.map((item) => {
                  const Row = item.link ? "button" : "div";
                  return (
                  <li key={item.id}>
                    <Row
                      className={`flex w-full items-start gap-2 px-4 py-2.5 text-left ${
                        item.link
                          ? "transition-colors duration-150 hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          : ""
                      }`}
                      {...(item.link
                        ? { onClick: () => openNotification({ ...item, link: item.link as string }), type: "button" as const }
                        : {})}
                    >
                      {/* 未読の印。**失敗は赤**にして、ニュースの通知に埋もれないようにする。 */}
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-2 shrink-0 rounded-pill ${
                          item.readAt
                            ? "bg-transparent"
                            : item.type === "error"
                              ? "bg-danger-dot"
                              : "bg-brand"
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
                    </Row>
                    {item.emailStatus === "failed" ? (
                      <p className="flex flex-wrap items-center gap-2 px-4 pb-2.5 text-[11px] text-danger-fg">
                        メールが送れませんでした
                        <button
                          className="rounded-chip border border-hairline px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                          disabled={pending}
                          onClick={() => retryEmail(item.id)}
                          type="button"
                        >
                          メールを再送
                        </button>
                      </p>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}

            {cursor ? (
              <div className="border-t p-2">
                <button
                  className="w-full rounded-card py-2 text-[12.5px] text-ink-2 transition-colors duration-150 hover:bg-black/[0.02] hover:text-ink disabled:opacity-50"
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
