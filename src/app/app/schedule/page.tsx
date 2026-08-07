import type { Metadata } from "next";

import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { ScheduleManager } from "./schedule-manager";
import { CardTitle, cardClassName } from "@/components/ui/card";

export const metadata: Metadata = { title: "スケジュール | Space AI" };

const pooledDb = pooledQueryable();

/** BYOKは valid な openai/google キー、premiumは運営キー＋画像モデルが設定済みのproviderを返す。
 *  クエリと判定を分離してあるのは、plan取得と並列に走らせるため（T-M8-67）。 */
function imageKeyRowsQuery(userId: string) {
  return getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
}

function imageProvidersFor(plan: string | null, keyRows: { provider: string }[]): string[] {
  if (plan === "premium") {
    const providers: string[] = [];
    if (env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL) providers.push("openai");
    if (env.GEMINI_API_KEY && env.GEMINI_IMAGE_MODEL) providers.push("google");
    return providers;
  }
  return keyRows.map((r) => r.provider);
}

export default async function SchedulePage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">ログインが必要です。</p>
      </main>
    );
  }
  const activeXAccountId = await resolveActiveXAccountForUser(user.id);

  let slots: ScheduleSlotView[] = [];
  let imageProviders: string[] = [];
  let automationConsented = false;
  let accountHandle: string | null = null;
  // デザインは「下書き・スケジュール」が1画面（T-M8-10）。**URLは変えない**方針なので、
  // どちらのURLでも両方を出す。ここでは下書きも読み込む。
  let drafts: DraftView[] = [];
  if (activeXAccountId) {
    // 4取得は相互に独立（T-M8-67。以前は slots+meta → providers → drafts の3段直列で、
    // 停止/再開/削除/保存のたびの router.refresh() でも毎回この直列分を待っていた）。
    const [loaded, meta, keyRows, draftRows] = await Promise.all([
      listScheduleSlots(pooledDb, activeXAccountId),
      getPool()
        .query<{ plan: string | null; consented: boolean; handle: string }>(
          `select p.plan, xa.handle,
                  (xa.automation_consent_version = $2 and xa.automation_consented_at is not null
                   and xa.automation_disabled_at is null) as consented
             from x_accounts xa join profiles p on p.id = xa.user_id
            where xa.id = $1`,
          [activeXAccountId, CURRENT_AUTOMATION_CONSENT_VERSION],
        )
        .then((r) => r.rows[0]),
      imageKeyRowsQuery(user.id),
      // この画面が描画するのは先頭5件だけ（下のカード）。全件は取得しない。
      listDraftsForAccount(pooledDb, activeXAccountId, "drafts", { limit: 5 }),
    ]);
    slots = loaded;
    imageProviders = imageProvidersFor(meta?.plan ?? null, keyRows.rows);
    automationConsented = meta?.consented === true;
    accountHandle = meta?.handle ?? null;
    drafts = draftRows;
  }

  return (
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      <header>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">スケジュール</h1>
        <p className="mt-1 text-body text-ink-2">
          曜日と時刻を決めて、下書き作成や自動投稿を定期実行します。
        </p>
      </header>

      {!activeXAccountId ? (
        <XAccountRequiredNotice description="スケジュールを作成するには、まずXアカウントを連携してください。" />
      ) : (
        <ScheduleManager
          accountHandle={accountHandle}
          automationConsented={automationConsented}
          imageProviders={imageProviders}
          slots={slots}
          xAccountId={activeXAccountId}
        />
      )}

      {activeXAccountId ? (
        <section
          aria-label="未確認の下書き"
          className={`${cardClassName} px-5 py-4`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>未確認の下書き</CardTitle>
            <Link
              className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline"
              href="/app/posts?tab=drafts"
            >
              編集・投稿する
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {drafts.length === 0 ? (
              <li className="rounded-card border border-hairline px-4 py-8 text-center text-body text-ink-2">
                未確認の下書きはありません。
              </li>
            ) : (
              drafts.slice(0, 5).map((draft) => (
                <li key={draft.id}>
                  <Link
                    className="block rounded-card border border-hairline p-3 transition-colors duration-150 hover:bg-black/[0.02]"
                    href={`/app/posts?tab=drafts&draftId=${draft.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone="brand">
                        {POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}
                      </Badge>
                      <span className="ml-auto text-caption text-ink-3 tabular-nums">
                        {formatJst(draft.updated_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-body leading-5 text-ink-2">
                      {draft.thread[0]?.text ?? ""}
                    </p>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
