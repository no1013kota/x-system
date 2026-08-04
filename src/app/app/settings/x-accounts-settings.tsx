"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
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
import { Card, CardTitle, cardTitleClassName } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";

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

/** 「このアカウントを再連携する」URL。`?account=` が対象を束縛する（T-M8-53）。 */
function reconnectPath(startPath: string, accountId: string): string {
  const separator = startPath.includes("?") ? "&" : "?";
  return `${startPath}${separator}account=${encodeURIComponent(accountId)}`;
}

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

  // 「解除したもの」は畳む（T-M8-54）。プラン変更による自動停止は畳まない。
  const connectedAccounts = accounts.filter((a) => !a.disconnected);
  const disconnectedAccounts = accounts.filter((a) => a.disconnected);

  /**
   * 1アカウント分の行。連携中と「解除したもの」の2か所で同じものを描くため関数にする（T-M8-54）。
   * 同じ行を2回書くと、片方だけ直して見た目と操作が食い違う。
   */
  function renderAccount(account: XAccountListItem) {
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
                <Icon name="account_circle" className="shrink-0 text-muted-foreground" size={40} />
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
                  {/*
                    tone は **prop で渡す**。className へ文字列展開すると
                    `class="... success"` という存在しないユーティリティになり、4状態すべてが
                    同じ見た目になる（T-M8-36 で実際に起きた退行）。
                  */}
                  <Badge tone={STATUS_TONE[account.status] ?? "neutral"}>
                    {STATUS_LABEL[account.status] ?? account.status}
                  </Badge>
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
                    // **どのアカウントを再連携するかを渡す**（T-M8-53）。以前は「追加」と同じURLで、
                    // 別のアカウントで認可すると新しい行が増え、壊れた行はそのまま残った。
                    render={<a href={reconnectPath(oauthStartPath, account.id)} />}
                    size="sm"
                    variant="outline"
                  >
                    <Icon name="refresh" /> 再連携
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
  }

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
      <Card as="div" className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle id="x-accounts-heading">
              Xアカウント
            </CardTitle>
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
              <Icon name="add" /> 追加（上限到達）
            </Button>
          ) : xApiKeyRegistered ? (
            <Button nativeButton={false} render={<a href={oauthStartPath} />} size="lg">
              <Icon name="add" /> Xアカウントを追加
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
          <Notice className="mt-4" tone="warn">
            Xアカウントの連携には、ご自身のX Developer AppのClient IDが必要です。「APIキー」タブで登録すると、この画面から連携できるようになります。
          </Notice>
        ) : null}

        {connected ? (
          <Notice className="mt-4" tone="success"
            role="status">
            Xアカウントを連携しました。
          </Notice>
        ) : null}
      </Card>

      {/*
        **解除したアカウントは一覧から畳む**（T-M8-54）。利用者が「連携を解除」したものが
        「停止中」として残り続けると、片付けたつもりの行がいつまでも見えて紛らわしい。
        ただし**行は消せない**（下書き・履歴・実績が参照している・要件06 §14）ので、
        `<details>` で辿れる場所へ移すだけにする。**プラン変更で自動停止されたもの
        （`disconnected` が false の `disabled`）は畳まない**——隠すと「なぜ止まったのか」が
        分からなくなる（CLAUDE.md 原則1）。
      */}
      {connectedAccounts.length === 0 ? (
        <EmptyNotice>
          {disconnectedAccounts.length > 0
            ? "連携中のXアカウントはありません。「Xアカウントを追加」から連携してください（解除したアカウントは下に畳んであります）。"
            : "まだXアカウントを連携していません。「Xアカウントを追加」から連携してください。"}
        </EmptyNotice>
      ) : (
        <ul className="space-y-3">
          {connectedAccounts.map(renderAccount)}
        </ul>
      )}

      {disconnectedAccounts.length > 0 ? (
        <details className="rounded-card border border-hairline bg-surface px-5 py-3">
          <summary className="cursor-pointer text-[13px] text-ink-2">
            解除したアカウント {disconnectedAccounts.length} 件（投稿履歴と実績は残っています）
          </summary>
          <p className="mt-2 text-[12.5px] leading-5 text-ink-3">
            もう一度使うときは「有効化」または「再連携」を押してください。連携中の一覧へ戻ります。
          </p>
          <ul className="mt-3 space-y-3">{disconnectedAccounts.map(renderAccount)}</ul>
        </details>
      ) : null}
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
          <AlertDialog.Title className={cardTitleClassName}>
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
