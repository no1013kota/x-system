import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BankAccountForm } from "./bank-account-form";
import { InviteLinkActions } from "./invite-link-card";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardTitle, pageTitleClassName } from "@/components/ui/card";
import { INVITE_TIERS, MIN_PAYOUT_JPY, PAYOUT_FEE_JPY, formatRateBps } from "@/lib/affiliate/config";
import { loadInviteSummary } from "@/lib/affiliate/summary-server";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { yen } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: `友達招待 | ${APP_NAME}` };

/**
 * 招待プログラム（T-M8-174。正本: docs/cp/invite_cp.md）。
 * リンク共有・実績・報酬率・進捗・報酬・振込予定・口座登録をこの1ページで完結する。
 */

const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  trial: { label: "Trial", tone: "info" },
  paid: { label: "有料", tone: "success" },
  cancelled: { label: "解約済み", tone: "neutral" },
  free: { label: "Free", tone: "neutral" },
};

const COMMISSION_STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "確定待ち", tone: "info" },
  payable: { label: "受取可能", tone: "success" },
  paid: { label: "支払済み", tone: "neutral" },
  reversed: { label: "返金調整", tone: "warn" },
  held: { label: "保留", tone: "warn" },
};

function jstDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(
    new Date(value),
  );
}

export default async function InvitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/invite");
  const summary = await loadInviteSummary(user.id);
  const base = env.APP_BASE_URL ?? "http://127.0.0.1:3000";
  const inviteUrl = `${base.replace(/\/$/, "")}/r/${summary.account.code}`;
  const { tier } = summary;
  const progressToNext = tier.next
    ? Math.min(1, summary.paidReferralCount / tier.next.minPaidUsers)
    : 1;

  return (
    // 器は他のapp画面と同一（要件06 §2・T-M8-179。素のdivだと幅と余白が揃わない）。
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      <header>
        <h1 className={pageTitleClassName}>友達招待</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          招待した方が有料プランを利用すると、招待した方のお支払い額の{formatRateBps(tier.currentRateBps)}
          が報酬になります（初回課金から最大6ヶ月が対象となります）。
        </p>
      </header>

      {/* ① 招待リンク＋現在のランク（最重要・invite_cp.md §2①） */}
      <Card as="section" className="p-5 sm:p-6">
        <CardTitle as="h2">友達を招待して報酬を受け取る</CardTitle>
        <p className="mt-3 text-caption text-ink-3">あなたの招待リンク</p>
        <p className="mt-1 rounded-lg border border-hairline bg-page px-3 py-2.5 font-mono text-sm break-all text-ink">
          {inviteUrl}
        </p>
        <div className="mt-3.5">
          <InviteLinkActions inviteUrl={inviteUrl} />
        </div>
        <div className="mt-5 rounded-card border border-hairline bg-page px-4 py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-caption text-ink-3">現在の報酬率</span>
            <span className="text-[26px] font-extrabold tabular-nums text-brand">
              {formatRateBps(tier.currentRateBps)}
            </span>
            {tier.next ? (
              <span className="text-caption text-ink-2">
                あと{tier.remainingToNext}人の有料招待で {formatRateBps(tier.next.rateBps)} にアップ
              </span>
            ) : (
              <span className="text-caption text-ink-2">最上位ランクです</span>
            )}
          </div>
          {tier.next ? (
            <div
              aria-hidden="true"
              className="mt-2.5 h-2 overflow-hidden rounded-pill bg-brand-subtle"
            >
              <div
                className="h-full rounded-pill bg-brand"
                style={{ width: `${Math.round(progressToNext * 100)}%` }}
              />
            </div>
          ) : null}
          <p className="mt-1.5 text-caption text-ink-3">
            有料招待 {summary.paidReferralCount}人
            {tier.next ? ` ／ 次のランクまで ${summary.paidReferralCount} / ${tier.next.minPaidUsers}人` : ""}
          </p>
          {/* 招待ランクの段（運営者の指示 2026-08-21: 報酬率の直下に小さく）。 */}
          <div aria-label="招待ランク" className="mt-3 grid grid-cols-5 gap-1.5" role="list">
            {INVITE_TIERS.map((tierRow, index) => {
              const nextTier = INVITE_TIERS[index + 1];
              const range = nextTier
                ? `${tierRow.minPaidUsers}〜${nextTier.minPaidUsers - 1}人`
                : `${tierRow.minPaidUsers}人〜`;
              const current = tier.currentRateBps === tierRow.rateBps;
              return (
                <div
                  className={cn(
                    "rounded-lg border px-1 py-1.5 text-center",
                    current ? "border-brand bg-surface" : "border-hairline bg-surface/60",
                  )}
                  key={tierRow.minPaidUsers}
                  role="listitem"
                >
                  <p
                    className={cn(
                      "text-body font-bold tabular-nums",
                      current ? "text-brand" : "text-ink-2",
                    )}
                  >
                    {formatRateBps(tierRow.rateBps)}
                    {current ? <span className="sr-only">（現在）</span> : null}
                  </p>
                  <p className="text-caption leading-tight text-ink-3">{range}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ② KPI（invite_cp.md §2②） */}
      <section aria-label="実績" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["有料招待", `${summary.paidReferralCount}人`],
          ["現在の報酬率", formatRateBps(tier.currentRateBps)],
          ["確定前報酬", `¥${yen(summary.pendingAmount)}`],
          ["受取可能", `¥${yen(summary.payableAmount)}`],
        ].map(([label, value]) => (
          <Card as="div" className="px-4 py-3.5" key={label}>
            <p className="text-caption text-ink-3">{label}</p>
            <p className="mt-1 text-[22px] font-extrabold tabular-nums text-ink">{value}</p>
          </Card>
        ))}
      </section>

      {/* ③ 次回振込／銀行口座（invite_cp.md §2③・§12） */}
      <Card as="section" className="p-5 sm:p-6">
        <CardTitle as="h2">次回のお振込み</CardTitle>
        {/*
          未払いは**期限の近い順に全部出す**（T-M8-240）。以前は最新に作られた1件だけを出しており、
          2件以上たまると期限が古い方が画面から消えていた（口座未登録などで積み上がる）。
        */}
        {summary.pendingPayouts.length > 0 ? (
          <div className="mt-3.5 max-w-md space-y-4">
            {summary.pendingPayouts.map((payout, index) => (
              <div className="space-y-1.5 text-sm" key={payout.id}>
                {summary.pendingPayouts.length > 1 ? (
                  <p className="text-caption font-bold text-ink-2">
                    {index === 0 ? "次回" : `${index + 1}回目`}（{jstDate(payout.paymentDueAt)}まで）
                  </p>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-ink-2">振込対象額</span>
                  <span className="font-bold tabular-nums">¥{yen(payout.grossAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">振込手数料</span>
                  <span className="tabular-nums">-¥{yen(payout.feeAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-hairline pt-1.5">
                  <span className="font-bold">振込予定額</span>
                  <span className="text-[18px] font-extrabold tabular-nums text-brand">
                    ¥{yen(payout.netAmount)}
                  </span>
                </div>
                <p className="pt-1 text-caption text-ink-3">
                  {jstDate(payout.paymentDueAt)}までにお振込みします。
                </p>
              </div>
            ))}
            {summary.pendingPayouts.length > 1 ? (
              <p className="border-t border-hairline pt-2 text-caption text-ink-2">
                未払いの振込が{summary.pendingPayouts.length}件あります（合計 ¥
                {yen(summary.pendingPayouts.reduce((sum, p) => sum + p.netAmount, 0))}）。
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            現在、振込予定はありません。受取可能報酬が¥{yen(MIN_PAYOUT_JPY)}
            以上になった月の末で締め、翌月末までにお振込みします（振込手数料¥{yen(PAYOUT_FEE_JPY)}）。
          </p>
        )}
        <div className="mt-5 border-t border-hairline pt-4">
          {summary.bankAccount ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="text-sm">
                <p className="text-caption text-ink-3">報酬受取口座</p>
                <p className="mt-0.5 font-medium">
                  {summary.bankAccount.bankName} {summary.bankAccount.branchName}{" "}
                  {summary.bankAccount.accountType === "ordinary" ? "普通" : "当座"} ****
                  {summary.bankAccount.last4}（{summary.bankAccount.holderName}）
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-3 rounded-card bg-warn-bg px-4 py-3 text-sm font-medium text-warn-fg">
              報酬を受け取るには銀行口座を登録してください。
            </p>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">
              {summary.bankAccount ? "口座を変更する" : "銀行口座を登録する"}
            </summary>
            <div className="mt-3.5">
              <BankAccountForm
                initial={
                  summary.bankAccount
                    ? {
                        accountType: summary.bankAccount.accountType,
                        bankName: summary.bankAccount.bankName,
                        branchName: summary.bankAccount.branchName,
                        holderName: summary.bankAccount.holderName,
                      }
                    : null
                }
              />
            </div>
          </details>
        </div>
      </Card>

      {/* ⑤ 招待ユーザー（invite_cp.md §2⑤・個人情報はマスク） */}
      <Card as="section" className="p-5 sm:p-6">
        <CardTitle as="h2">招待ユーザー</CardTitle>
        {summary.invitedUsers.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">
            まだ招待した方はいません。上のリンクを共有すると、登録した方がここに並びます。
          </p>
        ) : (
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-caption text-ink-3">
                  <th className="py-2 pr-3 font-medium" scope="col">ユーザー</th>
                  <th className="px-3 py-2 font-medium" scope="col">ステータス</th>
                  <th className="px-3 py-2 font-medium" scope="col">課金開始</th>
                  <th className="py-2 pl-3 text-right font-medium" scope="col">累計報酬</th>
                </tr>
              </thead>
              <tbody>
                {summary.invitedUsers.map((invited, index) => {
                  const status = STATUS_LABEL[invited.status];
                  return (
                    // マスク済みメールは重複し得るのでindexを併用（並びはattributed_at descで安定）。
                    <tr className="border-b border-hairline last:border-0" key={`${invited.maskedEmail}-${index}`}>
                      <td className="py-2.5 pr-3">{invited.maskedEmail}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">
                        {invited.firstPaidAt ? jstDate(invited.firstPaidAt) : "-"}
                      </td>
                      <td className="py-2.5 pl-3 text-right tabular-nums">
                        ¥{yen(invited.totalCommission)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ⑥ 報酬履歴（invite_cp.md §2⑥） */}
      <Card as="section" className="p-5 sm:p-6">
        <CardTitle as="h2">報酬履歴</CardTitle>
        {summary.history.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">まだ報酬はありません。</p>
        ) : (
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-caption text-ink-3">
                  <th className="py-2 pr-3 font-medium" scope="col">日付</th>
                  <th className="px-3 py-2 font-medium" scope="col">内容</th>
                  <th className="px-3 py-2 font-medium" scope="col">状態</th>
                  <th className="py-2 pl-3 text-right font-medium" scope="col">金額</th>
                </tr>
              </thead>
              <tbody>
                {summary.history.map((entry, index) => {
                  const status = COMMISSION_STATUS_LABEL[entry.status] ?? {
                    label: entry.status,
                    tone: "neutral" as BadgeTone,
                  };
                  return (
                    <tr className="border-b border-hairline last:border-0" key={`${entry.date}-${index}`}>
                      <td className="py-2.5 pr-3 text-ink-2">{entry.date}</td>
                      <td className="px-3 py-2.5">{entry.label}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pl-3 text-right tabular-nums",
                          entry.amount < 0 && "text-danger-fg",
                        )}
                      >
                        {entry.amount < 0 ? "-" : "+"}¥{yen(Math.abs(entry.amount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
