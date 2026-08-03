"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, CircleUserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setActiveXAccountAction } from "@/app/actions/x-accounts";
import { useToast } from "@/components/ui/toast";

export interface SwitcherAccount {
  id: string;
  handle: string;
  profileImageUrl: string | null;
}

// モバイル幅でも「どのアカウントを操作中か」を隠さない（誤アカウント投稿を防ぐ・要件06 §2）。
const CHIP_CLASS =
  "flex min-h-10 items-center gap-2 rounded-lg border bg-card px-2 text-sm sm:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * ヘッダのXアカウント切替UI（要件06 §2, A-6, T-M2-18）。activeなXアカウントを一覧し、選択すると
 * setActiveXAccount を呼んで operate 対象を切り替える。切替後は router.refresh() で表示中画面の
 * サーバーコンポーネント（一覧・集計）を再取得する。これにより mutation 系Actionが送る「表示中
 * アカウント」の受け渡しが成立する。0件は静的な「未選択」表示（初期設定ガイドは /app 側）。
 */
export function XAccountSwitcher({
  accounts,
  activeId,
}: {
  accounts: SwitcherAccount[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const active = accounts.find((a) => a.id === activeId) ?? null;
  const label = active ? `@${active.handle}` : "Xアカウント未選択";

  if (accounts.length === 0) {
    return (
      <div aria-label="現在のXアカウント" className={CHIP_CLASS} title="Xアカウント未選択">
        <CircleUserRound aria-hidden="true" className="size-4" />
        <span className="max-w-20 truncate sm:max-w-36">Xアカウント未選択</span>
      </div>
    );
  }

  function switchTo(id: string) {
    if (id === activeId || pending) return;
    startTransition(async () => {
      const res = await setActiveXAccountAction({ x_account_id: id });
      if (res.status === "error") {
        // 操作の結果はトーストへ集約する（T-M8-16）。この通知はApp Shell常駐で
        // `/app/**` の全画面に `role="alert"` を1個足していた。
        toast.show({
          tone: "error",
          title: "アカウントを切り替えられませんでした",
          description: res.message || undefined,
        });
        return;
      }
      // 表示中画面（一覧・集計）を再取得して、切替後のアカウントの内容を反映する。
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Menu.Root>
        <Menu.Trigger
          aria-busy={pending}
          // **操作中のアカウントを読み上げ名にも入れる**（T-M8-31）。`aria-label` は中の文字を
          // 上書きするため、以前は支援技術には「Xアカウントを切り替え」だけが伝わり、
          // **いまどのアカウントを操作しているのかが分からなかった**（要件06 §2 は
          // 「誤ったアカウントへの投稿を防ぐため常時表示」を求めている）。
          aria-label={`Xアカウントを切り替え（操作中: ${label}）`}
          className={CHIP_CLASS}
          disabled={pending}
          title={label}
        >
          <CircleUserRound aria-hidden="true" className="size-4" />
          <span className="max-w-20 truncate sm:max-w-36">{label}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-60" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6} className="z-40">
            <Menu.Popup className="min-w-56 rounded-lg border bg-background p-1 shadow-md outline-none">
              {accounts.map((account) => (
                <Menu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  key={account.id}
                  onClick={() => switchTo(account.id)}
                >
                  {account.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="size-5 shrink-0 rounded-full object-cover"
                      src={account.profileImageUrl}
                    />
                  ) : (
                    <CircleUserRound aria-hidden="true" className="size-5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">@{account.handle}</span>
                  {account.id === activeId ? (
                    <Check aria-hidden="true" className="size-4 shrink-0" />
                  ) : null}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
