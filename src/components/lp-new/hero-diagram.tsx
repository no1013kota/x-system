import Image from "next/image";

import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { CloneMark } from "./clone-mark";
import { CHIP_CLASS, CHIP_LABEL, GLASS, HERO_BOARD, type Who } from "./tokens";

/**
 * ヒーロー右の「分解ダイアグラム」（T-M8-419）。
 *
 * 生スクショを丸ごと置かず、実画面の3片（型のカード・設定済みの枠・ニュースカード）を
 * ガラス板に載せ、左上の意味ラベル（作る／出す／集める）で何の画面かを一目で示す。
 * 素材は `scripts/lp-new-crops.mjs` が public/lp-shots から切り出したもの（切り出しのみ・加工なし）。
 * 960px以上では板を重ねて右端を画面外へ約5%はみ出させる（section 側の overflow-x-clip で
 * body の横あふれは出ない）。960px未満は板A・板Bを出さない——幅350pxに縮むと文字が数pxの
 * 滲みになり「壊れたサムネイル」に見えるため。読める板C（ニュースカード）だけを縦積みで出す。
 */

/** 7工程（HeroSteps で描く）。分析だけ「AI・押すだけ」、確認と反映が「あなた」。 */
const STEPS: { icon: IconName; label: string; who: Who }[] = [
  { icon: "newspaper", label: "集める", who: "auto" },
  { icon: "edit_square", label: "作る", who: "auto" },
  { icon: "drafts", label: "確認", who: "you" },
  { icon: "output", label: "投稿", who: "auto" },
  { icon: "monitoring", label: "記録", who: "auto" },
  { icon: "tune", label: "分析", who: "ai" },
  { icon: "check_circle", label: "反映", who: "you" },
];

const BOARD = `${HERO_BOARD} relative p-3`;
/** 板の見出し行: 左に意味ラベル（作る／出す／集める）。画像の上に重ねず、行として持つ（実画面の文字を隠さない）。 */
const BOARD_HEAD = "mb-2 flex h-6 items-center gap-3";
const BOARD_TAG =
  "inline-flex h-6 shrink-0 items-center rounded-pill bg-brand-subtle px-2.5 text-caption font-medium text-brand";

export function HeroDiagram() {
  return (
    <div className="relative flex flex-col gap-4 min-[960px]:block min-[960px]:h-[580px] min-[960px]:w-[110%] min-[960px]:translate-x-[5%]">
      {/* 板A: 作る（型のカード2×2）。見出し行の生成中バーは「AIが動く瞬間」＝このページで1回目。PCのみ。 */}
      <div
        className={cn(
          BOARD,
          "hidden min-[960px]:absolute min-[960px]:left-0 min-[960px]:top-0 min-[960px]:block min-[960px]:w-[min(560px,100%)] min-[960px]:rotate-[-1deg]",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>作る</span>
          {/* 数字を先に置く: 右端は画面外へはみ出すため、事実の数字（60〜90秒）を切らせない。 */}
          <span className="shrink-0 text-caption text-ink-3">
            生成中 通常60〜90秒
          </span>
          <div className="min-w-0 flex-1">
            <div className="h-[3px] w-full rounded-pill bg-black/[0.06]">
              <div className="lp-anim-bar h-[3px] rounded-pill [background-image:var(--brand-gradient)]" />
            </div>
          </div>
        </div>
        <Image
          alt="投稿作成画面の型（パターン）のカード4枚"
          className="block h-auto w-full rounded-[14px]"
          height={184}
          sizes="(min-width: 960px) 560px, 100vw"
          src="/lp-new/hero-patterns.jpg"
          width={780}
        />
      </div>

      {/* 板B: 出す（設定済みの枠2行・次回の実行時刻）。PCのみ。 */}
      <div
        className={cn(
          BOARD,
          "lp-anim-float hidden min-[960px]:absolute min-[960px]:right-0 min-[960px]:top-[200px] min-[960px]:block min-[960px]:w-[min(520px,100%)]",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>出す</span>
        </div>
        <Image
          alt="スケジュール画面の設定済みの枠（自動投稿・曜日と時刻・次回の実行時刻）"
          className="block h-auto w-full rounded-[14px]"
          height={160}
          sizes="(min-width: 960px) 520px, 100vw"
          src="/lp-new/hero-schedule.jpg"
          width={600}
        />
      </div>

      {/* 板C: 集める（ニュースカード1枚）。全幅で出す唯一の板。960px未満は元画像の幅（594px）を超えて拡大しない。 */}
      <div
        className={cn(
          BOARD,
          "lp-anim-float w-full max-w-[460px] [animation-delay:-3s] min-[960px]:absolute min-[960px]:left-10 min-[960px]:top-[392px] min-[960px]:w-[min(340px,100%)] min-[960px]:max-w-none min-[960px]:rotate-[1deg]",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>集める</span>
        </div>
        <Image
          alt="ニュースカード（分野と重要度のバッジ、「すぐに投稿作成」ボタン）"
          className="block h-auto w-full rounded-[14px]"
          height={220}
          priority
          sizes="(min-width: 960px) 340px, 100vw"
          src="/lp-new/hero-news.jpg"
          width={594}
        />
      </div>

      {/*
       * クローンの印（2輪）。板Bの下・板Cの右の空きに置く。1200px未満は板と重なるため出さない。
       * 図全体は右へ約5%はみ出すので、印は図の右端から 48px 内側（1200px 幅で右端 1195px・
       * 1280px 幅で 1258px）に置き、ビューポートの縁で欠けさせない。
       */}
      <CloneMark
        className="hidden size-[112px] min-[1200px]:absolute min-[1200px]:right-[48px] min-[1200px]:top-[404px] min-[1200px]:block"
        id="clone-hero"
        rings={2}
      />
    </div>
  );
}

/**
 * ヒーロー直下の工程帯: 7工程を順序つきリスト（ol）で1行に。記法は「自動＝brand 塗り／
 * AI・押すだけ＝薄紫／あなた＝白ピル」（図面板・最終カードと共通）。
 * 1行にするのは 1120px 以上だけ（7工程＋「繰り返す」の実測幅 約970px が収まる幅）。
 * それ未満は折り返す（960〜1039px で「反映」が板の右端を突き抜けた実績があるため）。
 */
export function HeroSteps() {
  return (
    <ol
      className={cn(
        GLASS,
        "flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 min-[1120px]:h-16 min-[1120px]:flex-nowrap min-[1120px]:justify-between min-[1120px]:px-6 min-[1120px]:py-0",
      )}
    >
      {STEPS.map((step) => (
        <li
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
          key={step.label}
        >
          <Icon className="shrink-0 text-brand" name={step.icon} size={20} />
          <span className="text-sm font-medium text-ink">{step.label}</span>
          <span className={CHIP_CLASS[step.who]}>{CHIP_LABEL[step.who]}</span>
        </li>
      ))}
      <li className="flex shrink-0 items-center gap-1 whitespace-nowrap text-caption text-ink-3">
        <Icon className="shrink-0" name="refresh" size={16} />
        繰り返す
      </li>
    </ol>
  );
}
