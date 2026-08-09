import { LogoTile } from "@/components/app-shell/brand-logo";
import { APP_NAME } from "@/lib/app-config";
import { cardClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * ヒーロー右の運用イメージ（LP専用の装飾）。図版はすべてCSS/DOMで描く（画像アセット無し）。
 * 実画面のスクリーンショットではないので全体が `aria-hidden`。
 *
 * 4枚でサービスの4つの特徴を上から順になぞる（T-M8-79）:
 * ①ニュースからの下書き＝情報収集の自動化 ②生成中＝投稿・画像の自動作成
 * ③下書き・予約・分析 ④スケジュール投稿＝融通の効くスケジュール設定
 */

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded-chip bg-brand-subtle px-2 text-[11px] font-medium text-brand">
      {label}
    </span>
  );
}

/**
 * ③ 下書き・予約・分析。**タブと中身がある「画面」に見える形**にする。
 * 数字を3つ並べただけでは、その3つがどんな画面なのか想像できなかった。
 */
function WorkspaceStrip() {
  const drafts: [string, string][] = [
    ["ニュース解説", "予約 9:30"],
    ["週次まとめ", "明日 12:00"],
  ];
  return (
    <div className={cn(cardClassName, "overflow-hidden")}>
      <div className="flex items-center gap-1 border-b border-hairline px-3 pt-2.5">
        <span className="rounded-t-chip border-b-2 border-brand px-2 pb-1.5 text-[11px] font-bold text-brand">
          下書き 3
        </span>
        <span className="px-2 pb-1.5 text-[11px] text-ink-3">予約 5</span>
        <span className="px-2 pb-1.5 text-[11px] text-ink-3">分析</span>
      </div>
      <div className="grid gap-1.5 px-3.5 py-2.5">
        {drafts.map(([title, when]) => (
          <div className="flex items-center gap-2" key={title}>
            <span className="size-1.5 flex-none rounded-pill bg-brand-subtle" />
            <span className="truncate text-[11px] text-ink">{title}</span>
            <span className="ml-auto flex-none text-[11px] text-ink-3">{when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** ④ スケジュール投稿。曜日×時刻の枠が組んであることを示す。 */
function SchedulePreview() {
  const rows: { time: string; dots: ("on" | "draft" | "off")[] }[] = [
    { time: "9:00", dots: ["on", "draft", "on", "off", "on", "off", "off"] },
    { time: "19:30", dots: ["draft", "on", "off", "on", "draft", "on", "off"] },
  ];
  const dotClass = {
    on: "bg-brand",
    draft: "border-[1.5px] border-brand",
    off: "border border-hairline",
  } as const;
  return (
    <div className={cn(cardClassName, "px-3.5 py-3")}>
      <div className="flex items-center gap-1.5">
        <Chip label="スケジュール投稿" />
        <span className="ml-auto text-[11px] text-ink-3">毎週くり返し</span>
      </div>
      <div className="mt-2.5 grid gap-1.5">
        <div className="grid grid-cols-[34px_repeat(7,1fr)] gap-1 text-center text-[11px] text-ink-3">
          <span />
          {["月", "火", "水", "木", "金", "土", "日"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {rows.map((row) => (
          <div className="grid grid-cols-[34px_repeat(7,1fr)] items-center gap-1" key={row.time}>
            <span className="text-[11px] text-ink-3">{row.time}</span>
            {row.dots.map((dot, i) => (
              <span className={cn("size-2 justify-self-center rounded-pill", dotClass[dot])} key={i} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeroMock() {
  return (
    // 下の余白はフロートカードの高さぶん取る。足りないとスケジュール表の最終列に重なる（T-M8-79）。
    <div aria-hidden="true" className="relative min-w-0 pb-[46px]">
      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
          <LogoTile size={20} />
          <span className="text-body font-bold">{APP_NAME}での運用イメージ</span>
        </div>
        <div className="grid gap-2.5 bg-page p-3.5">
          {/* ① ニュースから起こした下書き */}
          <div className={cn(cardClassName, "px-3.5 py-3")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip label="ニュース解説" />
              <span className="inline-flex h-5 items-center rounded-chip border border-hairline px-2 text-[11px] text-ink-2">
                重要度：高
              </span>
              <span className="ml-auto text-[11px] text-ink-3">予約 9:30</span>
            </div>
            <p className="mt-2 text-caption leading-[1.7] text-ink">
              生成AIの業務利用がさらに拡大というニュース。個人事業主が今日から試せるポイントを3つに整理しました…
            </p>
            <div className="mt-2.5 flex gap-2">
              <span className="inline-flex h-7 items-center rounded-card bg-brand px-3 text-caption font-medium text-white">
                投稿する
              </span>
              <span className="inline-flex h-7 items-center rounded-card border border-hairline bg-surface px-3 text-caption text-ink-2">
                編集
              </span>
            </div>
          </div>

          {/* ② 生成中（AIが動く瞬間） */}
          <div className={cn(cardClassName, "px-3.5 py-3")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip label="自分の考え・意見" />
              <span className="ml-auto text-[11px] text-ink-3">画像も生成中</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-pill bg-page">
              <div className="lp-anim-bar h-full w-[62%] rounded-pill [background-image:var(--brand-gradient)]" />
            </div>
            <div className="relative mt-[7px] h-[17px] text-[11px] text-ink-3">
              <span className="lp-anim-label-a absolute top-0 left-0">生成中… 通常60〜90秒</span>
              <span className="lp-anim-label-b absolute top-0 left-0 font-medium text-brand opacity-0">
                生成が完了しました。内容を確認してください
              </span>
            </div>
          </div>

          {/* ③ 下書き・予約・分析 */}
          <WorkspaceStrip />

          {/* ④ スケジュール投稿 */}
          <SchedulePreview />
        </div>
      </div>
      <div className="lp-anim-float absolute right-[-8px] bottom-0 flex items-center gap-2.5 rounded-card border border-hairline bg-surface px-3.5 py-3 shadow-[var(--shadow-pop)]">
        <div className="flex h-[26px] items-end gap-[3px]">
          <span className="h-2.5 w-[5px] rounded-[2px] bg-brand-subtle" />
          <span className="h-3.5 w-[5px] rounded-[2px] bg-brand-subtle" />
          <span className="h-3 w-[5px] rounded-[2px] bg-brand-subtle" />
          <span className="h-[18px] w-[5px] rounded-[2px] bg-brand" />
          <span className="h-6 w-[5px] rounded-[2px] bg-brand" />
        </div>
        <div>
          <p className="text-[11px] leading-normal font-bold">フォロワー推移</p>
          <p className="text-[11px] leading-normal text-ink-3">日次で自動記録</p>
        </div>
      </div>
    </div>
  );
}
