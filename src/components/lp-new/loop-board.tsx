import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

import { CHIP_LABEL, H3, type Who } from "./tokens";

/**
 * 「手を動かす時間が、こう変わる」の図面板（T-M8-419）。このページ唯一の暗色面。
 *
 * 上段: 手作業 3h の棒と、Exos AI 5m の点（同じ尺。棒の長さ＝手を動かす時間。After は棒ではなく
 * 目盛り線の左端に白い点1つ——6周目）。
 * 下段: 自動で回る4工程・押すだけの分析・あなたが握る2つの判断のリング図。上下は板の内側の罫線1本で
 * 「上＝結果・下＝仕組み」の2段に切る（5周目）。
 *
 * 製品の仕組みは曲げない: 分析は「分析を開始」ボタン起点・1日1回・表示専用（「自動」と書かない）、
 * 既定は下書きまで（After にも「確認」の白い点を必ず残す）。
 * 暗色は固定色の面であり、dark: バリアントや prefers-color-scheme は使わない。
 * 文字の薄さは white/60 まで（#2b0f29 上で 4.5:1 以上）。opacity プロパティは使わない。
 */

const BOARD_BG = "#2b0f29";

/*
 * ─── 手作業 3h と Exos AI 5m の比例バー ─────────────────────────────────
 * 旧「ある1日のタイムライン」（6:00〜24:00 の横軸に行ごとの帯・ドット・目盛り）は、何を比べているかが
 * 3秒で読めなかった（運営者の指摘 2026-09-04）。同じ尺の棒にし、棒の長さそのものが時間を表すようにする。
 * After は同じ尺の**目盛り線**（1px・white/30）の左端に白い点1つ＋「5分」（6周目。5周目の「薄いトラック」
 * は Before と同じ長さの暗い棒に見え、「棒2本が同じ長さ」に読めた。線なら形が無いので棒と競わず、
 * 右へ空のまま続くことで「残りは空」が読める。白い点の直後に和文の「5分」を置き、点が bullet でなく
 * 尺の上の量であること、左列の「5m」が5分であることを同時に示す）。数字は例なので figcaption で
 * 明示し、「平均◯時間削減」の断定は書かない。JS 不要・CSS のみ。比例幅は inline style で書く
 * （Tailwind の動的クラスは JIT に拾われない）。
 */

/** 手作業の内訳（例・合計180分）。PRD §1.1 の6作業を5語へ（情報収集＋ネタ探し＝探す）。ラベルは5文字以内。 */
const BEFORE: { label: string; minutes: number }[] = [
  { label: "探す", minutes: 45 },
  { label: "書く", minutes: 60 },
  { label: "画像作り", minutes: 30 },
  { label: "投稿", minutes: 15 },
  { label: "数字を見る", minutes: 30 },
];
/** Exos AI で残る手作業。既定は下書きまでなので「確認（あなた）」を必ず残す。 */
const AFTER: { label: string; note: string; minutes: number }[] = [
  { label: "確認", note: "下書きを見るだけ", minutes: 5 },
];

const BEFORE_TOTAL = BEFORE.reduce((sum, item) => sum + item.minutes, 0);
const AFTER_TOTAL = AFTER.reduce((sum, item) => sum + item.minutes, 0);

/** 見出し・図内の表記（"3h"・"5m"）。0分の端数は出さない（旧実装は 180 → "3h 0m" だった）。 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
/** 読み上げ・本文・図内の和文（"3時間"・"5分"）。図の中でも "5m" は5メートルと読まれうるので、点の隣はこちら。 */
function formatMinutesJa(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/**
 * 見出し・サブ文で引用する合計（例の値。直書きせずここから描く。`loop-board.test.ts` が固定）。
 * `before`/`after` は見出しの "3h"・"5m"（運営者指定の表記・視覚用）、`beforeJa`/`afterJa` は
 * 読み上げ用の見出しとサブ文の「3時間」「5分」（読み上げでは "3h → 5m" が「3エイチ 5エム」になる）。
 */
export const LOOP_TOTALS = {
  before: formatMinutes(BEFORE_TOTAL),
  after: formatMinutes(AFTER_TOTAL),
  beforeJa: formatMinutesJa(BEFORE_TOTAL),
  afterJa: formatMinutesJa(AFTER_TOTAL),
};

/** Before の棒の区切り（板の色が透ける隙間）px。 */
const SEG_GAP = 2;
const GAPS_PX = SEG_GAP * (BEFORE.length - 1);

/** 行のグリッド: 640px以上は左にラベル＋合計、右に棒。未満は縦積み。 */
const ROW =
  "grid grid-cols-1 gap-y-2 min-[640px]:grid-cols-[116px_minmax(0,1fr)] min-[640px]:items-center min-[640px]:gap-x-3 min-[760px]:grid-cols-[140px_minmax(0,1fr)]";

/** 棒の高さ。After の白い点（最小幅＝高さ）が正円になる寸法（1280幅で比例幅 約27px ≒ 32px）。 */
const BAR_H = "h-7 min-[640px]:h-8";

function Row({
  label,
  total,
  note,
  children,
}: {
  label: string;
  total: string;
  /** 合計の直下の一言（「全部、手で」「確認だけ」）。数字を裸にせず左列だけで意味が読めるように。640px未満は出さない（棒の凡例と重複し、数字の尾ひれに読める）。 */
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className={ROW}>
      <div className="flex flex-wrap items-baseline gap-x-2 min-[640px]:block">
        <span className="text-caption font-medium tracking-[0.08em] whitespace-nowrap text-white/75">
          {label}
        </span>
        <span className="text-[length:clamp(28px,calc(18px_+_1.4vw),40px)] font-medium leading-none tabular-nums text-white min-[640px]:mt-1 min-[640px]:block">
          {total}
        </span>
        <span className="hidden text-caption whitespace-nowrap text-white/60 min-[640px]:mt-1.5 min-[640px]:block">
          {note}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * 上段の比例バー。Before は1本のピルを隙間で5つに刻む（幅＝分に比例・flex-grow）。
 * After は同じ尺の目盛り線の左端に白い点1つ（＝あなたの「確認」・LEGEND の「あなた」と同じ白の記法）
 * ＋「5分 下書きを見るだけ」。「確認」の語は左列の注記（確認だけ）に1回だけ（線上にも太字で置くと
 * 100px以内に2回並んだ）。
 */
function Bars() {
  return (
    <figure
      aria-label={`手作業だと1日${formatMinutesJa(BEFORE_TOTAL)}の作業が、${APP_NAME} では下書きの確認${formatMinutesJa(AFTER_TOTAL)}だけになる（例）。`}
    >
      <div className="grid gap-6 min-[640px]:gap-7">
        <Row label="手作業なら" note="全部、手で" total={LOOP_TOTALS.before}>
          <div className="min-w-0">
            <ol
              className={cn("flex w-full overflow-hidden rounded-pill", BAR_H)}
              style={{ gap: SEG_GAP }}
            >
              {BEFORE.map((item, index) => (
                <li
                  className="flex min-w-0 items-center justify-center bg-white/40 px-1 text-body font-medium text-white"
                  key={item.label}
                  style={{ flex: `${item.minutes} 1 0%` }}
                >
                  {/*
                    760px未満は番号だけ（作業名は下の凡例へ）。読み上げは作業名＋分で1回。
                    閾値は 640 でなく 760: 640〜759px では最後の区切りが約68pxで「数字を見る」（65px）が
                    縁に触れる（実測 2026-09-04）。
                  */}
                  <span aria-hidden="true" className="min-[760px]:hidden">
                    {index + 1}
                  </span>
                  <span
                    className="sr-only min-[760px]:not-sr-only"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {item.label}
                  </span>
                  <span className="sr-only">{item.minutes}分</span>
                </li>
              ))}
            </ol>
            <ol
              aria-hidden="true"
              className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-white/75 min-[760px]:hidden"
            >
              {BEFORE.map((item, index) => (
                <li className="whitespace-nowrap" key={item.label}>
                  <span className="mr-1 font-medium text-white">{index + 1}</span>
                  {item.label}
                </li>
              ))}
            </ol>
          </div>
        </Row>
        <Row label={`${APP_NAME} なら`} note="確認だけ" total={LOOP_TOTALS.after}>
          <div className={cn("relative flex min-w-0 items-center", BAR_H)}>
            {/*
              Before と同じ尺の目盛り線（棒ではない）。塗った面だと「同じ長さの棒が2本」に見える。
              線は点とラベルの後ろも右端まで通し、ラベル側が板の色で線を切る。
            */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/30"
            />
            {AFTER.map((item) => (
              <span className="contents" key={item.label}>
                {/* 幅は分に比例（min-w＝高さで、狭い幅でも点として残る）。relative で線の上に載せる。 */}
                <span
                  aria-hidden="true"
                  className="relative h-full min-w-7 shrink-0 rounded-pill bg-white min-[640px]:min-w-8"
                  style={{
                    width: `calc((100% - ${GAPS_PX}px) * ${item.minutes / BEFORE_TOTAL})`,
                  }}
                />
                <span
                  className="relative flex items-baseline gap-2 px-2.5 text-body whitespace-nowrap"
                  style={{ backgroundColor: BOARD_BG }}
                >
                  <span className="sr-only">{item.label}</span>
                  <span className="font-medium text-white">{formatMinutesJa(item.minutes)}</span>
                  <span className="text-white/60">{item.note}</span>
                </span>
              </span>
            ))}
          </div>
        </Row>
      </div>
      {/* 上段→下段の橋は1文だけ。同意・ボタンの開示は下段の本文が担う（重複させない）。 */}
      <figcaption className="mt-5 text-caption text-white/60">
        棒の長さ＝手を動かす時間（ある1日の例・目安）。あとの工程は {APP_NAME} が回します（仕組みは下の図）。
      </figcaption>
    </figure>
  );
}

/** リング図の7ノード。並び順＝工程の順（時計回り、上から）。note は行の配列（リング図では改行、縦リストでは「、」で連結）。 */
const NODES: {
  label: string;
  note: readonly string[];
  who: Who;
}[] = [
  { label: "集める", note: ["10分おき"], who: "auto" },
  { label: "作る", note: ["定刻・60〜90秒"], who: "auto" },
  // 「確認」は一番右のノード。1行だと 640〜1024px で板の右端を越える（実測 最大28px）ので2行。
  { label: "確認", note: ["あなた", "飛ばしてもOK"], who: "you" },
  // 要件04 §8: 定刻から「概ね」5分以内（断定しない）。自動投稿をオンにした後にだけ動く
  // （「同意後」は仕様書の語で、初心者には「何に同意？」となる——6周目）。
  { label: "投稿", note: ["自動投稿ONのとき", "定刻から概ね5分以内"], who: "auto" },
  // 表示回数などの反応を毎時、投稿の1・7・30日後にも記録する（要件04）。「反応」だけでは何を指すか
  // 曖昧なので「表示回数など」（6周目）。2行に分けるのは 640px でラベルが板の外へ出るため。
  { label: "記録", note: ["表示回数などを毎時", "1・7・30日後も"], who: "auto" },
  // 「分析」は一番左のノード。1行だと 640px で板の左端まで3pxしか残らないので2行。
  { label: "分析", note: ["ボタン1つ", "1日1回"], who: "ai" },
  { label: "反映", note: ["あなたが選ぶ"], who: "you" },
];

/**
 * ノード円の見た目（記法チップと同じ意味: 自動＝brand塗り／AI・押すだけ＝薄紫／あなた＝白）。
 * 板の暗色（#2b0f29）の上では brand 塗りが最も沈む（面の対比 約1.9:1）ので、板の上だけ白い輪郭を
 * 2px・white/60 に上げて「自動4工程」が主役として立つようにする（6周目。凡例チップも同じ値）。
 */
const NODE_CLASS: Record<Who, string> = {
  auto: "bg-brand text-white ring-2 ring-white/60",
  ai: "bg-brand-subtle text-brand ring-2 ring-brand",
  you: "bg-white text-brand ring-2 ring-brand",
};
const LEGEND_CLASS: Record<Who, string> = {
  auto: "bg-brand text-white ring-2 ring-white/60",
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

/**
 * 「作る」の外周にあった赤→紫→青のグラデの輪は撤去（5周目）。凡例に無い第4の記法で、暗色の上では
 * 「2番だけ赤＝警告？」に読めた。強調は置かない（4工程はどれも同じ「自動」）。
 */
function Ring() {
  return (
    /*
     * 正方形の下 19%（最下ノード y=81% より下）はそのまま余白になるので、負の margin で板の底に寄せる
     * （最下ラベルは y=81%＋約36px で板内に収まる）。
     */
    <div className="mx-auto w-full max-w-[560px] px-8 min-[640px]:-mb-[clamp(24px,5%,48px)] min-[960px]:px-10">
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
                className={cn("absolute whitespace-nowrap", LABEL_CLASS[placement])}
              >
                <span className="block text-base font-medium leading-tight text-white">
                  {node.label}
                </span>
                {node.note.map((line) => (
                  <span
                    className="block text-body leading-tight text-white/75"
                    key={line}
                  >
                    {line}
                  </span>
                ))}
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
          {/* 工程名は折らない（注記が長い行で「投／稿」と縦に折れた・6周目）。折れるのは注記側。 */}
          <span className="shrink-0 text-base font-medium whitespace-nowrap">{node.label}</span>
          <span className="text-body text-white/75">{node.note.join("、")}</span>
        </li>
      ))}
    </ol>
  );
}

export function LoopBoard() {
  return (
    <div
      className="rounded-[24px] px-[clamp(24px,4vw,48px)] pt-[clamp(24px,4vw,48px)] pb-[clamp(16px,2vw,24px)] text-white"
      style={{ backgroundColor: BOARD_BG }}
    >
      <Bars />
      {/* 板の内側の罫線1本で「上＝結果・下＝仕組み」を切る（空きだけだと2図の関係が構造として見えない）。 */}
      {/* 960px以上は左列（約230px）をリング図（約470px）の縦中央に置く（上寄せだと左下が空き、文字が板の上端に貼り付く）。 */}
      <div className="mt-[clamp(32px,5vw,56px)] grid grid-cols-1 items-start gap-10 border-t border-white/10 pt-[clamp(32px,5vw,56px)] min-[960px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] min-[960px]:items-center">
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
          {/* 「同意」「表示専用」は仕様書の語なので、初心者の言葉に開く（6周目）。事実は同じ: 同意後にだけ自動投稿・分析は1日1回・結果は表示のみ。 */}
          <p className="mt-4 text-sm leading-[1.8] text-white/75">
            自動投稿は、あなたがオンにした後にだけ始まり、設定からすぐ止められます。分析は「分析を開始」を押したときだけ（1日1回。結果を見るだけで、勝手には反映しません）。
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
