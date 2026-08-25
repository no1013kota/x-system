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

/**
 * 制御文字（ANSIエスケープ等）を拒否する。運営者は振込時にこの値をターミナルへ表示する
 * （scripts/affiliate-payouts.mjs）ため、制御文字を許すと表示金額の偽装に使われ得る（レビュー修正）。
 */
const printable = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label}を入力してください。`)
    .max(100, `${label}は100文字以内で入力してください。`)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), {
      message: `${label}に使えない文字が含まれています。`,
    });

const bankAccountSchema = z.object({
  account_holder_name: printable("口座名義"),
  account_number: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "口座番号は4〜8桁の数字で入力してください。"),
  account_type: z.enum(["ordinary", "checking"]),
  bank_name: printable("銀行名"),
  branch_name: printable("支店名"),
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
