import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { PLANS } from "@/lib/plans";

import { capSummary, perDayYen } from "./plan-picker-recommend-first";

/**
 * 料金「推奨先行」の共用部品（LP `#pricing` と `/plans`・T-M8-424）の契約を固定する。
 *
 * 外付けスタイル（CSS module）は共通部品 `PlanPricingCards` の DOM（`article[aria-labelledby=plan-card-<id>]`・
 * p の並び）に依存する。推奨プランを変えたときに CSS のセレクタだけ取り残されると、強調が黙って別の
 * カードへ移る（あるいは消える）ので、ここで固定する。
 *
 * テストは共用部品と同じディレクトリに置く（T-M8-424 のレビュー: `lp-new/` に残すと billing/ 側だけを
 * 読む人から守りが見えず、旧LP部品の整理〔D-53〕で一緒に消える）。LP側の薄い層の検査は
 * `lp-new/pricing-recommend-first.test.ts`。
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const CSS = readFileSync(`${HERE}/plan-picker-recommend-first.module.css`, "utf8");
const SHARED_TSX = readFileSync(`${HERE}/plan-picker-recommend-first.tsx`, "utf8");
const SHARED_CARDS = readFileSync(`${HERE}/plan-pricing-cards.tsx`, "utf8");
/** 選び方の1文を呼ぶ2画面。 */
const LP_PAGE = readFileSync(`${HERE}/../../app/page.tsx`, "utf8");
const PLANS_PAGE = readFileSync(`${HERE}/../../app/plans/page.tsx`, "utf8");

/** 画面に出る部分だけ（コメントに「使わない」と書いた語で落ちないように）。 */
const withoutComments = (tsx: string) =>
  tsx.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, "");

describe("plan-picker-recommend-first（LP・/plans 共用）", () => {
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

  it("組み立て（カード・帯）を持ち、帯へ trialAvailable を渡す", () => {
    expect(SHARED_TSX).toContain("<PlanPricingCards");
    expect(SHARED_TSX).toContain("<CampaignCallout");
    // 帯へ trialAvailable を渡す（/plans で消化済みの利用者に「7日間無料」を出さないための最後の砦）。
    expect(SHARED_TSX).toMatch(/<CampaignCallout[^>]*trialAvailable=\{trialAvailable\}/);
  });

  /**
   * 選び方の1文（`PlanChoiceLead`）は LP と `/plans` で同文（要件06 §1.1）。両ページへ書き写さず
   * 共用部品を呼ぶ（片方だけ直されて再びずれるのを防ぐ・T-M8-424 のレビュー）。
   * 末尾の「はじめての方は7日間無料（カード登録が必要）です。」は**最初のCTAより上にある唯一の条件**
   * なので、共用側に実文があり、`/plans` はトライアル消化済み・残りトライアル中の人に出さない。
   */
  it("選び方の1文は共用部品にだけ実文があり、LP と /plans はそれを呼ぶ", () => {
    const rendered = withoutComments(SHARED_TSX);
    expect(rendered).toContain("なら、APIキー（AIとX連携に使う鍵）の用意がいりません。");
    expect(rendered).toContain("はじめての方は7日間無料（カード登録が必要）です。");
    for (const [name, page] of [
      ["LP", LP_PAGE],
      ["/plans", PLANS_PAGE],
    ] as const) {
      expect(page, `${name} が PlanChoiceLead を呼ぶ`).toMatch(/<PlanChoiceLead[\s/>]/);
      expect(withoutComments(page), `${name} に選び方の1文を書き写さない`).not.toContain(
        "APIキー（AIとX連携に使う鍵）",
      );
      expect(withoutComments(page), `${name} にカード登録の1文を書き写さない`).not.toContain(
        "はじめての方は7日間無料（カード登録が必要）です。",
      );
    }
    // /plans は消化済み・残りトライアル中に出さない（LPは未ログインなので常に出す）。
    expect(PLANS_PAGE).toMatch(/<PlanChoiceLead trialNote=\{trialAvailable && !trialLabel\}/);
  });

  it("server component のまま・出現演出なし・価格の直書きなし・キャンペーン文言を独自に持たない", () => {
    expect(SHARED_TSX, "クライアントコンポーネントにしない").not.toContain('"use client"');
    expect(SHARED_TSX, "出現演出を置かない").not.toMatch(
      /opacity-0|IntersectionObserver|animation-timeline/,
    );
    for (const plan of Object.values(PLANS)) {
      expect(SHARED_TSX).not.toContain(String(plan.monthlyPriceJpy));
      expect(SHARED_TSX).not.toContain(String(perDayYen(plan)));
      expect(SHARED_TSX).not.toContain(`Xアカウント${plan.xAccountLimit}件`);
      // プラン名は PLANS から（直書きすると改名で片方だけ古くなる）。
      expect(withoutComments(SHARED_TSX)).not.toContain(plan.displayName);
    }
    const rendered = withoutComments(SHARED_TSX);
    // 禁止表現（LP共通・景表法）。
    expect(rendered, "禁止表現がある").not.toMatch(
      /一瞬で|数秒で|No\.1|導入実績|選ばれています|人気|通常価格/,
    );
    // 半額・キャンペーンの表示は共通部品（RELEASE_CAMPAIGN.active で出し分け）だけが持つ。
    // 組み立て側に独自の文言があると、終了時に消し忘れる場所が増える。
    expect(rendered, "キャンペーン文言を独自に持つ").not.toMatch(/半額|キャンペーン|RELEASE_CAMPAIGN/);
  });
});
