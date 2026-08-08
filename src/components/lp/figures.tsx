import { cn } from "@/lib/utils";

/**
 * LP「できること」「しくみ」のCSS図版（design_handoff_space_ai_lp）。
 * すべて装飾（`aria-hidden`）で、画像アセットを使わずDOMで描く。
 * 図版内の極小テキストは11pxで統一する（参照デザインの10px相当。type-scale.test.ts の許可リスト対象）。
 */

/** 情報収集の自動化: 時刻・見出しバー・重要度チップの3行。 */
export function NewsFeedFigure() {
  const rows: { time: string; width: string; high: boolean }[] = [
    { time: "10:00", width: "max-w-[62%]", high: true },
    { time: "12:00", width: "max-w-[48%]", high: false },
    { time: "14:00", width: "max-w-[55%]", high: true },
  ];
  return (
    <div
      aria-hidden="true"
      className="mt-4 grid gap-2 rounded-card border border-hairline bg-page px-3 py-2.5"
    >
      {rows.map((row) => (
        <div className="flex items-center gap-2.5" key={row.time}>
          <span className="w-[34px] flex-none text-[11px] text-ink-3">{row.time}</span>
          <span className={cn("h-[7px] flex-1 rounded bg-hairline", row.width)} />
          <span
            className={cn(
              "ml-auto inline-flex h-[18px] items-center rounded-chip px-[7px] text-[11px]",
              row.high
                ? "bg-brand-subtle font-medium text-brand"
                : "border border-hairline text-ink-2",
            )}
          >
            {row.high ? "高" : "中"}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 予約と自動運用: 曜日×時刻のドット表。●=そのまま投稿 ○=下書きまで。 */
export function ScheduleFigure() {
  // 参照HTMLのドット並びをそのまま写す（filled=そのまま投稿 / ring=下書きまで / off=なし）。
  const rows: { time: string; dots: ("filled" | "ring" | "off")[] }[] = [
    { time: "9:00", dots: ["filled", "ring", "filled", "off", "filled", "off", "off"] },
    { time: "19:30", dots: ["ring", "filled", "off", "filled", "ring", "filled", "off"] },
  ];
  const dotClass = {
    filled: "bg-brand",
    ring: "border-[1.5px] border-brand",
    off: "border border-hairline",
  } as const;
  return (
    <div
      aria-hidden="true"
      className="mt-4 grid gap-2 rounded-card border border-hairline bg-page p-3"
    >
      <div className="grid grid-cols-[44px_repeat(7,1fr)] items-center gap-1.5 text-center text-[11px] text-ink-3">
        <span />
        {["月", "火", "水", "木", "金", "土", "日"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      {rows.map((row) => (
        <div className="grid grid-cols-[44px_repeat(7,1fr)] items-center gap-1.5" key={row.time}>
          <span className="text-[11px] text-ink-3">{row.time}</span>
          {row.dots.map((dot, i) => (
            <span
              className={cn("size-2.5 justify-self-center rounded-pill", dotClass[dot])}
              key={i}
            />
          ))}
        </div>
      ))}
      <div className="mt-0.5 flex gap-3.5 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-[5px]">
          <span className="size-2 rounded-pill bg-brand" />
          そのまま投稿
        </span>
        <span className="inline-flex items-center gap-[5px]">
          <span className="size-2 rounded-pill border-[1.5px] border-brand" />
          下書きまで
        </span>
      </div>
    </div>
  );
}

/** 分析と改善提案: 棒グラフ6本＋記録タイミング＋「提案を更新」ボタン風チップ。 */
export function AnalyticsFigure() {
  const bars: { height: string; brand: boolean }[] = [
    { height: "h-3.5", brand: false },
    { height: "h-6", brand: false },
    { height: "h-5", brand: false },
    { height: "h-10", brand: true },
    { height: "h-[54px]", brand: true },
    { height: "h-[30px]", brand: false },
  ];
  return (
    <div
      aria-hidden="true"
      className="mt-4 flex flex-wrap items-end justify-between gap-3.5 rounded-card border border-hairline bg-page p-3.5"
    >
      <div className="flex h-14 items-end gap-2">
        {bars.map((bar, i) => (
          <span
            className={cn(
              "w-4 rounded-t-[3px]",
              bar.height,
              bar.brand ? "bg-brand" : "bg-brand-subtle",
            )}
            key={i}
          />
        ))}
      </div>
      <div className="text-[11px] text-ink-3">記録タイミング：投稿後 1日・7日・30日</div>
      <span className="inline-flex h-7 items-center rounded-card border border-hairline bg-surface px-3 text-caption font-medium text-brand">
        提案を更新
      </span>
    </div>
  );
}

/** しくみSTEP2: 発信定義書（ベースmd）。フローの中心で、brand枠と浮き影で強調する。 */
export function BaseMdFigure() {
  const sections = ["ペルソナ／発信テーマ", "トーン＆マナー", "NG設定", "学習させた文章"];
  return (
    <div className="overflow-hidden rounded-card border-[1.5px] border-brand bg-surface shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-2 border-b border-hairline bg-brand-subtle px-3.5 py-[9px]">
        <span aria-hidden="true" className="size-2 rounded-pill bg-brand" />
        <span className="text-caption font-bold text-brand">発信定義書（ベースmd）</span>
        <span className="ml-auto text-[11px] text-brand">アカウントごとに1つ</span>
      </div>
      <div className="px-4 py-3.5">
        <p className="mb-2 text-caption text-ink-2">STEP 2 — すべての生成の土台になる1枚。</p>
        <div aria-hidden="true" className="text-caption leading-8 text-ink-2">
          {sections.map((section) => (
            <div key={section}>
              <span className="font-bold text-brand">##</span> {section}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** しくみSTEP3: 生成中プログレスバー（7sループ）＋所要時間の注記。 */
export function GenerationProgressFigure() {
  return (
    <div aria-hidden="true">
      <div className="mt-2.5 h-1 max-w-[180px] overflow-hidden rounded-pill bg-page">
        <div className="lp-anim-bar h-full w-[70%] rounded-pill [background-image:var(--brand-gradient)]" />
      </div>
      <p className="mt-1.5 text-[11px] text-ink-3">通常60〜90秒</p>
    </div>
  );
}

/** しくみSTEP4: ぶれない投稿のミニカード。 */
export function MiniPostFigure() {
  return (
    <div
      aria-hidden="true"
      className="mt-2.5 rounded-card border border-hairline bg-page p-3"
    >
      <div className="flex items-center gap-2">
        <span className="size-6 flex-none rounded-pill bg-brand-subtle" />
        <div className="min-w-0">
          <p className="text-caption leading-[1.4] font-bold">あなたのアカウント</p>
          <p className="text-[11px] leading-[1.4] text-ink-3">いつもの文体・いつもの方針</p>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-[92%] rounded-[3px] bg-hairline" />
      <div className="mt-1.5 h-1.5 w-[70%] rounded-[3px] bg-hairline" />
    </div>
  );
}
