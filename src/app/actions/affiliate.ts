"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { ensureAffiliateAccount } from "@/lib/affiliate/store";
import { encrypt } from "@/lib/crypto";
import { pooledQueryable } from "@/lib/db/pool";
import { parseUserInput } from "@/lib/validation/user-input";

/**
 * 招待報酬の振込先口座の登録・変更（T-M8-174・invite_cp.md §12）。
 * 口座番号は AES-256-GCM で暗号化して保存し、画面へは末尾4桁だけ返す（要決定D-33）。
 */

const bankAccountSchema = z.object({
  account_holder_name: z
    .string()
    .trim()
    .min(1, "口座名義を入力してください。")
    .max(100, "口座名義は100文字以内で入力してください。"),
  account_number: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "口座番号は4〜8桁の数字で入力してください。"),
  account_type: z.enum(["ordinary", "checking"]),
  bank_name: z.string().trim().min(1, "銀行名を入力してください。").max(100),
  branch_name: z.string().trim().min(1, "支店名を入力してください。").max(100),
});

export async function saveAffiliatePayoutAccount(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(bankAccountSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;

  try {
    const db = pooledQueryable();
    const account = await ensureAffiliateAccount(db, auth.userId);
    const value = parsed.data;
    await db.query(
      `insert into affiliate_payout_accounts
         (affiliate_account_id, bank_name, branch_name, account_type,
          account_number_ciphertext, bank_account_last4, account_holder_name, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'active')
       on conflict (affiliate_account_id) do update
         set bank_name = excluded.bank_name,
             branch_name = excluded.branch_name,
             account_type = excluded.account_type,
             account_number_ciphertext = excluded.account_number_ciphertext,
             bank_account_last4 = excluded.bank_account_last4,
             account_holder_name = excluded.account_holder_name,
             status = 'active',
             updated_at = now()`,
      [
        account.id,
        value.bank_name,
        value.branch_name,
        value.account_type,
        encrypt(value.account_number),
        value.account_number.slice(-4),
        value.account_holder_name,
      ],
    );
    revalidatePath("/app/invite");
    return { status: "success", message: "振込先口座を保存しました。" };
  } catch (error) {
    return errorResult(error);
  }
}
