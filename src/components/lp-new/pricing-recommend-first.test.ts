import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import { perDayYen } from "./pricing-recommend-first";

/**
 * LP `#pricing` の料金（推奨先行）の**LP側**。組み立て（キャップ行・カード・帯・CSS module）は
 * LP と `/plans` の共用部品 `billing/plan-picker-recommend-first` にあり、その契約は
 * `billing/plan-picker-recommend-first.test.ts` が固定する（T-M8-424）。ここは LP 側が
 * **CTA を渡す薄い層のまま**であることだけを見る。
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const LP_TSX = readFileSync(`${HERE}/pricing-recommend-first.tsx`, "utf8");

describe("pricing-recommend-first（LP側の薄い層）", () => {
  it("共用部品を呼び、組み立て（カード・帯・CSS module）を独自に持たない", () => {
    expect(LP_TSX).toContain("PlanPickerRecommendFirst");
    // 組み立てが LP 側にも残ると、/plans と見せ方が再びずれる（T-M8-424 の動機）。
    for (const own of ["PlanPricingCards", "CampaignCallout", "module.css"]) {
      expect(LP_TSX, `${own} は共用部品側だけが持つ`).not.toContain(own);
    }
    // 共用側の関数を再exportする（`page.tsx` と既存の参照を保つ）。
    expect(perDayYen(PLANS.premium)).toBe(Math.ceil(PLANS.premium.monthlyPriceJpy / 30));
  });

  it("server component のまま・出現演出なし・価格の直書きなし・禁止表現なし", () => {
    expect(LP_TSX, "クライアントコンポーネントにしない").not.toContain('"use client"');
    expect(LP_TSX, "出現演出を置かない").not.toMatch(/opacity-0|IntersectionObserver|animation-timeline/);
    for (const plan of Object.values(PLANS)) {
      expect(LP_TSX).not.toContain(String(plan.monthlyPriceJpy));
      expect(LP_TSX).not.toContain(String(perDayYen(plan)));
    }
    const withoutComments = LP_TSX.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(withoutComments, "禁止表現がある").not.toMatch(
      /一瞬で|数秒で|No\.1|導入実績|選ばれています|人気|通常価格/,
    );
    expect(withoutComments, "キャンペーン文言を独自に持つ").not.toMatch(/半額|キャンペーン|RELEASE_CAMPAIGN/);
  });
});
