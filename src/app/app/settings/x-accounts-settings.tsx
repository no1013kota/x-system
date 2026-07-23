"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { CircleUserRound, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  disconnectXAccountAction,
  enableXAccountAction,
  refreshXAccountStatusAction,
} from "@/app/actions/x-accounts";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanId } from "@/lib/plans";
import type { XAccountListItem } from "@/lib/x/account-actions-server";

const STATUS_LABEL: Record<string, string> = {
  active: "有効",
  expired: "要再連携（トークン失効）",
  disabled: "停止中",
  error: "エラー（要確認）",
};

const STATUS_TONE: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  expired: "border-amber-200 bg-amber-50 text-amber-800",
  disabled: "border-slate-200 bg-slate-50 text-slate-700",
  error: "border-red-200 bg-red-50 text-red-800",
};

const AUTH_TYPE_LABEL: Record<string, string> = {
  byok: "自分のApp（BYOK）",
  managed: "運営App（Premium）",
};

interface Notice {
  message: string;
  tone: "error" | "success";
}

export function XAccountsSettings({
  accounts,
  plan,
  oauthStartPath,
  connected,
  oauthError,
}: {
  accounts: XAccountListItem[];
  plan: PlanId;
  oauthStartPath: string;
  connected: boolean;
  oauthError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

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
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      if (res.status === "error") {
        setNotice({ message: res.message || "操作に失敗しました。", tone: "error" });
        return;
      }
      setNotice({ message: successMessage, tone: "success" });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="x-accounts-heading" className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
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
          ) : (
            <Button render={<a href={oauthStartPath} />} size="lg">
              <Plus aria-hidden="true" /> Xアカウントを追加
            </Button>
          )}
        </div>

        {connected ? (
          <p
            className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
            role="status"
          >
            Xアカウントを連携しました。
          </p>
        ) : null}
        {oauthError ? (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            role="alert"
          >
            連携を完了できませんでした（{oauthError}）。もう一度お試しください。
          </p>
        ) : null}
        {notice ? (
          <p
            className={`mt-4 rounded-lg border p-3 text-sm ${
              notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
            role={notice.tone === "success" ? "status" : "alert"}
          >
            {notice.message}
          </p>
        ) : null}
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          まだXアカウントを連携していません。「Xアカウントを追加」から連携してください。
        </div>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => {
            const busy = busyId === account.id;
            return (
              <li
                className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm"
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
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-800">
                        操作中
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{account.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${
                        STATUS_TONE[account.status] ?? "border-slate-200 bg-slate-50"
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
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
          <AlertDialog.Title className="text-lg font-semibold">
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
              render={<Button size="lg" type="button" variant="destructive" />}
            >
              連携を解除する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
