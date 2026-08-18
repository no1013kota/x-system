/**
 * Stripe の失敗のうち、**待っても直らないもの**を見分ける（T-M8-148）。
 *
 * 2026-08-18、本番で「7日間無料で利用」を押すと必ず失敗した。Stripeの応答は
 * `Your account cannot currently make live charges.`（アカウントの本番有効化が未完了）。
 * これを `provider_error` に丸めると利用者へ「時間をおいて再度お試しください」と出る——
 * **待っても直らないので嘘になり、同じ操作を繰り返させる**（CLAUDE.md 原則1・T-M8-127と同じ型）。
 *
 * 運営者向けの原因表示は `doctor` の「決済の受付（Stripeアカウント）」が担う。
 * ここは**利用者へ返すコードを分ける**ためだけに使う。
 */

/** Stripe のエラーから人間可読なメッセージを集める（形が違う実装でも取りこぼさない）。 */
function messagesOf(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const e = error as { message?: unknown; raw?: { message?: unknown } };
  return [e.message, e.raw?.message].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );
}

/**
 * アカウントが本番決済を受け付けられない状態か。
 *
 * 文言一致に頼る（Stripeは専用の `code` を返さない）。**大文字小文字と語順のゆれを許す**が、
 * 判定を広げすぎない——一時的な障害まで「有効化が必要」と言うと今度は逆の嘘になる。
 */
export function isLiveChargesDisabled(error: unknown): boolean {
  return messagesOf(error).some((message) =>
    /cannot currently make live charges|account cannot make live charges/i.test(message),
  );
}
