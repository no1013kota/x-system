import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { PLANS } from "@/lib/plans";

import { capSummary, perDayYen } from "./pricing-recommend-first";

/**
 * /new 料金「推奨先行」の外付けスタイルは、共通部品の DOM（`article[aria-labelledby=plan-card-<id>]`・
 * p の並び）に依存する。推奨プランを変えたときに CSS のセレクタだけ取り残されると、強調が黙って別の
 * カードへ移る（あるいは消える）ので、ここで固定する。
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CSS = readFileSync(`${HERE}/pricing-recommend-first.module.css`, "utf8");
const TSX = readFileSync(`${HERE}/pricing-recommend-first.tsx`, "utf8");
const SHARED_CARDS = readFileSync(
  `${HERE}/../billing/plan-pricing-cards.tsx`,
  "utf8",
);

describe("pricing-recommend-first", () => {
  it("CSS のセレクタが RECOMMENDED_PLAN と一致している", () => {
    expect(CSS).toContain(`plan-card-${RECOMMENDED_PLAN}"]`);
    // 他プランの id を推奨として書いていない。
    for (const id of Object.keys(PLANS)) {
      if (id === RECOMMENDED_PLAN) continue;
      expect(CSS).not.toContain(`article[aria-labelledby="plan-card-${id}"] {`);
    }
    // 共通部品側の id 生成式。文字列で照合し、規則が変わったらここで止まる。
    expect(SHARED_CARDS).toContain("const headingId = `plan-card-${planId}`;");
    expect(SHARED_CARDS).toContain("aria-labelledby={headingId}");
  });

  it("SPの縦積みで先頭（order:-1）にするのは RECOMMENDED_PLAN のカード", () => {
    const sp = CSS.slice(CSS.indexOf("@media (max-width: 767px)"));
    expect(sp).toMatch(
      new RegExp(
        `article\\[aria-labelledby="plan-card-${RECOMMENDED_PLAN}"\\]\\s*\\{\\s*order:\\s*-1;`,
      ),
    );
  });

  it("消している「4番目の p」は共通部品の「1日あたり」行（p の並びが変わったらここで止まる）", () => {
    expect(CSS).toContain("> p:nth-of-type(4)");
    const card = SHARED_CARDS.slice(SHARED_CARDS.indexOf("function PlanCard("));
    const before = card.slice(0, card.indexOf("1日あたり 約"));
    expect(before.match(/<p[\s>]/g)?.length).toBe(4);
    // 「おすすめ」バッジは article 直下の最初の span（absolute）。
    expect(card).toMatch(/recommended \? \(\s*\/\/[^\n]*\n\s*<span className="absolute -top-3/);
  });

  it("1日あたりは共通部品と同じ式（切り上げ）", () => {
    for (const plan of Object.values(PLANS)) {
      expect(perDayYen(plan)).toBe(Math.ceil(plan.monthlyPriceJpy / 30));
    }
  });

  it("要約は plans.ts の定義から導く（BYOK／上限あり／無制限）", () => {
    expect(capSummary(PLANS.standard)).toBe("自分のAPIキーで使う（API利用料は別）");
    expect(capSummary(PLANS.premium)).toBe("APIキー不要");
    expect(capSummary(PLANS.expert)).toBe(
      `APIキー不要・無制限・Xアカウント${PLANS.expert.xAccountLimit}件まで`,
    );
  });

  it("server component のまま・出現演出なし・価格の直書きなし・キャンペーン文言を独自に持たない", () => {
    expect(TSX).not.toContain('"use client"');
    expect(TSX).not.toMatch(/opacity-0|IntersectionObserver|animation-timeline/);
    for (const plan of Object.values(PLANS)) {
      expect(TSX).not.toContain(String(plan.monthlyPriceJpy));
      expect(TSX).not.toContain(String(perDayYen(plan)));
      expect(TSX).not.toContain(`Xアカウント${plan.xAccountLimit}件`);
    }
    // 禁止表現（LP共通・景表法）。コメントに「使わない」と書いた語で落ちないよう、画面に出る部分だけを見る。
    const withoutComments = TSX.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(withoutComments).not.toMatch(/一瞬で|数秒で|No\.1|導入実績|選ばれています|人気|通常価格/);
    // 半額・キャンペーンの表示は共通部品（RELEASE_CAMPAIGN.active で出し分け）だけが持つ。
    // /new 側に独自の文言があると、終了時に消し忘れる場所が増える。
    expect(withoutComments).not.toMatch(/半額|キャンペーン|RELEASE_CAMPAIGN/);
  });
});
