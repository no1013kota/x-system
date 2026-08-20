import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { yen } from "@/lib/format";
import { PLAN_COMPARISON_ROWS, comparisonColumns } from "@/lib/plan-comparison";
import { RELEASE_CAMPAIGN, hasCampaignDiscount, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * プランのカード型表示（T-M8-169・運営者の指示 2026-08-21）。`/plans` で使う。
 *
 * 構成は参考ページ（tweethunter.io/pricing）に合わせる: プラン名・1行説明・価格・CTA・
 * Xアカウント数のバンド・「下位プランの全機能＋追加分」のチェックリスト。中央のプレミアムを
 * 推奨として強調する。**T-M8-125の表を `/plans` では置き換える**（LPの料金セクションは表のまま）。
 *
 * ## 数値・可否はここに書かない
 *
 * 機能リストは `PLAN_COMPARISON_ROWS`、価格・上限は `PLANS` から導く。カード化で表と
 * データ源が分かれると（旧カード時代のように）LPと食い違うため、**行の定義は表と共有**する。
 * 「下位プランの全機能」の入れ子が読み取れない問題（T-M8-125の動機）は、**下位と差がある行だけ**
 * を機械的に並べることで避ける——差分は書き写しではなく cell の比較で出す。
 */

/** 推奨プラン。CTAの強調・バッジ表示に使う。 */
export const RECOMMENDED_PLAN: PlanId = "premium";

const PLAN_ICONS: Record<PlanId, IconName> = {
  standard: "key",
  premium: "smart_toy",
  expert: "bolt",
};

/** Xアカウント数はカード内の専用バンドに出すため、チェックリストからは除く。 */
const ACCOUNT_ROW_LABEL = "連携できるXアカウント";

interface FeatureItem {
  label: string;
  /** 文字列セル（件数・上限など）。true のセルは値なし＝チェックのみ。 */
  value?: string;
  note?: string;
}

/**
 * カードに並べる行。先頭プランは対応する全行、2枚目以降は**下位プランと差がある行だけ**
 * （同じものは「◯◯プランの全機能」が受け持つ）。
 */
function featureItemsFor(index: number): FeatureItem[] {
  const columns = comparisonColumns();
  const { plan } = columns[index];
  const prev = index > 0 ? columns[index - 1].plan : null;
  const items: FeatureItem[] = [];
  for (const row of PLAN_COMPARISON_ROWS) {
    if (row.label === ACCOUNT_ROW_LABEL) continue;
    const cell = row.cell(plan);
    if (cell === false) continue;
    if (prev && String(row.cell(prev)) === String(cell)) continue;
    items.push({
      label: row.label,
      note: row.note,
      value: typeof cell === "string" ? cell : undefined,
    });
  }
  return items;
}

function PlanCard({
  planId,
  cta,
}: {
  planId: PlanId;
  cta: ReactNode;
}) {
  const columns = comparisonColumns();
  const index = columns.findIndex((column) => column.id === planId);
  const { plan } = columns[index];
  const recommended = planId === RECOMMENDED_PLAN;
  const items = featureItemsFor(index);
  const headingId = `plan-card-${planId}`;

  return (
    <Card
      aria-labelledby={headingId}
      as="article"
      className={cn(
        "relative flex flex-col p-5 sm:p-6",
        recommended && "border-brand ring-1 ring-brand",
      )}
    >
      {recommended ? (
        // 「選ばれています」等の実績表現は使わない（根拠となる販売実績が無い・景表法）。
        <span className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="px-3 py-1 shadow-[var(--shadow-card)]" tone="brand">
            おすすめ
          </Badge>
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 items-center justify-center rounded-lg bg-brand-subtle text-brand"
        >
          <Icon name={PLAN_ICONS[planId]} size={22} />
        </span>
        {hasCampaignDiscount(plan) ? (
          <Badge tone="danger">{RELEASE_CAMPAIGN.badge}</Badge>
        ) : null}
      </div>

      <h3 className="mt-3 text-[17px] font-bold text-ink" id={headingId}>
        {plan.displayName}
      </h3>
      <p className="mt-1 min-h-[2.6em] text-caption leading-[1.65] text-ink-2">{plan.tagline}</p>

      <p className="mt-3">
        <span className="text-[32px] font-extrabold tracking-tight tabular-nums text-ink">
          ¥{yen(plan.monthlyPriceJpy)}
        </span>
        <span className="ml-1 text-caption text-ink-3">／月（税込）</span>
      </p>
      {hasCampaignDiscount(plan) ? (
        // 「通常価格」とは書かない（販売実績が無い・plans.ts の RELEASE_CAMPAIGN 参照）。
        <p className="mt-0.5 text-caption text-ink-3">
          {RELEASE_CAMPAIGN.afterLabel}{" "}
          <span className="line-through">¥{yen(plan.regularPriceJpy)}</span>
        </p>
      ) : null}

      <div className="mt-4">{cta}</div>

      <p className="mt-4 rounded-lg border border-hairline bg-brand-subtle px-3 py-2 text-center text-caption font-bold text-ink">
        Xアカウント {plan.xAccountLimit}件{plan.xAccountLimit > 1 ? "まで" : ""}を連携
        {plan.xAccountLimit > 1 ? (
          <span className="font-medium text-ink-2">（利用枠は合算）</span>
        ) : null}
      </p>

      <p className="mt-5 text-caption font-bold tracking-wide text-ink-3">
        {index === 0 ? "含まれる機能" : `${columns[index - 1].plan.displayName}の全機能に加えて`}
      </p>
      <ul className="mt-2.5 space-y-2.5">
        {items.map((item) => (
          <li className="flex items-start gap-2" key={item.label}>
            <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-brand" name="check" size={16} />
            <span className="text-body leading-[1.55] text-ink">
              {item.label}
              {/* 値は「ラベル：値」で1文として読める形にする（別行だと主述が切れる）。 */}
              {item.value ? <span className="text-ink-2">：{item.value}</span> : null}
              {item.note ? (
                <span className="mt-0.5 block text-caption text-ink-3">{item.note}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * 3枚のプランカード。CTAは置き場所ごとに違う（`/plans`=Checkout、LPなら/signupリンク）ため、
 * 呼び出し側が `cta` で差し込む。
 */
export function PlanPricingCards({
  cta,
}: {
  cta: (planId: PlanId, planName: string) => ReactNode;
}) {
  return (
    <div className="grid items-start gap-4 pt-3 md:grid-cols-3">
      {comparisonColumns().map(({ id, plan }) => (
        <PlanCard cta={cta(id, plan.displayName)} key={id} planId={id} />
      ))}
    </div>
  );
}
