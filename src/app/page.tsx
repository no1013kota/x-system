import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { BrandLogo, LogoTile } from "@/components/brand/brand-logo";
import { XLogo } from "@/components/brand/x-logo";
import { LegalFooterLinks } from "@/components/legal-footer";
import {
  ConceptCycleFigure,
  GrowthChartFigure,
  PromptEditorFigure,
  PostComposeFigure,
  AnalyticsFigure,
  NewsFeedFigure,
  ScheduleFigure,
} from "@/components/lp/figures";
import { FaqList } from "@/components/lp/faq";
import { HeroMock } from "@/components/lp/hero-mock";
import { PricingCards } from "@/components/lp/pricing";
import { buttonVariants } from "@/components/ui/button";
import { cardClassName, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { COMMISSION_MONTHS, INVITE_TIERS, formatRateBps } from "@/lib/affiliate/config";
import { APP_DESCRIPTION, APP_NAME, OPERATOR_X_HANDLE, OPERATOR_X_URL } from "@/lib/app-config";
import { yen } from "@/lib/format";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * SC-01 LP（要件06 §1, T-M8-74）。design_handoff_lp のデザインリファレンス
 * 「Exos AI LP v2」を正とする再現実装。文言はハンドオフREADME §文言（一字一句変更禁止）に従い、
 * 価格・上限値は `plans.ts` から埋める。導線・注記・禁止表現は landing-page.test.ts が固定する。
 */

export const metadata: Metadata = {
  title: `${APP_NAME} — AIで学習・生成・投稿・分析まで自動化するX運用アプリ`,
  description: APP_DESCRIPTION,
};

// 動的レンダリングの指定は `app/layout.tsx` へ移した（T-M8-87）。
// ページごとに書くと書き忘れたページが静かに壊れる（`/signup` が実際にそうなった）。

const CONTAINER = "mx-auto w-full max-w-[1180px] px-[clamp(16px,3.5vw,32px)]";
const SECTION_PAD = "py-[clamp(56px,8vw,96px)]";
const TWO_COL = "grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-[clamp(24px,4vw,56px)]";
const HEADING = "font-bold tracking-[-0.01em] [font-feature-settings:'palt']";
const H2 = `mt-[18px] text-[length:clamp(20px,calc(12px_+_1.2vw),26px)] leading-normal ${HEADING}`;

/**
 * 決済直前で期待とズレないよう、主CTA直下（ヒーロー・最終CTAの2箇所）に必ず出す（要件06 §1.1）。
 * 末尾は申込前確認事項の「期間中に解約すれば料金はかかりません。」と同じ言い回しに揃える
 * （同じことを別の言い方で2箇所に書くと、読み手はどちらが正か迷う）。
 */
const CARD_REGISTRATION_NOTE =
  "7日間は無料でお試しいただけます。";

/** 主CTA（無料で始める）と副CTA（料金を見る）は同じ寸法にする（T-M8-79）。 */
const CTA_SIZE = "h-11 px-7 text-sm font-bold";
const CTA_PRIMARY_HOVER =
  "hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(125,31,117,0.25)] motion-reduce:hover:translate-y-0";

/** 「01 課題」のようなセクション番号行。上の1px罫が各章の区切りになる。 */
function SectionMark({ no, label }: { no: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-ink pt-4">
      <span className="text-caption font-bold tracking-[0.08em]">{no}</span>
      <span className="text-caption tracking-[0.08em] text-ink-2">{label}</span>
    </div>
  );
}

const NAV_LINKS: [string, string][] = [
  ["#features", "できること"],
  ["#how", "しくみ"],
  ["#pricing", "料金"],
  // ページ遷移のリンク（T-M8-173）。アンカーと同じ場所に置く（タブが2系統あると迷う）。
  //
  // **友達招待は契約前でも参加できる**（T-M8-268・運営者の指示 2026-08-23）。行き先は
  // `/app/invite` 固定でよい——未ログインなら route guard が `/login?next=/app/invite` へ送り、
  // ログイン後そのまま招待画面へ着く（ログイン画面から新規登録へも行ける）。
  // 「未ログインなら登録画面」を条件分岐で書き分けると、判定が2か所（LPとguard）に増える。
  ["/app/invite", "友達招待"],
  ["/prompt-templates", "プロンプト集"],
  ["/blog", "ブログ"],
];

// ── 06 利用者の声 は一時的に非表示（運営者の指示 2026-08-23・T-M8-231）─────────────
//
// **復活は行頭の `// ` を外すだけ**（この定数と、下の <section> の2か所）。あわせて
// `xProfileUrl` を `@/lib/app-config` の import へ戻す（いま未使用のため外してある）。
// 掲載条件は据え置き: **実在の提携アカウントのみ**・本人確認済みのコメントだけ
// （他人名義の創作コメントは公開しない。design_handoff_lp/README §禁止表現）。
// アバター画像 public/lp-avatars/*.jpg も消さずに残してある。
//
// /**
//  * 06 利用者の声（T-M8-214・運営者の指示 2026-08-22）。**実在の提携アカウントのみ**掲載する
//  * （禁止表現リストの「利用者の声」は架空の声を禁じる趣旨で、提携者の実名掲載は
//  * design_handoff_lp/README §禁止表現の改定どおり可）。
//  *
//  * **コメント文はドラフト。** 本番リリース前に、各提携者の本人確認済みコメントへ
//  * 名前はX APIの実表示名（2026-08-22取得）。コメント文は運営者が本人確認のうえ差し替えること
//  * （他人名義の創作コメントを公開しない）。
//  */
// const TESTIMONIALS: { handle: string; name: string; comment: string }[] = [
//   {
//     handle: "ai_newinfo",
//     name: "MATSUMOTO | 非エンジニア向けClaude活用術",
//     comment:
//       "ニュース収集から下書きまで自動で揃うので、毎日の投稿が続けやすくなりました。",
//   },
//   {
//     handle: "picaso_youtube",
//     name: "ピカソ AI×YouTube運用",
//     comment: "プロンプトを自分の言葉に直せるのが良い。使うほど投稿の雰囲気が馴染んでいきます。",
//   },
//   {
//     handle: "lin_youtube3",
//     name: "ハヤシ｜海外ネタ輸入_非属人YouTuber",
//     comment: "予約と分析までひとつの画面で完結するので、運用の手間が大きく減りました。",
//   },
//   {
//     handle: "kimi_marriage",
//     name: "キミマリ@婚活アドバイザー",
//     comment: "分析レポートで何が伸びたかが分かるので、次に何を書くか迷わなくなりました。",
//   },
// ];

const HOW_TO_STEPS: [string, string][] = [
  ["アカウント作成", "メールアドレスで登録し、確認メールで本人認証。"],
  ["カード登録", "ここから7日間の無料トライアルが始まります。"],
  ["初期設定", "Xアカウントを連携し、発信の設定をする。順番は自由。"],
  ["運用開始", "下書きの確認から、あなたのペースで。"],
];

/**
 * 「02 できること」の5枚（T-M8-172・運営者の指示 2026-08-21）。
 * 並び順は運用の流れと同じ: ニュース解説→プロンプト作成→投稿作成→スケジュール→結果分析・プロンプト改善
 * （ヒーローのモックとも揃える）。上端グラデ3pxは「投稿作成」＝AIが動く瞬間だけ（デザイン §カラー）。
 */
const FEATURES: {
  eyebrow: string;
  title: string;
  body: string;
  figure: ReactNode;
  gradientTop?: boolean;
}[] = [
  {
    eyebrow: "情報収集の自動化",
    title: "ニュースが毎日届く",
    // 重要度チップと時刻は図版が示すので文からは外してある（T-M8-76）。
    // 取得は1日2回（12時・19時）へ変更済み（T-M8-326）。**実際の仕様と揃える**（T-M8-337）。
    body: "AI・Web3・SNS運用・投資・恋愛・美容の6分野を、毎日12時と19時に自動収集します。気になった記事から、そのまま投稿の作成に進めます。",
    figure: <NewsFeedFigure />,
  },
  {
    eyebrow: "プロンプトの設計・編集",
    title: "AIへの指示を、自分の言葉で磨ける",
    body: "投稿の土台になるアカウント.md、投稿の型、画像生成のプロンプトを、そのまま確認・編集できます。テンプレートから始めて、反応を見ながらあなた用に育てられます。",
    figure: <PromptEditorFigure />,
  },
  {
    eyebrow: "投稿・画像の自動作成",
    title: "5種類の型で、文章も画像も",
    body: "スレッド形式の文章と、添える画像をまとめて生成します。編集や、追加指示つきの再生成もできます。",
    gradientTop: true,
    figure: <PostComposeFigure />,
  },
  {
    eyebrow: "融通の効くスケジュール設定",
    title: "曜日×時刻で、自分の型に合わせて",
    body: "9:00〜22:00の30分刻みで枠を組めます。枠ごとに「下書きまで」か「そのまま投稿」かを選べるので、忙しい日は下書きだけにもできます。",
    figure: <ScheduleFigure />,
  },
  {
    eyebrow: "結果分析・プロンプト改善",
    title: "何が伸びたかを分析して、改善案まで届く",
    // 記録タイミングは図版が示すので文からは外してある（T-M8-76）。
    body: "表示回数・いいね・リポスト・フォロワー数を自動で記録します。ボタン1つで、どの投稿が伸びたかを根拠つきのレポートにし、アカウント.mdとプロンプトの改善案まで用意します（反映するかはあなたが選べます）。",
    figure: <AnalyticsFigure />,
  },
];

/**
 * 「03 しくみ」（T-M8-172・運営者の指示 2026-08-21）: 4ステップのカード列から
 * **成長グラフ**へ変えた。伝えたいのは工程の説明ではなく「使うほどプロンプトも
 * アカウント.mdも成長する」こと（コンセプト画像と同じ主張の中身側）。
 * 工程は小さなサイクル表記（集める→作る→出す→測る→反映）で添える。
 * 「反映するかはあなたが選ぶ」の開示は落とさない（禁止表現「AIが自動で学習し続けて最適化」を避ける）。
 */
const CYCLE_STEPS = ["集める", "作る", "出す", "測る", "反映する"];

export default function Home() {
  const startingPrice = `${yen(PLANS.standard.monthlyPriceJpy)}円`;
  return (
    <div className="flex min-h-screen flex-col bg-page text-sm leading-[1.8] text-ink tabular-nums [text-wrap:pretty]">
      <header className="sticky top-0 z-50 border-b border-hairline bg-[rgba(255,255,255,0.82)] backdrop-blur-[10px] backdrop-saturate-[1.4]">
        <div className={`${CONTAINER} flex h-16 items-center justify-between gap-3.5`}>
          <BrandLogo href="/" priority />
          {/*
            aria-label はフッタの「法務情報」navと区別するために要る（navが2つあるため）。
            min-h-6 は WCAG 2.5.8（24x24px）。テキスト高さのままだと20pxしかなかった。
          */}
          <nav aria-label="セクション" className="hidden items-center gap-6 min-[880px]:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                className="inline-flex min-h-6 items-center gap-1 text-body font-medium text-ink-2 transition-colors hover:text-brand"
                href={href}
                key={href}
              >
                {label}
                {/* ページ遷移するリンクにはマークを付ける（アンカーと区別・T-M8-175）。 */}
                {!href.startsWith("#") ? (
                  <Icon aria-hidden="true" name="open_in_new" size={13} />
                ) : null}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <Link
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "h-9 px-3.5 text-body font-medium hover:bg-brand-subtle hover:text-brand",
              )}
              href="/login"
            >
              ログイン
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "brand" }), "h-9 px-4 text-body font-bold")}
              href="/signup"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ヒーロー */}
        <section className="relative overflow-hidden border-b border-hairline bg-surface">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-[56%] bg-[radial-gradient(rgba(0,0,0,0.06)_1px,transparent_1px)] bg-[size:22px_22px] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,rgba(0,0,0,1)_45%)] [mask-image:linear-gradient(90deg,transparent_0%,rgba(0,0,0,1)_45%)]"
          />
          <div
            className={`${CONTAINER} relative grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] items-center gap-[clamp(28px,4.5vw,56px)] py-[clamp(56px,8vw,104px)]`}
          >
            <div>
              {/* ピルバッジ「X（旧Twitter）運用を自動化するWebアプリ」はh1とほぼ同義のため削除（T-M8-76）。 */}
              <h1
                className={`text-[length:clamp(31px,calc(17px_+_3.4vw),44px)] leading-[1.34] ${HEADING}`}
              >
                プロンプトドリブンの
                <br />
                使用するほど性能が上がる
                <br />
                <span className="text-brand">SNS運用プラットフォーム</span>
              </h1>
              <p className="mt-5 max-w-[42em] text-sm text-ink-2">
                {/*
                  **長い文はですます調**（T-M8-312・運営者の指示 2026-08-26）。
                  あわせて「分析・プロンプト改善までを自動で実施」を事実に合わせた——
                  投稿分析の起点は「分析を開始」ボタンだけで（T-M8-255）、改善案は表示専用。
                  禁止表現「AIが自動で学習し続けて最適化」に触れる書き方だった。
                */}
                AIが情報収集から投稿作成、投稿予約、分析、プロンプト改善までを自動で実施。
                運用するほどプロンプトとアカウントが成長。
              </p>
              <div>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    className={cn(
                      buttonVariants({ variant: "brand" }),
                      CTA_SIZE,
                      CTA_PRIMARY_HOVER,
                    )}
                    href="/signup"
                  >
                    無料で始める
                  </Link>
                  <a
                    className={cn(buttonVariants({ variant: "subtle" }), CTA_SIZE)}
                    href="#pricing"
                  >
                    料金を見る
                  </a>
                </div>
                <p className="mt-2.5 text-caption text-ink-3">{CARD_REGISTRATION_NOTE}</p>
                {/*
                  CTAボタンと同等の文字サイズにする（運営者の指示 2026-08-22・T-M8-201）。

                  **文言は禁止表現リスト（`design_handoff_lp/README.md` §禁止表現）を通ること**（T-M8-311）。
                  2026-08-26 の指定は「多くのX運用者が利用」だったが利用者数の表示に当たるため採らず、
                  続く指定「プロンプトと投稿結果を自動で分析・改善」からも**「自動で」を外した**——
                  投稿分析の起点は「分析を開始」ボタンだけ（`analytics/start-analysis-button.tsx`・T-M8-255）で、
                  リストにも「AIが自動で学習し続けて最適化（正: 提案は押したときだけ・1日1回・表示専用）」とある。
                  価格は `startingPrice` から作り、数値を画面へ書き写さない（R30）。
                */}
                <div className="mt-[22px] flex flex-wrap gap-x-[18px] gap-y-2 text-sm font-medium text-ink-2">
                  {["高品質なプロンプトをデフォルトで完備", "プロンプトテンプレを何個でも管理", `月額${startingPrice}から`].map(
                    (item) => (
                      <span className="inline-flex items-center gap-1.5" key={item}>
                        <span aria-hidden="true" className="font-bold text-brand">
                          ✓
                        </span>
                        {item}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="min-w-0 duration-[800ms]">
              <HeroMock />
            </div>
          </div>
        </section>

        {/*
          ファクトストリップ（分野数／型の種類／生成時間／最安月額）は削除した（T-M8-76）。
          4項目すべてが後続セクションの再掲で、新しい情報が1つも無かった:
          前3つは「02 できること」、月額はヒーローのチェックと料金セクションの見出し。
        */}

        {/* 01 コンセプト（T-M8-172・運営者の指示 2026-08-21。旧「01 課題」を置き換えた） */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <div className={TWO_COL}>
            <div>
              <SectionMark label="コンセプト" no="01" />
              <h2 className={H2}>
                使うほど、
                <br />
                プロンプトが磨かれる。
              </h2>
              <p className="mt-4 max-w-[38em] text-sm text-ink-2">
                {APP_NAME}はプロンプト駆動のSNS運用プラットフォームです。プロンプトを設計し、投稿を生成・運用し、結果を分析して、プロンプトを改善する——この1周を回すたびに、あなたのアカウントとプロンプトが育ちます。
              </p>
            </div>
            <div className="min-w-0">
              {/*
                コンセプトの循環図（T-M8-177）。JPEG埋め込みをやめ、ページのトークンで描く
                （内容は docs/lp/コンセプト.png と同じ。LP図版はCSS/DOM/SVGの原則へ戻った）。
              */}
              <ConceptCycleFigure />
            </div>
          </div>
        </section>

        {/* 02 できること */}
        <section
          className="scroll-mt-[76px] border-y border-hairline bg-surface"
          id="features"
        >
          <div className={`${CONTAINER} ${SECTION_PAD}`}>
            <SectionMark label="できること" no="02" />
                          <h2 className={H2}>情報収集からプロンプト改善まで、5つの仕事を引き受けます</h2>
            {/*
              ベントーグリッド（12col・7/5→5/7）から**4枚の縦積み**へ変更（T-M8-77）。
              各カードは全幅になるので、本文を左・図版を右の2カラムに置く
              （1180px幅いっぱいに本文を流すと1行が長くなりすぎて読みにくい）。
              760px未満では本文→図版の縦積みに戻る。
            */}
            <div className="mt-[30px] grid gap-3.5">
              {FEATURES.map((feature) => (
                <div
                  className={cn(
                    cardClassName,
                    "relative overflow-hidden p-5 transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]",
                  )}
                  key={feature.title}
                >
                  {feature.gradientTop && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-[3px] [background-image:var(--brand-gradient)]"
                    />
                  )}
                  <div className="grid items-center gap-x-8 gap-y-4 min-[760px]:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-caption font-bold tracking-[0.06em] text-brand">
                        {feature.eyebrow}
                      </p>
                      <CardTitle as="h3" className="mt-2">
                        {feature.title}
                      </CardTitle>
                      <p className="mt-2 text-sm text-ink-2">{feature.body}</p>
                    </div>
                    <div className="min-w-0">{feature.figure}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 03 しくみ（T-M8-172: 4ステップのカード列 → 成長グラフ） */}
        <section className={`${CONTAINER} ${SECTION_PAD} scroll-mt-[76px]`} id="how">
          <SectionMark label="しくみ" no="03" />
          <h2 className={H2}>運用によるプロンプトの成長が、アカウントも成長させます</h2>
          {/* 説明は1文に簡潔化（運営者の指示 2026-08-22・T-M8-201）。 */}
          <p className="mt-3.5 max-w-[46em] text-sm text-ink-2">
            {CYCLE_STEPS.join("→")}のサイクルがまわるたび、プロンプトが磨かれ、投稿があなたの言葉に近づきます。
          </p>
          <div className="mt-7">
            <GrowthChartFigure />
          </div>
          {/*
            グラフ下の開示行はT-M8-181で削除（運営者の指示）。「反映するかはあなたが選べます」の
            開示は02できることの「結果分析・プロンプト改善」カード本文が引き続き担う
            （禁止表現「AIが自動で学習し続けて最適化」の回避はそちらで維持）。
          */}
        </section>

        {/*
          「04 安全性」セクションは削除した（T-M8-77）。主張の中心（勝手に投稿しない／即座に停止）は
          ヒーローのチェック3点とFAQ「勝手に投稿されませんか？」が担う。
          **APIキーの暗号化・末尾4桁はFAQからも外した**（運営者の判断 2026-08-24・T-M8-284）。
          LP上の置き場所は無くなり、プライバシーポリシー（法務3リンクから辿れる）が担う。
        */}

        {/* 04 初めかた（T-M8-172: 名称変更＋フロー図） */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="初めかた" no="04" />
          <h2 className={H2}>初めかたは4ステップ</h2>
          {/* フロー図: 各ステップを矢印でつなぐ（960px未満は縦の流れ）。 */}
          <div className="mt-[30px] grid gap-3 min-[960px]:grid-cols-[1fr_26px_1fr_26px_1fr_26px_1fr] min-[960px]:items-stretch">
            {HOW_TO_STEPS.map(([title, body], index) => (
              <Fragment key={title}>
                {index > 0 && (
                  <div
                    aria-hidden="true"
                    className="flex min-h-4 rotate-90 items-center justify-center self-center text-[15px] text-ink-3 min-[960px]:rotate-0"
                  >
                    →
                  </div>
                )}
                <div className={cn(cardClassName, "flex h-full flex-col p-[18px]")}>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-8 items-center justify-center rounded-pill bg-brand-subtle text-[15px] font-bold text-brand"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-2.5 text-[15px] font-bold">{title}</h3>
                  <p className="mt-1.5 text-body text-ink-2">{body}</p>
                </div>
              </Fragment>
            ))}
          </div>
        </section>

        {/* 05 料金 */}
        <section className="scroll-mt-[76px] border-y border-hairline bg-surface" id="pricing">
          <div className={`${CONTAINER} ${SECTION_PAD}`}>
            <SectionMark label="料金" no="05" />
                          <h2 className={H2}>月額{startingPrice}から。全プラン7日間の無料トライアル付き。</h2>
            <PricingCards />
            {/*
              友達招待キャンペーン（T-M8-268）。**料金の直後・同じ白い面に置く**
              （運営者の指示 2026-08-26）。別セクションにすると背景がグレーへ切り替わり、
              上下にセクション余白が二重に入って間延びする。行き先は `/app/invite` 固定——
              未ログインなら route guard が `/login?next=/app/invite` へ送り、ログイン後そのまま着く。
            */}
            <div className="mt-12 overflow-hidden rounded-[20px] border border-hairline bg-brand-subtle px-[clamp(20px,4vw,44px)] py-[clamp(24px,4vw,40px)]">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="max-w-[560px]">
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-caption font-bold text-brand">
                    <Icon aria-hidden="true" name="star_shine" size={13} />
                    友達招待キャンペーン
                  </p>
                  <h2 className={`${H2} mt-3`}>
                    紹介した方の利用料から、最大{formatRateBps(INVITE_TIERS[INVITE_TIERS.length - 1].rateBps)}が報酬に
                  </h2>
                  <p className="mt-2.5 text-body leading-6 text-ink-2">
                    ご自身のプラン契約がなくても参加できます。あなたが招待した方が有料プランを利用した月から、
                    最大{COMMISSION_MONTHS}か月分が報酬対象です（報酬率は招待人数に応じて上がります）。
                  </p>
                </div>
                <Link
                  className={cn(
                    buttonVariants({ variant: "brand" }),
                    "h-11 shrink-0 px-6 text-body font-bold",
                  )}
                  href="/app/invite"
                >
                  招待リンクを受け取る
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/*
          ── 06 利用者の声 は一時的に非表示（運営者の指示 2026-08-23・T-M8-231）──
          復活はこの {/* … *⁄} を外し、定数 TESTIMONIALS の `// ` も外す。
          中の `*⁄`（U+2044）は元はアスタリスク＋スラッシュ。そのままだとJSXコメントが閉じてしまうため置換した。戻すときに直す。

        {/* 06 利用者の声（T-M8-214） *⁄}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="利用者の声" no="06" />
          {/*
            Xの投稿カードに寄せる（運営者の指示 2026-08-22）: 上段=アバター（実画像・
            public/lp-avatars/）＋名前＋@ハンドル＋右上にXロゴ、下に本文。
            アバターはリリース時にリポジトリへ同梱した静的画像（外部ホットリンクはCSP・
            変更耐性の点で使わない。更新するときは unavatar.io/x/<handle> から取り直す）。
          *⁄}
          <div className="mt-[clamp(24px,3vw,38px)] grid gap-4 sm:grid-cols-2">
            {TESTIMONIALS.map(({ handle, name, comment }) => (
              <figure
                // 長い表示名（truncate=nowrap）のmin-contentがgrid列を390px超へ押し広げないよう
                // min-w-0 を明示する（2026-08-22、実名反映で横スクロールが出た）。
                className={cn(cardClassName, "flex min-w-0 flex-col gap-3 p-5")}
                key={handle}
              >
                <figcaption className="flex items-start gap-3">
                  <a
                    className="group flex min-w-0 flex-1 items-start gap-3"
                    href={xProfileUrl(handle)}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 静的同梱の小画像（最適化不要） *⁄}
                    <img
                      alt={`${name}のXアイコン`}
                      className="size-11 flex-none rounded-pill border border-hairline object-cover"
                      height={44}
                      loading="lazy"
                      src={`/lp-avatars/${handle}.jpg`}
                      width={44}
                    />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-body font-bold text-ink group-hover:underline">
                        {name}
                      </span>
                      <span className="block truncate text-caption text-ink-3">@{handle}</span>
                    </span>
                  </a>
                  <XLogo aria-hidden="true" className="mt-0.5 flex-none text-ink-2" size={17} />
                </figcaption>
                <blockquote className="text-sm leading-[1.9] whitespace-pre-line text-ink">
                  {comment}
                </blockquote>
              </figure>
            ))}
          </div>
        </section>
        */}


        {/* 07 よくある質問 */}

        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          {/* 06 利用者の声を隠しているあいだは番号を詰める（復活時は "07" へ戻す・T-M8-231）。 */}
          <SectionMark label="よくある質問" no="06" />
          {/* 見出しの言い換え（「気になることは、先に答えておきます」）を置かず、
              質問と回答そのものを大きく出す（2026-08-20 運営者の指示）。 */}
          <div className="mt-[clamp(24px,3vw,38px)] max-w-[840px]">
            <FaqList />
          </div>
        </section>

        {/* 最終CTA */}
        <section className="relative overflow-hidden border-t border-hairline bg-surface">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(rgba(0,0,0,0.05)_1px,transparent_1px)] bg-[size:22px_22px] [-webkit-mask-image:radial-gradient(ellipse_at_center,rgba(0,0,0,1)_0%,transparent_70%)] [mask-image:radial-gradient(ellipse_at_center,rgba(0,0,0,1)_0%,transparent_70%)]"
          />
          <div className={`${CONTAINER} relative py-[clamp(64px,9vw,110px)] text-center`}>
            <div className="flex justify-center">
              <LogoTile size={40} />
            </div>
            <div>
              <h2 className={`mt-[22px] text-[length:clamp(24px,calc(14px_+_1.8vw),34px)] leading-[1.45] ${HEADING}`}>
                1日数分の確認から、
                <br />
                始めませんか。
              </h2>
            </div>
            {/* 「7日間、すべての機能を無料で試せます。」は直下のカード登録注記と重複のため削除（T-M8-76）。 */}
            <div>
              <div className="mt-[26px] flex justify-center">
                <Link
                  className={cn(
                    buttonVariants({ variant: "brand" }),
                    CTA_SIZE,
                    CTA_PRIMARY_HOVER,
                  )}
                  href="/signup"
                >
                  無料で始める
                </Link>
              </div>
              <p className="mt-2.5 text-caption text-ink-3">{CARD_REGISTRATION_NOTE}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline bg-page">
        {/*
          1行目にロゴと©、右側にXアイコンと法務3リンク。幅が狭いと法務リンクだけ2行目へ折り返し、
          Xアイコンは1行目のロゴの右端に残る（アイコンが1つだけ3行目へ落ちて孤立しない・T-M8-183）。
          DOM順＝見た目の順（`order` を使わない。フォーカス順と視覚順をずらさない・WCAG 2.4.3）。
        */}
        <div className={`${CONTAINER} flex flex-wrap items-center gap-x-6 gap-y-4 py-8`}>
          <div className="flex items-center gap-2.5">
            <LogoTile size={24} />
            <span className="text-body font-bold">{APP_NAME}</span>
            <span className="text-caption text-ink-3">© 2026 Exos AI</span>
          </div>
          {/*
            運営者のXアカウント（T-M8-183）。アイコンだけのリンクなので aria-label で
            行き先と「新しいタブ」を読み上げる。タップ領域は size-9（36px・WCAG 2.5.8）。
          */}
          <a
            aria-label={`運営者のXアカウント @${OPERATOR_X_HANDLE}（新しいタブで開く）`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "ml-auto rounded-full text-ink-2 hover:bg-brand-subtle hover:text-brand",
            )}
            href={OPERATOR_X_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <XLogo className="size-4.5" size={18} />
          </a>
          <LegalFooterLinks
            className="flex basis-full flex-wrap gap-x-5 gap-y-2 sm:basis-auto"
            linkClassName="inline-flex min-h-6 items-center text-caption text-ink-2 transition-colors hover:text-brand"
          />
        </div>
      </footer>
    </div>
  );
}
