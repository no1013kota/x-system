"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import {
  disconnectXAccountForUser,
  enableXAccountForUser,
  listXAccounts,
  refreshXAccountStatusForUser,
  setActiveXAccountForUser,
  type XAccountListItem,
} from "@/lib/x/account-actions-server";

/**
 * Xアカウント管理 Server Actions（要件05 §4.3, A-6）。本人のみ。list以外は x_account_id を検証し、
 * status を返す。tokenの平文や外部レスポンス本文は返さない（server層で復号・破棄）。
 */

const idSchema = z.object({ x_account_id: z.string().uuid() });

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}

export interface ListXAccountsActionResult extends BaseResult {
  accounts?: XAccountListItem[];
}

export interface XAccountStatusActionResult extends BaseResult {
  accountStatus?: string;
}

async function requireUserId(): Promise<
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

export async function listXAccountsAction(): Promise<ListXAccountsActionResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const accounts = await listXAccounts(auth.userId);
    return { accounts, message: "", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function refreshXAccountStatusAction(
  input: unknown,
): Promise<XAccountStatusActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { status } = await refreshXAccountStatusForUser(
      parsed.data.x_account_id,
      auth.userId,
    );
    revalidatePath("/app/settings");
    return { accountStatus: status, message: "最新の状態を確認しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function enableXAccountAction(
  input: unknown,
): Promise<XAccountStatusActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { status } = await enableXAccountForUser(parsed.data.x_account_id, auth.userId);
    revalidatePath("/app/settings");
    return { accountStatus: status, message: "アカウントを有効化しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function setActiveXAccountAction(
  input: unknown,
): Promise<XAccountStatusActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await setActiveXAccountForUser(parsed.data.x_account_id, auth.userId);
    revalidatePath("/app");
    return { message: "操作対象のアカウントを切り替えました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function disconnectXAccountAction(
  input: unknown,
): Promise<XAccountStatusActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { status } = await disconnectXAccountForUser(
      parsed.data.x_account_id,
      auth.userId,
    );
    revalidatePath("/app/settings");
    revalidatePath("/app");
    return { accountStatus: status, message: "連携を解除しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}
