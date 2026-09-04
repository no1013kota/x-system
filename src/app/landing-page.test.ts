import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HERO_STEP_LABELS } from "@/components/lp-new/hero-diagram";
import { LOOP_NODE_LABELS } from "@/components/lp-new/loop-board";
import { TOUR_STOP_TITLES } from "@/components/lp-new/tour";
import { OPERATOR_X_URL } from "@/lib/app-config";
import { RELEASE_CAMPAIGN } from "@/lib/plans";

/**
 * SC-01 LP（T-M8-74, design_handoff_lp → T-M8-419/420 で「AIクローン」LPへ全面刷新）の構造検査。
 *
 * 2026-09-04（T-M8-420）、`/new` で先行公開していた新LPを `/` へ昇格し、旧LPは `/old`（noindex・
 * 比較用）へ退避した。ここで検査するのは **`/`（新LP）だけ**。旧LPの部品 `src/components/lp/`
 * は共有部品（スクショ枠）を新LPも使うため走査に含めるが、旧LP固有の規則（グラデの枚数など）は外した。
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
/**
 * **キャンペーン価格を実際に描いている画面を見る**（T-M8-137）。
 *
 * 以前は共通部品 `campaign-price.tsx` を読んでいたが、T-M8-125 で比較表へ寄せた結果
 * **その部品はどこからも import されなくなり、この検査は誰も描かないファイルを見ていた**
 * （設定＞課金は自前で描いているのに、規則が当たっていなかった）。部品は削除し、
 * 検査は「実際に `regularPriceJpy` を描く画面」へ向ける。
 */
const SETTINGS_BILLING = read("src/app/app/settings/page.tsx");
/** プランカード（T-M8-171）。LPと /plans で共通。行と可否の定義は `plan-comparison.ts`。 */
const PRICING_CARDS = read("src/components/billing/plan-pricing-cards.tsx");
/**
 * プロモ帯（T-M8-171）。「カード登録が必要」「期間中に解約すれば無料」の常時表示。
 * **「初回のみ」は 2026-08-26 に帯から外した**（T-M8-321・運営者の最終レビュー）——初回限りの開示は FAQ・特商法ページが担う。
 */
const CAMPAIGN_CALLOUT = read("src/components/billing/campaign-callout.tsx");
const COMPARISON = read("src/lib/plan-comparison.ts");
const GLOBALS_CSS = read("src/app/globals.css");
/** コメントを除いたCSS。解説文に書いたセレクタ名を規則と誤認しないため。 */
const CSS_RULES = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * LPを構成するファイル。**ディレクトリを走査する**（R35）。
 *
 * 以前はファイル名の手書き列挙だったため、`src/components/lp/` へコンポーネントを足すと
 * 禁止表現・価格の直書き・`opacity-0`・`use client` の検査が**全部すり抜けた**
 * （列挙への追記が人の記憶に依存する・CLAUDE.md 原則3）。
 *
 * 新LP（T-M8-420）は `src/components/lp-new/` が本体で、`src/components/lp/` からはスクショ枠
 * （`screenshot.tsx`）だけを共有する。両方を走査する（`lp/` の残りは `/old` 専用）。
 */
const LP_DIRS = ["src/components/lp/", "src/components/lp-new/"] as const;
const LP_SOURCE_BY_FILE = new Map(
  LP_DIRS.flatMap((dir) =>
    readdirSync(fileURLToPath(new URL(dir, ROOT)))
      .filter((name) => name.endsWith(".tsx"))
      .sort()
      .map((name) => [`${dir}${name}` as string, read(`${dir}${name}`)] as const),
  ),
);
const LP_FILES = [...LP_SOURCE_BY_FILE.keys()];
const LP_SOURCES = [PAGE, ...LP_SOURCE_BY_FILE.values()].join("\n");
/** 新LPを描くソースだけ（旧LP専用の部品を除く）。新LP固有の規則はこちらで見る。 */
const NEW_LP_SOURCES = [
  PAGE,
  ...[...LP_SOURCE_BY_FILE.entries()]
    .filter(([path]) => path.startsWith("src/components/lp-new/"))
    .map(([, source]) => source),
].join("\n");

/** 個別に見たいファイル（無ければ即座に落として、名前の変更に気付けるようにする）。 */
function lpFile(path: string): string {
  const source = LP_SOURCE_BY_FILE.get(path);
  if (!source) {
    throw new Error(`${path} が見つかりません（改名したら検査も直す）`);
  }
  return source;
}

const FAQ = lpFile("src/components/lp-new/faq.tsx");
/** 新LPの料金（推奨先行）のLP側。`/signup` への CTA を渡す薄い層（T-M8-419 → T-M8-424 で組み立てを共用へ）。 */
const PRICING = lpFile("src/components/lp-new/pricing-recommend-first.tsx");
/**
 * 料金「推奨先行」の組み立て（キャップ行＋`PlanPricingCards`＋`CampaignCallout`）。LP と `/plans` で
 * 共用（T-M8-424）。**LP側だけを見ていると、部品へ切り出したときに検査が空振りする**ので、
 * 帯・カードの使用はこちらで見る。
 */
const PLAN_PICKER = read("src/components/billing/plan-picker-recommend-first.tsx");

/**
 * **利用者に見える回答だけを検査対象にする**（2026-08-24）。
 *
 * これまで `FAQ`（ファイル全文）へ `toMatch` していたため、**回答から文が消えても
 * 冒頭のコメントに同じ語が残っていれば緑のまま**だった。実際に「暗号化」「末尾4桁」
 * 「キャンセル」が回答から消えたのにテストは通っていた——守っているつもりで守れていない。
 * 文字列リテラルだけを集めて、画面に出る文言で判定する。
 */
const FAQ_ANSWERS = (() => {
  const body = FAQ.slice(FAQ.indexOf("const FAQ_ITEMS"));
  const literals = body.match(/(["`])(?:\\.|(?!\1)[\s\S])*\1/g) ?? [];
  return literals.join("\n");
})();

describe("SC-01 LP: 導線", () => {
  it("会員登録・ログイン・ページ内アンカーへの導線がある", () => {
    // /signup へのCTAは流入元 `?src=` を引き継ぐため `signupHref`（T-M8-423）。直書きが戻ると引き継ぎが切れる。
    expect(PAGE).toContain('withTrafficSource("/signup", source)');
    expect(PAGE).toContain("href={signupHref}");
    expect(PAGE).not.toContain('href="/signup"');
    expect(PAGE).toContain('href="/login"');
    expect(PRICING).toContain("href={signupHref}"); // プランカードのCTA
    for (const anchor of ["#loop", "#tour", "#pricing", "#faq"]) {
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

  /**
   * フッタの運営者Xアカウント（T-M8-183）。URLは `app-config.ts` だけが持ち、
   * 画面は定数を参照する（直書きすると変えたとき片方だけ古くなる）。
   * 新しいタブで開く外部リンクなので rel="noopener noreferrer" と読み上げラベルを必須にする。
   */
  it("フッタに運営者のXアカウントへのリンクがある（URLは app-config の定数経由・新しいタブ・ラベル付き）", () => {
    expect(OPERATOR_X_URL).toBe("https://x.com/ai_newinfo");
    expect(PAGE).toContain("href={OPERATOR_X_URL}");
    expect(PAGE, "x.com のURLを画面へ直書きしない").not.toMatch(/https:\/\/x\.com\//);
    const anchor = PAGE.match(/<a\s[^>]*href=\{OPERATOR_X_URL\}[^>]*>/)?.[0];
    expect(anchor, "OPERATOR_X_URL を href に持つ <a> がある").toBeTruthy();
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
    expect(anchor).toMatch(/aria-label=/);
    expect(PAGE).toContain("<XLogo");
  });
});

describe("SC-01 LP: 法令・仕様上の固定文言", () => {
  it("主CTAの近くに開示3点（カード登録・7日間無料・期間中の解約）が載っている", () => {
    /*
     * 言い回しではなく**開示すべき3点が載っていること**を見る（T-M8-79）。
     * 2026-08-23、運営者がCTA直下の注記を訴求文へ差し替えたため、**開示の置き場所は
     * プロモ帯（CampaignCallout）**になった。LPは page.tsx と帯の合成で描かれるので、
     * 検査も合成で見る（どちらかに載っていればよい。両方から消えたら落ちる）。
     */
    // 見出し下の1文は運営者の指示（2026-09-04・D-56）で無くなり、開示はカード下の帯（CampaignCallout）に集約。
    const lp = PAGE + PLAN_PICKER + CAMPAIGN_CALLOUT;
    expect(lp, "カード登録が必要な事実が消えている").toMatch(/カード登録が必要/);
    expect(lp, "無料期間の長さが消えている").toMatch(/7日間(は|の)無料/);
    expect(lp, "期間中に解約すれば無料である事実が消えている").toMatch(
      /期間中に解約すれば料金はかかりません/,
    );
    // CTA直下の注記（`TRIAL_NOTE`）は CtaRow（ヒーロー・画面ツアー直後）と最終CTAに残す。
    const usages = PAGE.match(/\{TRIAL_NOTE\}/g) ?? [];
    expect(usages.length, "CtaRow と最終CTAの2箇所で使う").toBeGreaterThanOrEqual(2);
  });

  /**
   * 文言そのものではなく**その情報が載っていること**を検査する（T-M8-79）。
   * 完全一致で固定すると、言い回しを整えるたびに落ちて「直す＝一致させる」だけの作業になる。
   *
   * どこまで書くかは運営者の判断（2026-08-10、簡潔さを優先して短縮する方針を確認）。
   * ここでは**カードそのものが消えないこと**だけを守る。詳細な法定事項は
   * `/legal/commercial-transactions` と利用規約が担い、`legal-pages.test.ts` が検査する。
   */
  /**
   * BYOK（スタンダード）のAPI実費の開示（T-M8-171で注意書きカードを畳んだ・運営者の決定
   * 2026-08-21）。**常時表示の置き場所はカードの「APIキーの用意」行だけ**になったので、
   * 行定義から消えると LP・/plans の両方から開示が消える。
   */
  it("BYOKのAPI実費の開示がプラン行定義に残る", () => {
    // カードの行の括弧書き「（利用料はご自身のAPI課金）」は運営者の指示（2026-09-04）で削除。常時表示はキャップ要約だけ。
    expect(PLAN_PICKER, "BYOKのAPI実費の開示が消えている").toMatch(/API利用料は別/);
    // FAQも折りたたまない（2026-08-20 運営者の指示。LPで最も読まれるべき内容を隠していた）。
    expect(FAQ, "FAQを折りたたみ（details）へ戻さない").not.toContain("<details");
  });

  it("無料トライアルの条件（カード登録・期間中の解約）がプロモ帯に、初回限定の開示がFAQに残る", () => {
    /*
     * 「初回のみ」が消えると「無条件で7日間無料」の表示になり、2回目以降の申込みで事実と異なる
     * （景表法の有利誤認・特商法11条）。**帯からは 2026-08-26 に外した**（T-M8-321・運営者の最終レビュー）ので、
     * 初回限りの開示は FAQ（「はじめてのお申し込みに限り」）と特商法ページが担う。
     * 以前はこのテストが帯のソース全文へ `/初回のみ/` を当てていたため、**コメントに残った語だけで緑**になっていた
     * （T-M8-424 のレビュー）。画面に出る文字列だけを見る。
     */
    const rendered = CAMPAIGN_CALLOUT.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(rendered, "無料期間の長さが消えている").toMatch(/7日間/);
    expect(rendered, "カード登録が必要な事実が消えている").toMatch(/カード登録が必要/);
    expect(rendered, "期間中に解約すれば無料である事実が消えている").toMatch(/期間中に解約すれば料金はかかりません/);
    expect(FAQ_ANSWERS, "初回限定の開示がFAQから消えている").toMatch(/はじめてのお申し込みに限り/);
    // LPは共用の組み立て（`PlanPickerRecommendFirst`）を呼び、その組み立てが帯を出す（T-M8-424）。
    expect(PRICING, "LPの料金セクションが共用の組み立てを使っていない").toContain(
      "PlanPickerRecommendFirst",
    );
    expect(PLAN_PICKER, "料金の組み立てがプロモ帯を使っていない").toContain("CampaignCallout");
  });
});

describe("SC-01 LP: 価格・上限は plans.ts を正とする", () => {
  it("プランの数値を参照で埋める（直書きしない）", () => {
    // T-M8-171でLPも/plansと同じプランカードにした。**数値を持つ場所を見る**——LP側だけを
    // 見ていると、部品へ切り出したときに検査が空振りする（R39と同じ形の取りこぼし）。
    expect(PRICING, "LPは共用の組み立てを使う").toContain("PlanPickerRecommendFirst");
    expect(PLAN_PICKER, "組み立ては共通のプランカードを使う").toContain("PlanPricingCards");
    // 行の可否・件数・上限は定義側（`plan-comparison.ts`）が持つ。
    for (const ref of ["PLANS", "xAccountLimit", "usageLimits"]) {
      expect(COMPARISON, `${ref} を定義から引く`).toContain(ref);
    }
    // 価格・1日あたり概算は表示側が定義から引く。
    expect(PRICING_CARDS, "価格を定義から引く").toContain("monthlyPriceJpy");
    expect(PRICING_CARDS, "1日あたりの概算が消えている").toMatch(/1日あたり/);
  });

  it("価格・プレミアム上限の数値がLPソースに直書きされていない", () => {
    // 5,960 / 5960 はキャンペーン終了後の額（T-M8-118）。これも plans.ts から埋める。
    for (const literal of [
      "2,980",
      "2980",
      "5,960",
      "5960",
      "1,000円",
      "500円",
      "通常投稿200件",
      "画像生成20枚",
    ]) {
      expect(LP_SOURCES, `${literal} は plans.ts から埋める`).not.toContain(literal);
    }
  });

  /**
   * キャンペーンの見せ方（T-M8-118）。**「通常価格」と書かない**——景品表示法の
   * 二重価格表示は、通常価格として示すなら実際にその価格で相当期間販売した実績が必要で、
   * この3プランにその実績が無い（`plans.ts` の `RELEASE_CAMPAIGN` 参照）。
   */
  it("取り消し線の価格に「通常価格」と書かず、終了後の価格だと分かる形にする", () => {
    // 表示はLPと /plans で共通の部品（T-M8-122）。**その部品を見る**——LP側だけを見ていると、
    // 部品へ切り出したときに検査が空振りする（実際に一度そうなった）。
    // 設定＞課金は「キャンペーン終了後」の併記を出さない（運営者の指示 2026-08-22。
    // 月額をプラン名の真横に出すだけ）。終了後価格の表示ルールはプランカード側だけに残る。
    expect(PRICING_CARDS).toContain("regularPriceJpy");
    expect(PRICING_CARDS).toContain("RELEASE_CAMPAIGN.afterLabel");
    // 画面に出る文字だけを見る（コメントで理由を書くのは妨げない）。
    const withoutComments = (source: string) =>
      source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, source] of [
      ["プランカード", PRICING_CARDS],
      ["設定＞課金", SETTINGS_BILLING],
      ["LP料金", PRICING],
      ["料金の組み立て（LP・/plans 共用）", PLAN_PICKER],
      ["プロモ帯", CAMPAIGN_CALLOUT],
    ] as const) {
      expect(withoutComments(source), `${name}で「通常価格」は景表法上使えない`).not.toContain(
        "通常価格",
      );
    }
    expect(RELEASE_CAMPAIGN.afterLabel).not.toContain("通常価格");
  });
});

describe("SC-01 LP: 禁止表現（ハンドオフREADME §禁止表現）", () => {
  it("実装が事実と異なる主張・保証表現を含まない", () => {
    for (const banned of [
      // 「6分野」はT-M8-189で事実になった（禁止解除）。逆に旧仕様の「3分野」を禁止する。
      "3分野",
      "6種類",
      "一瞬で",
      "数秒で",
      "No.1",
      "導入実績",
      // 「利用者の声」はT-M8-214で解禁（実在の提携者・本人確認済みコメントのみ可）。
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
  it("走査対象が見つかる（検査そのものが空振りしていない）", () => {
    // ディレクトリ走査にしたので、ファイルが消えたり移動したら気付けるようにする。
    expect(LP_FILES.length).toBeGreaterThan(2);
    expect(LP_SOURCES.length).toBeGreaterThan(5000);
  });

  it("新LPはブランドグラデーションを直接使わない（ロゴは LogoTile 側・T-M8-419）", () => {
    // 新LPの記法は「自動／ボタン1つ／あなた」のチップ3色で、ブランドグラデは使わない
    // （3周目で「作る」のグラデ輪を撤去した。凡例に無い記法は足さない）。
    const direct = NEW_LP_SOURCES.match(/var\(--brand-gradient\)/g) ?? [];
    expect(direct.length).toBe(0);
    // 旧LP部品（hero-mock・figures）の2箇所は /old だけが使う。lp/ を消すときに一緒に消える。
    const legacy = LP_SOURCES.match(/var\(--brand-gradient\)/g) ?? [];
    expect(legacy.length).toBe(2);
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
    //
    // **除外は名前で列挙し、それ以外は自動で対象にする**（R35）。以前は対象側を手書きで
    // 列挙していたため、`src/components/lp/` へファイルを足すと検査から漏れた。
    const DECORATION_ONLY = new Set(["src/components/lp/hero-mock.tsx"]);
    const CONTENT_SOURCES = [
      PAGE,
      ...[...LP_SOURCE_BY_FILE.entries()]
        .filter(([path]) => !DECORATION_ONLY.has(path))
        .map(([, source]) => source),
    ].join("\n");
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

  it("ヒーローの見出しが運営者指定の文言のまま（2026-09-04・T-M8-420 で新LPへ）", () => {
    // 「日々のSNS活動を完全自動化　AIクローン生成プラットフォーム」を4つの span で描く。
    for (const part of ["日々のSNS活動を", "完全自動化", "AIクローン生成", "プラットフォーム"]) {
      expect(PAGE, `H1 の「${part}」が消えている`).toContain(part);
    }
    // 旧LPの見出しへ戻っていない（/old にだけ残る）。
    expect(PAGE).not.toContain("SNS運用プラットフォーム");
  });

  it("安全性の説明がFAQに残っている（独立セクションを持たないため）", () => {
    // 「04 安全性」を削除し（T-M8-77）、ヒーローのチェック3点も特徴の訴求へ変わった（T-M8-79）。
    // 新LPでも「安心3カード」は3周目で削除し FAQ へ集約した（T-M8-419）。
    // その結果、**安全性の説明はFAQだけがLP上の置き場所**になった。ここが消えると、
    // 「Xアカウントを預けて勝手に投稿されないか」という最大の購入障壁に答える記述がLPから消える。
    expect(FAQ_ANSWERS, "勝手に投稿されない説明がLPから消えている").toMatch(/下書きまで/);
    expect(FAQ_ANSWERS, "自動投稿に同意が要ることが消えている").toMatch(/同意/);
    /*
      **ここで守る範囲を狭めた**（運営者の判断 2026-08-24・BACKLOG T-M8-284）。
      「実行待ちの投稿もキャンセルされる」「APIキーは暗号化・末尾4桁のみ表示・削除可」
      「生成物は投稿前に確認」の3点はFAQの書き直しでLPから外した。**テストを緑にするために
      外したのではなく、外すと決めたので検査も外した**——理由と、代わりにどこで担保するか
      （利用規約第7条・特定商取引法に基づく表記・設定画面）はBACKLOGに記録した。
      戻すときはここへ `toMatch` を足し直す。
    */
  });
});

/**
 * 運営者が指定した文言（2026-09-04・T-M8-421）。**画面の文言は他のテストでは守られない**（CLAUDE.md
 * 落とし穴）ので、指定された語をそのまま固定する。H1 は上の「ヒーローの見出し」が担う。
 */
describe("SC-01 LP: 運営者指定の文言（T-M8-421）", () => {
  it("見出し・CTAの文言が指定どおり", () => {
    for (const phrase of [
      "投稿から改善まで",
      "AIモデルも自由に決定",
      "7日間の解放を",
      "お試しください",
      "複数のプロンプトを管理",
    ]) {
      expect(NEW_LP_SOURCES, `「${phrase}」が消えている`).toContain(phrase);
    }
    // 図面板の見出し「手を動かす時間が、3h → 5m に」は句点なし（運営者の指示）。
    expect(PAGE).toMatch(/\{LOOP_TOTALS\.after\} に\s*<\/span>/);
    // 削除した文言が戻っていない。
    for (const removed of ["繰り返す", "実際の管理画面です", "棒の長さ＝", "7日間、実物で"]) {
      expect(NEW_LP_SOURCES.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), `「${removed}」が戻っている`).not.toContain(removed);
    }
  });

  it("工程名はヒーローの帯・図面板のリング図・画面ツアーで同じ語（「改善」）", () => {
    // 3つの配列に別々に書かれているので、片方だけ「反映」に戻ると記法がずれる。
    expect(HERO_STEP_LABELS).toEqual(LOOP_NODE_LABELS);
    for (const title of TOUR_STOP_TITLES) {
      expect(LOOP_NODE_LABELS, `ツアーの停止「${title}」がリング図に無い`).toContain(title);
    }
    expect(LOOP_NODE_LABELS).toContain("改善");
    expect(LOOP_NODE_LABELS).not.toContain("反映");
  });
});
