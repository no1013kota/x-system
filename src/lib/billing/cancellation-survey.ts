import { isCancellationReason, type CancellationReason } from "./cancellation-reasons";
import { AppError } from "@/lib/observability/errors";

/**
 * 解約アンケートの保存（T-M8-277）。**解約手続きを止めない**——保存に失敗しても
 * 解約の導線は進める（アンケートのために解約できない、は本末転倒）。呼び出し側が握る。
 */

export interface CancellationSurveyDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface CancellationSurveyInput {
  reason: string;
  detail?: string | null;
  /** 確認画面から解約手続き（Stripe）へ進んだか。 */
  proceeded: boolean;
}

export async function saveCancellationSurvey(
  db: CancellationSurveyDb,
  userId: string,
  input: CancellationSurveyInput,
): Promise<CancellationReason> {
  if (!isCancellationReason(input.reason)) {
    throw new AppError("validation_error", { message: "解約の理由を選んでください。" });
  }
  const detail = (input.detail ?? "").trim();
  if (detail.length > 1000) {
    throw new AppError("validation_error", { message: "ご意見は1000文字以内で入力してください。" });
  }
  await db.query(
    `insert into cancellation_surveys (user_id, reason, detail, proceeded, plan)
     select $1, $2, $3, $4, p.plan from profiles p where p.id = $1`,
    [userId, input.reason, detail === "" ? null : detail, input.proceeded],
  );
  return input.reason;
}

/** 運営者向けの集計（doctor・日次サマリから読む想定）。直近N日を理由ごとに数える。 */
export async function cancellationReasonCounts(
  db: CancellationSurveyDb,
  days = 30,
): Promise<{ reason: string; count: number }[]> {
  const { rows } = await db.query<{ reason: string; n: string }>(
    `select reason, count(*)::text as n
       from cancellation_surveys
      where created_at >= now() - make_interval(days => $1) and proceeded
      group by reason order by 2 desc`,
    [days],
  );
  return rows.map((r) => ({ reason: r.reason, count: Number(r.n) }));
}

export type { CancellationReason };
