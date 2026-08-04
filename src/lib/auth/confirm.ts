import type { EmailOtpType } from "@supabase/supabase-js";

export const CONFIRMATION_TYPES = ["signup", "recovery"] as const;
export type ConfirmationType = (typeof CONFIRMATION_TYPES)[number];

export function parseConfirmationType(
  value: string | null,
): ConfirmationType | null {
  return CONFIRMATION_TYPES.includes(value as ConfirmationType)
    ? (value as ConfirmationType)
    : null;
}

export function otpTypeForConfirmation(type: ConfirmationType): EmailOtpType {
  return type;
}

function isAllowedAuthPath(pathname: string): boolean {
  return (
    pathname === "/plans" ||
    pathname === "/reset-password" ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  );
}
/** Allows only known application destinations and strips auth secrets. */
export function safeAuthNext(
  value: string | null,
  appBaseUrl: string,
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const base = new URL(appBaseUrl);
    const candidate = new URL(value, base);
    if (candidate.origin !== base.origin || !isAllowedAuthPath(candidate.pathname)) {
      return null;
    }

    candidate.searchParams.delete("token_hash");
    candidate.searchParams.delete("type");
    candidate.searchParams.delete("next");
    candidate.hash = "";
    return `${candidate.pathname}${candidate.search}`;
  // eslint-disable-next-line no-restricted-syntax -- URLとして解釈できないことが判定結果（null＝不正なnext）
  } catch {
    return null;
  }
}

export function confirmationSuccessPath(
  type: ConfirmationType,
  requestedNext: string | null,
  appBaseUrl: string,
): string {
  const next = safeAuthNext(requestedNext, appBaseUrl);
  if (next) return next;
  if (type === "recovery") return "/reset-password";
  // **確認が済んだことを着地側で言えるように目印を付ける**（T-M8-58）。
  // メールのリンクを押した結果が無言で料金表に変わるだけだと、確認が成功したのか分からない
  // （失敗時は「リンクを確認できませんでした」が出るのに、成功は何も言わなかった）。
  // URL由来の画面状態なのでトーストではなくインライン表示にする（要件06 §2.1）。
  return "/plans?confirmed=1";
}
