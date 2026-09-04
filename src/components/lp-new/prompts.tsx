import { Icon, type IconName } from "@/components/ui/icon";
import {
  DEFAULT_IMAGE_MODELS,
  IMAGE_MODEL_OPTIONS,
  TEXT_MODEL_OPTIONS,
} from "@/lib/ai/model-catalog";
import { PATTERN_MAX_COUNT } from "@/lib/post/post-patterns-store";
import { cn } from "@/lib/utils";

import { BODY, GLASS, H3 } from "./tokens";

/**
 * 「複数のプロンプトを管理」の3カード（T-M8-419・運営者の指示 2026-09-03。
 * 旧「勝手には、投稿しない」を置き換えた。既定は下書きまで／同意の開示はヒーローのサブ文と
 * FAQ Q1 が引き続き担う）。
 *
 * 図版は aria-hidden の装飾（CSSのみ）。文字は text-caption 以上。
 * 事実: 投稿の型は標準5種類＋自作で最大 PATTERN_MAX_COUNT 件・型ごとに生成プロンプトを編集
 * （要件06 §3.6・T-M8-134/397）／アカウント.md と画像プロンプトは保存するたび本棚に版が並び
 * 「使用中」を切替。**本棚は SHELF_MAX（5）件まで**で、上限では使用中の1件を書き換える
 * （要件06 §3.7・T-M8-350/411。`prompts.test.ts` が `PRESET_MAX_COUNT` との一致を固定）／
 * 文章生成は Claude・GPT・Gemini、画像生成は GPT Image・Nano Banana から用途ごとに選べる
 * （`model-catalog.ts`。図版の表示名はカタログから引き、id の実在は同テストが固定）。
 * 画像生成の既定は `DEFAULT_IMAGE_MODELS.openai`（GPT Image 1.5）。
 *
 * 見出し（2026-09-04・T-M8-421）: 運営者指定は「プロンプトを無限に管理」「AIモデルも自由に決定」
 * で、上の事実（本棚5件・型20件）と食い違うが、運営者が「一旦は食い違ってもよい。文章だけ変更」と決定した
 * （2026-09-04・D-54）。本文は上限を言い続ける。カード1も運営者の語「投稿の型を、何個でも」に戻した。
 *
 * 3カラムは 1180px 以上だけ（1040px 起点だとマスが約109pxで型名が省略された・3周目）。760〜1179px は
 * 図版を左・文字を右に置いた横並びの1カラム、760px 未満は縦積み（図版が全幅）。
 */
// 高さは 156px（140px だと本棚3行＋注記が 22px 溢れ、上端に貼り付いた——レビュー 2026-09-04）。
const FIGURE =
  "flex h-[156px] flex-col justify-start gap-2 rounded-[16px] bg-[linear-gradient(135deg,#f4e8f3_0%,rgba(255,255,255,0.7)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

/** 本棚の上限（Xアカウントあたり）。正本は `prompt-presets.ts` の `PRESET_MAX_COUNT.base_md`（DB層を LP に import しないため値を写し、テストで一致を固定）。 */
export const SHELF_MAX = 5;
/** 図版に出すモデル id（カタログに実在することをテストで固定。無ければ空欄で黙って描かれる）。 */
export const FIGURE_TEXT_MODEL_ID = "claude-sonnet-5";
export const FIGURE_IMAGE_MODEL_ID = DEFAULT_IMAGE_MODELS.openai;

function PatternsFigure() {
  // 標準の5種類（実画面の名前）＋6マス目に「パターンを追加」。本文の「5種類」と図の数を揃える。
  const patterns = ["ニュース解説", "自分の考え・意見", "ノウハウ・ハウツー", "トレンド便乗", "週次まとめ"];
  return (
    <div aria-hidden="true" className={FIGURE}>
      <div className="grid grid-cols-2 gap-1.5">
        {patterns.map((name, index) => (
          <span
            className={cn(
              // palt でカナを詰める（768〜1150px の2列マスで「ノウハウ・ハウツー」が省略されないため・3周目）。
              "truncate rounded-[10px] px-2.5 py-1.5 text-caption font-medium [font-feature-settings:'palt']",
              index === 0
                ? "bg-brand-subtle text-brand ring-1 ring-brand/40"
                : "bg-white/80 text-ink-2",
            )}
            key={name}
          >
            {name}
          </span>
        ))}
        <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden rounded-[10px] border border-dashed border-brand/50 px-2.5 py-1.5 text-caption whitespace-nowrap text-brand [font-feature-settings:'palt']">
          <Icon className="shrink-0" name="add" size={13} />
          <span className="truncate">パターンを追加</span>
        </span>
      </div>
    </div>
  );
}

function ShelfFigure() {
  // 名前は実画面の本棚と同じ「アカウント設定 vN」。件数は上限（SHELF_MAX）を超えて見せない。
  const versions: [string, boolean][] = [
    ["アカウント設定 v5", true],
    ["アカウント設定 v4", false],
    ["アカウント設定 v3", false],
  ];
  return (
    <div aria-hidden="true" className={FIGURE}>
      {versions.map(([name, inUse]) => (
        <div
          className={cn(
            "flex items-center justify-between rounded-[10px] px-3 py-1 text-caption",
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
      <span className="text-caption text-ink-3">{SHELF_MAX}件まで並べて、切り替え</span>
    </div>
  );
}

/** AIモデル設定の2行（文章・画像）。表示名はカタログから引く（架空のモデル名を書かない）。 */
function ModelsFigure() {
  const textModel = TEXT_MODEL_OPTIONS.anthropic.find((m) => m.id === FIGURE_TEXT_MODEL_ID);
  const imageModel = IMAGE_MODEL_OPTIONS.openai.find((m) => m.id === FIGURE_IMAGE_MODEL_ID);
  // 表示名の「（バランス）」などの位置づけは外す（狭い幅で省略されると「（バラ…」になる。段の説明は下の注記が担う）。
  const short = (label: string | undefined) => (label ?? "").replace(/（[^）]*）$/, "");
  const rows: [string, string][] = [
    ["文章生成", short(textModel?.label)],
    ["画像生成", short(imageModel?.label)],
  ];
  return (
    <div aria-hidden="true" className={FIGURE}>
      {rows.map(([purpose, model]) => (
        <div
          className="flex items-center justify-between gap-2 rounded-[10px] bg-white px-3 py-1.5 text-caption shadow-[var(--shadow-card)]"
          key={purpose}
        >
          <span className="shrink-0 text-ink-3">{purpose}</span>
          <span className="flex min-w-0 items-center gap-1 font-medium text-ink">
            <span className="truncate">{model}</span>
            <Icon className="shrink-0 rotate-90 text-ink-3" name="chevron_right" size={16} />
          </span>
        </div>
      ))}
      {/* 図版の「（バランス）」の意味を補う（本文と同じ内容を繰り返さない）。段の語はカタログの表示名どおり。 */}
      <span className="text-caption text-ink-3">最高性能・バランス・低コストから選べます</span>
    </div>
  );
}

const CARDS: {
  id: string;
  icon: IconName;
  title: React.ReactNode;
  body: string;
  figure: React.ReactNode;
}[] = [
  {
    id: "patterns",
    icon: "edit_square",
    // 運営者の決定（2026-09-04・D-54）: 上限（合わせて20件）と食い違ってもよい。本文が上限を言う。
    title: "投稿の型を、何個でも",
    // 上限は既定パターンを含めて数える（post-patterns-store.ts）ので「合わせて」。
    body: `標準の5種類（画面では「パターン」）から始めて、合わせて最大${PATTERN_MAX_COUNT}件。型ごとにプロンプトを直せます。`,
    figure: <PatternsFigure />,
  },
  {
    icon: "history",
    id: "shelf",
    // 運営者指定の見出し（2026-09-04・D-54 で「一旦は食い違ってもよい。文章だけ変更」と決定）。
    // 本棚は5件までなので本文が上限を言う（レビューで暫定にしていた「書き換えても、前の版に戻せる」から戻した）。
    title: "プロンプトを無限に管理",
    body: `アカウント.md（発信方針のメモ。画面では「アカウント設定」）と画像の指示は、保存するたびに新しい版として本棚に並びます（${SHELF_MAX}件まで）。使う版はいつでも切り替えられ、前の版にも戻せます。`,
    figure: <ShelfFigure />,
  },
  {
    id: "models",
    icon: "tune",
    title: "AIモデルも自由に決定",
    body: "文章と画像、それぞれに使うAIモデルを選べます。文章は Claude／GPT／Gemini、画像は GPT Image／Nano Banana（Gemini の画像モデル）。迷ったら最初の設定のままで。",
    figure: <ModelsFigure />,
  },
];

export function PromptCards() {
  return (
    <div className="mt-[clamp(24px,4vw,48px)] grid grid-cols-1 gap-6 min-[1180px]:grid-cols-3">
      {CARDS.map((card) => (
        <div
          className={cn(
            GLASS,
            // 1180px以上は上詰め（stretch で伸びた分が2行に等分され、本文が短いカードほど見出しが下がった・2周目）。
            // 760〜1179px は図版に半分（5:7 だと2列マスの幅が足りず型名が省略された・3周目）。
            "grid gap-5 p-6 min-[760px]:grid-cols-2 min-[760px]:items-center min-[1180px]:grid-cols-1 min-[1180px]:content-start min-[1180px]:items-start",
          )}
          key={card.id}
        >
          {card.figure}
          <div>
            {/* 見出しが2行に折れてもアイコンは1行目の中央に（items-center だと行間に浮く・3周目）。 */}
            <div className="flex items-start gap-2">
              <Icon className="mt-[5px] shrink-0 text-brand" name={card.icon} size={20} />
              <h3 className={H3}>{card.title}</h3>
            </div>
            <p className={cn("mt-2 text-ink-2", BODY)}>{card.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
