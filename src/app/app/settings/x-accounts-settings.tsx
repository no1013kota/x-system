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
import { Card, CardTitle, cardClassName, cardTitleClassName } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import {
  alertDialogBackdropClassName,
  alertDialogPopupClassName,
} from "@/components/ui/alert-dialog-classes";

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
  managed: "運営App（キー登録不要のプラン）",
};

export function XAccountsSettings({
  accounts,
  plan,
  oauthStartPath,
  connected,
  xApiKeyRegistered,
}: {
  accounts: XAccountListItem[];
  plan: PlanId | null;
  oauthStartPath: string;
  connected: boolean;
  /** BYOKプランでX APIキー（Client ID）が登録済みか。premiumは常にtrue（運営キーを使う）。 */
  xApiKeyRegistered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * **停止中は畳む**（T-M8-54）。使っていないアカウントが一覧に並び続けると、いま動いている
   * ものが埋もれる（実際にローカルで3件のうち2件が不要なまま並んだ）。
   *
   * 対象は `disabled` だけ。**`expired`／`error` は畳まない**——こちらは再連携という
   * やることが残っているので、隠すと気付けない（CLAUDE.md 原則1）。
   *
   * **行は消さない**（下書き・履歴・実績が参照する・要件06 §14）ので、`<details>` で辿れる
   * 場所へ移すだけにする。「解除した」ではなく「停止中」と呼ぶ——プラン変更で自動停止された
   * ものも同じ `disabled` で、利用者の操作とは限らないため。
   */
  const connectedAccounts = accounts.filter((a) => a.status !== "disabled");
  const inactiveAccounts = accounts.filter((a) => a.status === "disabled");

  /**
   * 1アカウント分の行。連携中と「解除したもの」の2か所で同じものを描くため関数にする（T-M8-54）。
   * 同じ行を2回書くと、片方だけ直して見た目と操作が食い違う。
   */
  function renderAccount(account: XAccountListItem) {
          const busy = busyId === account.id;
          return (
            <li
              className={`${cardClassName} flex flex-wrap items-center gap-4 p-4`}
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
                  {/* X Premium加入はバッジで示す（T-M8-219）。連携時と「接続を確認」で更新される。 */}
                  {account.xPremium ? <Badge tone="neutral">X Premium</Badge> : null}
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

                {/*
                  **何を確認するのかをラベルに書き、結果を文言で返す**（T-M8-56）。
                  以前は「状態を更新」で、何の状態をどう更新するのか読めなかった。
                  実体は「Xに問い合わせて、この連携がまだ使えるかを確かめる」操作。
                */}
                <Button
                  disabled={pending}
                  onClick={() =>
                    run(
                      account.id,
                      () => refreshXAccountStatusAction({ x_account_id: account.id }),
                      (res) =>
                        `Xとの接続を確認しました（${
                          STATUS_LABEL[res.accountStatus ?? ""] ?? "状態不明"
                        }）`,
                    )
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  接続を確認
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

  // 未契約(null)はこの画面へ来ない（route-guard）。型上のフォールバックだけ置く。
  const limit = plan ? PLANS[plan].xAccountLimit : PLANS.standard.xAccountLimit;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const atLimit = activeCount >= limit;

  function run<T extends { status: "error" | "success"; message: string }>(
    id: string,
    action: () => Promise<T>,
    successMessage: string | ((result: T) => string),
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
      toast.show({
        tone: "success",
        title: typeof successMessage === "function" ? successMessage(res) : successMessage,
      });
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
          // 誘導はボタン「先にX APIキーを登録」と同内容なので1文に留める（T-M8-66）。
          <Notice className="mt-4" tone="warn">
            Xアカウントの連携には、先に「APIキー」タブでX APIキーの登録が必要です。
          </Notice>
        ) : null}

        {connected ? (
          <Notice className="mt-4" tone="success"
            role="status">
            Xアカウントを連携しました。
          </Notice>
        ) : null}
      </Card>

      {connectedAccounts.length === 0 ? (
        <EmptyNotice>
          {/* 停止中の存在は直下のdetailsのsummaryが伝えるため、括弧書きで繰り返さない（T-M8-66）。 */}
          {inactiveAccounts.length > 0
            ? "連携中のXアカウントはありません。「Xアカウントを追加」から連携してください。"
            : "まだXアカウントを連携していません。「Xアカウントを追加」から連携してください。"}
        </EmptyNotice>
      ) : (
        <ul className="space-y-3">
          {connectedAccounts.map(renderAccount)}
        </ul>
      )}

      {inactiveAccounts.length > 0 ? (
        <details className="rounded-card border border-hairline bg-surface px-5 py-3">
          <summary className="cursor-pointer text-body text-ink-2">
            停止中のアカウント {inactiveAccounts.length} 件（投稿履歴と実績は残っています）
          </summary>
          {/* 操作は各行の「有効化」「再連携」ボタン自体が示す。前置きの説明は置かない（T-M8-66）。 */}
          <ul className="mt-3 space-y-3">{inactiveAccounts.map(renderAccount)}</ul>
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
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName()}>
          <AlertDialog.Title className={cardTitleClassName}>
            @{handle} の連携を解除しますか？
          </AlertDialog.Title>
          {/* 破壊的操作の確認なので影響の要旨は残す。内部概念（同意の取り消し）とデータ列挙は削る（T-M8-66）。 */}
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            このアカウントへの投稿と自動実行を停止します。下書きや履歴などのデータは残り、
            再連携すればいつでも再開できます。
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
