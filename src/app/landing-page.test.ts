import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OPERATOR_X_URL } from "@/lib/app-config";
import { RELEASE_CAMPAIGN } from "@/lib/plans";

/**
 * SC-01 LP（T-M8-74, design_handoff_lp）の構造検査。
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
/** プロモ帯（T-M8-171）。「初回のみ」「カード登録が必要」の開示はここが唯一の常時表示。 */
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
 */
const LP_DIR = fileURLToPath(new URL("src/components/lp/", ROOT));
const LP_FILES = readdirSync(LP_DIR)
  .filter((name) => name.endsWith(".tsx"))
  .sort();
const LP_SOURCE_BY_FILE = new Map(
  LP_FILES.map((name) => [name, read(`src/components/lp/${name}`)] as const),
);
const LP_SOURCES = [PAGE, ...LP_SOURCE_BY_FILE.values()].join("\n");

/** 個別に見たいファイル（無ければ即座に落として、名前の変更に気付けるようにする）。 */
function lpFile(name: string): string {
  const source = LP_SOURCE_BY_FILE.get(name);
  if (!source) {
    throw new Error(`${name} が src/components/lp/ に見つかりません（改名したら検査も直す）`);
  }
  return source;
}

const FAQ = lpFile("faq.tsx");

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
  it("主CTA直下のカード登録注記が2箇所（ヒーロー・最終CTA）にある", () => {
    // 言い回しではなく、開示すべき3点（カード登録が要る／7日間無料／期間中の解約で無料）を見る。
    expect(PAGE, "カード登録が必要な事実が消えている").toMatch(/カード登録が必要/);
    expect(PAGE, "無料期間の長さが消えている").toMatch(/7日間は無料/);
    expect(PAGE, "期間中に解約すれば無料である事実が消えている").toMatch(/期間中に解約すれば料金はかかりません/);
    const usages = PAGE.match(/\{CARD_REGISTRATION_NOTE\}/g) ?? [];
    expect(usages.length, "ヒーローと最終CTAの2箇所で使う").toBeGreaterThanOrEqual(2);
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
    expect(COMPARISON, "BYOKのAPI実費の開示が消えている").toMatch(/ご自身のAPI課金/);
    // FAQも折りたたまない（2026-08-20 運営者の指示。LPで最も読まれるべき内容を隠していた）。
    expect(FAQ, "FAQを折りたたみ（details）へ戻さない").not.toContain("<details");
  });

  it("無料トライアルの条件（初回のみ・カード登録）がプロモ帯に残る", () => {
    // 「初回のみ」が消えると「無条件で7日間無料」の表示になり、2回目以降の申込みで事実と異なる
    // （景表法の有利誤認・特商法11条）。「カード登録が必要」は無料の条件の開示。
    // T-M8-171で申込前確認カードを畳んだため、**プロモ帯が唯一の常時表示**。
    expect(CAMPAIGN_CALLOUT, "初回限定の開示が消えている").toMatch(/初回のみ/);
    expect(CAMPAIGN_CALLOUT, "無料期間の長さが消えている").toMatch(/7日間/);
    expect(CAMPAIGN_CALLOUT, "カード登録が必要な事実が消えている").toMatch(/カード登録が必要/);
    expect(PRICING, "LPの料金セクションがプロモ帯を使っていない").toContain("CampaignCallout");
  });
});

describe("SC-01 LP: 価格・上限は plans.ts を正とする", () => {
  it("プランの数値を参照で埋める（直書きしない）", () => {
    // T-M8-171でLPも/plansと同じプランカードにした。**数値を持つ場所を見る**——LP側だけを
    // 見ていると、部品へ切り出したときに検査が空振りする（R39と同じ形の取りこぼし）。
    expect(PRICING, "LPは共通のプランカードを使う").toContain("PlanPricingCards");
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
    // 表のヘッダがキャンペーン価格を出す（T-M8-125）。設定＞課金は自前で描くので、
    // **両方が決まりを守っていること**を見る（片方だけ見ると他方が黙って外れる）。
    for (const source of [PRICING_CARDS, SETTINGS_BILLING]) {
      expect(source).toContain("regularPriceJpy");
      expect(source).toContain("RELEASE_CAMPAIGN.afterLabel");
    }
    // 画面に出る文字だけを見る（コメントで理由を書くのは妨げない）。
    const withoutComments = (source: string) =>
      source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, source] of [
      ["プランカード", PRICING_CARDS],
      ["設定＞課金", SETTINGS_BILLING],
      ["LP料金", PRICING],
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

  it("ブランドグラデーションは規定の2箇所だけ（ロゴはLogoTile側なので数えない）", () => {
    // 生成中バー1本（ヒーローモックの「投稿作成」）＋上端3pxバー1本（02の「投稿作成」カード）
    // ＋生成画像のサムネイル1枚（02「投稿・画像の自動作成」の簡易画像・T-M8-201）。
    // 3つとも「AIが作る瞬間・作った物」なのでブランドグラデの意味（デザイン §カラー）に合う。
    const direct = LP_SOURCES.match(/var\(--brand-gradient\)/g) ?? [];
    expect(direct.length).toBe(3);
  });

  /**
   * **出現数だけでは足りない**（R35）。
   *
   * 上端3pxバーと生成中バーは、どちらも1行のJSXを**データ配列のフラグでループ描画**する。
   * そのため2枚目以降のカードへフラグを足しても `var(--brand-gradient)` の出現数は5のままで、
   * **画面上のグラデだけが黙って増える**。フラグの数そのものを数える。
   */
  it("グラデを出すカードの枚数が増えていない（フラグの数を数える）", () => {
    const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;
    // 02できることの「投稿作成」1枚だけ（T-M8-172で03しくみのカード列が無くなった）。
    expect(count(PAGE, /gradientTop: true/g), "上端グラデのカードが増えている").toBe(1);
    expect(count(PAGE, /\bbar: true/g), "生成中バーのカードが増えている").toBe(0);
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
    const DECORATION_ONLY = new Set(["hero-mock.tsx"]);
    const CONTENT_SOURCES = [
      PAGE,
      ...[...LP_SOURCE_BY_FILE.entries()]
        .filter(([name]) => !DECORATION_ONLY.has(name))
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

  it("ヒーローの見出しと固定コピーがハンドオフどおり（2026-08-22の運営者指示で改定）", () => {
    expect(PAGE).toContain("プロンプトドリブンの");
    expect(PAGE).toContain("使用するほど性能が上がる");
    expect(PAGE).toContain("SNS自動化プラットフォーム");
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
