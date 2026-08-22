import type { Metadata } from "next";

import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { imageProvidersFor } from "@/lib/ai/image-providers-server";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatJst } from "@/lib/format";
import { nextScheduleRun } from "@/lib/schedule/next-run";
import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import {
  listPatternPrompts,
  listSchedulablePatterns,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { ScheduleManager } from "./schedule-manager";
import { CardTitle, cardClassName, pageTitleClassName } from "@/components/ui/card";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";

export const metadata: Metadata = { title: "スケジュール | Exos AI" };

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

  /**
   * 予約済み下書き（1回きり）と、有効スロットの次回実行（繰り返し）を**時間順に1本へ**並べる
   * （T-M8-226・運営者の指示 2026-08-22）。スロットは各枠の「次の1回」だけを載せる——
   * 先々まで展開すると同じ枠が列を埋め、1回きりの予約が埋もれる。
   */
  const upcoming: (
    | { kind: "draft"; at: string; draftId: string; patternName: string; excerpt: string }
    | { kind: "slot"; at: string; slotId: string; patternName: string | null; mode: string; imageEnabled: boolean }
  )[] = [
    ...scheduledDrafts.map((d) => ({
      kind: "draft" as const,
      at: new Date(d.scheduled_at).toISOString(),
      draftId: d.id,
      patternName: d.pattern_name,
      excerpt: d.excerpt,
    })),
    ...slots.flatMap((slot) => {
      if (!slot.enabled) return [];
      const next = nextScheduleRun(slot);
      if (!next) return [];
      return [
        {
          kind: "slot" as const,
          at: next.at.toISOString(),
          slotId: slot.id,
          patternName: slot.pattern_name,
          mode: slot.mode,
          imageEnabled: slot.image_enabled,
        },
      ];
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

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
          automationConsented={automationConsented}
          imageProviders={imageProviders}
          patternPrompts={patternPrompts}
          patterns={patterns}
          slots={slots}
          xAccountId={activeXAccountId}
        />
      )}

      {activeXAccountId ? (
        /*
          今後の予定（T-M8-226・運営者の指示 2026-08-22）。**予約済みの下書き（1回きり）と
          定期実行の次回（繰り返し）を時間順に1本のリスト**で見せる——「次に何がいつ起きるか」を
          この画面だけで追えるようにする。未予約の下書きは出さない（編集・投稿は投稿作成画面）。
          種別は色つきバッジで区別し（時刻の並びだけでは1回きりか繰り返しか読めない）、
          予約済み下書きの行だけ下書きへのリンクにする（定期実行の編集は上のスケジュール一覧）。
        */
        <section aria-label="今後の予定" className={`${cardClassName} px-5 py-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>今後の予定</CardTitle>
            <Link
              className="inline-flex items-center py-2 -my-2 text-caption font-medium text-brand underline-offset-2 hover:underline"
              href="/app/posts?tab=drafts"
            >
              下書きを編集・投稿する
            </Link>
          </div>
          <ul className="mt-3 space-y-2">
            {upcoming.length === 0 ? (
              <li className="rounded-card border border-hairline px-4 py-8 text-center text-body text-ink-2">
                予約された投稿・定期実行の予定はありません。
              </li>
            ) : (
              upcoming.map((entry) =>
                entry.kind === "draft" ? (
                  <li key={`draft-${entry.draftId}`}>
                    <Link
                      className="block rounded-card border border-hairline p-3 transition-colors duration-150 hover:bg-black/[0.02]"
                      href={`/app/posts?tab=drafts&draftId=${entry.draftId}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">{entry.patternName}</Badge>
                        {/* 予約時刻はタイトルの右（下書き画面の「予約 <日時>」と同じ形・運営者の指示 2026-08-22）。 */}
                        <Badge tone="info">予約 {formatJst(entry.at)}</Badge>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-body leading-5 text-ink-2">
                        {entry.excerpt}
                      </p>
                    </Link>
                  </li>
                ) : (
                  <li
                    className="rounded-card border border-hairline p-3"
                    key={`slot-${entry.slotId}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">
                        スケジュール・{entry.mode === "auto" ? "自動投稿" : "下書き作成"}
                      </Badge>
                      <span className="text-caption text-ink-3 tabular-nums">
                        次回 {formatJst(entry.at)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-body leading-5 text-ink-2">
                      {entry.patternName ?? "（パターン削除済み）"}
                      {entry.imageEnabled ? "・画像つき" : ""}
                    </p>
                  </li>
                ),
              )
            )}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
