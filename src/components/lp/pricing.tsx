import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cardClassName, CardTitle } from "@/components/ui/card";
import { yen } from "@/lib/format";
import { PLAN_IDS, PLANS, type PlanDefinition } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * LP 06 料金（design_handoff_space_ai_lp）。価格・プラン名・アカウント数・プレミアムの月間上限は
 * `plans.ts` を正とし、ここに数値を直書きしない（landing-page.test.ts が固定する）。
 * BYOK注記と申込前確認事項は特商法上の要件のため、折りたたまず常時表示する。
 */

/** プランの説明文。数値はプラン定義から埋める（文言はハンドオフREADME §文言と一致させる）。 */
function planFeatureText(plan: PlanDefinition): string {
  if (plan.usageLimits) {
    const limits = plan.usageLimits;
    return (
      "mdプランの全機能。" +
      `月間上限：通常投稿${limits.normalPosts}件／URL付き投稿${limits.urlPosts}件／` +
      `文章生成${limits.generations}回／画像生成${limits.images}枚。`
    );
  }
  return plan.canEditMdAndPrompts
    ? "通常プランの全機能＋ベース.mdファイル・プロンプトの直接編集。"
    : "基本機能すべて（情報収集・投稿生成・スケジュール設定・分析）。";
}

function PlanCard({ plan }: { plan: PlanDefinition }) {
  // BYOKかどうかはアプリ側上限の有無と一致する（plans.ts の定義参照）。
  const byok = plan.usageLimits === null;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          cardClassName,
          "flex h-full flex-col overflow-hidden",
          byok
            ? "transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]"
            : "shadow-[var(--shadow-pop)]",
        )}
      >
        <div
          aria-hidden="true"
          className={cn("h-[3px] flex-none", byok || "[background-image:var(--brand-gradient)]")}
        />
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-center justify-between gap-2.5">
            <CardTitle as="h3">{plan.displayName}</CardTitle>
            {byok || (
              <span className="inline-flex h-[22px] items-center rounded-pill bg-brand-subtle px-2.5 text-caption font-medium text-brand">
                APIキー不要
              </span>
            )}
          </div>
          <p className="mt-2.5 text-body text-ink-2">
            <span className="text-[28px] font-bold tracking-[-0.01em] text-ink">
              {yen(plan.monthlyPriceJpy)}円
            </span>{" "}
            ／月（税込）
          </p>
          <div className="mt-4 grid gap-2 border-t border-hairline pt-3.5 text-body">
            <div className="flex justify-between gap-2.5">
              <span className="text-ink-2">Xアカウント</span>
              <span className="font-medium">{plan.xAccountLimit}件</span>
            </div>
            <div className="flex justify-between gap-2.5">
              <span className="text-ink-2">APIキー</span>
              <span className="font-medium">{byok ? "自分で用意" : "不要"}</span>
            </div>
          </div>
          <p className="mt-3.5 flex-1 text-body text-ink-2">{planFeatureText(plan)}</p>
          <Link
            className={cn(
              buttonVariants({ variant: byok ? "subtle" : "brand" }),
              "mt-4 h-10 text-sm font-bold",
            )}
            href="/signup"
          >
            無料で始める
          </Link>
        </div>
      </div>
    </div>
  );
}

export function PricingCards() {
  return (
    <>
      <div className="mt-[30px] grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] items-stretch gap-3.5">
        {PLAN_IDS.map((planId) => (
          <PlanCard key={planId} plan={PLANS[planId]} />
        ))}
      </div>
      <div className="mt-3.5">
        <div className="rounded-card border border-hairline bg-page px-5 py-4">
          <p className="text-body font-bold">APIキーの費用について</p>
          {/*
            2文目は**特定商取引法11条の「商品代金以外に必要な費用」**そのもの（T-M8-79で復活）。
            月額だけを見せて別途費用に触れないと、実際の負担が月額より大きくなるため省略できない。
          */}
          <p className="mt-1.5 text-body text-ink-2">
            通常プラン・mdプランは「APIキーをご自身でご用意いただく方式」です。月額とは別に、X
            APIと生成AI APIの利用料が各提供元にかかります。プレミアムプランは運営がAPIキーを用意するため、追加の負担はありません。
          </p>
        </div>
      </div>
      <div className="mt-3.5">
        <div className={cn(cardClassName, "px-5 py-4")}>
          <p className="text-body font-bold">お申し込み前にご確認ください</p>
          {/*
            特定商取引法11条の法定表示事項。**「自動更新」と「支払時期」は省略できない**
            （無料期間の後に自動で課金が始まる契約は、申込画面の近くでの明示が要る）。
            解約条件は利用規約第5条・特商法表記と同じ内容にする（食い違うと表示が虚偽になる）。
          */}
          <ul className="mt-2 grid list-disc gap-1 pl-[1.3em] text-caption text-ink-2">
            <li>料金：上記のとおり、すべて税込月額です。</li>
            <li>無料期間：全プラン初回のみ7日間無料。</li>
            <li>
              自動更新：無料期間の終了後、選択したプランで自動的に課金が始まります。期間中に解約すれば料金はかかりません。
            </li>
            <li>支払時期：無料期間の終了時に初回のお支払い。以後は毎月の自動更新です。</li>
            <li>解約方法：設定内のお支払い管理画面から、期間末での解約となります。日割りの返金はありません。</li>
            <li>提供開始：カード登録の完了後、すぐにご利用いただけます。</li>
          </ul>
        </div>
      </div>
    </>
  );
}
