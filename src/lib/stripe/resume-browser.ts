/**
 * 「プランを再開」のブラウザ側呼び出し（T-M8-264）。checkout/portal の `startBillingRedirect` と
 * 違い**遷移しない**（その場で再開が完了する）ため、fetchの結果をそのまま返す。
 * fetchはclient componentに直接書かず、ここ（outbound-channels登録済み）へ置く。
 */

export type ResumeResult =
  | { ok: true; data: { status: string; synced: boolean } }
  | { ok: false; error?: { message?: string } };

export async function startPlanResume(): Promise<ResumeResult> {
  const res = await fetch("/api/stripe/resume", {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await res.json().catch(() => null)) as ResumeResult | null;
  if (!body) return { ok: false };
  return body;
}
