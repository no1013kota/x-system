import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { SLOT_DOT_CLASS, type SlotDotKind, WEEKDAY_LABELS_LP } from "./dots";

/**
 * LP「できること」「しくみ」のCSS図版（design_handoff_lp）。
 * すべて装飾（`aria-hidden`）で、画像アセットを使わずDOMで描く。
 * 図版内の極小テキストは11pxで統一する（参照デザインの10px相当。type-scale.test.ts の許可リスト対象）。
 */

/**
 * 情報収集の自動化: **ニュースが一覧で並んでいる**見え方にする（T-M8-79）。
 *
 * 以前は見出しを灰色のバーで表していたが、それでは「ニュースが並んでいる」ようには見えなかった。
 * 見出しは文字で書く（ヒーローのモックが既に架空の例文を使っているのと同じ扱い）。
 * **実在の記事・企業名は書かない。** 分野・時刻・重要度は実際の仕様と揃える
 * （運用6分野の一部を例示・10:00〜20:00に2時間おき・重要度 高中低。T-M8-189）。
 */
export function NewsFeedFigure() {
  // 新着が上に積まれるフィードに見えるよう時刻は降順。収集の間隔はヘッダーが担うので行を6本にしない。
  const items: { field: string; time: string; headline: string; level: "high" | "mid" | "low" }[] = [
    { field: "SNS運用", time: "16:00", headline: "投稿の時間帯で表示回数に差", level: "high" },
    { field: "AI", time: "14:00", headline: "生成AIの業務利用がさらに拡大", level: "mid" },
    { field: "美容", time: "12:00", headline: "スキンケアの新常識が話題に", level: "low" },
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

/** 投稿分析: 棒グラフ6本＋記録タイミング＋「毎朝レポート」チップ（自動生成・T-M8-94）。 */
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
        毎朝レポート
      </span>
    </div>
  );
}


/**
 * プロンプトの設計・編集（T-M8-172）: アカウント.md・投稿の型・画像生成の3区分を
 * タブで持つ編集画面の見え方。実画面（設定＞プロンプト）の区分と揃える。
 */
export function PromptEditorFigure() {
  const lines = [
    "# 発信の軸",
    "AI活用を、個人事業主の目線でやさしく解説する。",
    "## 文体",
    "断定しすぎず、実体験ベースで語る。絵文字は1投稿に1つまで。",
  ];
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-card border border-hairline bg-page">
      <div className="flex items-end gap-3 border-b border-hairline bg-surface px-3 pt-2">
        <span className="border-b-2 border-brand pb-1.5 text-[11px] font-medium text-brand">
          アカウント.md
        </span>
        <span className="border-b-2 border-transparent pb-1.5 text-[11px] text-ink-3">投稿の型</span>
        <span className="border-b-2 border-transparent pb-1.5 text-[11px] text-ink-3">画像生成</span>
        <span className="ml-auto pb-1.5 text-[11px] text-ink-3">v3</span>
      </div>
      <div className="grid gap-1 px-3 py-2.5">
        {lines.map((line) => (
          <p
            className={cn(
              "truncate text-[11px] leading-[1.7]",
              line.startsWith("#") ? "font-bold text-ink" : "text-ink-2",
            )}
            key={line}
          >
            {line}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-hairline bg-surface px-3 py-2">
        <span className="inline-flex h-[18px] items-center rounded-chip bg-brand-subtle px-[7px] text-[11px] font-medium text-brand">
          保存して履歴に残す
        </span>
        <span className="text-[11px] text-ink-3">いつでも前の版に戻せます</span>
      </div>
    </div>
  );
}

/**
 * 投稿・画像の自動作成（T-M8-172）: 生成された下書き（スレッド＋画像）の見え方。
 * 型チップの一覧だけでは「何ができあがるのか」が想像できなかったため、成果物を見せる。
 */
export function PostComposeFigure() {
  return (
    <div aria-hidden="true" className="grid gap-2 rounded-card border border-hairline bg-page p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-[18px] items-center rounded-chip bg-brand-subtle px-[7px] text-[11px] font-medium text-brand">
          型：ニュース解説
        </span>
        <span className="inline-flex h-[18px] items-center rounded-chip border border-hairline bg-surface px-[7px] text-[11px] text-ink-2">
          スレッド 3投稿
        </span>
        <span className="ml-auto text-[11px] text-ink-3">画像つき</span>
      </div>
      <div className="rounded-card border border-hairline bg-surface px-2.5 py-2">
        <p className="text-[11px] leading-[1.7] text-ink">
          生成AIの業務利用がまた一歩前へ。個人でも今日から試せる活用ポイントを3つに絞って解説します🧵
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-14 flex-none items-center justify-center rounded-card border border-hairline bg-brand-subtle text-[11px] font-medium text-brand">
          画像
        </span>
        <span className="text-[11px] text-ink-3">本文に合わせた画像も同時に生成</span>
        <span className="ml-auto inline-flex h-[18px] items-center rounded-chip border border-hairline bg-surface px-[7px] text-[11px] text-ink-2">
          編集・再生成OK
        </span>
      </div>
    </div>
  );
}

/**
 * しくみの成長グラフ（T-M8-172/177・運営者の指示）: 縦軸=アカウントの成長、横軸=運用時間。
 * 点を細かく刻み（10点・段差のある右肩上がり）、節目3つだけに太字の注釈を置く
 * （薄いグレーの補足文は置かない・2026-08-21の指示）。
 * y軸は「初版→学習・提案の反映で版が積み上がる」という事実の範囲に留め、
 * フォロワー増の保証と読める表現にはしない（反映は利用者が選ぶことを本文側が開示する）。
 */
export function GrowthChartFigure() {
  // 座標はviewBox基準の固定値（データではなく概念図）。段差＝反映のタイミング。
  const points: { x: number; y: number; label?: string }[] = [
    { x: 60, y: 196, label: "v1 初版" },
    { x: 108, y: 190 },
    { x: 156, y: 172 },
    { x: 204, y: 166 },
    { x: 252, y: 142, label: "学習・提案を反映" },
    { x: 300, y: 136 },
    { x: 348, y: 112 },
    { x: 396, y: 104 },
    { x: 444, y: 78 },
    { x: 492, y: 56, label: "あなた専用の1枚に" },
  ];
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div aria-hidden="true" className="rounded-card border border-hairline bg-page p-3.5">
      <svg className="h-auto w-full" role="presentation" viewBox="0 0 560 244">
        {/* 目盛り（横罫）。細かさを出すが主張はさせない。 */}
        {[76, 116, 156, 196].map((y) => (
          <line key={y} stroke="var(--hairline)" strokeWidth="1" x1="40" x2="544" y1={y} y2={y} />
        ))}
        {/* 軸 */}
        <line stroke="var(--ink-3)" strokeWidth="1.25" x1="40" x2="40" y1="16" y2="216" />
        <line stroke="var(--ink-3)" strokeWidth="1.25" x1="40" x2="544" y1="216" y2="216" />
        <text fill="var(--ink-2)" fontSize="12" fontWeight="600" x="48" y="30">
          ↑ アカウントの成長
        </text>
        <text fill="var(--ink-2)" fontSize="12" fontWeight="600" textAnchor="end" x="544" y="236">
          運用時間 →
        </text>
        {/* 面と線 */}
        <path
          d={`${path} L${last.x},216 L${points[0].x},216 Z`}
          fill="var(--brand-subtle)"
          opacity="0.7"
        />
        <path d={path} fill="none" stroke="var(--brand)" strokeLinecap="round" strokeWidth="2.5" />
        {points.map((p) => (
          <g key={`${p.x}-${p.y}`}>
            <circle
              cx={p.x}
              cy={p.y}
              fill={p.label ? "var(--surface)" : "var(--brand)"}
              r={p.label ? 5 : 3}
              stroke="var(--brand)"
              strokeWidth={p.label ? 2.5 : 0}
            />
            {p.label ? (
              <text
                fill="var(--ink)"
                fontSize="12"
                fontWeight="700"
                textAnchor={p.x > 460 ? "end" : "middle"}
                x={p.x > 460 ? p.x + 12 : p.x}
                y={p.y - 14}
              >
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * 01コンセプトの循環図（T-M8-177・運営者の指示 2026-08-21）。
 * 画像（JPEG）の埋め込みをやめ、ページのトークンで描く（LP図版はCSS/DOM/SVGの原則へ戻る）。
 * 内容は docs/lp/コンセプト.png と同じ4ステップの循環＋中央のサービス名。
 */
const CONCEPT_STEPS: { no: string; label: string; icon: IconName; pos: string }[] = [
  { no: "01", label: "プロンプトを設計", icon: "edit_square", pos: "top-0 left-1/2 -translate-x-1/2" },
  { no: "02", label: "投稿を生成・運用", icon: "drafts", pos: "top-1/2 right-0 -translate-y-1/2" },
  { no: "03", label: "投稿結果を分析", icon: "monitoring", pos: "bottom-0 left-1/2 -translate-x-1/2" },
  { no: "04", label: "プロンプトを改善", icon: "refresh", pos: "top-1/2 left-0 -translate-y-1/2" },
];

export function ConceptCycleFigure() {
  return (
    <figure aria-label="プロンプトを設計→投稿を生成・運用→投稿結果を分析→プロンプトを改善、の4ステップが循環する図。使うほど、プロンプトが磨かれる。">
      <div aria-hidden="true" className="relative mx-auto aspect-[4/3] w-full max-w-[520px]">
        {/* 循環の矢印（4本の弧）。 */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 300">
          <defs>
            <marker id="concept-arrow" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5" viewBox="0 0 8 7">
              <path d="M0,0 L8,3.5 L0,7 Z" fill="var(--brand)" />
            </marker>
          </defs>
          {[
            "M260.2,55.0 A148,104 0 0 1 335.2,107.7",
            "M335.2,192.3 A148,104 0 0 1 260.2,245.0",
            "M139.8,245.0 A148,104 0 0 1 64.8,192.3",
            "M64.8,107.7 A148,104 0 0 1 139.8,55.0",
          ].map((d) => (
            <path d={d} fill="none" key={d} markerEnd="url(#concept-arrow)" stroke="var(--brand)" strokeLinecap="round" strokeWidth="2" />
          ))}
        </svg>
        {/* 中央: サービス名。 */}
        <div className="absolute top-1/2 left-1/2 flex size-[44%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-pill border border-hairline bg-surface text-center shadow-[var(--shadow-card)]">
          <p className="text-[17px] leading-tight font-bold tracking-tight sm:text-[20px]">Exos AI</p>
          <p className="mt-1 px-3 text-[11px] leading-[1.5] text-ink-2 sm:text-caption">
            プロンプト駆動の
            <br />
            SNS運用
            <br className="sm:hidden" />
            プラットフォーム
          </p>
        </div>
        {/* 4ステップのノード。 */}
        {CONCEPT_STEPS.map((step) => (
          <div
            className={cn(
              "absolute flex w-[100px] flex-col items-center gap-1 rounded-card border border-hairline bg-surface px-1.5 py-2 text-center shadow-[var(--shadow-card)] sm:w-[128px] sm:px-2 sm:py-2.5",
              step.pos,
            )}
            key={step.no}
          >
            <span className="text-caption font-bold text-brand">{step.no}</span>
            <Icon className="text-brand" name={step.icon} size={20} />
            <span className="text-caption leading-tight font-bold text-ink">{step.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-4 flex items-center justify-center gap-3 text-sm font-bold text-ink">
        <span aria-hidden="true" className="h-px w-8 bg-brand" />
        使うほど、プロンプトが磨かれる。
        <span aria-hidden="true" className="h-px w-8 bg-brand" />
      </figcaption>
    </figure>
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
