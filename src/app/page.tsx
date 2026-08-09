import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo, LogoTile } from "@/components/app-shell/brand-logo";
import { LegalFooterLinks } from "@/components/legal-footer";
import {
  AnalyticsFigure,
  BaseMdFigure,
  GenerationProgressFigure,
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
 * SC-01 LP（要件06 §1, T-M8-74）。design_handoff_space_ai_lp のデザインリファレンス
 * 「Space AI LP v2」を正とする再現実装。文言はハンドオフREADME §文言（一字一句変更禁止）に従い、
 * 価格・上限値は `plans.ts` から埋める。導線・注記・禁止表現は landing-page.test.ts が固定する。
 */

export const metadata: Metadata = {
  title: `${APP_NAME} — AIで学習・生成・投稿・分析まで自動化するX運用アプリ`,
  description: APP_DESCRIPTION,
};

// nonceベースCSP（T-M6-17）はper-requestのnonceを要するため動的レンダリングにする
// （静的prerenderだとNext.jsのscriptにnonceが付かずCSPで実行が阻害される）。
export const dynamic = "force-dynamic";

const CONTAINER = "mx-auto w-full max-w-[1180px] px-[clamp(16px,3.5vw,32px)]";
const SECTION_PAD = "py-[clamp(56px,8vw,96px)]";
const TWO_COL = "grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-[clamp(24px,4vw,56px)]";
const HEADING = "font-bold tracking-[-0.01em] [font-feature-settings:'palt']";
const H2 = `mt-[18px] text-[length:clamp(20px,calc(12px_+_1.2vw),26px)] leading-normal ${HEADING}`;

/** 決済直前で期待とズレないよう、主CTA直下（ヒーロー・最終CTAの2箇所）に必ず出す（要件06 §1.1）。 */
const CARD_REGISTRATION_NOTE =
  "開始にはカード登録が必要です（7日間は無料。期間中の解約で料金はかかりません）。";

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
  ["#safety", "安全性"],
  ["#pricing", "料金"],
];

const PROBLEMS: [string, string][] = [
  [
    "毎日回すには、作業が多すぎる",
    "ネタ探し、情報収集、文章、画像、投稿、分析。本業の合間に全部は続かない。",
  ],
  ["運用代行は、個人には高すぎる", "SNS運用代行は高額で、個人事業主にはなかなか手が出せない。"],
  [
    "AIに書かせると、自分らしくない",
    "予約投稿ツールは投稿の作成までは助けてくれない。汎用のAIチャットは毎回指示が面倒で、文体もぶれる。",
  ],
];

const SAFETY_ITEMS: [string, string][] = [
  [
    "既定は「下書きまで」モード",
    "自動投稿を使うには、対象・実行条件・停止方法を説明した画面での明示的な同意が別途必要です。Xと連携しただけでは始まりません。",
  ],
  ["いつでも即座に止められます", "設定から停止すると、実行待ちの自動投稿もキャンセルされます。"],
  ["1日50投稿の安全上限", "1アカウントあたり1日50投稿の上限を、全プランに設けています。"],
  [
    "自動いいね・フォロー・リプライはしません",
    "アカウント凍結のリスクを避けるため、実装していません。",
  ],
  ["APIキーは暗号化して保存", "画面上は末尾4桁のみ表示します。いつでも削除できます。"],
];

const HOW_TO_STEPS: [string, string][] = [
  ["アカウント作成", "メールアドレスとパスワードで登録。確認メールで本人認証します。"],
  ["カード登録", "安全に登録。ここから7日間の無料トライアルが始まります。"],
  ["初期設定", "任意の順で進められます。"],
  ["運用開始", "下書きの確認から、あなたのペースで。"],
];

const POST_TYPE_CHIPS = ["ニュース解説", "考え・意見", "ノウハウ", "トレンド便乗", "週次まとめ"];

export default function Home() {
  const startingPrice = `${yen(PLANS.standard.monthlyPriceJpy)}円`;
  return (
    <div className="flex min-h-screen flex-col bg-page text-sm leading-[1.8] text-ink tabular-nums [text-wrap:pretty]">
      <header className="sticky top-0 z-50 border-b border-hairline bg-[rgba(255,255,255,0.82)] backdrop-blur-[10px] backdrop-saturate-[1.4]">
        <div className={`${CONTAINER} flex h-16 items-center justify-between gap-3.5`}>
          <BrandLogo href="/" />
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
                あなたの発信スタイルを学習したAIが、情報収集から投稿作成・予約・分析までを引き受けます。あなたは1日数分、下書きを確認するだけ。
              </p>
              <div>
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    className={cn(
                      buttonVariants({ variant: "brand" }),
                      "h-11 px-7 text-sm font-bold hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(125,31,117,0.25)] motion-reduce:hover:translate-y-0",
                    )}
                    href="/signup"
                  >
                    無料で始める
                  </Link>
                  <a
                    className={cn(buttonVariants({ variant: "subtle" }), "h-10 px-5 text-sm")}
                    href="#pricing"
                  >
                    料金を見る
                  </a>
                </div>
                <p className="mt-2.5 text-caption text-ink-3">{CARD_REGISTRATION_NOTE}</p>
                <div className="mt-[22px] flex flex-wrap gap-x-[18px] gap-y-2 text-caption text-ink-2">
                  {["勝手には投稿しません", "いつでも即座に停止", `月額${startingPrice}から`].map(
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
                  毎日のX運用、
                  <br />
                  こんな悩みはありませんか
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
            <div className="mt-[30px] grid grid-cols-1 gap-3.5 min-[900px]:grid-cols-12">
              <div className="min-w-0 min-[900px]:col-span-7">
                <div
                  className={cn(
                    cardClassName,
                    "h-full p-5 transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]",
                  )}
                >
                  <p className="text-caption font-bold tracking-[0.06em] text-brand">
                    情報収集の自動化
                  </p>
                  <CardTitle as="h3" className="mt-2">
                    ニュースが2時間おきに届く
                  </CardTitle>
                  {/* 重要度チップと時刻は図版が示すので文からは外した（T-M8-76）。 */}
                  <p className="mt-2 text-sm text-ink-2">
                    AI・投資・SNS運用の3分野を、10:00〜20:00に2時間おきで自動収集。気になった記事から、そのまま投稿の作成に進めます。
                  </p>
                  <NewsFeedFigure />
                </div>
              </div>
              <div className="min-w-0 min-[900px]:col-span-5">
                <div
                  className={cn(
                    cardClassName,
                    "relative h-full overflow-hidden p-5 transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]",
                  )}
                >
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-[3px] [background-image:var(--brand-gradient)]"
                  />
                  <p className="text-caption font-bold tracking-[0.06em] text-brand">投稿の生成</p>
                  <CardTitle as="h3" className="mt-2">
                    5種類の型で、あなたの文体に
                  </CardTitle>
                  <p className="mt-2 text-sm text-ink-2">
                    スレッド形式で出力し、画像の自動生成も選べます。生成は通常60〜90秒。編集や、追加指示つきの再生成もできます。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {POST_TYPE_CHIPS.map((chip) => (
                      <span
                        className="inline-flex h-[22px] items-center rounded-chip bg-brand-subtle px-2 text-caption text-brand"
                        key={chip}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="min-w-0 min-[900px]:col-span-5">
                <div
                  className={cn(
                    cardClassName,
                    "h-full p-5 transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]",
                  )}
                >
                  <p className="text-caption font-bold tracking-[0.06em] text-brand">
                    予約と自動運用
                  </p>
                  <CardTitle as="h3" className="mt-2">
                    曜日×時刻で回し続ける
                  </CardTitle>
                  <p className="mt-2 text-sm text-ink-2">
                    9:00〜22:00の30分刻みでスケジュールを設定。スロットごとに「下書きまで」か「そのまま投稿」かを選べます。
                  </p>
                  <ScheduleFigure />
                </div>
              </div>
              <div className="min-w-0 min-[900px]:col-span-7">
                <div
                  className={cn(
                    cardClassName,
                    "h-full p-5 transition-shadow duration-[250ms] hover:shadow-[var(--shadow-pop)]",
                  )}
                >
                  <p className="text-caption font-bold tracking-[0.06em] text-brand">
                    分析と改善提案
                  </p>
                  <CardTitle as="h3" className="mt-2">
                    何が伸びたかを、根拠つきで
                  </CardTitle>
                  {/* 記録タイミングは図版が示すので文からは外した（T-M8-76）。 */}
                  <p className="mt-2 text-sm text-ink-2">
                    表示回数・いいね・リポスト・プロフィール表示とフォロワー数を自動で記録。「提案を更新」を押すと、どの型×時間帯×テーマが伸びたかを根拠つきで示します（1日1回・表示のみ）。
                  </p>
                  <AnalyticsFigure />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 03 しくみ */}
        <section className={`${CONTAINER} ${SECTION_PAD} scroll-mt-[76px]`} id="how">
          <SectionMark label="しくみ" no="03" />
                      <h2 className={H2}>「発信定義書」が、あなたらしさの土台になる</h2>
          {/* 定義書の中身はSTEP2の図版が列挙するので、リード文は役割の説明だけに絞った（T-M8-76）。 */}
                      <p className="mt-3.5 max-w-[42em] text-sm text-ink-2">
              すべての投稿生成がこの1枚を土台にするため、毎回指示を書き直さなくても文体と方針がぶれません。
            </p>
          <div className="mt-8 grid gap-3.5 min-[960px]:grid-cols-[1fr_26px_1.18fr_26px_1fr_26px_1fr] min-[960px]:items-stretch">
            <div className="min-w-0">
              <div className={cn(cardClassName, "h-full p-[18px]")}>
                <p className="text-caption font-bold tracking-[0.06em] text-ink-3">STEP 1</p>
                <CardTitle as="h3" className="mt-1.5">
                  学習させる素材
                </CardTitle>
                <p className="mt-2 text-body text-ink-2">
                  ペルソナ／発信テーマ／トーン＆マナー／NG設定
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {["参考アカウント", "伸びた投稿", "自分の過去投稿"].map((chip) => (
                    <span
                      className="inline-flex h-[22px] items-center rounded-chip border border-hairline bg-page px-2 text-caption text-ink-2"
                      key={chip}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div
              aria-hidden="true"
              className="flex min-h-4 rotate-90 items-center justify-center self-center text-[15px] text-ink-3 min-[960px]:rotate-0"
            >
              →
            </div>
            <div className="min-w-0">
              <BaseMdFigure />
            </div>
            <div
              aria-hidden="true"
              className="flex min-h-4 rotate-90 items-center justify-center self-center text-[15px] text-ink-3 min-[960px]:rotate-0"
            >
              →
            </div>
            <div className="min-w-0">
              <div className={cn(cardClassName, "relative h-full overflow-hidden p-[18px]")}>
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px] [background-image:var(--brand-gradient)]"
                />
                <p className="text-caption font-bold tracking-[0.06em] text-ink-3">STEP 3</p>
                <CardTitle as="h3" className="mt-1.5">
                  AIが投稿を生成
                </CardTitle>
                <p className="mt-2 text-body text-ink-2">
                  定義書を土台に、5つの型で生成。スレッド形式・画像も選べます。
                </p>
                <GenerationProgressFigure />
              </div>
            </div>
            <div
              aria-hidden="true"
              className="flex min-h-4 rotate-90 items-center justify-center self-center text-[15px] text-ink-3 min-[960px]:rotate-0"
            >
              →
            </div>
            <div className="min-w-0">
              <div className={cn(cardClassName, "h-full p-[18px]")}>
                <p className="text-caption font-bold tracking-[0.06em] text-ink-3">STEP 4</p>
                <CardTitle as="h3" className="mt-1.5">
                  ぶれない投稿に
                </CardTitle>
                {/* 抽象的なミニ投稿カードの図版は情報量が薄いため削除（T-M8-76）。 */}
                <p className="mt-2 text-body text-ink-2">
                  いつもの文体・いつもの方針で、毎回指示を書き直す必要はありません。
                </p>
              </div>
            </div>
          </div>
          {/* 末尾注記（mdプラン以上は直接編集可）は料金セクションのmdプラン説明と重複のため削除（T-M8-76）。 */}
        </section>

        {/* 04 安全性 */}
        <section className="scroll-mt-[76px] border-y border-hairline bg-surface" id="safety">
          <div className={`${CONTAINER} ${SECTION_PAD}`}>
            <div className={TWO_COL}>
              <div>
                <SectionMark label="安全性" no="04" />
                                  <h2 className={H2}>勝手には、投稿しません。</h2>
                                  <p className="mt-3.5 max-w-[30em] text-sm text-ink-2">
                    大切なアカウントを預かる前提で設計しています。できないことは、できないままにしてあります。
                  </p>
              </div>
              <div>
                {SAFETY_ITEMS.map(([title, body], index) => (
                  <div
                    className={cn(
                      "border-t border-hairline",
                      index === SAFETY_ITEMS.length - 1 && "border-b",
                    )}
                    key={title}
                  >
                    <div className="flex gap-3.5 py-4">
                      <span
                        aria-hidden="true"
                        className="grid size-6 flex-none place-items-center rounded-pill bg-brand-subtle text-body font-bold text-brand"
                      >
                        ✓
                      </span>
                      <div>
                        <p className="text-[15px] leading-[1.6] font-bold">{title}</p>
                        <p className="mt-1 text-body text-ink-2">{body}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 05 使い方 */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="使い方" no="05" />
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

        {/* 06 料金 */}
        <section className="scroll-mt-[76px] border-y border-hairline bg-surface" id="pricing">
          <div className={`${CONTAINER} ${SECTION_PAD}`}>
            <SectionMark label="料金" no="06" />
                          <h2 className={H2}>月額{startingPrice}から。すべて税込です</h2>
                          <p className="mt-3 text-sm text-ink-2">
                全プラン7日間の無料トライアル付き。
              </p>
            <PricingCards />
          </div>
        </section>

        {/* 07 よくある質問 */}
        <section className={`${CONTAINER} ${SECTION_PAD}`}>
          <SectionMark label="よくある質問" no="07" />
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
                    "h-11 px-[34px] text-sm font-bold hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(125,31,117,0.25)] motion-reduce:hover:translate-y-0",
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
            <span className="text-caption text-ink-3">© 2026</span>
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
