import type { Metadata } from "next";
import Link from "next/link";

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
  if (activeXAccountId) {
    const [loaded, meta] = await Promise.all([
      listScheduleSlots(pooledDb, activeXAccountId),
      getPool()
        .query<{ plan: string | null; consented: boolean }>(
          `select p.plan,
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
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950" role="alert">
          <p className="font-semibold">Xアカウントの連携が必要です</p>
          <p className="mt-1 text-sm">スケジュールを作成するには、まずXアカウントを連携してください。</p>
          <Link
            className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
            href="/app/settings?tab=x-accounts"
          >
            設定へ
          </Link>
        </div>
      ) : (
        <ScheduleManager
          automationConsented={automationConsented}
          imageProviders={imageProviders}
          slots={slots}
          xAccountId={activeXAccountId}
        />
      )}
    </main>
  );
}
