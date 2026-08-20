import type { Queryable } from "../x/token-refresh";

/**
 * 投稿分析（SUGGEST）の起票と読み出し（K-2, 要件04 §12, 要件05 §9, T-M8-94）。
 *
 * 2026-08-15 の刷新で**手動の「提案を更新」を廃止し、毎朝8:00 JSTの自動実行**にした
 * （運営者の指示）。起票は `scheduler_tick` が `enqueueDailySuggestions` で行う:
 * - JST 8時前は何もしない（日次サマリ `deliverDailySummaries` と同じゲートの形）
 * - 対象は status='active' の Xアカウントのうち、契約が有効（trialing/active）で、
 *   BYOKならAIキーが1つ以上 valid のもの（キーが無いと provider解決で必ず失敗し、
 *   毎朝失敗通知が届き続けるため入口で除く）
 * - 冪等キーは request_key = `sug-daily:{x_account_id}:{JST日付}`（unique制約が1日1回を保証）
 * - dispatch はしない。queued に置けば tick の dispatch フェーズ（最大50件/回）が拾う
 *
 * 旧・手動起票（refreshSuggestions と already_today / no_new_metrics 等のゲート）は削除した。
 * 1日1回の費用上限は request_key の冪等がそのまま担う。
 */

export interface DailyEnqueueResult {
  /** 新しく作った job の数（既存＝実行済みの日はカウントしない）。 */
  created: number;
}

const JST_OFFSET_MS = 9 * 3_600_000;
/** 自動実行の時刻（JST時）。日次サマリ（SUMMARY_HOUR_JST）と同じ朝8時。 */
export const SUGGESTION_HOUR_JST = 8;

/** `YYYY-MM-DD`（JST）。 */
export function jstDateOf(nowIso: string): string {
  return new Date(Date.parse(nowIso) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 自動実行の冪等キー。unique(request_key) が「1アカウント1日1回」を保証する。 */
export function dailySuggestionKey(xAccountId: string, jstDate: string): string {
  return `sug-daily:${xAccountId}:${jstDate}`;
}

/**
 * 毎朝の投稿分析jobを一括で冪等作成する（scheduler_tick から毎回呼ばれる）。
 * JST 8時前は no-op。作成済みの日は on conflict do nothing で0件になる。
 */
export async function enqueueDailySuggestions(
  db: Queryable,
  nowIso: string,
): Promise<DailyEnqueueResult> {
  const jstHour = new Date(Date.parse(nowIso) + JST_OFFSET_MS).getUTCHours();
  if (jstHour < SUGGESTION_HOUR_JST) return { created: 0 };
  const date = jstDateOf(nowIso);

  // 対象アカウントを1クエリで選び、そのまま冪等insertする（enqueueDueSlots と同じ「置くだけ」の形。
  // dispatch は tick の dispatch フェーズに任せる）。
  const { rows } = await db.query<{ id: string }>(
    `insert into generation_jobs (x_account_id, kind, trigger, request_key, status)
     select xa.id, 'suggestion', 'schedule', 'sug-daily:' || xa.id || ':' || $1, 'queued'
       from x_accounts xa
       join profiles p on p.id = xa.user_id
      where xa.status = 'active'
        and p.subscription_status in ('trialing', 'active')
        and (
          -- 運営キー系プラン（premium/expert）はキー登録なしで対象（T-M8-168）。
          p.plan in ('premium', 'expert')
          -- AIのキーに限る（provider='x' はX App資格情報で、LLMの解決には使えない）。
          or exists (
            select 1 from user_api_keys k
             where k.user_id = p.id and k.status = 'valid' and k.provider <> 'x'
          )
        )
     -- 下の for key share が要る理由（T-M8-116。news-digest.ts・daily-summary.ts と同じ）:
     -- 同じ文の中でも、SELECT が見る行と外部キー検査が見る行は別のスナップショットで決まる。
     -- SELECT の直後にXアカウントの連携解除（や退会のcascade）がコミットされると、検査時点では
     -- 親行が無く generation_jobs_x_account_id_fkey 違反になる。tick は cleanup の例外を
     -- 捕まえて先へ進むため、1人の解除でその日の分析が全利用者ぶん黙って起票されなくなる。
     -- 親行を先にロックしておけば、解除はこの文の完了まで待たされ、先に消えていれば0行になる。
       for key share of xa
     -- arbiter を限定しない: request_key（1日1回）と「activeなsuggestionは1件」の
     -- partial-unique の両方を吸収する（前日のjobが残っていても23505でtickを落とさない）。
     on conflict do nothing
     returning id`,
    [date],
  );
  return { created: rows.length };
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
