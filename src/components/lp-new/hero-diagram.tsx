import Image from "next/image";

import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { CHIP_CLASS, CHIP_LABEL, GLASS, HERO_BOARD, type Who } from "./tokens";

/**
 * ヒーロー右の「分解ダイアグラム」（T-M8-419）。
 *
 * 生スクショを丸ごと置かず、実画面の3片（型のカード・設定済みの枠・ニュースカード）を
 * ガラス板に載せ、左上の意味ラベル（作る／投稿／集める）で何の画面かを一目で示す。
 * 素材は `scripts/lp-new-crops.mjs` が public/lp-shots から切り出したもの（切り出しのみ・加工なし）。
 * 960px以上では板を重ねて右端を画面外へ約5%はみ出させる（section 側の overflow-x-clip で
 * body の横あふれは出ない）。960px未満は板A・板Bを出さない——幅350pxに縮むと文字が数pxの
 * 滲みになり「壊れたサムネイル」に見えるため。読める板C（ニュースカード）だけを縦積みで投稿。
 */

/** 7工程（HeroSteps で描く）。分析だけ「ボタン1つ」、確認と改善が「あなた」。語は図面板のリング図・画面ツアーと同じ（テストで固定）。 */
const STEPS: { icon: IconName; label: string; who: Who }[] = [
  { icon: "newspaper", label: "集める", who: "auto" },
  { icon: "edit_square", label: "作る", who: "auto" },
  { icon: "drafts", label: "確認", who: "you" },
  { icon: "output", label: "投稿", who: "auto" },
  { icon: "monitoring", label: "記録", who: "auto" },
  { icon: "tune", label: "分析", who: "ai" },
  { icon: "check_circle", label: "改善", who: "you" },
];

const BOARD = `${HERO_BOARD} relative p-3`;
/**
 * 板の見出し行: 左に意味ラベル（作る／投稿／集める）＋右に一言の注記。画像の上に重ねず、行として持つ（実画面の文字を隠さない）。
 * 注記は3枚で「作る＝時間／投稿＝時刻／集める＝頻度」に揃え、ヒーローだけで自動の中身が読めるようにする（2026-09-05）。
 * 数字は既存のもの（60〜90秒・10分おき）だけ。語はリング図・画面ツアーと同じ。
 */
const BOARD_HEAD = "mb-2 flex h-6 items-center gap-3";
const BOARD_NOTE = "shrink-0 text-caption text-ink-3";
const BOARD_TAG =
  "inline-flex h-6 shrink-0 items-center rounded-pill bg-brand-subtle px-2.5 text-caption font-medium text-brand";

export function HeroDiagram() {
  return (
    <div className="relative flex flex-col gap-4 min-[960px]:block min-[960px]:h-[580px] min-[960px]:w-[110%] min-[960px]:translate-x-[5%]">
      {/* 板A: 作る（型のカード2×2）。見出し行の生成中バーは「AIが動く瞬間」＝このページで1回目。PCのみ。 */}
      {/* 3周目（運営者の指摘「不自然な動き・整頓されていない配置」）: 傾き・浮遊・生成バーの動きをやめ、板を水平に整列。 */}
      <div
        className={cn(
          BOARD,
          "hidden min-[960px]:absolute min-[960px]:left-0 min-[960px]:top-0 min-[960px]:block min-[960px]:w-[min(560px,100%)]",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>作る</span>
          <span className={BOARD_NOTE}>60〜90秒で下書きに</span>
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

      {/* 板B: 投稿（設定済みの枠2行・次回の実行時刻）。PCのみ。 */}
      <div
        className={cn(
          BOARD,
          "hidden min-[960px]:absolute min-[960px]:right-0 min-[960px]:top-[200px] min-[960px]:block min-[960px]:w-[min(520px,100%)]",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>投稿</span>
          <span className={BOARD_NOTE}>予約した時刻に自動で</span>
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

      {/* 板C: 集める（ニュースカード1枚）。全幅で投稿唯一の板。960px未満は元画像の幅（594px）を超えて拡大しない。 */}
      <div
        className={cn(
          BOARD,
          "w-full max-w-[460px] min-[960px]:absolute min-[960px]:left-0 min-[960px]:top-[392px] min-[960px]:w-[min(340px,100%)] min-[960px]:max-w-none",
        )}
      >
        <div className={BOARD_HEAD}>
          <span className={BOARD_TAG}>集める</span>
          <span className={BOARD_NOTE}>10分おきに新着</span>
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

      {/* 同心円の「クローンの印」は撤去（3周目・意味が伝わらない装飾だった）。 */}
    </div>
  );
}

/**
 * ヒーロー直下の工程帯: 7工程を順序つきリスト（ol）で1行に。記法は「自動＝brand 塗り／
 * AI・押すだけ＝薄紫／あなた＝白ピル」（図面板・最終カードと共通）。
 * 1行にするのは 1120px 以上だけ（7工程の実測幅 約900px が収まる幅）。末尾の「繰り返す」の印は
 * 運営者の指示（2026-09-04）で削除した（ループは図面板のリング図が示す）。
 * それ未満は折り返す（960〜1039px で最後の工程が板の右端を突き抜けた実績があるため）。
 */
/** 工程名（帯・リング図・ツアーの一致を `landing-page.test.ts` が固定する）。 */
export const HERO_STEP_LABELS: readonly string[] = STEPS.map((step) => step.label);

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
    </ol>
  );
}
