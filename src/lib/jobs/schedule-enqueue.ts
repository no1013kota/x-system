import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { CURRENT_MONTH_JST_SQL } from "@/lib/usage/current-month";
import { hasRemovingLearningSource } from "@/lib/learning-sources";
import { PATTERN_MAX_POSTS } from "@/lib/post/generation-validation";

import type { Queryable } from "../x/token-refresh";

/**
 * scheduler_tick の enqueue フェーズ（要件04 §6/§7.1, S-2, T-M4-06）。直前10分以内の未処理 due slot を
 * 走査し、§7.1 の各条件（enabled・曜日/時刻・契約・Xアカウントactive・auto同意・BYOKキー・premium残量・
 * 日次上限）を満たす slot だけ post_generation を作る。`schedule_run_key` unique ＋ `last_run_at` を
 * 同一 transaction で更新して冪等化する（同一slot・同一定刻窓で複数tickでもjobは1件）。1起動500件上限。
 */

/** premium auto の「ロールバック安全残量」保守的仮定（要件04 §7.1）。P-5はスケジュール対象外。 */
const ROLLBACK_SAFE_BUDGET: Record<string, { normal: number; url: number }> = {
  p1: { normal: 10, url: 1 },
  p2: { normal: 1, url: 0 },
  p3: { normal: 12, url: 1 },
  p4: { normal: 8, url: 1 },
  p6: { normal: 12, url: 1 },
};

/** premium月次上限（要件03 §7・plans.ts と一致）。 */
const PREMIUM_LIMITS = { normalPosts: 200, urlPosts: 20, generations: 100, images: 20 };

interface DueSlotRow {
  id: string;
  x_account_id: string;
  pattern: string;
  time_jst: string;
  mode: string;
  instructions: string | null;
  image_enabled: boolean;
  image_provider: string | null;
  user_id: string;
  x_status: string;
  base_md_version: number;
  auto_consent_ok: boolean;
  plan: string;
  subscription_status: string;
  ai_purpose_config: { text?: string; image?: string } | null;
  jst_date: string;
  jst_month: string;
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
    `select ss.id, ss.x_account_id, ss.pattern, ss.time_jst::text as time_jst, ss.mode,
            ss.instructions, ss.image_enabled, ss.image_provider,
            xa.user_id, xa.status as x_status, xa.base_md_version,
            (xa.automation_consent_version = $1 and xa.automation_consented_at is not null
             and xa.automation_disabled_at is null) as auto_consent_ok,
            p.plan, p.subscription_status, p.ai_purpose_config,
            to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as jst_date,
            ${CURRENT_MONTH_JST_SQL} as jst_month
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

async function premiumBudgetOk(db: Queryable, slot: DueSlotRow): Promise<boolean> {
  const { rows } = await db.query<{
    normal_posts_count: number;
    url_posts_count: number;
    generations_count: number;
    images_count: number;
  }>(
    `select normal_posts_count, url_posts_count, generations_count, images_count
       from usage_counters where user_id = $1 and month = $2`,
    [slot.user_id, slot.jst_month],
  );
  const c = rows[0] ?? {
    normal_posts_count: 0,
    url_posts_count: 0,
    generations_count: 0,
    images_count: 0,
  };
  if (c.generations_count + 1 > PREMIUM_LIMITS.generations) return false;
  if (slot.image_enabled && c.images_count + 1 > PREMIUM_LIMITS.images) return false;
  if (slot.mode === "auto") {
    const need = ROLLBACK_SAFE_BUDGET[slot.pattern] ?? { normal: 0, url: 0 };
    if (c.normal_posts_count + need.normal > PREMIUM_LIMITS.normalPosts) return false;
    if (c.url_posts_count + need.url > PREMIUM_LIMITS.urlPosts) return false;
  }
  return true;
}

async function dailyLimitOk(
  db: Queryable,
  slot: DueSlotRow,
  dailyLimit: number,
): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from usage_events
      where x_account_id = $1 and operation = 'post_create' and reason = 'consume'
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date`,
    [slot.x_account_id],
  );
  const today = rows[0]?.n ?? 0;
  const planned = PATTERN_MAX_POSTS[slot.pattern] ?? 0;
  return today + planned <= dailyLimit;
}

/** §7.1 の各条件を評価し、enqueue すべきか返す。 */
async function isEligible(db: Queryable, slot: DueSlotRow, dailyLimit: number): Promise<boolean> {
  if (slot.subscription_status !== "trialing" && slot.subscription_status !== "active") return false;
  if (slot.x_status !== "active") return false;
  if (slot.base_md_version < 1) return false;
  if (slot.pattern === "p5") return false; // スケジュール対象外（保険）
  if (slot.mode === "auto" && !slot.auto_consent_ok) return false;
  // 学習ソース削除merge中は新規生成を止める（要件04 §12, T-M5-05）。
  if (await hasRemovingLearningSource(db, slot.x_account_id)) return false;
  if (slot.plan === "premium") {
    if (!(await premiumBudgetOk(db, slot))) return false;
  } else {
    if (!(await keysValid(db, slot))) return false;
  }
  if (!(await dailyLimitOk(db, slot, dailyLimit))) return false;
  return true;
}

async function enqueueSlot(deps: ScheduleEnqueueDeps, slot: DueSlotRow): Promise<boolean> {
  const timeHhmm = slot.time_jst.slice(0, 5);
  const runKey = `slot:${slot.id}:${slot.jst_date}:${timeHhmm}`;
  const input = JSON.stringify({
    instructions: slot.instructions ?? null,
    image_enabled: slot.image_enabled,
    image_provider: slot.image_provider ?? null,
    mode: slot.mode,
    requested_mode: slot.mode,
  });
  return deps.runInTx(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `insert into generation_jobs
         (x_account_id, kind, trigger, slot_id, pattern, input, status, scheduled_for, schedule_run_key, available_at)
       values ($1, 'post_generation', 'schedule', $2, $3, $4::jsonb, 'queued',
               (($5 || ' ' || $6)::timestamp at time zone 'Asia/Tokyo'), $7, now())
       on conflict (schedule_run_key) do nothing
       returning id`,
      [slot.x_account_id, slot.id, slot.pattern, input, slot.jst_date, timeHhmm, runKey],
    );
    if (inserted.rowCount === 0) return false; // 既に同一定刻窓で作成済み（冪等）
    await tx.query(`update schedule_slots set last_run_at = now() where id = $1`, [slot.id]);
    return true;
  });
}

export async function enqueueDueSlots(deps: ScheduleEnqueueDeps): Promise<EnqueueResult> {
  const slots = await loadDueSlots(deps.db);
  let enqueued = 0;
  for (const slot of slots) {
    if (!(await isEligible(deps.db, slot, deps.dailyLimit))) continue;
    if (await enqueueSlot(deps, slot)) enqueued += 1;
  }
  return { scanned: slots.length, enqueued };
}
