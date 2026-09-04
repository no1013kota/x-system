import type { Metadata } from "next";
import Link from "next/link";

import { recordPageView } from "@/lib/ops/page-view-server";
import { BrandLogo, LogoTile } from "@/components/brand/brand-logo";
import { XLogo } from "@/components/brand/x-logo";
import { LegalFooterLinks } from "@/components/legal-footer";
import { PromptCards } from "@/components/lp-new/prompts";
import { NewFaqList } from "@/components/lp-new/faq";
import { OUTPUT_ENABLED } from "@/components/lp-new/facts";
import { Grow } from "@/components/lp-new/grow";
import { HeroDiagram, HeroSteps } from "@/components/lp-new/hero-diagram";
import { LOOP_TOTALS, LoopBoard } from "@/components/lp-new/loop-board";
import {
  PricingRecommendFirst,
  RECOMMENDED,
} from "@/components/lp-new/pricing-recommend-first";
import styles from "@/components/lp-new/new-lp.module.css";
import { Tour } from "@/components/lp-new/tour";
import {
  ANCHOR,
  CONTAINER,
  CTA_PRIMARY_HOVER,
  GLASS,
  H1,
  H2,
  H3,
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
import { COMMISSION_MONTHS, INVITE_TIERS, formatRateBps } from "@/lib/affiliate/config";
import { APP_NAME, OPERATOR_X_HANDLE, OPERATOR_X_URL } from "@/lib/app-config";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * SC-01 LP（T-M8-419 で `/new` として先行公開 → T-M8-420 で `/` に昇格・2026-09-04）。
 * 旧LPは `/old`（noindex）に残してある。
 *
 * - server component のみ（クライアント指令を置かない）。JSが1行も動かなくても全文が読める
 *   （初期 opacity:0・IntersectionObserver・animation-timeline を使わない・T-M8-76）。
 * - 価格・分野名・サービス名・URLは PLANS / yen / OPERATED_THEME_OPTIONS / APP_NAME /
 *   OPERATOR_X_URL / LegalFooterLinks から描き、直書きしない。
 * - 製品の仕組み（分析はボタン1つ・1日1回・表示専用／既定は下書きまで／60〜90秒／Xのみ）は曲げない。
 *   記法は3つ: 自動（集める・作る・投稿・記録）／ボタン1つ（分析）／あなた（確認・改善）。
 * - 動的レンダリングの指定は `app/layout.tsx` が一括で持つ（ここに dynamic を書かない・T-M8-87）。
 * - 入口ファネルの分母として `recordPageView("/")` を呼ぶ（T-M8-378。応答後に書くので表示は遅くならない）。
 */

export const metadata: Metadata = {
  // ヒーローの H1 と同文（運営者の指定 2026-09-04）。
  title: `${APP_NAME} — 日々のSNS活動を完全自動化　AIクローン生成プラットフォーム`,
  // APP_DESCRIPTION の「分析改善までを自動化」は分析の起点（ボタン1つ）と合わないため、ここでは使わない。
  description:
    "ニュース収集・投稿作成・実績の記録を自動で回し、投稿は同意後に自動。分析はボタン1つで、反映するかはあなたが決める、X（旧Twitter）運用アプリ。",
};

/**
 * ヘッダーnav。FAQの右にページ遷移の3本（ブログ・プロンプト集・友達招待）。
 * 「友達招待」は契約前でも参加できる導線（T-M8-268・運営者の指示 2026-08-23）で、行き先は
 * `/app/invite` 固定——未ログインは route guard が `/login?next=/app/invite` へ送り、ログイン後そのまま着く。
 */
const NAV_LINKS: [string, string][] = [
  ["#loop", "仕組み"],
  ["#tour", "画面"],
  ["#pricing", "料金"],
  ["#faq", "FAQ"],
  ["/blog", "ブログ"],
  ["/prompt-templates", "プロンプト集"],
  ["/app/invite", "友達招待"],
];

/** 「現行ページ」への比較リンクは置かない（来訪者には意味が無く、テストページと分かるため）。 */
const FOOTER_LINKS: [string, string][] = NAV_LINKS;

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

// 「クローンと呼ぶ理由」「安心して任せるために」の2セクションは3周目で削除（個人開発のサービスとして
// 冗長・企業向けの説明だったため）。鍵の暗号化・書き込み範囲の開示はFAQへ集約した。

export default async function Home() {
  await recordPageView("/");
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
            // 7本になったので 960px 未満は畳む（880px ではロゴ・ログイン・主CTAと合わせて容器を越える）。
            className="hidden items-center gap-6 min-[960px]:flex"
          >
            {NAV_LINKS.map(([href, label]) => (
              <a
                className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-ink-2 transition-colors hover:text-brand"
                href={href}
                key={href}
              >
                {label}
                {/* ページ遷移するリンクにはマークを付ける（アンカーと区別）。 */}
                {!href.startsWith("#") ? (
                  <Icon aria-hidden="true" name="open_in_new" size={13} />
                ) : null}
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
              {/* 文言は運営者の指定（2026-09-04）「日々のSNS活動を完全自動化　AIクローン生成プラットフォーム」。 */}
              <h1 className={H1}>
                <span className="block">
                  <span className="inline-block">日々のSNS活動を</span>
                  <span className="inline-block text-brand">完全自動化</span>
                </span>
                <span className="block">
                  <span className="inline-block">AIクローン生成</span>
                  <span className="inline-block">プラットフォーム</span>
                </span>
              </h1>
              {/* 投稿は同意後にだけ自動（S-3）。分析はボタン1つ（K-2）。文節ごとに inline-block で語の途中の折れを防ぐ。 */}
              <p className={cn(LEAD, "mt-6 max-w-[560px]")}>
                <span className="inline-block">使うほど、</span>
                <span className="inline-block">あなたのAIクローンが育つ。</span>
                <span className="inline-block">ニュース収集から投稿・記録まで自動。</span>
                <span className="inline-block">分析はボタン1つで、</span>
                <span className="inline-block">反映はあなたが決める。</span>
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

        {/* 「数字で見る、自動の中身」は削除（運営者の指示 2026-09-04・訴求要素が薄い）。 */}

        {/* 手を動かす時間が、こう変わる（図面板）。数字は図面板の例の合計（直書きしない）。 */}
        <section className={cn(ANCHOR, CONTAINER, SECTION)} id="loop">
          <SectionHead
            // After の棒は「確認」1本なので、サブ文も1つに揃える（改善案の判断は板の下段の h3 が担う）。
            sub={`ある1日の例。手を動かすのは、下書きを見る${LOOP_TOTALS.afterJa}だけ。`}
            // 「3h → 5m」は運営者指定の表記（視覚用）。読み上げでは「3エイチ 5エム」になるので和文を別に持つ。
            title={
              <>
                <span className="inline-block">手を動かす時間が、</span>
                <span aria-hidden="true" className="inline-block tabular-nums">
                  {LOOP_TOTALS.before} → {LOOP_TOTALS.after} に
                </span>
                <span className="sr-only">
                  {LOOP_TOTALS.beforeJa}から{LOOP_TOTALS.afterJa}に
                </span>
              </>
            }
          />
          <div className="mt-[clamp(24px,4vw,48px)]">
            <LoopBoard />
          </div>
        </section>
        {/* 図面板の直後にあった「暗色→紫へ溶かす帯」は、板を白にしたので不要（T-M8-421）。 */}

        {/* 投稿から改善まで（画面ツアー）: 見出し・索引は Tour が左列（sticky）に描き、CTA は右列の最後（停止04の直下）。 */}
        <section className={cn(ANCHOR, CONTAINER, SECTION)} id="tour">
          <Tour
            // 納得の直後に受け皿を置く（ヒーローから料金まで主CTAが無い区間を作らない）。
            cta={
              <CtaRow
                primary="無料で始める"
                secondaryHref="#pricing"
                secondaryLabel="料金を見る"
              />
            }
          />
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

        {/* 複数のプロンプトを管理（運営者の指示 2026-09-03。旧「勝手には、投稿しない」を置換） */}
        <section className={cn(CONTAINER, SECTION)}>
          <SectionHead
            sub="投稿の型・アカウント.md・画像の指示・使うAIモデル。クローンの中身は、すべてあなたが編集できます。"
            title="複数のプロンプトを管理"
          />
          <PromptCards />
        </section>

        {/* 使うほど、あなたの言葉に近づく（背景の印がコンテナの外へ少し出るので、ここだけ横を clip する） */}
        <section className={cn(CONTAINER, SECTION, "overflow-x-clip")}>
          <Grow />
        </section>

        {/* 料金: 推奨先行（lp-new/pricing-recommend-first）。共通部品を外から包むだけで、中身は /plans と同じ。 */}
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
              // 錨を推奨（RECOMMENDED_PLAN）に置く。APIキーの一言説明と、両隣の存在理由を1文で先出しする。
              sub={
                <>
                  {/* 主語を付ける（無いと「全プランでAPIキー不要」に読め、直下のスタンダードの要約と矛盾して見える）。 */}
                  <span className="inline-block">
                    {RECOMMENDED.displayName}なら、APIキー（AIとX連携に使う鍵）の用意がいりません。
                  </span>
                  <span className="inline-block">
                    自分で用意できるなら{PLANS.standard.displayName}、
                  </span>
                  <span className="inline-block">
                    投稿量が多いなら{PLANS.expert.displayName}。
                  </span>
                  <span className="inline-block">
                    {/* 帯の注記を外したので、料金のCTAより上に「カード登録」の条件を一言残す（暫定・D-54）。 */}
                    はじめての方は7日間無料（カード登録が必要）です。
                  </span>
                </>
              }
              title={
                <>
                  <span className="inline-block">迷ったら、</span>
                  <span className="inline-block">
                    {RECOMMENDED.displayName}から。
                  </span>
                </>
              }
            />
            <div className="mt-[clamp(16px,3vw,40px)]">
              <PricingRecommendFirst />
            </div>
            {/*
              友達招待キャンペーン（T-M8-268・運営者の指示 2026-08-23）。料金の直後・同じ面に置く。
              契約前でも参加できることを本文で言う（要件06 §1.5・要件03）。新LPへの差し替え（T-M8-420）で
              一度落ちていたのを invite-access.spec が検出した。
            */}
            <div
              className={cn(
                GLASS,
                "mt-[clamp(24px,4vw,48px)] px-[clamp(20px,4vw,44px)] py-[clamp(24px,4vw,40px)]",
              )}
            >
              <div className="flex flex-col gap-5 min-[880px]:flex-row min-[880px]:items-center min-[880px]:justify-between">
                <div className="max-w-[600px]">
                  <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1 text-caption font-bold text-brand">
                    <Icon aria-hidden="true" name="star_shine" size={13} />
                    友達招待キャンペーン
                  </p>
                  <h3 className={cn(H3, "mt-3 [text-wrap:balance]")}>
                    紹介した方の利用料から、最大
                    {formatRateBps(INVITE_TIERS[INVITE_TIERS.length - 1].rateBps)}が報酬に
                  </h3>
                  <p className="mt-2.5 text-body leading-6 text-ink-2 [text-wrap:pretty]">
                    {/* 1行に書く（JSXは行の継ぎ目に半角空白を入れるため、「から、 最大」と空く）。 */}
                    ご自身のプラン契約がなくても参加できます。あなたが招待した方が有料プランを利用した月から、最大{COMMISSION_MONTHS}か月分が報酬対象です（報酬率は招待人数に応じて上がります）。
                  </p>
                </div>
                <Link
                  className={cn(buttonVariants({ variant: "brand" }), PILL_MD, "shrink-0")}
                  href="/app/invite"
                >
                  招待リンクを受け取る
                </Link>
              </div>
            </div>
          </div>
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
              よくある質問
            </h2>
            <NewFaqList />
          </div>
        </section>

        {/* 最終CTA: 全幅帯ではなく角丸の大グラデカード。注記はグラデの濃い側でも AA を割らないよう ink。 */}
        <div className={cn(CONTAINER, "pb-[clamp(56px,8vw,96px)]")}>
          <section className="relative overflow-hidden rounded-[24px] bg-[radial-gradient(120%_120%_at_0%_0%,#ffffff_0%,#f4e8f3_45%,rgba(181,122,176,0.35)_100%)] p-[clamp(32px,6vw,80px)] shadow-[var(--shadow-pop)]">
            {/* 3周目: 右列（同心円＋「自動4／AI1／あなた2」の集計）は意味が伝わらないため撤去し、1カラム中央寄せに。 */}
            <div className="mx-auto flex max-w-[640px] flex-col items-center text-center">
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
                {/* 文言は運営者指定（2026-09-04）。「解放」＝毎日のSNS作業からの解放。 */}
                <span className="inline-block">7日間の解放を</span>
                <span className="inline-block">お試しください</span>
              </h2>
              <p className="mt-4 max-w-[560px] text-sm text-ink [text-wrap:balance] [word-break:auto-phrase]">
                {TRIAL_NOTE}
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
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
