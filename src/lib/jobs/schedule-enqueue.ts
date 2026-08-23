import {
  EXECUTABLE_SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from "@/lib/auth/subscription-access";
import {
  IMAGE_DEFAULT_ESTIMATE_CREDITS,
  TEXT_DEFAULT_ESTIMATE_CREDITS,
} from "../ai/model-catalog";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { usagePeriodKeyExpr } from "@/lib/usage/usage-period";
import { canPostThreadToday } from "@/lib/usage/daily-post-limit";
import { countTodaysPostsForXAccount } from "@/lib/usage/daily-post-limit-server";
import { hasRemovingLearningSource } from "@/lib/learning-sources";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import {
  parsePatternSpec,
  scheduledPostSlots,
  type PatternSpec,
} from "@/lib/post/pattern-spec";

import { recordUnexpectedError } from "../observability/sentry";
import type { Queryable } from "../x/token-refresh";

/**
 * scheduler_tick の enqueue フェーズ（要件04 §6/§7.1, S-2, T-M4-06）。直前10分以内の未処理 due slot を
 * 走査し、§7.1 の各条件（enabled・曜日/時刻・契約・Xアカウントactive・auto同意・BYOKキー・premium残量・
 * 日次上限）を満たす slot だけ post_generation を作る。`schedule_run_key` unique を
 * 同一 transaction で更新して冪等化する（同一slot・同一定刻窓で複数tickでもjobは1件）。1起動500件上限。
 */

/** 運営キー系プランの月次上限（要件03 §7・T-M8-168）。plans.ts の usageLimits が正本。 */
import { usageLimitsForPlan, isOperatorManagedPlan } from "@/lib/plans";

interface DueSlotRow {
  id: string;
  x_account_id: string;
  pattern_id: string | null;
  /** パターン設定。enqueue時に凍結してjobへ渡す（T-M8-129 U2/U3）。 */
  pattern_spec: unknown;
  time_jst: string;
  mode: string;
  instructions: string | null;
  /** 分野（発信テーマ）。NULL は指定なし＝AIがアカウント.mdの発信テーマから選ぶ（T-M8-28）。 */
  theme: string | null;
  image_enabled: boolean;
  /** この枠の生成入力（T-M8-135）。投稿作成画面で毎回指定していたものを枠に保存したもの。 */
  source_url: string | null;
  placeholder_values: Record<string, string> | null;
  prompt_override: string | null;
  user_id: string;
  x_status: string;
  base_md_version: number;
  auto_consent_ok: boolean;
  plan: string;
  subscription_status: string;
  ai_purpose_config: { text?: string; image?: string } | null;
  jst_date: string;
  /** 利用枠の期間キー（契約期間の開始日・T-M8-258）。`usage_counters.month` の値。 */
  usage_period: string;
}

export interface ScheduleEnqueueDeps {
  db: Queryable;
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** 全プラン共通の日次投稿上限（env X_DAILY_POST_LIMIT）。 */
  dailyLimit: number;
}

export interface EnqueueResult {
  scanned: number;
  enqueued: number;
}

async function loadDueSlots(db: Queryable): Promise<DueSlotRow[]> {
  const { rows } = await db.query<DueSlotRow>(
    `select ss.id, ss.x_account_id, ss.pattern_id,
              pattern_spec_of(ss.pattern_id) as pattern_spec,
              ss.time_jst::text as time_jst, ss.mode,
            ss.instructions, ss.theme, ss.image_enabled,
            ss.source_url, ss.placeholder_values, ss.prompt_override,
            xa.user_id, xa.status as x_status, xa.base_md_version,
            (xa.automation_consent_version = $1 and xa.automation_consented_at is not null
             and xa.automation_disabled_at is null) as auto_consent_ok,
            p.plan, p.subscription_status, p.ai_purpose_config,
            to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as jst_date,
            ${usagePeriodKeyExpr("p.current_period_start")} as usage_period
       from schedule_slots ss
       join x_accounts xa on xa.id = ss.x_account_id
       join profiles p on p.id = xa.user_id
      where ss.enabled = true
        and (extract(dow from (now() at time zone 'Asia/Tokyo'))::int) = any(ss.weekdays)
        and (now() at time zone 'Asia/Tokyo')::time >= ss.time_jst
        and (now() at time zone 'Asia/Tokyo')::time < (ss.time_jst + interval '10 minutes')
      order by ss.time_jst
      limit 500`,
    [CURRENT_AUTOMATION_CONSENT_VERSION],
  );
  return rows;
}

async function keysValid(db: Queryable, slot: DueSlotRow): Promise<boolean> {
  const cfg = slot.ai_purpose_config ?? {};
  const needed: string[] = [];
  if (cfg.text) needed.push(cfg.text);
  else return false; // 文章providerが未選択なら生成不可
  if (slot.image_enabled) {
    if (cfg.image) needed.push(cfg.image);
    else return false;
  }
  if (slot.mode === "auto") needed.push("x");
  const { rows } = await db.query<{ provider: string; status: string }>(
    `select provider, status from user_api_keys where user_id = $1 and provider = any($2)`,
    [slot.user_id, [...new Set(needed)]],
  );
  const statusByProvider = new Map(rows.map((r) => [r.provider, r.status]));
  return needed.every((p) => {
    const s = statusByProvider.get(p);
    // Xキーは valid/unchecked を許容（form検証済み）。AIキーは valid のみ。
    return p === "x" ? s === "valid" || s === "unchecked" : s === "valid";
  });
}

async function operatorBudgetOk(
  db: Queryable,
  slot: DueSlotRow,
  spec: PatternSpec,
): Promise<boolean> {
  // プランごとの上限（premium / expert・T-M8-168）。無ければ呼ばれない（isOperatorManagedPlanが偽）。
  const limits = usageLimitsForPlan(slot.plan);
  if (!limits) return true;
  const { rows } = await db.query<{
    normal_posts_count: number;
    url_posts_count: number;
    ai_credits_used: number;
  }>(
    `select normal_posts_count, url_posts_count, ai_credits_used
       from usage_counters where user_id = $1 and month = $2`,
    [slot.user_id, slot.usage_period],
  );
  const c = rows[0] ?? {
    normal_posts_count: 0,
    url_posts_count: 0,
    ai_credits_used: 0,
  };
  // AIクレジット（T-M8-109）: 見積もり基準額で「残高が1回分に満たない」場合は起票しない。
  // モデル選択で見積もりは変わるが、事前チェックは基準額（最小消費）で判定する
  //（厳密判定はreserveが行う。ここで厳しくしすぎると実行できるjobまで塞ぐ）。
  const estimate =
    TEXT_DEFAULT_ESTIMATE_CREDITS + (slot.image_enabled ? IMAGE_DEFAULT_ESTIMATE_CREDITS : 0);
  if (c.ai_credits_used + estimate > limits.aiCredits) return false;
  if (slot.mode === "auto") {
    // パターンの設定から導く（T-M8-129 U3）。
    const need = scheduledPostSlots(spec);
    if (c.normal_posts_count + need.normal > limits.normalPosts) return false;
    if (c.url_posts_count + need.url > limits.urlPosts) return false;
  }
  return true;
}

/**
 * 日次上限に収まるか。数え方と判定は**投稿jobと画面のバナーと共有する**（T-M8-28）。
 *
 * ここには同じSQLの3つ目の写しがあった（`post-publish.ts`・App Shell のバナー・ここ）。
 * T-M8-26 で2つは共通化したがここを見落としていた。3か所に散っていると、
 * 「予約は積まれるのに投稿で弾かれる」ような食い違いが静かに生まれる。
 */
async function dailyLimitOk(
  db: Queryable,
  slot: DueSlotRow,
  spec: PatternSpec,
  dailyLimit: number,
): Promise<boolean> {
  const today = await countTodaysPostsForXAccount(db, slot.x_account_id);
  return canPostThreadToday(today, dailyLimit, spec.maxPostsEdit);
}

/** §7.1 の各条件を評価し、enqueue すべきか返す。 */
async function isEligible(
  db: Queryable,
  slot: DueSlotRow,
  spec: PatternSpec,
  dailyLimit: number,
): Promise<boolean> {
  // 実行できる契約かは `SUBSCRIPTION_ACCESS` から導く（T-M8-249。可否を2か所に書かない）。
  if (!EXECUTABLE_SUBSCRIPTION_STATUSES.includes(slot.subscription_status as SubscriptionStatus)) {
    return false;
  }
  if (slot.x_status !== "active") return false;
  if (slot.base_md_version < 1) return false;
  // 引用URLが必須のパターンは予約に使えない（DBのトリガも拒否する）。保険としてここでも見る。
  if (spec.requiresQuoteUrl) return false;
  if (slot.mode === "auto" && !slot.auto_consent_ok) return false;
  // 学習ソース削除merge中は新規生成を止める（要件04 §12, T-M5-05）。
  if (await hasRemovingLearningSource(db, slot.x_account_id)) return false;
  if (isOperatorManagedPlan(slot.plan)) {
    if (!(await operatorBudgetOk(db, slot, spec))) return false;
  } else {
    if (!(await keysValid(db, slot))) return false;
  }
  if (!(await dailyLimitOk(db, slot, spec, dailyLimit))) return false;
  return true;
}

/** `slot.pattern_spec` は呼び出し側で `parsePatternSpec` を通してある（読めない枠は来ない）。 */
async function enqueueSlot(deps: ScheduleEnqueueDeps, slot: DueSlotRow): Promise<boolean> {
  const timeHhmm = slot.time_jst.slice(0, 5);
  const runKey = `slot:${slot.id}:${slot.jst_date}:${timeHhmm}`;
  /*
    **投稿作成画面と同じキーで渡す**（T-M8-135）。生成側（`post-generation.ts`）は
    `job.input` の形しか見ないので、ここでキー名がずれると
    「予約では効かない」という、画面からは説明できない差になる。
  */
  const input = JSON.stringify({
    instructions: slot.instructions ?? null,
    theme: slot.theme ?? null,
    image_enabled: slot.image_enabled,
    mode: slot.mode,
    requested_mode: slot.mode,
    source_url: slot.source_url ?? null,
    placeholder_values: slot.placeholder_values ?? null,
    /*
      **プラン境界を実行時にも守る**（T-M8-135）。プロンプトの編集は md/premium だけなので、
      編集権限の無い状態（未契約へ下がった枠）の `prompt_override` は使わない。
      画面はこのときセクションごと隠すため、使い続けると
      **画面に出ていない指示で生成される**（原則1・原則2に反する）。
    */
    prompt_override: promptEditablePlan(slot.plan) ? (slot.prompt_override ?? null) : null,
  });
  return deps.runInTx(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      // **パターン設定をここで凍結する**（T-M8-129 U2/U3）。実行中に編集・削除されても
      // このジョブは当時の設定で走り切る。
      `insert into generation_jobs
         (x_account_id, kind, trigger, slot_id, pattern_id, pattern_spec,
          input, status, scheduled_for, schedule_run_key, available_at)
       values ($1, 'post_generation', 'schedule', $2, $3, $8::jsonb, $4::jsonb, 'queued',
               (($5 || ' ' || $6)::timestamp at time zone 'Asia/Tokyo'), $7, now())
       on conflict (schedule_run_key) do nothing
       returning id`,
      [
        slot.x_account_id,
        slot.id,
        slot.pattern_id,
        input,
        slot.jst_date,
        timeHhmm,
        runKey,
        JSON.stringify(slot.pattern_spec),
      ],
    );
    if (inserted.rowCount === 0) return false; // 既に同一定刻窓で作成済み（冪等）
    return true;
  });
}

export async function enqueueDueSlots(deps: ScheduleEnqueueDeps): Promise<EnqueueResult> {
  const slots = await loadDueSlots(deps.db);
  let enqueued = 0;
  for (const slot of slots) {
    // **パターンが読めない枠は黙って飛ばさない。** 削除済みのパターンを指す枠は
    // DBのトリガが `enabled=false` へ落とすので、ここへ来るのは想定外の状態。
    const spec = parsePatternSpec(slot.pattern_spec);
    if (!spec) {
      recordUnexpectedError(new Error(`schedule slot ${slot.id} has no usable pattern`), {
        at: "schedule-enqueue",
        slotId: slot.id,
      });
      continue;
    }
    if (!(await isEligible(deps.db, slot, spec, deps.dailyLimit))) continue;
    if (await enqueueSlot(deps, slot)) enqueued += 1;
  }
  return { scanned: slots.length, enqueued };
}
