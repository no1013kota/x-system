import type { Metadata } from "next";

import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { ScheduleManager } from "./schedule-manager";

export const metadata: Metadata = { title: "スケジュール | Space AI" };

const pooledDb = pooledQueryable();

/** BYOKは valid な openai/google キー、premiumは運営キー＋画像モデルが設定済みのproviderを返す。 */
async function availableImageProviders(userId: string, plan: string | null): Promise<string[]> {
  if (plan === "premium") {
    const providers: string[] = [];
    if (env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL) providers.push("openai");
    if (env.GEMINI_API_KEY && env.GEMINI_IMAGE_MODEL) providers.push("google");
    return providers;
  }
  const { rows } = await getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
  return rows.map((r) => r.provider);
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
  if (activeXAccountId) {
    const [loaded, meta] = await Promise.all([
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
    ]);
    slots = loaded;
    imageProviders = await availableImageProviders(user.id, meta?.plan ?? null);
    automationConsented = meta?.consented === true;
    accountHandle = meta?.handle ?? null;
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8 lg:py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">スケジュール</h1>
        <p className="text-sm text-muted-foreground">
          曜日と時刻を決めて、下書き生成または自動投稿を定期実行します。
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
    </main>
  );
}
