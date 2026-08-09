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
const GLOBALS_CSS = read("src/app/globals.css");
/** コメントを除いたCSS。解説文に書いたセレクタ名を規則と誤認しないため。 */
const CSS_RULES = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const LP_SOURCES = [PAGE, PRICING, HERO_MOCK, FIGURES, FAQ].join("\n");

describe("SC-01 LP: 導線", () => {
  it("会員登録・ログイン・ページ内アンカーへの導線がある", () => {
    expect(PAGE).toContain('href="/signup"');
    expect(PAGE).toContain('href="/login"');
    expect(PRICING).toContain('href="/signup"'); // プランカードのCTA
    for (const anchor of ["#features", "#how", "#pricing"]) {
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
    // 言い回しではなく、開示すべき3点（カード登録が要る／7日間無料／期間中の解約で無料）を見る。
    expect(PAGE, "カード登録が必要な事実が消えている").toMatch(/カード登録が必要/);
    expect(PAGE, "無料期間の長さが消えている").toMatch(/7日間は無料/);
    expect(PAGE, "期間中に解約すれば無料である事実が消えている").toMatch(/期間中に解約すれば料金はかかりません/);
    const usages = PAGE.match(/\{CARD_REGISTRATION_NOTE\}/g) ?? [];
    expect(usages.length, "ヒーローと最終CTAの2箇所で使う").toBeGreaterThanOrEqual(2);
  });

  /**
   * 文言そのものではなく**開示されている事実**を検査する（T-M8-79）。
   * 完全一致で固定すると、言い回しを整えるたびにテストが落ちて「直す＝一致させる」だけになり、
   * 逆に**開示ごと消したときに気付けない**（実際に、簡潔化の過程で下の4項目が一度消えた）。
   */
  it("BYOKの別途費用がプランカード直下に折りたたみなしで開示されている", () => {
    expect(PRICING, "BYOK方式であること").toMatch(/APIキーをご自身でご用意いただく方式/);
    // 特商法11条「商品代金以外に必要な費用」。月額の他に実費がかかる事実。
    expect(PRICING, "月額とは別に費用がかかる事実が消えている").toMatch(/月額とは別に/);
    expect(PRICING, "何の利用料かが消えている").toMatch(/X\s*\n?\s*APIと生成AI\s*API/);
    expect(PRICING, "プレミアムは追加負担なしという対比が消えている").toMatch(/追加の?負担はありません/);
    expect(PRICING, "折りたたみ（details）にしない").not.toContain("<details");
  });

  it("申込前確認事項に特商法11条の法定事項が揃っている", () => {
    for (const item of ["料金：", "無料期間：", "自動更新：", "支払時期：", "解約方法：", "提供開始："]) {
      expect(PRICING, `「${item}」が消えている`).toContain(item);
    }
    // 定期購入規制の中核。無料期間の後に自動で課金が始まることの明示。
    expect(PRICING, "自動課金が始まる事実が消えている").toMatch(/自動的に課金が始まります/);
    // 規約第5条・特商法表記と同じ条件であること（食い違うと表示が虚偽になる）。
    expect(PRICING, "期間末解約であることが消えている").toMatch(/期間末での解約/);
    expect(PRICING, "日割り返金なしが消えている").toMatch(/日割り(の)?返金は(行いません|ありません)/);
  });

  it("無料トライアルが初回限定であることが料金セクションに残る", () => {
    // 「初回のみ」が消えると「無条件で7日間無料」の表示になり、2回目以降の申込みで事実と異なる
    // （景表法の有利誤認・特商法11条）。言い回しは変わりうるので、事実の有無だけを見る。
    expect(PRICING, "初回限定の開示が申込前確認事項から消えている").toMatch(/初回のみ/);
    expect(PRICING, "無料期間の長さが消えている").toMatch(/7日間/);
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

  it("reduced-motion で生成ループの装飾が止まる", () => {
    expect(GLOBALS_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.lp-anim-bar/);
  });

  it("LPの内容を透明にする仕掛けが無い（JSが死んでも白紙にならない）", () => {
    // 当初は IntersectionObserver で初期 opacity:0 を解除する作りで、JSのロード失敗・
    // CSPブロック・JS無効のいずれでも **LPがヘッダーだけの白紙**になった（実測）。
    // 新規登録の唯一の入口が無言で消え、サーバーは200・テストも緑なので運営者は気付けない。
    // 次に animation-timeline: view() へ移したが、画面外を opacity:0 に保つ点は同じだった。
    // 結論として出現演出は廃止し、**LPは常に不透明**にした。二度と戻さないよう固定する。
    // 対象は**内容を持つソース**。ヒーローモック（全体が aria-hidden の装飾）だけは、
    // 「生成中…」⇄「完了」のクロスフェードで opacity を使うので除く。読ませる情報は入っていない。
    const CONTENT_SOURCES = [PAGE, PRICING, FIGURES, FAQ].join("\n");
    expect(CONTENT_SOURCES, "LPの内容を透明にしない").not.toContain("opacity-0");
    expect(LP_SOURCES, "LPをクライアントコンポーネントにしない").not.toContain("use client");
    expect(CSS_RULES, "スクロール連動アニメーションを復活させない").not.toContain(
      "animation-timeline",
    );
    // 残っている装飾アニメ（生成バー・フロート）は情報を隠さないものだけ。
    for (const name of CSS_RULES.match(/@keyframes\s+([\w-]+)/g) ?? []) {
      expect(
        ["@keyframes sai-bar", "@keyframes sai-lbl-a", "@keyframes sai-lbl-b", "@keyframes sai-float"],
        `未知のkeyframes ${name} が増えている。内容を隠さないか確認すること`,
      ).toContain(name);
    }
  });

  it("ヒーローの見出しと固定コピーがハンドオフどおり", () => {
    expect(PAGE).toContain("ネタ探しから投稿、分析まで。");
    expect(PAGE).toContain("X運用の毎日を");
    expect(PAGE).toContain("1日数分の確認から、");
  });

  it("安全性の説明がFAQに残っている（独立セクションを持たないため）", () => {
    // 「04 安全性」を削除し（T-M8-77）、ヒーローのチェック3点も特徴の訴求へ変わった（T-M8-79）。
    // その結果、**安全性の説明はFAQだけがLP上の置き場所**になった。ここが消えると、
    // 「Xアカウントを預けて勝手に投稿されないか」という最大の購入障壁に答える記述がLPから消える。
    expect(FAQ, "勝手に投稿されない説明がLPから消えている").toMatch(/下書きまで/);
    expect(FAQ, "自動投稿に同意が要ることが消えている").toMatch(/同意/);
    expect(FAQ, "自動投稿を止められることが消えている").toMatch(/キャンセル/);
    expect(FAQ, "APIキーの保管方法がLPから消えている").toMatch(/暗号化/);
    expect(FAQ, "末尾4桁のみ表示が消えている").toMatch(/末尾4桁/);
  });
});
