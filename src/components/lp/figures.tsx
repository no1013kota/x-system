import { cn } from "@/lib/utils";

/**
 * LP「できること」「しくみ」のCSS図版（design_handoff_space_ai_lp）。
 * すべて装飾（`aria-hidden`）で、画像アセットを使わずDOMで描く。
 * 図版内の極小テキストは11pxで統一する（参照デザインの10px相当。type-scale.test.ts の許可リスト対象）。
 */

/**
 * 情報収集の自動化: **ニュースが一覧で並んでいる**見え方にする（T-M8-79）。
 * 分野・時刻・重要度は実際の仕様（AI／投資／SNS運用の3分野・2時間おき・高中低）と揃える。
 * 見出しそのものは実在しない記事を作らないよう、バーで表す。
 */
export function NewsFeedFigure() {
  const items: { field: string; time: string; lines: [string, string]; high: boolean }[] = [
    { field: "AI", time: "10:00", lines: ["w-[92%]", "w-[64%]"], high: true },
    { field: "投資", time: "12:00", lines: ["w-[78%]", "w-[44%]"], high: false },
    { field: "SNS運用", time: "14:00", lines: ["w-[86%]", "w-[56%]"], high: true },
  ];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-card border border-hairline bg-page"
    >
      {items.map((item, index) => (
        <div className={cn("px-3 py-2.5", index > 0 && "border-t border-hairline")} key={item.field}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[18px] items-center rounded-chip border border-hairline bg-surface px-[7px] text-[11px] text-ink-2">
              {item.field}
            </span>
            <span className="text-[11px] text-ink-3">{item.time}</span>
            <span
              className={cn(
                "ml-auto inline-flex h-[18px] items-center rounded-chip px-[7px] text-[11px]",
                item.high
                  ? "bg-brand-subtle font-medium text-brand"
                  : "border border-hairline text-ink-2",
              )}
            >
              重要度 {item.high ? "高" : "中"}
            </span>
          </div>
          {/* 見出し2行ぶん。実在しない記事名を書かないための抽象表現。 */}
          <div className={cn("mt-2 h-[7px] rounded bg-hairline", item.lines[0])} />
          <div className={cn("mt-1.5 h-[7px] rounded bg-hairline/60", item.lines[1])} />
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
      className="grid gap-2 rounded-card border border-hairline bg-page p-3"
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
      className="flex flex-wrap items-end justify-between gap-3.5 rounded-card border border-hairline bg-page p-3.5"
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

/**
 * しくみSTEP2: 発信定義書（ベースmd）の中身。md風の「##」見出しを並べる。
 *
 * 以前はここだけ brand枠1.5px＋浮き影＋brand-subtleのヘッダー行で強調し、グリッドも1.18fr と
 * 広く取っていた。4ステップの中で1枚だけ器が違ううえ**見出し（h3）を持たない**ため、
 * 見出しの並びからも抜けていた。他のステップと同じ図版の器へ揃える（T-M8-78）。
 */
export function BaseMdFigure() {
  const sections = ["ペルソナ／発信テーマ", "トーン＆マナー", "NG設定", "学習させた文章"];
  return (
    <div
      aria-hidden="true"
      className="rounded-card border border-hairline bg-page px-3 py-2 text-caption leading-6 text-ink-2"
    >
      {sections.map((section) => (
        <div key={section}>
          <span className="font-bold text-brand">##</span> {section}
        </div>
      ))}
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

/*
 * しくみSTEP4のミニ投稿カード（MiniPostFigure）は削除した（T-M8-76）。
 * 抽象的な棒線だけで新しい情報が無く、しくみセクションの図版4つのうち最も密度を上げていた。
 */
