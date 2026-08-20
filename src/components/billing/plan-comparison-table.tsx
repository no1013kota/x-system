import { Icon } from "@/components/ui/icon";
import { yen } from "@/lib/format";
import { PLAN_COMPARISON_ROWS, comparisonColumns, type PlanCell } from "@/lib/plan-comparison";
import { RELEASE_CAMPAIGN, hasCampaignDiscount } from "@/lib/plans";

/**
 * プラン比較表（T-M8-125）。LPの料金セクションで使う（`/plans` はT-M8-169でカード型
 * `PlanPricingCards` へ置き換えた。**行・可否のデータ源 `lib/plan-comparison.ts` は両者で共通**）。
 *
 * **機能を行見出しにして、各プランに ✓ / − を付ける**（運営者の指示）。以前はプランごとの
 * 箇条書きカードで「mdプランの全機能」という入れ子の言い方をしていたため、
 * 上位プランに何が積まれるのかが読み取れなかった。
 *
 * 行と可否は `lib/plan-comparison.ts` が持つ（画面に ✓ / − を書き写さない）。
 */

/** ✓ は色だけに頼らず記号でも分かるようにする（WCAG: 色以外の手がかり）。 */
function Cell({ value }: { value: PlanCell }) {
  if (value === true) {
    return (
      <>
        <Icon aria-hidden="true" className="text-brand" name="check" size={18} />
        <span className="sr-only">対応</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <span aria-hidden="true" className="text-ink-3">
          —
        </span>
        <span className="sr-only">対応しません</span>
      </>
    );
  }
  return <span className="text-body text-ink">{value}</span>;
}

export function PlanComparisonTable() {
  const columns = comparisonColumns();
  return (
    // 表は幅が足りないと横に伸びる。**自分の中でスクロールさせる**（ページ全体を横に伸ばさない）。
    // `relative` が要るのは、中の `sr-only`（position:absolute）が外へ逃げないようにするため
    // （T-M8-60でLPの比較表がスマホ幅を183px横スクロールさせた原因と同じ）。
    <div className="relative mt-6 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <caption className="sr-only">プランごとの機能と月額の比較</caption>
        <thead>
          <tr className="border-b border-hairline">
            <th className="py-3 pr-4 align-bottom text-caption font-medium text-ink-3" scope="col">
              機能
            </th>
            {columns.map(({ id, plan }) => (
              <th className="px-3 py-3 align-bottom" key={id} scope="col">
                <span className="block text-body font-bold text-ink">{plan.displayName}</span>
                {hasCampaignDiscount(plan) ? (
                  <span className="mt-1 block text-caption font-bold text-danger-fg">
                    {RELEASE_CAMPAIGN.badge}
                  </span>
                ) : null}
                <span className="mt-0.5 block">
                  <span className="text-[22px] font-extrabold tabular-nums text-ink">
                    ¥{yen(plan.monthlyPriceJpy)}
                  </span>
                  <span className="text-caption text-ink-3">／月（税込）</span>
                </span>
                {hasCampaignDiscount(plan) ? (
                  <span className="block text-caption text-ink-3">
                    {RELEASE_CAMPAIGN.afterLabel}{" "}
                    <span className="line-through">¥{yen(plan.regularPriceJpy)}</span>
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLAN_COMPARISON_ROWS.map((row) => (
            <tr className="border-b border-hairline last:border-0" key={row.label}>
              <th className="py-3 pr-4 align-top font-normal" scope="row">
                <span className="block text-body text-ink">{row.label}</span>
                {row.note ? (
                  <span className="mt-0.5 block text-caption text-ink-3">{row.note}</span>
                ) : null}
              </th>
              {columns.map(({ id, plan }) => (
                <td className="px-3 py-3 align-top text-caption" key={id}>
                  <Cell value={row.cell(plan)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
