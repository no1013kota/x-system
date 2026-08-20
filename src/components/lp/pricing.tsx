import Link from "next/link";

import { CampaignCallout } from "@/components/billing/campaign-callout";
import { PlanPricingCards, RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * LP 06 料金（design_handoff_lp）。`/plans` と同じカード部品（`PlanPricingCards`）を使う
 * （T-M8-171・運営者の指示 2026-08-21。T-M8-125の比較表から置き換えた）。
 * 価格・上限・可否は `plans.ts`／`plan-comparison.ts` を正とし、ここに数値を直書きしない
 * （landing-page.test.ts が固定する）。
 *
 * 下部の注意書き（APIキーの費用・申込前確認）は運営者の決定で削除した（2026-08-21）。
 * 法令上の開示は次で担う: 「初回のみ」「カード登録が必要」＝CampaignCallout、
 * BYOKのAPI実費＝スタンダードカードの「APIキーの用意」行、法定事項の全文＝特商法ページ・利用規約。
 */
export function PricingCards() {
  return (
    <>
      <CampaignCallout className="mt-[30px]" />
      <PlanPricingCards
        cta={(planId, planName) => (
          <Link
            aria-label={`${planName}を7日間無料で試す`}
            className={cn(
              buttonVariants({ variant: planId === RECOMMENDED_PLAN ? "brand" : "subtle" }),
              "h-11 w-full text-sm font-bold",
            )}
            href="/signup"
          >
            7日間無料で試す
          </Link>
        )}
      />
    </>
  );
}
