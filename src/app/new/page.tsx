import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo, LogoTile } from "@/components/brand/brand-logo";
import { XLogo } from "@/components/brand/x-logo";
import { LegalFooterLinks } from "@/components/legal-footer";
import { PricingCards } from "@/components/lp/pricing";
import { ControlCards } from "@/components/lp-new/control";
import { NewFaqList } from "@/components/lp-new/faq";
import { CloneMark } from "@/components/lp-new/clone-mark";
import { OUTPUT_ENABLED, STATS, TECH } from "@/components/lp-new/facts";
import { Grow } from "@/components/lp-new/grow";
import { HeroDiagram, HeroSteps } from "@/components/lp-new/hero-diagram";
import { LOOP_TOTALS, LoopBoard } from "@/components/lp-new/loop-board";
import styles from "@/components/lp-new/new-lp.module.css";
import { TextCards, type TextCard } from "@/components/lp-new/text-cards";
import { Tour } from "@/components/lp-new/tour";
import {
  ANCHOR,
  CHIP_AI,
  CHIP_AUTO,
  CHIP_YOU,
  CONTAINER,
  CTA_PRIMARY_HOVER,
  GLASS,
  H1,
  H2,
  HEADING,
  LEAD,
  PILL_LG,
  PILL_MD,
  SECTION,
  SUB,
  TRIAL_NOTE,
} from "@/components/lp-new/tokens";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { APP_NAME, OPERATOR_X_HANDLE, OPERATOR_X_URL } from "@/lib/app-config";
import { yen } from "@/lib/format";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * /new — 先行公開の新LP（T-M8-419）。現行の `/`（SC-01）には触らず、別ページとして置く。
 *
 * - server component のみ（"use client" を置かない）。JSが1行も動かなくても全文が読める
 *   （初期 opacity:0・IntersectionObserver・animation-timeline を使わない・T-M8-76）。
 * - 公開のまま noindex（検索には載せない。切り替えの判断は運営者）。
 * - 価格・分野名・サービス名・URLは PLANS / yen / OPERATED_THEME_OPTIONS / APP_NAME /
 *   OPERATOR_X_URL / LegalFooterLinks から描き、直書きしない。
 * - 製品の仕組み（分析はボタン1つ・1日1回・表示専用／既定は下書きまで／60〜90秒／Xのみ）は曲げない。
 *   記法は3つ: 自動（集める・作る・投稿・記録）／AI・押すだけ（分析）／あなた（確認・反映）。
 * - 動的レンダリングの指定は `app/layout.tsx` が一括で持つ（ここに dynamic を書かない・T-M8-87）。
 * - 閲覧計測（recordPageView）は呼ばない（TRACKED_PAGES に無い。数えるなら型と集計を同時に足す）。
 */

export const metadata: Metadata = {
  // ヒーローの H1 と同文（タブ・共有カードで「完全自動化」だけが単独で出ないよう「数時間 →」まで入れる）。
  title: `${APP_NAME} — 日々のSNS活動を数時間 → 完全自動化。AIクローン生成プラットフォーム`,
  // /new 専用（APP_DESCRIPTION の「分析改善までを自動化」は分析の起点と合わないため、ここでは使わない）。
  description:
    "ニュース収集・投稿作成・実績の記録を自動で回し、投稿は同意後に自動。分析はボタン1つで、反映するかはあなたが決める、X（旧Twitter）運用アプリ。",
  robots: { index: false, follow: false },
};

const NAV_LINKS: [string, string][] = [
  ["#loop", "仕組み"],
  ["#tour", "画面"],
  ["#pricing", "料金"],
  ["#faq", "FAQ"],
];

/** 「現行ページ」への比較リンクは置かない（来訪者には意味が無く、テストページと分かるため）。 */
const FOOTER_LINKS: [string, string][] = [
  ...NAV_LINKS,
  ["/blog", "ブログ"],
  ["/prompt-templates", "プロンプト集"],
];

/** 見出し行（左に H2＋サブ、880px以上では右端に副CTA）。 */
function SectionHead({
  title,
  sub,
  aside,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-4 min-[880px]:grid-cols-[1fr_auto]">
      <div>
        <h2 className={H2}>{title}</h2>
        {sub ? <p className={SUB}>{sub}</p> : null}
      </div>
      {aside ? <div className="min-[880px]:pb-1">{aside}</div> : null}
    </div>
  );
}

/** 主CTA＋副リンク＋法令注記のひとまとまり（ヒーロー・画面ツアー直後）。 */
function CtaRow({
  primary,
  secondaryHref,
  secondaryLabel,
  fullWidthOnMobile = false,
}: {
  primary: string;
  secondaryHref: string;
  secondaryLabel: string;
  fullWidthOnMobile?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className={cn(
            buttonVariants({ variant: "brand" }),
            PILL_LG,
            CTA_PRIMARY_HOVER,
            fullWidthOnMobile && "w-full min-[480px]:w-auto",
          )}
          href="/signup"
        >
          {primary}
        </Link>
        <a
          className={cn(
            buttonVariants({ variant: "subtle" }),
            PILL_LG,
            "gap-1",
            fullWidthOnMobile && "w-full min-[480px]:w-auto",
          )}
          href={secondaryHref}
        >
          {secondaryLabel}
          <Icon name="chevron_right" size={16} />
        </a>
      </div>
      <p className="mt-3 max-w-[560px] text-sm text-ink-2 [text-wrap:balance] [word-break:auto-phrase]">
        {TRIAL_NOTE}
      </p>
    </>
  );
}

const WHY_CLONE: TextCard[] = [
  {
    icon: "edit_square",
    title: "あなたの言葉で書く",
    body: "アカウント.mdと投稿プロンプトが、すべての生成の土台。全プランで編集できます。",
  },
  {
    icon: "history",
    title: "あなたの投稿を分析する",
    body: "対象はXアカウントの投稿そのもの（最大300件）。このサービス経由でなくても構いません。",
  },
  {
    icon: "check_circle",
    title: "あなたが決める",
    body: "改善案を反映するのも、自動投稿を許すのも、あなた。既定は下書きまで。",
  },
];

const SAFETY: TextCard[] = [
  {
    icon: "lock",
    title: "鍵は、暗号化して保存",
    body: "APIキーとXトークンは AES-256-GCM で暗号化して保存します。",
  },
  {
    // X API は投稿のほか、実績・フォロワー数・分析対象の投稿の「読み取り」も行う（K-1〜K-3）。「投稿だけ」と書かない。
    icon: "verified_user",
    title: "Xの公式APIで、書き込みは投稿だけ",
    body: "読み取りは実績と分析のためだけ。自動いいね・自動フォロー・自動リプライは行いません（凍結リスクを避けるため）。",
  },
  {
    icon: "key",
    title: "費用が見える",
    body: "プレミアム以上は追加費用なし。スタンダードは X API と生成AI API の利用料がご自身の契約で発生します（従量）。",
  },
];

export default function NewLanding() {
  const startingPrice = `${yen(PLANS.standard.monthlyPriceJpy)}円`;
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-page text-sm leading-[1.8] text-ink tabular-nums [text-wrap:pretty]">
      {/*
       * ページ全体を貫く「1枚の空気」: 放射グラデのブロブ3個を fixed でビューポートに留める
       * （absolute で上端 1600px に置くと、総高の85%が素のベタになり中盤のカードが浮かない）。
       * 全セクションの背景は透明。ブロブは translate をアニメするので合成レイヤーに載せる。
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div
          className={cn(
            styles.drift1,
            "absolute left-[-15%] top-[-10%] size-[720px] rounded-full bg-[radial-gradient(circle,rgba(125,31,117,0.14),transparent_70%)] blur-3xl will-change-transform",
          )}
        />
        <div
          className={cn(
            styles.drift2,
            "absolute right-[-20%] top-[30%] size-[640px] rounded-full bg-[radial-gradient(circle,rgba(181,122,176,0.18),transparent_70%)] blur-3xl will-change-transform",
          )}
        />
        <div
          className={cn(
            styles.drift3,
            "absolute bottom-[-20%] left-[30%] size-[560px] rounded-full bg-[radial-gradient(circle,rgba(0,175,255,0.07),transparent_70%)] blur-3xl will-change-transform",
          )}
        />
      </div>

      {/* ヘッダー: 背景グラデが透ける半透明・罫線なし・主CTAは常時表示。SPでもログインを消さない（再訪者の導線）。 */}
      <header className="sticky top-0 z-20 bg-[rgba(255,255,255,0.72)] backdrop-blur-[10px]">
        <div
          className={`${CONTAINER} flex h-16 items-center justify-between gap-4`}
        >
          <BrandLogo href="/" priority />
          <nav
            aria-label="セクション"
            className="hidden items-center gap-6 min-[880px]:flex"
          >
            {NAV_LINKS.map(([href, label]) => (
              <a
                className="inline-flex min-h-6 items-center text-sm font-medium text-ink-2 transition-colors hover:text-brand"
                href={href}
                key={href}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              className="inline-flex min-h-6 items-center px-2 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors hover:text-brand"
              href="/login"
            >
              ログイン
            </Link>
            <Link
              className={cn(
                buttonVariants({ variant: "brand" }),
                "h-9 rounded-pill px-5 text-sm font-bold whitespace-nowrap",
              )}
              href="/signup"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ヒーロー */}
        <section className="relative overflow-x-clip">
          <div
            className={`${CONTAINER} grid grid-cols-1 items-center gap-[clamp(28px,4vw,56px)] pt-[clamp(40px,6vw,80px)] pb-[clamp(24px,4vw,48px)] min-[960px]:min-h-[calc(100svh-64px-96px)] min-[960px]:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]`}
          >
            <div className="min-w-0">
              {/*
               * 文言は運営者のタイトルをそのまま（textContent が完全一致するよう、装飾は span の色だけ）。
               * 和文は任意の位置で折り返されるため、語の途中（「数/時間」「プラ/ットフォーム」）で
               * 切れないよう、意味の切れ目だけを inline-block の単位にしてある。
               * 「数時間」は本文色のまま（薄くすると飛ばして読まれ、対比が立たない）。矢印と「完全自動化」だけ brand。
               */}
              <h1 className={H1}>
                <span className="inline-block">日々のSNS活動を</span>
                <span className="min-[1040px]:inline-block">
                  <span className="inline-block">数時間</span>{" "}
                  <span className="inline-block text-brand">→</span>{" "}
                  <span className="inline-block">
                    <span className="text-brand">完全自動化</span>。
                  </span>
                </span>
                <span className="block">
                  <span className="inline-block">AIクローン生成</span>
                  <span className="inline-block">プラットフォーム。</span>
                </span>
              </h1>
              {/* 投稿は同意後にだけ自動（S-3）。分析はボタン1つ（K-2）。文節ごとに inline-block で語の途中の折れを防ぐ。 */}
              <p className={cn(LEAD, "mt-6 max-w-[560px]")}>
                <span className="inline-block">使うほど、</span>
                <span className="inline-block">あなたのAIクローンが育つ。</span>
                <span className="inline-block">
                  集める→作る→記録は自動で回り、
                </span>
                <span className="inline-block">投稿は同意後に自動。</span>
                <span className="inline-block">分析はボタン1つ。</span>
                <span className="inline-block">
                  反映するかは、あなたが決める。
                </span>
              </p>
              <div className="mt-8">
                <CtaRow
                  fullWidthOnMobile
                  primary="無料で始める"
                  secondaryHref="#tour"
                  secondaryLabel="実際の画面を見る"
                />
              </div>
            </div>
            <div className="min-w-0">
              <HeroDiagram />
            </div>
          </div>
          {/* 7工程の帯（ダイアグラムの外・コンテナ幅いっぱい）。 */}
          <div className={cn(CONTAINER, "pb-[clamp(24px,4vw,48px)]")}>
            <HeroSteps />
          </div>
        </section>

        {/* 数字で見る、自動の中身 */}
        <section
          className={`${CONTAINER} pt-[clamp(40px,6vw,72px)] pb-[clamp(24px,4vw,48px)]`}
        >
          <h2
            className={cn(
              "text-[length:clamp(24px,calc(14px_+_1.2vw),32px)] leading-[1.3]",
              HEADING,
            )}
          >
            数字で見る、自動の中身
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            どれも実装済みの設定値です（生成時間は実測の目安）。
          </p>
          <div className={cn(GLASS, "mt-6 p-6 min-[1040px]:p-8")}>
            {/* 5列は 1040px 以上だけ（値が折り返さない幅）。長い値の列（分野名・1・7・30日）を少し広く取る。 */}
            <dl className="grid grid-cols-2 gap-6 min-[640px]:grid-cols-3 min-[1040px]:grid-cols-[4fr_5fr_4fr_4fr_5fr] min-[1040px]:divide-x min-[1040px]:divide-hairline">
              {STATS.map((stat, index) => (
                <div
                  className={cn(
                    "min-w-0 min-[1040px]:pl-6 min-[1040px]:first:pl-0",
                    index === STATS.length - 1 &&
                      "col-span-2 min-[640px]:col-span-1",
                  )}
                  key={stat.value}
                >
                  <Icon className="text-brand" name={stat.icon} size={20} />
                  <dt className="mt-2 text-[length:clamp(26px,calc(12px_+_1.6vw),36px)] font-medium leading-none whitespace-nowrap tabular-nums">
                    {stat.value}
                  </dt>
                  <dd className="mt-2 text-sm leading-[1.6] text-ink-2">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
            {/* 利用している技術: カードの足元に文字だけのピルで（同じアイコンの連続はプレースホルダーに見える）。 */}
            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-4">
              <span className="mr-1 text-caption text-ink-3">
                利用している技術
              </span>
              {TECH.map((tech) => (
                <span
                  className="inline-flex h-9 items-center gap-2 rounded-pill bg-white/70 px-4 text-sm font-medium whitespace-nowrap text-ink shadow-[var(--shadow-card)]"
                  key={tech.name}
                >
                  {tech.icon === "x" ? <XLogo size={14} /> : null}
                  {tech.name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 手を動かす時間が、こう変わる（図面板）。数字は図面板の例の合計（直書きしない）。 */}
        <section className={cn(ANCHOR, CONTAINER, SECTION)} id="loop">
          <SectionHead
            sub="ある1日の例です。集める・作る・投稿・記録は自動、分析はボタン1つ。下書きの確認と、改善案を反映するかだけが、あなたの仕事です。"
            title={
              <>
                <span className="inline-block">手を動かす時間が、</span>
                <span className="inline-block tabular-nums">
                  {LOOP_TOTALS.before} → {LOOP_TOTALS.after} に。
                </span>
              </>
            }
          />
          <div className="mt-[clamp(24px,4vw,48px)]">
            <LoopBoard />
          </div>
        </section>
        {/* 図面板の直後: 線で切らずに次へ溶かす薄い帯（紫の空気につなげる）。 */}
        <div
          aria-hidden="true"
          className="-mt-[clamp(64px,9vw,120px)] h-[160px] bg-[linear-gradient(to_bottom,rgba(125,31,117,0.07),transparent)]"
        />

        {/* 実際の画面で、工程を追う */}
        <section className={cn(ANCHOR, CONTAINER, SECTION)} id="tour">
          <SectionHead
            aside={
              <a
                className={cn(buttonVariants({ variant: "subtle" }), PILL_MD)}
                href="#pricing"
              >
                料金を見る
              </a>
            }
            sub="実際の管理画面のスクリーンショットです（一部を切り出し。画面は改良で変わることがあります）。"
            title={
              <>
                <span className="inline-block">実際の画面で、</span>
                <span className="inline-block">工程を追う</span>
              </>
            }
          />
          <Tour />
          {/* 納得の直後に受け皿を置く（ヒーローから料金まで主CTAが無い区間を作らない）。 */}
          <div className="mt-[clamp(24px,4vw,48px)]">
            <CtaRow
              primary="この画面で始める"
              secondaryHref="#pricing"
              secondaryLabel="料金を見る"
            />
          </div>
        </section>

        {/* 何が出てくるか（運営者の実投稿）。事実確認と実投稿3件が揃うまで描画しない。 */}
        {OUTPUT_ENABLED ? (
          <section className={cn(CONTAINER, SECTION)}>
            <SectionHead
              aside={
                <a
                  aria-label="運営者のXアカウントを開く（新しいタブで開く）"
                  className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-brand"
                  href={OPERATOR_X_URL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  @{OPERATOR_X_HANDLE} を見る
                  <Icon name="open_in_new" size={13} />
                </a>
              }
              sub="当方のXアカウントも、このシステムで日々投稿しています。"
              title="何が出てくるかは、投稿で判断してください"
            />
          </section>
        ) : null}

        {/* 勝手には、投稿しない */}
        <section className={cn(CONTAINER, SECTION)}>
          <SectionHead
            sub="既定は下書きまで。自動投稿は内容と停止方法を読んで同意した後に始まり、いつでも即時に止められます。"
            title="勝手には、投稿しない"
          />
          <ControlCards />
        </section>

        {/* 使うほど、あなたの言葉に近づく（背景の印がコンテナの外へ少し出るので、ここだけ横を clip する） */}
        <section className={cn(CONTAINER, SECTION, "overflow-x-clip")}>
          <Grow />
        </section>

        {/* 「クローン」と呼ぶ理由（文字だけの3カード） */}
        <section className={cn(CONTAINER, SECTION)}>
          <SectionHead
            sub="テンプレの量産機ではありません。あなたの言葉で書き、あなたの投稿を分析し、あなたが決めます。"
            title="「クローン」と呼ぶ理由"
          />
          <TextCards className="mt-[clamp(24px,4vw,48px)]" items={WHY_CLONE} />
        </section>

        {/* 料金: PricingCards（角丸8pxの白カード）をガラスで二重に囲まず、ブロブだけで浮かせる。 */}
        <section className={cn(ANCHOR, "relative isolate")} id="pricing">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          >
            <div className="absolute left-1/2 top-1/2 size-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(125,31,117,0.10),transparent_70%)] blur-3xl" />
          </div>
          <div className={cn(CONTAINER, SECTION)}>
            <SectionHead
              aside={
                <a
                  className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-brand"
                  href="#faq"
                >
                  よくある質問
                  <Icon name="chevron_right" size={13} />
                </a>
              }
              // 連携できるXアカウント数（1／1／3）もカードに出るので「2つだけ」と断定しない。
              sub="APIキーを自分で用意するか、利用上限か（連携できるXアカウント数はカードに記載）。全プラン、はじめての方は7日間無料です。"
              title={
                <>
                  <span className="inline-block">
                    月額{startingPrice}から。
                  </span>
                  <span className="inline-block">主な違いは2つ</span>
                </>
              }
            />
            <div className="mt-[clamp(16px,3vw,40px)]">
              <PricingCards />
            </div>
          </div>
        </section>

        {/* 安心して任せるために */}
        <section className={cn(CONTAINER, SECTION)}>
          <SectionHead
            sub="自動で動く部分ほど、止め方・預かり方・費用を先に決めています。"
            title="安心して任せるために"
          />
          <TextCards className="mt-[clamp(24px,4vw,48px)]" items={SAFETY} />
        </section>

        {/* よくある疑問 */}
        <section className={cn(ANCHOR, CONTAINER, SECTION)} id="faq">
          <div className="grid grid-cols-1 gap-[clamp(24px,4vw,56px)] min-[880px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <h2
              className={cn(
                H2,
                "self-start min-[880px]:sticky min-[880px]:top-[88px]",
              )}
            >
              <span className="inline-block">よくある疑問に、</span>
              <span className="inline-block">先に答える</span>
            </h2>
            <NewFaqList />
          </div>
        </section>

        {/* 最終CTA: 全幅帯ではなく角丸の大グラデカード。注記はグラデの濃い側でも AA を割らないよう ink。 */}
        <div className={cn(CONTAINER, "pb-[clamp(56px,8vw,96px)]")}>
          <section className="relative overflow-hidden rounded-[24px] bg-[radial-gradient(120%_120%_at_0%_0%,#ffffff_0%,#f4e8f3_45%,rgba(181,122,176,0.35)_100%)] p-[clamp(32px,6vw,80px)] shadow-[var(--shadow-pop)]">
            <div className="grid grid-cols-1 items-center gap-8 min-[880px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <LogoTile size={40} />
                  <span className="text-[17px] font-medium tracking-tight">
                    {APP_NAME}
                  </span>
                </div>
                <h2
                  className={cn(
                    "mt-6 text-[length:clamp(32px,calc(18px_+_2.6vw),56px)] leading-[1.15]",
                    HEADING,
                  )}
                >
                  <span className="inline-block">7日間、実物で</span>
                  <span className="inline-block">確かめてください。</span>
                </h2>
                <p className="mt-4 max-w-[560px] text-sm text-ink [text-wrap:balance] [word-break:auto-phrase]">
                  {TRIAL_NOTE}
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link
                    className={cn(
                      buttonVariants({ variant: "brand" }),
                      PILL_LG,
                      CTA_PRIMARY_HOVER,
                    )}
                    href="/signup"
                  >
                    無料で始める
                  </Link>
                  <a
                    className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-brand"
                    href="#tour"
                  >
                    もう一度、画面を見る
                  </a>
                </div>
              </div>
              <div className="flex flex-col items-center gap-4">
                <CloneMark
                  className="size-[160px] min-[880px]:size-[260px]"
                  id="clone-final"
                  rings={4}
                  stroke="rgba(125,31,117,0.35)"
                />
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className={CHIP_AUTO}>自動 4</span>
                  <span className={CHIP_AI}>AI・押すだけ 1</span>
                  <span className={CHIP_YOU}>あなた 2</span>
                </div>
                <p className="text-center text-caption text-ink">
                  集める・作る・投稿・記録／分析／確認・反映
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* フッター: ここだけ白にして本編との境界を作る。 */}
      <footer className="border-t border-hairline bg-surface py-10">
        <div
          className={`${CONTAINER} grid grid-cols-1 items-start gap-6 min-[760px]:grid-cols-[1fr_auto]`}
        >
          <div className="flex items-center gap-2.5">
            <LogoTile size={28} />
            <span className="text-body font-bold">{APP_NAME}</span>
            <span className="text-caption text-ink-3">© 2026</span>
          </div>
          <nav aria-label="サイト" className="flex flex-wrap gap-x-5 gap-y-2">
            {FOOTER_LINKS.map(([href, label]) => (
              <a
                className="inline-flex min-h-6 items-center gap-1 text-body text-ink-2 transition-colors hover:text-brand"
                href={href}
                key={href}
              >
                {label}
                {!href.startsWith("#") ? (
                  <Icon name="open_in_new" size={13} />
                ) : null}
              </a>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 min-[760px]:col-span-2">
            <a
              aria-label={`運営者のXアカウント @${OPERATOR_X_HANDLE}（新しいタブで開く）`}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "rounded-full text-ink-2 hover:bg-brand-subtle hover:text-brand",
              )}
              href={OPERATOR_X_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              <XLogo size={18} />
            </a>
            <LegalFooterLinks
              className="flex flex-wrap gap-x-5 gap-y-2"
              linkClassName="inline-flex min-h-6 items-center text-caption text-ink-2 transition-colors hover:text-brand"
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
