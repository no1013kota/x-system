import { cn } from "@/lib/utils";
import { SLOT_DOT_CLASS, type SlotDotKind, WEEKDAY_LABELS_LP } from "./dots";

/**
 * LP「できること」「しくみ」のCSS図版（design_handoff_space_ai_lp）。
 * すべて装飾（`aria-hidden`）で、画像アセットを使わずDOMで描く。
 * 図版内の極小テキストは11pxで統一する（参照デザインの10px相当。type-scale.test.ts の許可リスト対象）。
 */

/**
 * 情報収集の自動化: **ニュースが一覧で並んでいる**見え方にする（T-M8-79）。
 *
 * 以前は見出しを灰色のバーで表していたが、それでは「ニュースが並んでいる」ようには見えなかった。
 * 見出しは文字で書く（ヒーローのモックが既に架空の例文を使っているのと同じ扱い）。
 * **実在の記事・企業名は書かない。** 分野・時刻・重要度は実際の仕様と揃える
 * （AI／投資／SNS運用の3分野・10:00〜20:00に2時間おき・重要度 高中低）。
 */
export function NewsFeedFigure() {
  // 新着が上に積まれるフィードに見えるよう時刻は降順。収集の間隔はヘッダーが担うので行を6本にしない。
  const items: { field: string; time: string; headline: string; level: "high" | "mid" | "low" }[] = [
    { field: "SNS運用", time: "16:00", headline: "投稿の時間帯で表示回数に差", level: "high" },
    { field: "AI", time: "14:00", headline: "生成AIの業務利用がさらに拡大", level: "mid" },
    { field: "投資", time: "12:00", headline: "少額から始める資産形成に関心", level: "low" },
    { field: "AI", time: "10:00", headline: "画像生成の新しいモデルが公開", level: "high" },
  ];
  // 重要度は仕様どおり3段。既存トークンだけで濃淡を作る（新しい面の色を増やさない）。
  const levelClass = {
    high: "bg-brand-subtle font-medium text-brand",
    mid: "border border-hairline text-ink-2",
    low: "text-ink-3",
  } as const;
  const levelLabel = { high: "高", mid: "中", low: "低" } as const;
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-card border border-hairline bg-page">
      <div className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <span className="text-[11px] font-bold text-ink">今日のニュース</span>
        <span className="ml-auto text-[11px] text-ink-3">10:00〜20:00 ／ 2時間おき</span>
      </div>
      {items.map((item, index) => (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2",
            index > 0 && "border-t border-hairline",
          )}
          key={item.time}
        >
          <span className="w-[34px] flex-none text-[11px] text-ink-3">{item.time}</span>
          <span className="inline-flex h-[18px] flex-none items-center rounded-chip border border-hairline bg-surface px-[7px] text-[11px] text-ink-2">
            {item.field}
          </span>
          <p className="min-w-[180px] flex-1 truncate text-caption text-ink">{item.headline}</p>
          <span
            className={cn(
              "ml-auto inline-flex h-[18px] flex-none items-center rounded-chip px-[7px] text-[11px]",
              levelClass[item.level],
            )}
          >
            重要度 {levelLabel[item.level]}
          </span>
        </div>
      ))}
      {/* 導線は器の外周に1回だけ。各行に繰り返すと情報1つぶんに面積を4倍使う。 */}
      <div className="border-t border-hairline bg-surface px-3 py-2">
        <span className="inline-flex h-[18px] items-center rounded-chip bg-brand-subtle px-[7px] text-[11px] font-medium text-brand">
          この記事から投稿を作る
        </span>
      </div>
    </div>
  );
}

/** 予約と自動運用: 曜日×時刻のドット表。●=そのまま投稿 ○=下書きまで。 */
export function ScheduleFigure() {
  // 参照HTMLのドット並びをそのまま写す（post=そのまま投稿 / draft=下書きまで / none=なし）。
  const rows: { time: string; dots: SlotDotKind[] }[] = [
    { time: "9:00", dots: ["post", "draft", "post", "none", "post", "none", "none"] },
    { time: "19:30", dots: ["draft", "post", "none", "post", "draft", "post", "none"] },
  ];
  return (
    <div
      aria-hidden="true"
      className="grid gap-2 rounded-card border border-hairline bg-page p-3"
    >
      <div className="grid grid-cols-[44px_repeat(7,1fr)] items-center gap-1.5 text-center text-[11px] text-ink-3">
        <span />
        {WEEKDAY_LABELS_LP.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      {rows.map((row) => (
        <div className="grid grid-cols-[44px_repeat(7,1fr)] items-center gap-1.5" key={row.time}>
          <span className="text-[11px] text-ink-3">{row.time}</span>
          {row.dots.map((dot, i) => (
            <span
              className={cn("size-2.5 justify-self-center rounded-pill", SLOT_DOT_CLASS[dot])}
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

/*
 * しくみの図版（BaseMdFigure / GenerationProgressFigure）は削除した（T-M8-80）。
 * 03を「集める→作る→出す→測る」の4ステップへ組み替えた際、4枚とも同じ「次へ渡すもの」の
 * 器に統一したため専用の図版が不要になった。生成中バーはそのスロット内にインラインで持つ。
 */

/*
 * しくみSTEP4のミニ投稿カード（MiniPostFigure）は削除した（T-M8-76）。
 * 抽象的な棒線だけで新しい情報が無く、しくみセクションの図版4つのうち最も密度を上げていた。
 */
