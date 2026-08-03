"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { CircleUserRound, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  disconnectXAccountAction,
  enableXAccountAction,
  refreshXAccountStatusAction,
  setActiveXAccountAction,
} from "@/app/actions/x-accounts";
import { StopAllAutomationButton } from "@/app/app/schedule/schedule-manager";
import { EmptyNotice } from "@/components/app-shell/page-state";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PLANS, type PlanId } from "@/lib/plans";
import type { XAccountListItem } from "@/lib/x/account-actions-server";

const STATUS_LABEL: Record<string, string> = {
  active: "有効",
  expired: "要再連携（トークン失効）",
  disabled: "停止中",
  error: "エラー（要確認）",
};

/** 状態→色は**意味で決める**（`Badge` の tone・デザイン §カラー）。 */
const STATUS_TONE: Record<string, BadgeTone> = {
  active: "success",
  expired: "warn",
  disabled: "neutral",
  error: "danger",
};

const AUTH_TYPE_LABEL: Record<string, string> = {
  byok: "自分のApp（BYOK）",
  managed: "運営App（プレミアムプラン）",
};

export function XAccountsSettings({
  accounts,
  plan,
  oauthStartPath,
  connected,
  xApiKeyRegistered,
}: {
  accounts: XAccountListItem[];
  plan: PlanId;
  oauthStartPath: string;
  connected: boolean;
  /** BYOKプランでX APIキー（Client ID）が登録済みか。premiumは常にtrue（運営キーを使う）。 */
  xApiKeyRegistered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const limit = PLANS[plan].xAccountLimit;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const atLimit = activeCount >= limit;

  function run(
    id: string,
    action: () => Promise<{ status: "error" | "success"; message: string }>,
    successMessage: string,
  ) {
    if (pending) return;
    setBusyId(id);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (res.status === "error") {
        toast.show({
          tone: "error",
          title: "操作できませんでした",
          description: res.message || "操作に失敗しました。",
        });
        return;
      }
      toast.show({ tone: "success", title: successMessage });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="x-accounts-heading" className="space-y-6">
      <div className="rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold" id="x-accounts-heading">
              Xアカウント
            </h2>
            <p className="text-sm text-muted-foreground">
              有効なアカウント {activeCount} / {limit} 件（プラン上限）
            </p>
          </div>
          {atLimit ? (
            <Button
              disabled
              size="lg"
              title={`プラン上限（${limit}件）に達しています`}
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" /> 追加（上限到達）
            </Button>
          ) : xApiKeyRegistered ? (
            <Button nativeButton={false} render={<a href={oauthStartPath} />} size="lg">
              <Plus aria-hidden="true" /> Xアカウントを追加
            </Button>
          ) : (
            // X APIキー未登録のまま連携を始めると無言でAPIキータブへ戻されるため、先に登録へ誘導する。
            <Button
              nativeButton={false}
              render={<Link href="/app/settings?tab=api-keys" />}
              size="lg"
              variant="outline"
            >
              先にX APIキーを登録
            </Button>
          )}
        </div>

        {!xApiKeyRegistered ? (
          <p className="mt-4 rounded-lg border border-warn-fg/25 bg-warn-bg p-3 text-sm leading-6 text-warn-fg">
            Xアカウントの連携には、ご自身のX Developer AppのClient IDが必要です。「APIキー」タブで登録すると、この画面から連携できるようになります。
          </p>
        ) : null}

        {connected ? (
          <p
            className="mt-4 rounded-lg border border-success-fg/25 bg-success-bg p-3 text-sm text-success-fg"
            role="status"
          >
            Xアカウントを連携しました。
          </p>
        ) : null}
      </div>

      {accounts.length === 0 ? (
        <EmptyNotice>
          まだXアカウントを連携していません。「Xアカウントを追加」から連携してください。
        </EmptyNotice>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => {
            const busy = busyId === account.id;
            return (
              <li
                className="flex flex-wrap items-center gap-4 rounded-card border bg-card p-4 shadow-sm"
                key={account.id}
              >
                {account.profileImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                    src={account.profileImageUrl}
                  />
                ) : (
                  <CircleUserRound aria-hidden="true" className="size-10 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-40 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    @{account.handle}
                    {account.isActive ? (
                      <Badge tone="info">操作中</Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{account.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        STATUS_TONE[account.status] ?? "border-hairline bg-black/[0.04]"
                      }`}
                    >
                      {STATUS_LABEL[account.status] ?? account.status}
                    </span>
                    <span className="text-muted-foreground">
                      {AUTH_TYPE_LABEL[account.authType] ?? account.authType}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    操作対象の切り替えをこの一覧からもできるようにする（T-M8-31）。
                    ヘッダーの切替メニューだけだと、設定画面で一覧を見ている人が
                    「どこで切り替えるのか」を探すことになる。
                    切り替えると下書き・履歴・分析・スケジュールもそのアカウントのものになる。
                  */}
                  {!account.isActive && account.status === "active" ? (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        run(
                          account.id,
                          () => setActiveXAccountAction({ x_account_id: account.id }),
                          `@${account.handle} に切り替えました`,
                        )
                      }
                      size="sm"
                      type="button"
                      variant="subtle"
                    >
                      {busy ? "切り替え中…" : "このアカウントを操作する"}
                    </Button>
                  ) : null}

                  {account.status === "disabled" ? (
                    <Button
                      disabled={pending}
                      onClick={() =>
                        run(
                          account.id,
                          () => enableXAccountAction({ x_account_id: account.id }),
                          "アカウントを有効化しました。",
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {busy ? "処理中…" : "有効化"}
                    </Button>
                  ) : null}

                  {account.status !== "active" ? (
                    <Button
                      nativeButton={false}
                      render={<a href={oauthStartPath} />}
                      size="sm"
                      variant="outline"
                    >
                      <RefreshCw aria-hidden="true" /> 再連携
                    </Button>
                  ) : null}

                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        account.id,
                        () => refreshXAccountStatusAction({ x_account_id: account.id }),
                        "最新の状態を確認しました。",
                      )
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    状態を更新
                  </Button>

                  {account.automationActive ? (
                    <StopAllAutomationButton xAccountId={account.id} />
                  ) : null}

                  {account.status !== "disabled" ? (
                    <DisconnectButton
                      disabled={pending}
                      handle={account.handle}
                      onConfirm={() =>
                        run(
                          account.id,
                          () => disconnectXAccountAction({ x_account_id: account.id }),
                          "連携を解除しました。",
                        )
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DisconnectButton({
  disabled,
  handle,
  onConfirm,
}: {
  disabled: boolean;
  handle: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        render={
          <Button disabled={disabled} size="sm" type="button" variant="destructive" />
        }
      >
        連携を解除
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/55" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-modal border border-hairline bg-surface p-6 shadow-[var(--shadow-modal)] outline-none">
          <AlertDialog.Title className="text-[15px] font-bold text-ink">
            @{handle} の連携を解除しますか？
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            解除すると、このアカウントへの投稿と自動実行を停止し、自動投稿の同意も取り消します。
            下書き・投稿履歴・実績・ベースmdなどのデータは削除されません。再連携すればいつでも
            再開できます。
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close
              render={<Button size="lg" type="button" variant="outline" />}
            >
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close
              onClick={onConfirm}
              render={<Button size="lg" type="button" variant="danger" />}
            >
              連携を解除する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
