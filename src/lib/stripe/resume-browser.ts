/**
 * 「プランを再開」のブラウザ側呼び出し（T-M8-264）。checkout/portal の `startBillingRedirect` と
 * 違い**遷移しない**（その場で再開が完了する）ため、fetchの結果をそのまま返す。
 * fetchはclient componentに直接書かず、ここ（outbound-channels登録済み）へ置く。
 */

export type ResumeResult =
  | { ok: true; data: { status: string; synced: boolean } }
  | { ok: false; error?: { message?: string } };

export type ResumeFailure = ResumeResult & { ok: false; status?: number };

/**
 * @param plan 別のプランで再開する場合に指定する（T-M8-298）。省略なら元のプラン。
 *   トライアルが残っている人は `/plans` から任意のプランを選んでも、残りの期間を無料で始められる。
 */
export async function startPlanResume(plan?: string): Promise<ResumeResult & { status?: number }> {
  const res = await fetch("/api/stripe/resume", {
    body: plan ? JSON.stringify({ plan }) : undefined,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await res.json().catch(() => null)) as ResumeResult | null;
  // 呼び出し側が「カードが無いだけ」(402) と本当の失敗を区別できるように status を返す。
  if (!body) return { ok: false, status: res.status };
  return { ...body, status: res.status };
}
