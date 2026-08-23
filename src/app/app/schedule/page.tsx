import type { Metadata } from "next";

import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { imageKeyRowsQuery, imageProvidersFor } from "@/lib/ai/image-providers-server";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";

import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import {
  listPatternPrompts,
  listSchedulablePatterns,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { ScheduleManager } from "./schedule-manager";
import { pageTitleClassName } from "@/components/ui/card";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";

export const metadata: Metadata = { title: "スケジュール | Exos AI" };

const pooledDb = pooledQueryable();


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
  /**
   * 今後の予定（T-M8-226・運営者の指示 2026-08-22）: **投稿予約済みの下書きだけ**を読む。
   * 未予約の下書きはこの画面に出さない（編集・投稿は投稿作成＞下書きが担う）。
   */
  let scheduledDrafts: {
    id: string;
    pattern_name: string;
    scheduled_at: string;
    excerpt: string;
  }[] = [];
  /** 予約に使えるパターン（引用URLが必須のものは除く・T-M8-129 U3）。 */
  let patterns: PatternOption[] = [];
  /**
   * 生成に使うプロンプト（T-M8-135）。**md/premium だけ**——投稿作成・AI設定と同じ境界。
   * null なら画面はセクションごと出さない（standardに「編集できない欄」を見せない）。
   */
  let patternPrompts: Record<string, PatternPromptView> | null = null;
  if (activeXAccountId) {
    // 4取得は相互に独立（T-M8-67。以前は slots+meta → providers → drafts の3段直列で、
    // 停止/再開/削除/保存のたびの router.refresh() でも毎回この直列分を待っていた）。
  const [loaded, meta, keyRows, draftRows, schedulable] = await Promise.all([
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
      getPool().query<{
        id: string;
        pattern_name: string;
        scheduled_at: string;
        excerpt: string;
      }>(
        `select id, pattern_name, scheduled_at::text as scheduled_at,
                coalesce(thread->0->>'text', '') as excerpt
           from drafts
          where x_account_id = $1 and status = 'draft' and scheduled_at is not null
          order by scheduled_at asc
          limit 20`,
        [activeXAccountId],
      ),
      listSchedulablePatterns(pooledDb, activeXAccountId),
    ]);
    patterns = schedulable;
    // 判定は `promptEditablePlan` に集約（T-M8-144）。
  if (promptEditablePlan(meta?.plan ?? "")) {
      const prompts = await listPatternPrompts(pooledDb, activeXAccountId);
      // 予約に使えるパターンの分だけ渡す（選べないものを編集させない）。
      patternPrompts = Object.fromEntries(
        patterns.filter((o) => prompts[o.id]).map((o) => [o.id, prompts[o.id]]),
      );
    }
    slots = loaded;
    imageProviders = imageProvidersFor(meta?.plan ?? null, keyRows.rows);
    automationConsented = meta?.consented === true;
    accountHandle = meta?.handle ?? null;
    scheduledDrafts = draftRows.rows;
  }


  return (
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      <header>
        <h1 className={pageTitleClassName}>スケジュール</h1>
      </header>

      {!activeXAccountId ? (
        <XAccountRequiredNotice description="スケジュールを作成するには、まずXアカウントを連携してください。" />
      ) : (
        <ScheduleManager
          key={activeXAccountId}
          accountHandle={accountHandle}
          scheduledDrafts={scheduledDrafts}
          automationConsented={automationConsented}
          imageProviders={imageProviders}
          patternPrompts={patternPrompts}
          patterns={patterns}
          slots={slots}
          xAccountId={activeXAccountId}
        />
      )}

    </main>
  );
}
