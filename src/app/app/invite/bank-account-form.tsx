"use client";

import { useState } from "react";

import { saveAffiliatePayoutAccount } from "@/app/actions/affiliate";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * 振込先口座の登録・変更（T-M8-174・invite_cp.md §12）。
 * 口座番号は送信後に表示しない（保存後は末尾4桁だけがサーバーから返る）。
 */
export function BankAccountForm({
  initial,
  onDone,
}: {
  initial: { bankName: string; branchName: string; accountType: string; holderName: string } | null;
  onDone?: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    try {
      const result = await saveAffiliatePayoutAccount({
        account_holder_name: data.get("account_holder_name"),
        account_number: data.get("account_number"),
        account_type: data.get("account_type"),
        bank_name: data.get("bank_name"),
        branch_name: data.get("branch_name"),
      });
      if (result.status === "success") {
        toast.show({ tone: "success", title: result.message });
        form.reset();
        onDone?.();
      } else {
        toast.show({ tone: "error", title: "保存できませんでした", description: result.message });
      }
    } finally {
      setPending(false);
    }
  }

  const field = "h-11 w-full rounded-lg border border-hairline bg-background px-3 text-sm";
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
      <label className="block space-y-1.5 text-sm font-medium">
        銀行名
        <input
          className={field}
          defaultValue={initial?.bankName ?? ""}
          name="bank_name"
          placeholder="三井住友銀行"
          required
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        支店名
        <input
          className={field}
          defaultValue={initial?.branchName ?? ""}
          name="branch_name"
          placeholder="渋谷支店"
          required
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        口座種別
        <select className={field} defaultValue={initial?.accountType ?? "ordinary"} name="account_type">
          <option value="ordinary">普通</option>
          <option value="checking">当座</option>
        </select>
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        口座番号
        <input
          autoComplete="off"
          className={field}
          inputMode="numeric"
          name="account_number"
          pattern="\d{4,8}"
          placeholder="1234567"
          required
          title="4〜8桁の数字"
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium sm:col-span-2">
        口座名義（カナ）
        <input
          className={field}
          defaultValue={initial?.holderName ?? ""}
          name="account_holder_name"
          placeholder="ヤマダ タロウ"
          required
        />
      </label>
      <div className="sm:col-span-2">
        <Button className="h-11 px-5 font-bold" disabled={pending} type="submit" variant="brand">
          {pending ? "保存しています…" : initial ? "口座を変更する" : "口座を登録する"}
        </Button>
      </div>
    </form>
  );
}
