import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * SC-01 LP（T-M8-74, design_handoff_space_ai_lp）の構造検査。
 *
 * LPは静的な1ページだが、法令・仕様上の固定要件が多い（カード登録注記・BYOK注記・禁止表現・
 * グラデーションの使用箇所制限・価格の plans.ts 一元化）。これらは見た目のテストでは守れず、
 * コピー修正のついでに黙って壊れやすいので、legal-pages.test.ts と同じソース検査で固定する。
 * 導線の実動作（クリック・スクロール・出現）は e2e/landing.spec.ts が見る。
 */

const ROOT = new URL("../../", import.meta.url);

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");
}

const PAGE = read("src/app/page.tsx");
const PRICING = read("src/components/lp/pricing.tsx");
const HERO_MOCK = read("src/components/lp/hero-mock.tsx");
const FIGURES = read("src/components/lp/figures.tsx");
const FAQ = read("src/components/lp/faq.tsx");
const REVEAL = read("src/components/lp/reveal.tsx");
const GLOBALS_CSS = read("src/app/globals.css");
const LP_SOURCES = [PAGE, PRICING, HERO_MOCK, FIGURES, FAQ, REVEAL].join("\n");

describe("SC-01 LP: 導線", () => {
  it("会員登録・ログイン・ページ内アンカーへの導線がある", () => {
    expect(PAGE).toContain('href="/signup"');
    expect(PAGE).toContain('href="/login"');
    expect(PRICING).toContain('href="/signup"'); // プランカードのCTA
    for (const anchor of ["#features", "#how", "#safety", "#pricing"]) {
      expect(PAGE, `ヘッダーnavに ${anchor} がある`).toContain(`"${anchor}"`);
      expect(PAGE, `セクションに id=${anchor.slice(1)} がある`).toContain(
        `id="${anchor.slice(1)}"`,
      );
    }
  });

  it("法務3リンクは LegalFooterLinks 経由で出す（URLを直書きしない）", () => {
    expect(PAGE).toContain("LegalFooterLinks");
    expect(PAGE).not.toContain("/terms");
    expect(PAGE).not.toContain("/privacy");
  });
});

describe("SC-01 LP: 法令・仕様上の固定文言", () => {
  it("主CTA直下のカード登録注記が2箇所（ヒーロー・最終CTA）にある", () => {
    expect(PAGE).toContain(
      "開始にはカード登録が必要です（7日間は無料。期間中の解約で料金はかかりません）。",
    );
    const usages = PAGE.match(/\{CARD_REGISTRATION_NOTE\}/g) ?? [];
    expect(usages.length, "ヒーローと最終CTAの2箇所で使う").toBeGreaterThanOrEqual(2);
  });

  it("BYOK注記がプランカード直下に折りたたみなしで表示される", () => {
    expect(PRICING).toContain(
      "通常プラン・mdプランは「APIキーをご自身でご用意いただく方式（BYOK）」です。",
    );
    expect(PRICING).toContain("プレミアムプランは運営がAPIキーを用意するため、追加負担はありません。");
    expect(PRICING, "折りたたみ（details）にしない").not.toContain("<details");
  });

  it("申込前確認事項6項目（特商法の再掲）がある", () => {
    for (const item of ["料金：", "無料期間：", "自動更新：", "支払時期：", "解約方法：", "提供開始："]) {
      expect(PRICING).toContain(item);
    }
  });

  it("無料トライアルの条件（7日間・初回のみ）を料金セクションで明示する", () => {
    expect(PAGE).toContain("全プラン7日間の無料トライアル付き（初回のみ）。");
  });
});

describe("SC-01 LP: 価格・上限は plans.ts を正とする", () => {
  it("プランの数値を参照で埋める（直書きしない）", () => {
    expect(PRICING).toContain("PLANS");
    expect(PRICING).toContain("monthlyPriceJpy");
    expect(PRICING).toContain("xAccountLimit");
    expect(PRICING).toContain("usageLimits");
  });

  it("価格・プレミアム上限の数値がLPソースに直書きされていない", () => {
    for (const literal of ["2,980", "2980", "1,000円", "500円", "通常投稿200件", "画像生成20枚"]) {
      expect(LP_SOURCES, `${literal} は plans.ts から埋める`).not.toContain(literal);
    }
  });
});

describe("SC-01 LP: 禁止表現（ハンドオフREADME §禁止表現）", () => {
  it("実装が事実と異なる主張・保証表現を含まない", () => {
    for (const banned of [
      "6分野",
      "6種類",
      "一瞬で",
      "数秒で",
      "No.1",
      "導入実績",
      "利用者の声",
      "LINE通知",
      "動画生成",
      "承認ワークフロー",
      "連携するだけで自動投稿",
    ]) {
      expect(LP_SOURCES, `「${banned}」は使用禁止`).not.toContain(banned);
    }
  });
});

describe("SC-01 LP: デザイン制約", () => {
  it("ブランドグラデーションは規定の5箇所だけ（ロゴはLogoTile側なので数えない）", () => {
    // 生成中バー2本（ヒーローモック・しくみSTEP3）＋上端3pxバー3本（「投稿の生成」カード・
    // STEP3カード・プレミアムプランカード）。ハンドオフREADME §デザイントークン の規定どおり。
    const direct = LP_SOURCES.match(/var\(--brand-gradient\)/g) ?? [];
    expect(direct.length).toBe(5);
  });

  it("reduced-motion で出現アニメと生成ループが止まる", () => {
    expect(REVEAL).toContain("motion-reduce:opacity-100");
    expect(REVEAL).toContain("motion-reduce:transition-none");
    expect(GLOBALS_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(GLOBALS_CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.lp-anim-bar/,
    );
  });

  it("ヒーローの見出しと固定コピーがハンドオフどおり", () => {
    expect(PAGE).toContain("ネタ探しから投稿、分析まで。");
    expect(PAGE).toContain("X運用の毎日を");
    expect(PAGE).toContain("勝手には、投稿しません。");
    expect(PAGE).toContain("1日数分の確認から、");
  });
});
