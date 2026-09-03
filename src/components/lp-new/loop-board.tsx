import { cn } from "@/lib/utils";

import { CHIP_LABEL, H3, type Who } from "./tokens";

/**
 * 「手を動かす時間が、こう変わる」の図面板（T-M8-419）。このページ唯一の暗色面。
 *
 * 上段: ある1日の Before/After タイムライン（6:00〜24:00 を横軸に、1行＝1つの作業・工程）。
 * 下段: 自動で回る4工程・押すだけの分析・あなたが握る2つの判断のリング図。
 *
 * 製品の仕組みは曲げない: 分析は「分析を開始」ボタン起点・1日1回・表示専用（「自動」と書かない）、
 * 既定は下書きまで（After にも「確認」の白ピルを必ず残す）、投稿の枠は 9:00〜22:00・30分刻み
 * （PRD S-2・DB CHECK `schedule_slots_time_valid`）なので例の枠も 9:00 と 21:00 にする。
 * 暗色は固定色の面であり、dark: バリアントや prefers-color-scheme は使わない。
 * 文字の薄さは white/60 まで（#2b0f29 上で 4.5:1 以上）。opacity プロパティは使わない。
 */

const BOARD_BG = "#2b0f29";

/*
 * ─── ある1日のタイムライン ───────────────────────────────────────────────
 * 6:00〜24:00 を横軸に、Before は「人が手を動かす作業」5行、After は「自動で回る工程」4行＋
 * 「確認（あなた）」1行。位置は分単位（left/width を %）。JS 不要・CSS のみ。
 * 数字は例なので figcaption で明示し、「平均◯時間削減」の断定は書かない。
 */
const DAY_START = 6 * 60;
const DAY_END = 24 * 60;
const DAY = DAY_END - DAY_START;

function at(hour: number, minute = 0): number {
  return hour * 60 + minute;
}
function pct(minutes: number): string {
  return `${(((minutes - DAY_START) / DAY) * 100).toFixed(3)}%`;
}
function widthPct(minutes: number): string {
  return `max(${((minutes / DAY) * 100).toFixed(3)}%, 12px)`;
}
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Before: 人が手を動かす作業（例）。ラベルは狭い幅でも1行に収まる長さ（6文字以内）。 */
const BEFORE: { label: string; start: number; minutes: number }[] = [
  { label: "ニュース確認", start: at(7, 30), minutes: 30 },
  { label: "ネタ探し", start: at(12), minutes: 20 },
  { label: "執筆", start: at(21), minutes: 60 },
  { label: "画像を用意", start: at(22), minutes: 15 },
  { label: "数字を見る", start: at(23), minutes: 10 },
];

/** After: 自動で回る工程（ドット＝自動）と、あなたの確認（白ピル）。 */
type AfterRow =
  | {
      kind: "dots";
      label: string;
      note: string;
      /** ドット間隔（background-size）。640px未満は間隔を広げないと実線に見える。 */
      sizeClass: string;
    }
  | { kind: "marks"; label: string; note: string; times: number[] }
  | {
      kind: "you";
      label: string;
      note: string;
      times: { start: number; minutes: number }[];
    };

const AFTER: AfterRow[] = [
  {
    kind: "dots",
    label: "収集",
    note: "10分おき",
    // 18時間 = 10分おきで108個。狭い幅では30分刻み（36個）で「間隔がある」ことだけ示す。
    sizeClass:
      "bg-[size:calc(100%/36)_100%] min-[640px]:bg-[size:calc(100%/108)_100%]",
  },
  { kind: "marks", label: "生成", note: "定刻", times: [at(9), at(21)] },
  {
    kind: "marks",
    label: "投稿",
    note: "予約・定刻",
    times: [at(12), at(21, 2)],
  },
  {
    kind: "dots",
    label: "記録",
    note: "毎時",
    sizeClass: "bg-[size:calc(100%/18)_100%]",
  },
  {
    kind: "you",
    label: "確認",
    note: "あなた",
    times: [
      { start: at(9, 5), minutes: 3 },
      { start: at(21, 5), minutes: 2 },
    ],
  },
];

const BEFORE_TOTAL = BEFORE.reduce((sum, item) => sum + item.minutes, 0);
const AFTER_TOTAL = AFTER.reduce(
  (sum, row) =>
    row.kind === "you"
      ? sum + row.times.reduce((s, t) => s + t.minutes, 0)
      : sum,
  0,
);

/** 見出しで引用する合計（例の値。直書きせずここから描く）。 */
export const LOOP_TOTALS = {
  before: formatMinutes(BEFORE_TOTAL),
  after: formatMinutes(AFTER_TOTAL),
};

const TICKS = ["6:00", "12:00", "18:00", "24:00"];
/** 行のグリッド: 左にラベル、右に軌道。 */
const ROW =
  "grid grid-cols-[116px_minmax(0,1fr)] items-center gap-x-3 min-[760px]:grid-cols-[140px_minmax(0,1fr)]";
/** 軌道の背景: 6:00／12:00／18:00 の縦の目安線。 */
const TRACK =
  "relative h-6 bg-[linear-gradient(to_right,rgba(255,255,255,0.14)_1px,transparent_1px)] bg-[size:33.3333%_100%]";
const LABEL = "text-caption leading-tight whitespace-nowrap";

function BlockHead({
  label,
  total,
  note,
  bar,
}: {
  label: string;
  total: string;
  note: string;
  /** 合計を1本の帯で比較する（Before は全幅の白、After は比率ぶんの brand）。 */
  bar: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-caption font-medium tracking-[0.08em] text-white/75">
          {label}
        </span>
        <span className="text-[length:clamp(28px,calc(18px_+_1.4vw),40px)] font-medium leading-none tabular-nums">
          {total}
        </span>
        <span className="text-caption text-white/60">{note}</span>
      </div>
      <div className="mt-3 h-2 w-full">{bar}</div>
    </div>
  );
}

function Ticks() {
  return (
    <div className={ROW} aria-hidden="true">
      <span />
      <div className="relative h-4 text-caption leading-4 text-white/60">
        {TICKS.map((tick, index) => (
          <span
            className={cn(
              "absolute",
              index === TICKS.length - 1 && "right-0",
              // 狭い幅では 18:00 と 24:00 が重なるので 18:00 を出さない。
              index === TICKS.length - 2 && "hidden min-[640px]:inline",
            )}
            key={tick}
            style={
              index === TICKS.length - 1
                ? undefined
                : { left: `${(index / (TICKS.length - 1)) * 100}%` }
            }
          >
            {tick}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timeline() {
  return (
    <figure>
      <div className="grid gap-10">
        {/* Before */}
        <div>
          <BlockHead
            bar={<div className="h-2 w-full rounded-pill bg-white/30" />}
            label="BEFORE"
            note="手を動かす時間"
            total={LOOP_TOTALS.before}
          />
          <div className="mt-4 grid gap-1.5">
            {BEFORE.map((item) => (
              <div className={ROW} key={item.label}>
                <span className={`${LABEL} text-white/75`}>
                  {item.label}{" "}
                  <s className="decoration-white/50">{item.minutes}分</s>
                </span>
                <div className={TRACK}>
                  <span
                    className="absolute top-0.5 h-5 rounded-pill bg-white/30"
                    style={{
                      left: pct(item.start),
                      width: widthPct(item.minutes),
                    }}
                  />
                </div>
              </div>
            ))}
            <Ticks />
          </div>
        </div>

        {/* After */}
        <div>
          <BlockHead
            bar={
              <div
                className="h-2 min-w-[12px] rounded-pill bg-brand ring-1 ring-white/50"
                style={{
                  width: `${((AFTER_TOTAL / BEFORE_TOTAL) * 100).toFixed(2)}%`,
                }}
              />
            }
            label="AFTER"
            note="手を動かす時間"
            total={LOOP_TOTALS.after}
          />
          <div className="mt-4 grid gap-1.5">
            {AFTER.map((row) => (
              <div className={ROW} key={row.label}>
                <span className={`${LABEL} text-white`}>
                  {row.label}
                  <span className="ml-1 text-white/60">{row.note}</span>
                </span>
                <div className={TRACK}>
                  {row.kind === "dots" ? (
                    <span
                      className={cn(
                        "absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.6)_1.5px,transparent_2.2px)]",
                        row.sizeClass,
                      )}
                    />
                  ) : null}
                  {row.kind === "marks"
                    ? row.times.map((time) => (
                        <span
                          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-brand ring-2 ring-white/50"
                          key={time}
                          style={{ left: pct(time) }}
                        />
                      ))
                    : null}
                  {row.kind === "you"
                    ? row.times.map((time) => (
                        <span
                          className="absolute top-1/2 inline-flex h-5 -translate-y-1/2 items-center rounded-pill bg-white px-2 text-caption font-medium whitespace-nowrap text-brand"
                          key={time.start}
                          style={{ left: pct(time.start) }}
                        >
                          {time.minutes}分
                        </span>
                      ))
                    : null}
                </div>
              </div>
            ))}
            <Ticks />
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-caption text-white/60">
        ある1日の例（9:00は下書きまで、21:00はそのまま投稿の枠）。時間は目安です。
      </figcaption>
    </figure>
  );
}

/** リング図の7ノード。並び順＝工程の順（時計回り、上から）。 */
const NODES: {
  label: string;
  note: string;
  who: Who;
  highlight?: boolean;
}[] = [
  { label: "集める", note: "10分おき", who: "auto" },
  { label: "作る", note: "定刻・60〜90秒", who: "auto", highlight: true },
  { label: "確認", note: "あなた・省略可", who: "you" },
  // 要件04 §8: 定刻から「概ね」5分以内（断定しない）。同意後にだけ動く。
  { label: "投稿", note: "同意後・定刻から概ね5分以内", who: "auto" },
  { label: "記録", note: "毎時・1/7/30日後", who: "auto" },
  { label: "分析", note: "ボタン1つ・1日1回", who: "ai" },
  { label: "反映", note: "あなた・選べる", who: "you" },
];

/** ノード円の見た目（記法チップと同じ意味: 自動＝brand塗り／AI・押すだけ＝薄紫／あなた＝白）。 */
const NODE_CLASS: Record<Who, string> = {
  auto: "bg-brand text-white ring-1 ring-white/35",
  ai: "bg-brand-subtle text-brand ring-2 ring-brand",
  you: "bg-white text-brand ring-2 ring-brand",
};
const LEGEND_CLASS: Record<Who, string> = {
  auto: "bg-brand text-white ring-1 ring-white/35",
  ai: "bg-brand-subtle text-brand ring-2 ring-brand",
  you: "bg-white text-brand",
};
const WHO_ORDER: Who[] = ["auto", "ai", "you"];

/** 中心 (50,50)・半径 RADIUS（%）の円周上の点。角度は上（-90°）から時計回り。 */
const RADIUS = 31;
function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) };
}
const STEP = 360 / NODES.length;
/** ノード円（size-11＝44px）にかからないよう、弧の両端を角度で削る。 */
const GAP_DEG = 9;

function arcPath(index: number): string {
  const from = polar(-90 + STEP * index + GAP_DEG, RADIUS);
  const to = polar(-90 + STEP * (index + 1) - GAP_DEG, RADIUS);
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

/** ラベルの置き場所: 上のノードは上、下2つは下、それ以外は外側（左右）。 */
function labelPlacement(index: number): "top" | "bottom" | "right" | "left" {
  if (index === 0) return "top";
  const { x, y } = polar(-90 + STEP * index, RADIUS);
  if (y > 80) return "bottom";
  return x >= 50 ? "right" : "left";
}

const LABEL_CLASS: Record<ReturnType<typeof labelPlacement>, string> = {
  top: "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 text-center",
  bottom: "top-[calc(100%+8px)] left-1/2 -translate-x-1/2 text-center",
  right: "left-[calc(100%+10px)] top-1/2 -translate-y-1/2 text-left",
  left: "right-[calc(100%+10px)] top-1/2 -translate-y-1/2 text-right",
};

function Ring() {
  return (
    <div className="mx-auto w-full max-w-[560px] px-8 min-[960px]:px-10">
      <div className="relative aspect-square w-full">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          fill="none"
          viewBox="0 0 100 100"
        >
          <defs>
            <marker
              id="loop-arrow"
              markerHeight="4"
              markerWidth="4"
              orient="auto"
              refX="3"
              refY="2"
              viewBox="0 0 4 4"
            >
              <path d="M 0 0 L 4 2 L 0 4 z" fill="rgba(255,255,255,0.7)" />
            </marker>
            {/* var(--brand-gradient) は SVG の stroke に使えないため3色を再現（「AIが動く瞬間」＝このページ2回目で最後）。 */}
            <linearGradient id="loop-brand-grad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#ff0000" />
              <stop offset="50%" stopColor="#7d1f75" />
              <stop offset="100%" stopColor="#00afff" />
            </linearGradient>
          </defs>
          {NODES.map((node, index) => (
            <path
              d={arcPath(index)}
              key={node.label}
              markerEnd="url(#loop-arrow)"
              stroke="rgba(255,255,255,0.45)"
              strokeDasharray="1.2 1.2"
              strokeWidth={0.4}
            />
          ))}
          {NODES.map((node, index) => {
            if (!node.highlight) return null;
            const { x, y } = polar(-90 + STEP * index, RADIUS);
            return (
              <circle
                cx={x}
                cy={y}
                key={node.label}
                r={6.2}
                stroke="url(#loop-brand-grad)"
                strokeWidth={0.6}
              />
            );
          })}
        </svg>
        {/* 中心は薄い輪1本だけ（同心円の「印」は撤去・3周目）。 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[34%] rounded-full border border-white/15"
        />
        {NODES.map((node, index) => {
          const { x, y } = polar(-90 + STEP * index, RADIUS);
          const placement = labelPlacement(index);
          return (
            <div
              className="absolute size-11 -translate-x-1/2 -translate-y-1/2"
              key={node.label}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-pill text-caption font-bold",
                  NODE_CLASS[node.who],
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  "absolute whitespace-nowrap",
                  LABEL_CLASS[placement],
                  // 「作る」だけ外周にグラデの輪があるぶん、ラベルを離す。
                  node.highlight &&
                    placement === "right" &&
                    "left-[calc(100%+20px)]",
                )}
              >
                <span className="block text-base font-medium leading-tight text-white">
                  {node.label}
                </span>
                <span className="block text-body leading-tight text-white/75">
                  {node.note}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 640px未満はリング図の代わりに同じ7工程を縦のリストで出す（ラベルが円の外へはみ出すため）。 */
function StepList() {
  return (
    <ol className="grid gap-2">
      {NODES.map((node, index) => (
        <li className="flex items-center gap-3" key={node.label}>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-pill text-caption font-bold",
              NODE_CLASS[node.who],
            )}
          >
            {index + 1}
          </span>
          <span className="text-base font-medium">{node.label}</span>
          <span className="text-body text-white/75">{node.note}</span>
        </li>
      ))}
    </ol>
  );
}

export function LoopBoard() {
  return (
    <div
      className="rounded-[24px] px-[clamp(24px,4vw,48px)] pt-[clamp(24px,4vw,48px)] pb-[clamp(16px,3vw,32px)] text-white"
      style={{ backgroundColor: BOARD_BG }}
    >
      <Timeline />
      <div className="mt-[clamp(40px,6vw,72px)] grid grid-cols-1 items-start gap-10 min-[960px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <h3 className={H3}>
            <span className="inline-block">自動で回る4工程。</span>
            <span className="inline-block">分析はボタン1つ、</span>
            <span className="inline-block">判断は2つだけ。</span>
          </h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {WHO_ORDER.map((who) => (
              <span
                className={cn(
                  "inline-flex h-7 items-center rounded-pill px-3 text-caption font-medium",
                  LEGEND_CLASS[who],
                )}
                key={who}
              >
                {CHIP_LABEL[who]}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm leading-[1.8] text-white/75">
            自動投稿は同意の後にだけ始まり、設定から即時に停止できます。分析は「分析を開始」を押したときだけ（1日1回・表示専用）。
          </p>
        </div>
        <figure aria-label="集める・作る・投稿・記録は自動、分析は押したときだけAIが行い、確認と反映はあなた。">
          <div className="hidden min-[640px]:block">
            <Ring />
          </div>
          <div className="min-[640px]:hidden">
            <StepList />
          </div>
        </figure>
      </div>
    </div>
  );
}
