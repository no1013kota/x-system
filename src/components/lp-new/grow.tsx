import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { BODY, CHIP_CLASS, CHIP_LABEL, GLASS, H2, SUB, type Who } from "./tokens";

/**
 * 「使うほど、あなたの言葉に近づく」（T-M8-419）。
 *
 * 育つ主体は AI ではなく「アカウント.md と投稿プロンプト」。改善案は「分析を開始」ボタン起点・
 * 1日1回・**表示専用（全文の改訂案＋コピー）**で、反映は利用者がコピーして貼り、保存する
 * （PRD K-2・要件06 分析画面「承認・却下・自動反映の操作は持たない」）。
 * 「AIクローンが自動で学習」「勝手に賢くなる」とは書かず、図版にも「取り入れる／見送る」の
 * ような**存在しない操作**を描かない（レビュー 2026-09-04 で一度描いて差し戻した）。
 *
 * 右の図版は「押す → 貼る → 効く」の3段（T-M8-421・運営者の指摘「もう少し直感的に」）。
 * 旧図版（アカウント.md の diff ＋「良かった型 上位3件」の棒）は、markdown の見出しと相対の棒が
 * 何を意味するか初見で読めなかった。新図版は因果を上から下へ1本にし、各段に「誰が」の記法チップを
 * 付ける。例文は実在の5項目（ペルソナ／発信テーマ／トーン／スレッド量・文章量／NG設定）に沿い、
 * 架空の数値（件数・伸び率）は入れない。
 */
// 順は「始め方（土台→型）→ 育ち方（分析）」。最後の「分析」が右図の段1へつながる（2周目）。
const PATHS: { icon: IconName; text: string }[] = [
  {
    icon: "account_circle",
    text: "参考アカウント（最大3件）の投稿から、土台を作れる",
  },
  // T-M8-397: 参考投稿は「最大」3件（3件必須と読ませない）。
  { icon: "add", text: "参考投稿を最大3件貼ると、あなた専用の型をAIが生成" },
  {
    icon: "monitoring",
    text: "「分析を開始」を押すと、アカウント.mdとプロンプトの改善案が届く",
  },
];

/** 改訂案で変わる行の例（項目名は実在の5項目から。項目と中身が噛み合うものだけ）。 */
const CHANGES: { field: string; text: string }[] = [
  // 段3の例文（「差がつきます。」「みてください。」）と噛み合う語尾に（「〜です」だと例文が効いていない・3周目）。
  { field: "トーン", text: "語尾は「です・ます」で統一" },
  { field: "文章量", text: "結論を先に一文で言い切る" },
];

/** 3段の見出しと記法（押す＝ボタン1つ／貼る＝あなた／効く＝自動）。 */
const STEPS: { who: Who; title: string }[] = [
  { who: "ai", title: "「分析を開始」を押す" },
  // 動詞を減らす（「コピーして貼り、保存」は段1の「ボタン1つ」との対比で重く読めた・2周目）。コピーは段1のピルが示す。
  { who: "you", title: "気に入った案だけ、貼って保存" },
  { who: "auto", title: "次の投稿から効く" },
];

const PANEL = "mt-2.5 rounded-[12px] bg-white px-3.5 py-3 text-caption shadow-[var(--shadow-card)]";
/** 番号の丸: 記法チップと同じ色（誰がやる段かを丸の色でも示す）。SP のリング図の代替リストと同寸（32px）。 */
const DOT: Record<Who, string> = {
  auto: "bg-brand text-white",
  ai: "bg-brand-subtle text-brand ring-2 ring-brand",
  you: "bg-white text-brand ring-2 ring-brand",
};

function Step({
  index,
  last = false,
  children,
}: {
  index: number;
  last?: boolean;
  children: React.ReactNode;
}) {
  const step = STEPS[index];
  return (
    <li className="relative pl-11">
      <span
        className={cn(
          "absolute top-0 left-0 flex size-8 items-center justify-center rounded-pill text-caption font-bold",
          DOT[step.who],
        )}
      >
        {index + 1}
      </span>
      {/* 段をつなぐ縦線。リング図の弧と同じ記法（brand・破線）。hairline は白いカードの上では見えなかった。 */}
      {!last ? (
        <span className="absolute top-9 bottom-0 left-4 border-l border-dashed border-brand/40" />
      ) : null}
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{step.title}</span>
        <span className={CHIP_CLASS[step.who]}>{CHIP_LABEL[step.who]}</span>
      </div>
      <div className={cn(!last && "pb-6")}>{children}</div>
    </li>
  );
}

/** 図版本体（aria-hidden の装飾。読み上げは下の sr-only の1文）。 */
function LoopFigure() {
  return (
    <div aria-hidden="true" className={cn(GLASS, "p-6")}>
      <ol className="grid">
        <Step index={0}>
          {/* 実画面（分析＞改善案）と同じ形: 全文の改訂案＋「コピー」。承認・却下のボタンは無い。 */}
          <div className={PANEL}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">アカウント.md の改善案</span>
              <span className="rounded-pill border border-brand px-2 py-0.5 font-medium text-brand">
                コピー
              </span>
            </div>
            <p className="mt-1 text-ink-3">全文を書き直した案。勝手には反映しません</p>
            {/* 「+」の差分記法は非エンジニアに馴染みが薄いので、見出し1行で「変わるところ」と言う（3周目）。 */}
            <p className="mt-2 text-ink-3">変わるところ（例）</p>
            <div className="mt-1 grid gap-1">
              {CHANGES.map((item) => (
                <p className="rounded-chip bg-brand-subtle px-2 text-ink" key={item.text}>
                  <span className="text-ink-3">{item.field}: </span>
                  {item.text}
                </p>
              ))}
            </div>
          </div>
        </Step>
        <Step index={1}>
          <div className={PANEL}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* 名前は実画面の本棚と同じ「アカウント設定 vN」。 */}
              <span className="font-medium text-ink">アカウント設定 v4</span>
              <span className="rounded-pill bg-brand px-2 py-0.5 font-medium text-white">
                使用中
              </span>
            </div>
            <p className="mt-1 text-ink-3">アカウント.mdの新しい版。前の版は本棚に残り、いつでも戻せます</p>
          </div>
        </Step>
        <Step index={2} last>
          {/* 次の投稿のプレビュー（例文）。改訂案の2行が効いた書き出しを薄紫で示す。 */}
          <div className={PANEL}>
            <div className="flex items-center gap-2">
              <Icon className="text-brand" name="account_circle" size={24} />
              <span className="font-medium text-ink">次の投稿（下書き）</span>
            </div>
            <p className="mt-2 text-sm leading-[1.7] text-ink">
              <span className="rounded-chip bg-brand-subtle px-1">
                結論から言うと、AIは「使う場所」で差がつきます。
              </span>
              まず1つ、毎日やっている作業を任せてみてください。
            </p>
          </div>
        </Step>
      </ol>
    </div>
  );
}

export function Grow() {
  return (
    <div className="grid grid-cols-1 items-center gap-[clamp(24px,4vw,56px)] min-[960px]:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
      <div>
        <h2 className={H2}>
          <span className="inline-block">使うほど、</span>
          <span className="inline-block">あなたの言葉に</span>
          <span className="inline-block">近づく</span>
        </h2>
        <p className={SUB}>
          育つのは、アカウント.mdと投稿プロンプト。改善案を取り入れた分だけ、次の投稿に効きます。
        </p>
        <ul className="mt-8 grid gap-4">
          {PATHS.map((path) => (
            <li className="flex gap-3" key={path.icon}>
              <Icon
                className="mt-0.5 shrink-0 text-brand"
                name={path.icon}
                size={20}
              />
              <span className={cn(BODY, "text-ink")}>{path.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">
        <LoopFigure />
        <p className="sr-only">
          「分析を開始」を押すと改善案が届き、あなたがコピーしてアカウント.mdに貼って保存すると、次の投稿からその言葉で書かれます。
        </p>
      </div>
    </div>
  );
}
