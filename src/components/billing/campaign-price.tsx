import { yen } from "@/lib/format";
import { RELEASE_CAMPAIGN, hasCampaignDiscount, type PlanDefinition } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * キャンペーン価格の見せ方（T-M8-122）。
 *
 * LPと `/plans` で**バッジ＋価格＋取り消し線**を別々に組み立てていた。文言の決まり
 * （「通常価格」と書かない）を守る場所が2つに分かれていて、片方だけ直す事故が起きる形だった。
 * `landing-page.test.ts` はLPしか見ていないので、`/plans` 側は素通りしていた。
 *
 * **なぜ「通常価格」と書かないか**は `lib/plans.ts` の `RELEASE_CAMPAIGN` にある（景品表示法の
 * 二重価格表示。実際にその価格で相当期間販売した実績が無いため、将来価格として示す）。
 */

/** キャンペーン中だけ出るバッジ。割引が無いプランでは何も描かない。 */
export function CampaignBadge({ plan, className }: { plan: PlanDefinition; className?: string }) {
  if (!hasCampaignDiscount(plan)) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-fit items-center rounded-pill bg-danger-subtle px-2.5 text-caption font-bold text-danger-fg",
        className,
      )}
    >
      {RELEASE_CAMPAIGN.badge}
    </span>
  );
}

/**
 * 終了後の価格（取り消し線）。割引が無いプランでは何も描かない。
 *
 * `currency` で通貨の出し方を切り替える: LPは「1,000円」、`/plans` は「¥1,000」。
 * どちらも既存の表記に合わせるためで、意味は同じ。
 */
export function CampaignAfterPrice({
  plan,
  className,
  currency = "suffix",
}: {
  plan: PlanDefinition;
  className?: string;
  currency?: "suffix" | "prefix";
}) {
  if (!hasCampaignDiscount(plan)) return null;
  const amount = yen(plan.regularPriceJpy);
  return (
    <p className={cn("text-caption text-ink-3", className)}>
      {RELEASE_CAMPAIGN.afterLabel}{" "}
      <span className="line-through">
        {currency === "prefix" ? `¥${amount}` : `${amount}円`}
      </span>
      ／月
    </p>
  );
}
