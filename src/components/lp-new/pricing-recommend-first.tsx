import Link from "next/link";

import {
  PlanChoiceLead,
  PlanPickerRecommendFirst,
  RECOMMENDED,
  capSummary,
  perDayYen,
} from "@/components/billing/plan-picker-recommend-first";
import { RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * LP `#pricing` の料金「推奨先行」（T-M8-419）。組み立て（キャップ行・カード・帯・CSS module）は
 * `/plans` と共用の `PlanPickerRecommendFirst`（billing/）へ移した（T-M8-424・運営者の依頼 2026-09-04
 * 「ホームページの料金に /plans も合わせる」）。ここは **LP固有の CTA（`/signup` への Link）を渡す薄い層**
 * だけを持ち、見せ方は共通側で1か所に保つ。
 *
 * - CTA は `lp/pricing.tsx` と同じ形（推奨だけ brand・他は subtle）。`signupHref` は流入元 `?src=` を
 *   引き継いだ `/signup`（T-M8-423。`landing-page.test.ts` が直書きの `/signup` を禁じる）。
 * - `RECOMMENDED`・`PlanChoiceLead`（見出し下の選び方の1文。`/plans` と同文）・`perDayYen`・`capSummary` は
 *   共通側の再export（`page.tsx` と既存テストの参照を保つ）。
 */

/** @param signupHref `/signup`（流入元 `?src=` を引き継いだもの・T-M8-423）。 */
export function PricingRecommendFirst({ signupHref = "/signup" }: { signupHref?: string } = {}) {
  return (
    <PlanPickerRecommendFirst
      cta={(planId, planName) => (
        <Link
          aria-label={`${planName}を7日間無料で試す`}
          className={cn(
            buttonVariants({ variant: planId === RECOMMENDED_PLAN ? "brand" : "subtle" }),
            "h-11 w-full text-sm font-bold",
          )}
          href={signupHref}
        >
          7日間無料で試す
        </Link>
      )}
    />
  );
}

export { PlanChoiceLead, RECOMMENDED, capSummary, perDayYen };
