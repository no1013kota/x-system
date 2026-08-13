import type { ZodError } from "zod";

import { requireLegalConsent } from "@/lib/auth/legal-consent-server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  AppError,
  toUserFacingError,
  type UserFacingError,
} from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import { firstAuthoredIssueMessage } from "@/lib/validation/user-input";

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
 * エラーを Server Action の失敗結果（`{ ...toUserFacingError(error), status: "error" }`）へ
 * 正規化する。各 action の catch/ガードで同一に書かれていた定型の単一正本。
 */
export function errorResult(
  error: unknown,
): UserFacingError & { status: "error" } {
  const safe = toUserFacingError(error);
  // throw せず値で返すため `onRequestError` が発火しない。未知の例外はここで記録する
  // （要件01 §8。AppError は仕様どおりの分岐なので記録しない）。
  if (safe.code === "internal_error") {
    recordUnexpectedError(error, { at: "server-action" });
  }
  return { ...safe, status: "error" };
}

/**
 * 入力検証の失敗を、**理由まで伝わる**失敗結果にする（F9）。
 *
 * `errorResult(new AppError("validation_error"))` だけだと画面には常に
 * 「入力内容を確認してください。」が出て、何を直せばよいか分からない（T-M8-37 と同型）。
 * 一方 zod の既定文言は英語かつ内部語（`Too big: expected string to have <=512 characters` 等）で、
 * そのまま出すと要件06 §8「内部用語を画面に使わない」に反する。
 *
 * そこで**作者が自分で書いた文言だけ**を載せる。無ければ既定の汎用文へ落ちる。
 * 検証は必ず `parseUserInput`（sentinel付き）で行うこと——素の `safeParse` では
 * 既定文言と作者文言を区別できない。
 */
export function validationErrorResult(
  error: ZodError,
): UserFacingError & { status: "error" } {
  const base = errorResult(new AppError("validation_error"));
  const authored = firstAuthoredIssueMessage(error);
  return authored ? { ...base, message: authored } : base;
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
    return { ok: false, result: errorResult(new AppError("unauthorized")) };
  }
  return { ok: true, userId: user.id };
}

/**
 * 生成・投稿・自動実行の Server Action 共通ガード（T-M8-73）。
 *
 * ログイン確認に加えて、**現行版の利用規約・プライバシーポリシーへの同意**を確認する。
 * 利用規約が「変更後は生成・投稿・自動実行の前に再同意をお願いする」と定めているため、
 * この確認が無いと規約の記載が実装に裏付けられない（要件06 §1.3）。
 * 失敗時の `details.settingsPath` は同意画面（`/app/consent`）を指し、
 * 各画面の既存の前提不足表示がそのまま誘導に使える。
 */
export async function requireExecutionUserId(): Promise<
  { ok: true; userId: string } | { ok: false; result: BaseResult }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  try {
    await requireLegalConsent(auth.userId);
  } catch (error) {
    return { ok: false, result: errorResult(error) };
  }
  return auth;
}
