import { Icon, type IconName } from "@/components/ui/icon";
import { PATTERN_MAX_COUNT } from "@/lib/post/post-patterns-store";
import { cn } from "@/lib/utils";

import { GLASS, HEADING } from "./tokens";

/**
 * 「複数のプロンプトを管理」の3カード（T-M8-419・運営者の指示 2026-09-03。
 * 旧「勝手には、投稿しない」を置き換えた。既定は下書きまで／同意の開示はヒーローのサブ文と
 * FAQ Q1 が引き続き担う）。
 *
 * 図版は aria-hidden の装飾（CSSのみ）。文字は text-caption 以上。
 * 事実: 投稿の型は標準5種類＋自作で最大 PATTERN_MAX_COUNT 件・型ごとに生成プロンプトを編集
 * （要件06 §3.6・T-M8-134/397）／アカウント.md は保存するたび本棚に版が増え「使用中」を切替
 * （T-M8-332/411）／プロンプト画面は AIモデル設定・アカウント.md・投稿作成プロンプト・
 * 画像生成プロンプトの4区分（T-M8-401）。画像生成の既定は OpenAI / GPT Image 1.5。
 *
 * 3カラムは 1040px 以上だけ。640〜1039px は図版を左・文字を右に置いた横並びの1カラム。
 */
const FIGURE =
  "flex h-[140px] flex-col justify-center gap-2.5 rounded-[16px] bg-[linear-gradient(135deg,#f4e8f3_0%,rgba(255,255,255,0.7)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

function PatternsFigure() {
  const patterns = ["ニュース解説", "自分の考え・意見", "ノウハウ・ハウツー", "トレンド便乗"];
  return (
    <div aria-hidden="true" className={FIGURE}>
      <div className="grid grid-cols-2 gap-1.5">
        {patterns.map((name, index) => (
          <span
            className={cn(
              "truncate rounded-[10px] px-2.5 py-1.5 text-caption font-medium",
              index === 0
                ? "bg-brand-subtle text-brand ring-1 ring-brand/40"
                : "bg-white/80 text-ink-2",
            )}
            key={name}
          >
            {name}
          </span>
        ))}
      </div>
      <span className="inline-flex w-fit items-center gap-1 rounded-[10px] border border-dashed border-brand/50 px-2.5 py-1 text-caption text-brand">
        <Icon name="add" size={13} />
        パターンを追加
      </span>
    </div>
  );
}

function ShelfFigure() {
  const versions: [string, boolean][] = [
    ["アカウント設定 v3", true],
    ["アカウント設定 v2", false],
    ["アカウント設定 v1", false],
  ];
  return (
    <div aria-hidden="true" className={FIGURE}>
      {versions.map(([name, inUse]) => (
        <div
          className={cn(
            "flex items-center justify-between rounded-[10px] px-3 py-1.5 text-caption",
            inUse ? "bg-white shadow-[var(--shadow-card)] text-ink" : "bg-white/60 text-ink-2",
          )}
          key={name}
        >
          <span className="font-medium">{name}</span>
          {inUse ? (
            <span className="rounded-pill bg-brand px-2 py-0.5 text-caption font-medium text-white">
              使用中
            </span>
          ) : (
            <span className="text-ink-3">切替</span>
          )}
        </div>
      ))}
    </div>
  );
}

function TabsFigure() {
  const tabs = ["AIモデル設定", "アカウント.md", "投稿作成プロンプト", "画像生成プロンプト"];
  return (
    <div aria-hidden="true" className={FIGURE}>
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab, index) => (
          <span
            className={cn(
              "rounded-pill px-2.5 py-1 text-caption font-medium whitespace-nowrap",
              index === 3 ? "bg-white text-brand shadow-[var(--shadow-card)]" : "text-ink-2",
            )}
            key={tab}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="rounded-[10px] bg-white/80 px-3 py-2 text-caption text-ink-2">
        <span className="text-ink-3">画像生成に使うAI</span>
        <span className="ml-2 font-medium text-ink">OpenAI / GPT Image 1.5</span>
      </div>
    </div>
  );
}

const CARDS: {
  icon: IconName;
  title: string;
  body: string;
  figure: React.ReactNode;
}[] = [
  {
    icon: "edit_square",
    title: "投稿の型を、何個でも",
    body: `標準の5種類から始めて、自分の型を最大${PATTERN_MAX_COUNT}件まで。型ごとに生成プロンプトを直せます。`,
    figure: <PatternsFigure />,
  },
  {
    icon: "history",
    title: "アカウント.mdは、版で残す",
    body: "誰に何を発信するかの土台。保存するたび本棚に版が増え、使用中を切り替えられます。",
    figure: <ShelfFigure />,
  },
  {
    icon: "tune",
    title: "画像とAIモデルも、ここで",
    body: "画像生成の指示と、文章・画像に使うAIモデル。クローンの中身は1画面で見渡せます。",
    figure: <TabsFigure />,
  },
];

export function PromptCards() {
  return (
    <div className="mt-[clamp(24px,4vw,48px)] grid grid-cols-1 gap-6 min-[1040px]:grid-cols-3">
      {CARDS.map((card) => (
        <div
          className={cn(
            GLASS,
            "grid gap-5 p-6 min-[640px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[640px]:items-center min-[1040px]:grid-cols-1",
          )}
          key={card.title}
        >
          {card.figure}
          <div>
            <div className="flex items-center gap-2">
              <Icon className="text-brand" name={card.icon} size={20} />
              <h3 className={cn("text-[20px] leading-[1.4]", HEADING)}>{card.title}</h3>
            </div>
            <p className="mt-2 text-sm leading-[1.8] text-ink-2">{card.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
