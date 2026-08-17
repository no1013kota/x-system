import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cardClassName } from "@/components/ui/card";
import { PlanComparisonTable } from "@/components/billing/plan-comparison-table";
import { PLAN_IDS, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * LP 06 料金（design_handoff_lp）。価格・プラン名・アカウント数・プレミアムの月間上限は
 * `plans.ts` を正とし、ここに数値を直書きしない（landing-page.test.ts が固定する）。
 * BYOK注記と申込前確認事項は特商法上の要件のため、折りたたまず常時表示する。
 */

export function PricingCards() {
  return (
    <>
      {/*
        プラン比較表（T-M8-125）。**`/plans` と同じ部品**を使う（運営者の指示・2026-08-18）。
        以前はプランごとの箇条書きカードで、「mdプランの全機能」という入れ子の言い方だったため
        上位プランに何が積まれるのかが読み取れなかった。表なら差がその場で分かる。
      */}
      <PlanComparisonTable />
      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
        {PLAN_IDS.map((planId) => (
          <Link
            className={cn(
              buttonVariants({ variant: planId === "premium" ? "brand" : "subtle" }),
              "h-10 text-sm font-bold",
            )}
            href="/signup"
            key={planId}
          >
            {PLANS[planId].displayName}で始める
          </Link>
        ))}
      </div>
      <div className="mt-3.5">
        <div className="rounded-card border border-hairline bg-page px-5 py-4">
          <p className="text-body font-bold">APIキーの費用について</p>
          <p className="mt-1.5 text-body text-ink-2">
            通常プラン・mdプランは「APIキーをご自身でご用意いただく方式」です。プレミアムプランは運営がAPIキーを用意いたします。
          </p>
        </div>
      </div>
      <div className="mt-3.5">
        <div className={cn(cardClassName, "px-5 py-4")}>
          <p className="text-body font-bold">お申し込み前にご確認ください</p>
          <ul className="mt-2 grid list-disc gap-1 pl-[1.3em] text-caption text-ink-2">
            <li>料金：上記のとおり、すべて税込月額です。</li>
            <li>無料期間：全プラン初回のみ7日間無料。無料期間中に解約すれば料金はかかりません。</li>
            <li>解約方法：設定内のプラン選択画面から、数タップで可能です。</li>
            <li>提供開始：アカウント作成とカード登録が完了後、すぐにご利用いただけます。</li>
          </ul>
        </div>
      </div>
    </>
  );
}
