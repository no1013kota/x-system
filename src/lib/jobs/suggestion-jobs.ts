import { EXECUTABLE_SUBSCRIPTION_STATUSES } from "@/lib/auth/subscription-access";
import type { Queryable } from "../x/token-refresh";

/**
 * 投稿分析（SUGGEST）の起票と読み出し（K-2, 要件04 §12, 要件05 §9, T-M8-94→T-M8-255）。
 *
 * 2026-08-23 の刷新で**毎朝8:00の自動実行を廃止し、利用者がボタンで開始する手動実行**へ戻した
 * （運営者の指示。自動実行は利用者数×毎日のAI費用が上限なしで積み上がるため）。
 * - 起票は投稿分析画面の「分析を開始」ボタン（Server Action）だけが行う
 * - 対象ゲートは自動実行時と同じ: status='active'・契約が有効（trialing/active）・
 *   BYOKならAIキーが1つ以上 valid（キーが無いと provider解決で必ず失敗するため入口で弾く）
 * - 冪等キーは request_key = `sug-manual:{x_account_id}:{JST日付}`（unique制約が**1日1回**を保証。
 *   費用の上限はこの冪等がそのまま担う）
 * - dispatch は Action が `after()` で行い、失敗分は tick の回収フェーズが拾う
 * - 取り込む投稿は**最大7日前まで**（`suggestion-timeline.ts` の取得窓）
 */

const JST_OFFSET_MS = 9 * 3_600_000;

/** `YYYY-MM-DD`（JST）。 */
export function jstDateOf(nowIso: string): string {
  return new Date(Date.parse(nowIso) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 手動実行の冪等キーの前置き。SQL側の組み立てとここだけが正（T-M8-249）。 */
export const MANUAL_SUGGESTION_KEY_PREFIX = "sug-manual:";

/** 手動実行の冪等キー。unique(request_key) が「1アカウント1日1回」を保証する。 */
export function manualSuggestionKey(xAccountId: string, jstDate: string): string {
  return `${MANUAL_SUGGESTION_KEY_PREFIX}${xAccountId}:${jstDate}`;
}

export type ManualSuggestionRejection =
  | "not_found"
  | "x_account_inactive"
  | "subscription_inactive"
  | "api_key_required"
  | "already_running"
  | "already_done_today";

export interface ManualSuggestionResult {
  ok: boolean;
  jobId?: string;
  reason?: ManualSuggestionRejection;
}

/**
 * 「分析を開始」からの手動起票。所有・状態・契約・（BYOKの）AIキーを検証し、
 * 1日1回の冪等キーで generation_jobs(kind=suggestion, trigger=manual) を作る。
 * 既に今日実行済み／実行中なら理由を返して作らない（黙って二重起票しない・原則2）。
 */
export async function createManualSuggestionJob(
  db: Queryable,
  params: { userId: string; xAccountId: string; nowIso: string },
): Promise<ManualSuggestionResult> {
  const date = jstDateOf(params.nowIso);

  const gate = await db.query<{
    status: string;
    subscription_status: string;
    plan: string | null;
    has_ai_key: boolean;
  }>(
    `select xa.status::text as status, p.subscription_status::text as subscription_status,
            p.plan::text as plan,
            exists (
              select 1 from user_api_keys k
               where k.user_id = p.id and k.status = 'valid' and k.provider <> 'x'
            ) as has_ai_key
       from x_accounts xa join profiles p on p.id = xa.user_id
      where xa.id = $1 and xa.user_id = $2`,
    [params.xAccountId, params.userId],
  );
  const row = gate.rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "active") return { ok: false, reason: "x_account_inactive" };
  if (!(EXECUTABLE_SUBSCRIPTION_STATUSES as readonly string[]).includes(row.subscription_status)) {
    return { ok: false, reason: "subscription_inactive" };
  }
  // 運営キー系プラン（premium/expert）はキー登録なしで対象（T-M8-168）。
  if (!(row.plan === "premium" || row.plan === "expert") && !row.has_ai_key) {
    return { ok: false, reason: "api_key_required" };
  }

  // arbiter を限定しない: request_key（1日1回）と「activeなsuggestionは1件」の
  // partial-unique の両方を吸収する。冪等キーの組み立ては `manualSuggestionKey` の1か所だけ
  // （T-M8-249。SQL側で `||` の手組みを重複させない）。
  const inserted = await db.query<{ id: string }>(
    `insert into generation_jobs (x_account_id, kind, trigger, request_key, status)
     values ($1, 'suggestion', 'manual', $2, 'queued')
     on conflict do nothing
     returning id`,
    [params.xAccountId, manualSuggestionKey(params.xAccountId, date)],
  );
  if (inserted.rows[0]) return { ok: true, jobId: inserted.rows[0].id };

  // 作れなかった理由を言い分ける（実行中か、今日はもう実行済みか）。
  const running = await db.query<{ id: string }>(
    `select id from generation_jobs
      where x_account_id = $1 and kind = 'suggestion' and status in ('queued', 'running')
      limit 1`,
    [params.xAccountId],
  );
  if (running.rows[0]) return { ok: false, reason: "already_running" };
  return { ok: false, reason: "already_done_today" };
}

export interface SuggestionView {
  content: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

/** 最新の成功 suggestion job 実行分の提案を返す（所有者のみ・新しい順）。 */
export async function listSuggestions(
  db: Queryable,
  userId: string,
  xAccountId: string,
): Promise<SuggestionView[]> {
  const { rows } = await db.query<{ content: string; evidence: Record<string, unknown>; created_at: string }>(
    `select s.content, s.evidence, s.created_at::text as created_at
       from improvement_suggestions s
       join x_accounts xa on xa.id = s.x_account_id
      where s.x_account_id = $1 and xa.user_id = $2
        and s.source_job_id = (
          select gj.id from generation_jobs gj
           where gj.x_account_id = $1 and gj.kind = 'suggestion' and gj.status = 'succeeded'
           order by coalesce(gj.finished_at, gj.created_at) desc, gj.created_at desc
           limit 1
        )
      order by s.created_at asc`,
    [xAccountId, userId],
  );
  return rows.map((r) => ({ content: r.content, evidence: r.evidence, createdAt: r.created_at }));
}
