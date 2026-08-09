import { LogoTile } from "@/components/app-shell/brand-logo";
import { cardClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * ヒーロー右の「下書きの確認」アプリモック（LP専用の装飾）。
 * design_handoff_space_ai_lp の図版はすべてCSS/DOMで描く（画像アセット無し）。
 * 実画面のスクリーンショットではないので `aria-hidden`。文言・寸法は参照HTMLを正とする。
 */

function DraftChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded-chip bg-brand-subtle px-2 text-[11px] font-medium text-brand">
      {label}
    </span>
  );
}

export function HeroMock() {
  return (
    <div aria-hidden="true" className="relative min-w-0 pb-[26px]">
      <div className="overflow-hidden rounded-card border border-hairline bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center justify-between gap-2.5 border-b border-hairline px-4 py-2.5">
          <div className="flex items-center gap-2">
            <LogoTile size={20} />
            <span className="text-body font-bold">下書きの確認</span>
          </div>
          <div className="flex gap-1.5">
            <span className="inline-flex h-[22px] items-center rounded-chip bg-brand-subtle px-2.5 text-[11px] font-medium text-brand">
              下書き 3
            </span>
            <span className="inline-flex h-[22px] items-center rounded-chip px-2.5 text-[11px] text-ink-3">
              予約
            </span>
            <span className="inline-flex h-[22px] items-center rounded-chip px-2.5 text-[11px] text-ink-3">
              分析
            </span>
          </div>
        </div>
        <div className="grid gap-2.5 bg-page p-3.5">
          <div className={cn(cardClassName, "px-3.5 py-3")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <DraftChip label="ニュース解説" />
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
          <div className={cn(cardClassName, "px-3.5 py-3")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <DraftChip label="自分の考え・意見" />
              <span className="ml-auto text-[11px] text-ink-3">予約 12:30</span>
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
          <div className={cn(cardClassName, "px-3.5 py-3")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <DraftChip label="週次まとめ" />
              <span className="inline-flex h-5 items-center rounded-chip border border-hairline px-2 text-[11px] text-ink-2">
                下書きのまま
              </span>
              <span className="ml-auto text-[11px] text-ink-3">明日 12:00</span>
            </div>
            <p className="mt-2 text-caption leading-[1.7] text-ink">
              今週のAIニュース振り返り。反応の大きかった話題と、来週おさえておきたい動きをスレッドで…
            </p>
          </div>
        </div>
        {/* 「既定は下書きまで」の注記は「04 安全性」の1項目目と重複のため削除（T-M8-76）。 */}
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
