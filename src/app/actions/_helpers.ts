import { getCurrentUser } from "@/lib/auth/session";
import { AppError, toUserFacingError } from "@/lib/observability/errors";

/**
 * Server Action 共通の結果形（要件05 §2）。成功/失敗の判別＋ユーザー向けメッセージに、任意の
 * error code / details を添える。各 action の個別結果型はこれを extends して拡張する。
 */
export interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}

/**
 * ログイン必須 Server Action の共通ガード。ログイン済みなら userId を、未ログインなら
 * unauthorized の `BaseResult`（status:"error"）を判別可能ユニオンで返す。各 action に同一実装で
 * 重複していたものの単一正本。
 */
export async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; result: BaseResult }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      result: { ...toUserFacingError(new AppError("unauthorized")), status: "error" },
    };
  }
  return { ok: true, userId: user.id };
}
