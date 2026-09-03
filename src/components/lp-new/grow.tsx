import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { GLASS, H2, SUB } from "./tokens";

/**
 * 「使うほど、あなたの言葉に近づく」（T-M8-419）。
 *
 * 育つ主体は AI ではなく「アカウント.md と投稿プロンプト」。改善案は「分析を開始」ボタン起点・
 * 1日1回・表示専用で、反映は利用者がコピーして編集する（PRD K-2）。
 * 「AIクローンが自動で学習」「勝手に賢くなる」とは書かない。
 * 差分図版の文言は実在の5項目（ペルソナ／発信テーマ／トーン／スレッド量・文章量／NG設定）に沿った
 * 例文で、架空の数値は入れない。
 */
const PATHS: { icon: IconName; text: string }[] = [
  {
    icon: "account_circle",
    text: "参考アカウント（最大3件）の投稿から、土台を作れる",
  },
  {
    icon: "monitoring",
    text: "「分析を開始」を押すと、アカウント.mdとプロンプトの改善案が届く",
  },
  // T-M8-397: 参考投稿は「最大」3件（3件必須と読ませない）。
  { icon: "add", text: "参考投稿を最大3件貼ると、あなた専用の型をAIが生成" },
];

/** 改訂案の例。`+` 行が追加提案。 */
const DIFF: { kind: "h" | "line" | "add"; text: string }[] = [
  { kind: "h", text: "# ペルソナ" },
  { kind: "line", text: "非エンジニア向けにAI活用を発信する個人" },
  { kind: "add", text: "結論を先に一文で言い切る" },
  { kind: "h", text: "# 発信テーマ" },
  { kind: "line", text: "AI・SNS運用" },
  { kind: "add", text: "数字は出典つきで1つ" },
  { kind: "h", text: "# トーン" },
  { kind: "add", text: "語尾は「〜です」で統一" },
];

/**
 * 良かった投稿の型 上位3件（イメージ）。行頭は実在する標準の型名。
 * 実データ（assetWishlist）が届くまで数値は出さず、相対の棒だけ（架空の数値を入れない）。
 */
const BARS: { label: string; width: string }[] = [
  { label: "ニュース解説", width: "w-full" },
  { label: "ノウハウ・ハウツー", width: "w-[72%]" },
  { label: "週次まとめ", width: "w-[54%]" },
];

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
              <span className="text-sm leading-[1.8] text-ink">
                {path.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative min-w-0 min-[960px]:pr-8 min-[960px]:pb-10">
        {/* 背景の同心円は撤去（3周目・意味の無い装飾）。 */}
        {/* 960px以上は下端にカード2が重なるため、重なる分（約96px）を余白にして内容を隠さない。 */}
        <div className={cn(GLASS, "relative p-6 min-[960px]:pb-28")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">
              アカウント.md 改訂案
            </span>
            <Badge tone="brand">表示専用・反映はあなた</Badge>
          </div>
          <div className="mt-4 grid gap-1 font-mono text-sm leading-[1.8]">
            {DIFF.map((row) => (
              <p
                className={cn(
                  row.kind === "h" && "font-medium text-ink",
                  row.kind === "line" && "text-ink-2",
                  row.kind === "add" &&
                    "rounded-chip bg-brand-subtle px-2 text-ink",
                )}
                key={row.text}
              >
                {row.kind === "add" ? (
                  <span className="mr-1 font-medium text-brand">+</span>
                ) : null}
                {row.text}
              </p>
            ))}
          </div>
          <div
            aria-hidden="true"
            className="mt-5 flex flex-wrap items-center gap-3"
          >
            <span className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-brand px-4 text-sm font-bold text-white">
              <Icon name="monitoring" size={16} />
              分析を開始
            </span>
            <Badge tone="neutral">1日1回</Badge>
          </div>
        </div>
        <div
          className={cn(
            GLASS,
            "relative mt-4 w-full p-5 min-[960px]:absolute min-[960px]:right-0 min-[960px]:bottom-0 min-[960px]:mt-0 min-[960px]:w-[58%]",
          )}
        >
          <p className="text-caption text-ink-3">
            良かった投稿の型 上位3件（イメージ）
          </p>
          <div className="mt-3 grid gap-2">
            {BARS.map((bar) => (
              <div
                className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-2"
                key={bar.label}
              >
                <span className="truncate text-caption text-ink-2">
                  {bar.label}
                </span>
                <div className="h-2 rounded-pill bg-black/[0.05]">
                  <div
                    className={cn("h-2 rounded-pill bg-brand/70", bar.width)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
