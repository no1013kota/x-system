import type { Queryable } from "../x/token-refresh";

/**
 * scheduler_tick 回収ステップ(1)（要件04 §1/§6/§7.2, T-M4-07）。enqueue/dispatch の前に:
 * - 期限切れ（`scheduled_for + 10min` 超）の schedule 起点 post_generation を canceled にし、schedule_missed
 *   通知（error, 冪等key `slot:{slot_id}:{yyyy-mm-dd}:{hh:mm}:missed`）を作る（外部API/利用枠は消費しない）。
 * - enqueue されないまま定刻+10分を超えた due slot にも同じ冪等keyで missed 通知を作る。
 * - FEATURE_QUOTE_POST_ENABLED=false の間、queued の P-5 job を feature_disabled で canceled にする。
 * いずれも1起動500件上限。dedupe_key の unique で通知は slot 定刻ごとに1件へ集約する。
 */

export interface ScheduleRecoveryDeps {
  db: Queryable;
  quotePostEnabled: boolean;
}

export interface ScheduleRecoveryResult {
  canceledExpired: number;
  missedNotified: number;
  canceledFeatureDisabled: number;
}

/** schedule_missed の error 通知（設定を尊重・両channel OFFなら作らない）。冪等key単位で1件。 */
async function insertMissedNotification(
  db: Queryable,
  params: { userId: string; slotId: string; occDate: string; occTime: string },
): Promise<boolean> {
  const dedupe = `slot:${params.slotId}:${params.occDate}:${params.occTime}:missed`;
  const { rowCount } = await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'error', $2, '自動投稿の予定時刻を過ぎました',
            '予定時刻から10分を超えたため投稿を見送りました。次回の予定をお待ちください。',
            '/app/schedule', jsonb_build_object('slot_id', $3::text),
            coalesce((p.notification_config->'error'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'error'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, dedupe, params.slotId],
  );
  return (rowCount ?? 0) > 0;
}

/** (a) 期限切れ schedule post_generation を canceled にし missed 通知を作る（外部/枠消費なし）。 */
async function cancelExpiredJobs(db: Queryable): Promise<{ canceled: number; notified: number }> {
  const { rows } = await db.query<{
    slot_id: string | null;
    user_id: string;
    occ_date: string;
    occ_time: string;
  }>(
    `with expired as (
       select id from generation_jobs
        where kind = 'post_generation' and trigger = 'schedule' and status = 'queued'
          and scheduled_for is not null and scheduled_for + interval '10 minutes' < now()
        order by scheduled_for
        limit 500
     )
     update generation_jobs gj
        set status = 'canceled', finished_at = now()
       from expired e, x_accounts xa
      where gj.id = e.id and xa.id = gj.x_account_id
      returning gj.slot_id, xa.user_id,
                to_char(gj.scheduled_for at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as occ_date,
                to_char(gj.scheduled_for at time zone 'Asia/Tokyo', 'HH24:MI') as occ_time`,
  );
  let notified = 0;
  for (const r of rows) {
    if (!r.slot_id) continue; // schedule起点はslot_idを持つ想定。無ければ通知集約できないためskip。
    if (await insertMissedNotification(db, {
      userId: r.user_id,
      slotId: r.slot_id,
      occDate: r.occ_date,
      occTime: r.occ_time,
    })) {
      notified += 1;
    }
  }
  return { canceled: rows.length, notified };
}

/** (b) enqueueされないまま定刻+10分を超えた due slot に missed 通知を作る（冪等keyで重複防止）。 */
async function notifyUnenqueuedMissed(db: Queryable): Promise<number> {
  // 直近の過去窓 [now-70min, now-10min]（JST・同曜日）で、対応する schedule_run_key の job が無い slot。
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    occ_date: string;
    occ_time: string;
  }>(
    `select ss.id, xa.user_id,
            to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as occ_date,
            to_char(ss.time_jst, 'HH24:MI') as occ_time
       from schedule_slots ss
       join x_accounts xa on xa.id = ss.x_account_id
      where ss.enabled = true
        and (extract(dow from (now() at time zone 'Asia/Tokyo'))::int) = any(ss.weekdays)
        and (now() at time zone 'Asia/Tokyo')::time >= ss.time_jst + interval '10 minutes'
        and (now() at time zone 'Asia/Tokyo')::time < ss.time_jst + interval '70 minutes'
        and not exists (
          select 1 from generation_jobs gj
           where gj.schedule_run_key =
                 'slot:' || ss.id::text || ':' ||
                 to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') || ':' ||
                 to_char(ss.time_jst, 'HH24:MI')
        )
      limit 500`,
  );
  let notified = 0;
  for (const r of rows) {
    if (await insertMissedNotification(db, {
      userId: r.user_id,
      slotId: r.id,
      occDate: r.occ_date,
      occTime: r.occ_time,
    })) {
      notified += 1;
    }
  }
  return notified;
}

/**
 * (c) FEATURE_QUOTE_POST_ENABLED=false の間、queued の引用ポスト job を canceled にする
 * （外部API・利用枠を消費する前）。
 *
 * 判定は**凍結した spec**（`pattern_spec.requires_quote_url`）で行う（T-M8-129 U5）。
 * 旧 enum の `'p5'` は撤去した。利用者が作った「引用URL必須」のパターンも同じ扱いになる。
 */
async function cancelFeatureDisabledJobs(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `update generation_jobs set status = 'canceled', finished_at = now()
      where status = 'queued'
        and (pattern_spec->>'requires_quote_url')::boolean is true`,
  );
  return rowCount ?? 0;
}

export async function recoverSchedule(
  deps: ScheduleRecoveryDeps,
): Promise<ScheduleRecoveryResult> {
  const expired = await cancelExpiredJobs(deps.db);
  const missedUnenqueued = await notifyUnenqueuedMissed(deps.db);
  const canceledFeatureDisabled = deps.quotePostEnabled
    ? 0
    : await cancelFeatureDisabledJobs(deps.db);
  return {
    canceledExpired: expired.canceled,
    missedNotified: expired.notified + missedUnenqueued,
    canceledFeatureDisabled,
  };
}
