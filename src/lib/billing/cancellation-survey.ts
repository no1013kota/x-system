import {
  CANCELLATION_REASONS,
  isCancellationReason,
  type CancellationReason,
} from "./cancellation-reasons";
import { AppError } from "@/lib/observability/errors";

/**
 * 解約アンケートの保存（T-M8-277）。**解約手続きを止めない**——保存に失敗しても
 * 解約の導線は進める（アンケートのために解約できない、は本末転倒）。呼び出し側が握る。
 */

export interface CancellationSurveyDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface CancellationSurveyInput {
  /**
   * 選んだ理由（1つ以上・T-M8-294）。**複数選べる**——解約の理由は1つに絞れないことが多く、
   * 1つしか選べないと集計が「仕方なく選んだ1つ」に寄って、何を直すべきかの判断を誤らせる。
   */
  reasons: string[];
  detail?: string | null;
  /** 確認画面から解約手続き（Stripe）へ進んだか。 */
  proceeded: boolean;
}

export async function saveCancellationSurvey(
  db: CancellationSurveyDb,
  userId: string,
  input: CancellationSurveyInput,
): Promise<CancellationReason[]> {
  // 重複は落とす（同じ理由が2回来ても集計を二重に数えない）。順序は選択肢の並びに揃える。
  const unique = CANCELLATION_REASONS.map((r) => r.value).filter((value) =>
    input.reasons.includes(value),
  );
  if (unique.length === 0) {
    throw new AppError("validation_error", { message: "解約の理由を1つ以上選んでください。" });
  }
  // 知らない値が混じっていたら黙って捨てず弾く（画面と定数のずれに気付けるように）。
  if (input.reasons.some((value) => !isCancellationReason(value))) {
    throw new AppError("validation_error", { message: "解約の理由を選んでください。" });
  }
  const detail = (input.detail ?? "").trim();
  if (detail.length > 1000) {
    throw new AppError("validation_error", { message: "ご意見は1000文字以内で入力してください。" });
  }
  await db.query(
    `insert into cancellation_surveys (user_id, reasons, detail, proceeded, plan)
     select $1, $2::text[], $3, $4, p.plan from profiles p where p.id = $1`,
    [userId, unique, detail === "" ? null : detail, input.proceeded],
  );
  return unique;
}

/**
 * 運営者向けの集計（doctor・日次サマリから読む想定）。直近N日を理由ごとに数える。
 * **複数選択なので合計は回答数より多くなる**（1件の回答が複数の理由に数えられる）。
 */
export async function cancellationReasonCounts(
  db: CancellationSurveyDb,
  days = 30,
): Promise<{ reason: string; count: number }[]> {
  const { rows } = await db.query<{ reason: string; n: string }>(
    `select reason, count(*)::text as n
       from cancellation_surveys, unnest(reasons) as reason
      where created_at >= now() - make_interval(days => $1) and proceeded
      group by reason order by 2 desc`,
    [days],
  );
  return rows.map((r) => ({ reason: r.reason, count: Number(r.n) }));
}

export type { CancellationReason };
