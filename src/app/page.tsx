import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";

import { BrandLogo, LogoTile } from "@/components/brand/brand-logo";
import { LegalFooterLinks } from "@/components/legal-footer";
import {
  AnalyticsFigure,
  NewsFeedFigure,
  ScheduleFigure,
} from "@/components/lp/figures";
import { FaqList } from "@/components/lp/faq";
import { HeroMock } from "@/components/lp/hero-mock";
import { PricingCards } from "@/components/lp/pricing";
import { buttonVariants } from "@/components/ui/button";
import { cardClassName, CardTitle } from "@/components/ui/card";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";
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
  "開始にはカード登録が必要です（7日間は無料。期間中に解約すれば料金はかかりません）。";

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
];

/** 課題は `docs/marketing/lp-design-brief.md` §1 の3つ（作業量／費用／自分らしさ）を正とする。 */
const PROBLEMS: [string, string][] = [
  [
    "毎日続けるには、やることが多すぎる",
    "ネタ探し、情報収集、文章と画像の作成、投稿、反応の確認。本業の合間にこれを毎日回すのは、時間がいくらあっても足りません。",
  ],
  [
    "代行に頼むには、費用が大きすぎる",
    "SNS運用の代行は月あたりの負担が大きく、個人や小規模の事業では手が出しにくいのが実情です。",
  ],
  [
    "適切なプロンプトを作成できない",
    "本ツールでは毎日の運用の中で、投稿結果を自動で分析してプロンプトの改善を行います。またご自身でもプロンプトの編集が可能です。",
  ],
];

const HOW_TO_STEPS: [string, string][] = [
  ["アカウント作成", "メールアドレスとパスワードで登録。確認メールで本人認証します。"],
  ["カード登録", "ここから7日間の無料トライアルが始まります。"],
  ["初期設定", "Xアカウントの連携とアカウント設定。画面の案内に沿って、任意の順で進められます。"],
  ["運用開始", "下書きの確認から、あなたのペースで。"],
];

const POST_TYPE_CHIPS = ["ニュース解説", "考え・意見", "ノウハウ", "トレンド便乗", "週次まとめ"];

/** 「02 できること」の4枚。上端グラデ3pxは「投稿の生成」＝AIが動く瞬間だけ（デザイン §カラー）。 */
const FEATURES: {
  eyebrow: string;
  title: string;
  body: string;
  figure: ReactNode;
  gradientTop?: boolean;
}[] = [
  {
    eyebrow: "情報収集の自動化",
    title: "ニュースが2時間おきに届く",
    // 重要度チップと時刻は図版が示すので文からは外してある（T-M8-76）。
    body: "AI・投資・SNS運用の3分野を、10:00〜20:00に2時間おきで自動収集。気になった記事から、そのまま投稿の作成に進めます。",
    figure: <NewsFeedFigure />,
  },
  {
    eyebrow: "投稿・画像の自動作成",
    title: "5種類の型で、文章も画像も",
    body: "スレッド形式の文章と、添える画像をまとめて生成します。編集や、追加指示つきの再生成もできます。",
    gradientTop: true,
    figure: (
      <div className="flex flex-wrap gap-1.5">
        {POST_TYPE_CHIPS.map((chip) => (
          <span
            className="inline-flex h-[22px] items-center rounded-chip bg-brand-subtle px-2 text-caption text-brand"
            key={chip}
          >
            {chip}
          </span>
        ))}
      </div>
    ),
  },
  {
    eyebrow: "融通の効くスケジュール設定",
    title: "曜日×時刻で、自分の型に合わせて",
    body: "9:00〜22:00の30分刻みで枠を組めます。枠ごとに「下書きまで」か「そのまま投稿」かを選べるので、忙しい日は下書きだけにもできます。",
    figure: <ScheduleFigure />,
  },
  {
    eyebrow: "使うほど投稿の質が上がる",
    title: "何が伸びたかを、分析してプロンプトを自動で改善",
    // 記録タイミングは図版が示すので文からは外してある（T-M8-76）。
    body: "表示回数・いいね・リポスト・プロフィール表示とフォロワー数を自動で記録。毎朝、どの投稿が伸びたかを根拠つきのレポートで示します（1日1回・表示のみ。設定への反映はあなたが選べます）。",
    figure: <AnalyticsFigure />,
  },
];

/**
 * 「03 しくみ」の4ステップ＝**サービスの4つの特徴を1周の流れ**として並べる（T-M8-80）。
 *
 * 以前は「学習させる素材 → アカウント.md → 生成 → 分析」で、(1)特徴1（ニュースの自動取得）が
 * どこにも無く (2)最後の「分析」が次へ戻らない一方通行だった。
 * **仕様値（3分野・5種類・9:00〜22:00・記録タイミング）は書かない**——それは「02 できること」の
 * 担当で、ここは「何を受け取って何を次へ渡すか」だけを言う（02の言い直しにしない）。
 */
const HOW_STEPS: {
  eyebrow: string;
  title: string;
  body: string;
  /** 次のステップへ渡すもの。4枚とも同じ器に入れて高さのばらつきを消す。 */
  slot: string;
  /** 生成中バー。AIが動く瞬間を示すブランドグラデーションはこの1枚だけ。 */
  bar?: boolean;
  gradientTop?: boolean;
}[] = [
  {
    eyebrow: "01 集める",
    title: "ニュースが自動で届く",
    body: "決めた分野のニュースが自動で集まり、その日の素材になります。",
    slot: "次へ渡す：その日のニュース",
  },
  {
    eyebrow: "02 作る",
    title: "文章と画像ができる",
    body: "素材とアカウント.mdから、文章と画像のそろった下書きができます。毎回の指示は要りません。",
    slot: "次へ渡す：下書き（通常60〜90秒）",
    bar: true,
    gradientTop: true,
  },
  {
    eyebrow: "03 出す",
    title: "スケジュール通りに投稿",
    body: "できた下書きは、事前に設定したスケジュール通りに投稿されます。",
    slot: "次へ渡す：予約ずみの投稿",
  },
  {
    eyebrow: "04 測る",
    // 「1日1回・表示のみ」は落とさない（落とすと禁止表現「AIが自動で学習し続けて最適化」に触れる）。
    title: "伸びた条件がわかる",
    body: "出した投稿の反応が自動で記録され、何が伸びたかを根拠つきで示します（1日1回・表示のみ）。",
    slot: "次へ渡す：伸びた条件",
  },
];

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
                className="inline-flex min-h-6 items-center text-body font-medium text-ink-2 transition-colors hover:text-brand"
                href={href}
                key={href}
              >
                {label}
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
                ネタ探しから投稿、分析まで。
                <br />
                X運用の毎日を<span className="text-brand">自動化</span>。
              </h1>
              <p className="mt-5 max-w-[42em] text-sm text-ink-2">
                AIが情報収集から投稿作成・投稿予約・分析・プロンプト改善までを自動で実施。運用は1日数分の確認をするだけ。
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
                <div className="mt-[22px] flex flex-wrap gap-x-[18px] gap-y-2 text-caption text-ink-2">
                  {["高品質な投稿を自動作成", "高品質なプロンプトの確認及び改善", `月額${startingPrice}から`].map(
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

        {/* 01 課題 */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <div className={TWO_COL}>
            <div>
              <SectionMark label="課題" no="01" />
                              <h2 className={H2}>
                  毎日のX運用に
                  <br />
                  時間を取られていませんか？
                </h2>
              {/* リード文は見出しと3項目で足りるため削除（T-M8-76）。 */}
            </div>
            <div>
              {PROBLEMS.map(([title, body], index) => (
                <div
                  className={cn(
                    "border-t border-hairline",
                    index === PROBLEMS.length - 1 && "border-b",
                  )}
                  key={title}
                >
                  <div className="flex gap-[18px] py-[18px]">
                    <span className="flex-none pt-0.5 text-body font-bold text-brand">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-[15px] leading-[1.6] font-bold">{title}</p>
                      <p className="mt-1.5 text-sm text-ink-2">{body}</p>
                    </div>
                  </div>
                </div>
              ))}
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
                          <h2 className={H2}>情報収集から分析まで、4つの仕事を引き受けます</h2>
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

        {/* 03 しくみ */}
        <section className={`${CONTAINER} ${SECTION_PAD} scroll-mt-[76px]`} id="how">
          <SectionMark label="しくみ" no="03" />
          {/*
            見出しは**4ステップ全体（＝サービスの4つの特徴）**を指す。「アカウント.mdが土台」という
            見出しでは、最後の「測る」を説明できなかった。アカウント.mdは強調せずリード文で役割を述べる。
          */}
                      <h2 className={H2}>ネタ探し→投稿作成→スケジュール化→効果測定とプロンプト改善のサイクルを自動化</h2>
                      <p className="mt-3.5 max-w-[42em] text-sm text-ink-2">
              最初の設定でできる1枚（アカウント.md）を土台に、4つの工程が順にまわります。あなたが手を動かすのは、上がってきた下書きを確認するところだけです。
            </p>
          {/*
            4ステップは**同じ器・同じ構造**で並べる（T-M8-78）。特定のステップを強調しない。
            上端3pxグラデと生成バーは「作る」＝AIが動く瞬間の1枚だけ（デザイン §カラーの規定）。
          */}
          <div className="mt-8 grid gap-3.5 min-[960px]:grid-cols-[1fr_26px_1fr_26px_1fr_26px_1fr] min-[960px]:items-stretch">
            {HOW_STEPS.map((step, index) => (
              <Fragment key={step.title}>
                {index > 0 && (
                  <div
                    aria-hidden="true"
                    className="flex min-h-4 rotate-90 items-center justify-center self-center text-[15px] text-ink-3 min-[960px]:rotate-0"
                  >
                    →
                  </div>
                )}
                <div className="min-w-0">
                  <div
                    className={cn(
                      cardClassName,
                      "relative flex h-full flex-col overflow-hidden p-[18px]",
                    )}
                  >
                    {step.gradientTop && (
                      <div
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-[3px] [background-image:var(--brand-gradient)]"
                      />
                    )}
                    <p className="text-caption font-bold tracking-[0.06em] text-ink-3">
                      {step.eyebrow}
                    </p>
                    <CardTitle as="h3" className="mt-1.5">
                      {step.title}
                    </CardTitle>
                    <p className="mt-2 flex-1 text-body text-ink-2">{step.body}</p>
                    {/* 4枚とも同じ器の「次へ渡すもの」。STEP4だけ図版が無い不揃いを解消する。 */}
                    <div
                      aria-hidden="true"
                      className="mt-2.5 flex items-center gap-2 rounded-card border border-hairline bg-page px-2.5 py-1.5 text-caption text-ink-3"
                    >
                      {step.bar && (
                        <span className="h-1 w-10 flex-none overflow-hidden rounded-pill bg-surface">
                          <span className="lp-anim-bar block h-full w-[70%] rounded-pill [background-image:var(--brand-gradient)]" />
                        </span>
                      )}
                      {step.slot}
                    </div>
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
          {/*
            「測る」から次の1周へ戻る線。これが無いと最後のステップが一方通行に見える。
            同時に「取り入れると決めたことだけ」＝提案は自動反映しないことの開示になる
            （禁止表現「AIが自動で学習し続けて最適化」を避ける）。
          */}
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-caption text-ink-3">
            <span aria-hidden="true">←</span>
            <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-hairline" />
            <span>取り入れると決めたことだけが、次の1周に効きます</span>
            <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-hairline" />
          </div>
        </section>

        {/*
          「04 安全性」セクションは削除した（T-M8-77）。主張の中心（勝手に投稿しない／即座に停止）は
          ヒーローのチェック3点とFAQ「勝手に投稿されませんか？」が担う。
          **APIキーの暗号化・末尾4桁だけはここが唯一の置き場所だったので、FAQの回答へ戻した。**
        */}

        {/* 04 使い方 */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="使い方" no="04" />
                      <h2 className={H2}>始め方は4ステップ</h2>
          <div className="mt-[30px] grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-x-3.5 gap-y-6">
            {HOW_TO_STEPS.map(([title, body], index) => (
              <div className="border-t-2 border-brand pt-4" key={title}>
                <p aria-hidden="true" className="text-[20px] font-bold text-brand">
                  {index + 1}
                </p>
                <h3 className="mt-1.5 text-[15px] font-bold">{title}</h3>
                <p className="mt-1.5 text-body text-ink-2">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 05 料金 */}
        <section className="scroll-mt-[76px] border-y border-hairline bg-surface" id="pricing">
          <div className={`${CONTAINER} ${SECTION_PAD}`}>
            <SectionMark label="料金" no="05" />
                          <h2 className={H2}>月額{startingPrice}から。全プラン7日間の無料トライアル付き。</h2>
            <PricingCards />
          </div>
        </section>

        {/* 06 よくある質問 */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="よくある質問" no="06" />
          <div className={`${TWO_COL} mt-[18px]`}>
            <div>
              <h2 className={`text-[length:clamp(20px,calc(12px_+_1.2vw),26px)] leading-normal ${HEADING}`}>
                気になることは、
                <br />
                先に答えておきます
              </h2>
            </div>
            <div>
              <FaqList />
            </div>
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
        <div
          className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-6 gap-y-4 py-8`}
        >
          <div className="flex items-center gap-2.5">
            <LogoTile size={24} />
            <span className="text-body font-bold">{APP_NAME}</span>
            <span className="text-caption text-ink-3">© 2026 Exos AI</span>
          </div>
          <LegalFooterLinks
            className="flex flex-wrap gap-x-5 gap-y-2"
            linkClassName="inline-flex min-h-6 items-center text-caption text-ink-2 transition-colors hover:text-brand"
          />
        </div>
      </footer>
    </div>
  );
}
