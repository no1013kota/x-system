"use client";

import { Popover } from "@base-ui/react/popover";
import { Icon } from "@/components/ui/icon";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { formatJst } from "@/lib/format";
import type {
  NotificationListPayload,
  NotificationView,
} from "@/lib/notifications";

/**
 * propsで受け取るActionの契約。**payloadの形は手書きせず `@/lib/notifications` の正本を使う**
 * （T-M8-158）。ここへ `items` / `nextCursor` を書き写すと、action側でフィールド名を変えても
 * propsの代入検査が通り、実行時に undefined を読む——「もっと見る」が黙って消える形の不具合になる。
 * Actionを直importしないまま（依存方向は保ったまま）、名前の同期だけを型で取り戻す。
 */
interface NotificationActionResult {
  message?: string;
  status: "error" | "success";
}

interface ListNotificationsResult
  extends NotificationActionResult,
    NotificationListPayload {}

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
 * （メール再送の導線はT-M8-222で廃止——通知はアプリ内のみ。）
 */
export function NotificationBell({
  initialUnread,
  initialItems,
  initialCursor,
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  sidebar = false,
}: {
  initialUnread: number;
  initialItems: NotificationView[];
  initialCursor: string | null;
  listNotificationsAction: (input: {
    cursor: string;
  }) => Promise<ListNotificationsResult>;
  markAllNotificationsReadAction: () => Promise<unknown>;
  markNotificationReadAction: (input: {
    notification_id: string;
  }) => Promise<unknown>;
  /** サイドバー下部に置く形（T-M8-328）。ラベル付きの横並びにする。 */
  sidebar?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
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
        aria-label={unread > 0 ? `お知らせ（未読${unread}件）` : "お知らせ"}
        className={
          sidebar
            ? // サイドバーではナビ項目と同じ見た目にする（アイコンだけだと何の印か分からない）。
              "relative flex min-h-10 w-full items-center gap-2.5 rounded-card px-3 text-body font-medium text-ink-2 transition-colors duration-150 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            : "relative inline-flex size-9 items-center justify-center rounded-card text-ink-2 transition-colors duration-150 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        }
      >
        <Icon name="notifications" size={sidebar ? 22 : 20} />
        {sidebar ? <span className="flex-1 text-left">お知らせ</span> : null}
        {unread > 0 ? (
          <span
            className={
              sidebar
                ? "inline-flex min-w-5 items-center justify-center rounded-pill bg-danger-dot px-1.5 text-[11px] leading-4 font-bold text-white"
                : "absolute top-1 right-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-danger-dot px-1 text-[11px] leading-4 font-bold text-white"
            }
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align={sidebar ? "start" : "end"} className="z-40" side={sidebar ? "top" : "bottom"} sideOffset={8}>
          <Popover.Popup className="w-[min(340px,calc(100vw-1rem))] overflow-hidden rounded-card border border-hairline bg-surface shadow-[var(--shadow-modal)] outline-none">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <p className="text-body font-bold text-ink">通知</p>
              <button
                className="-mx-2 -my-2 rounded-card px-2 py-2 text-caption text-brand hover:underline disabled:opacity-50"
                disabled={pending || unread === 0}
                onClick={markAll}
                type="button"
              >
                すべて既読
              </button>
            </div>

            {items.length === 0 ? (
              <p className="px-4 py-9 text-center text-body text-ink-2">
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
                        <span className="block text-body font-medium text-ink">{item.title}</span>
                        <span className="mt-0.5 block text-caption leading-4 text-ink-2 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
                          {item.body}
                        </span>
                        <span className="mt-1 block text-caption text-ink-3">
                          {formatJst(item.createdAt)}
                        </span>
                      </span>
                    </Row>
                  </li>
                  );
                })}
              </ul>
            )}

            {cursor ? (
              <div className="border-t p-2">
                <button
                  className="w-full rounded-card py-2 text-body text-ink-2 transition-colors duration-150 hover:bg-black/[0.02] hover:text-ink disabled:opacity-50"
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
