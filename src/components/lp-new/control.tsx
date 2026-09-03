import { SLOT_DOT_CLASS } from "@/components/lp/dots";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { GLASS, HEADING } from "./tokens";

/**
 * 「勝手には、投稿しない」の3カード（T-M8-419）。
 *
 * 図版は aria-hidden の装飾（CSSのみ）。文字は text-caption 以上。
 * 事実: 既定は下書きまで（PRD §10）／自動投稿は版付き同意の後・投稿直前にも再検証（要件04 §10）／
 * 設定から即時停止・停止で実行待ちも止まる／1アカウント1日50ポスト上限（O-5）。
 * 「連携するだけで自動投稿」「承認ワークフロー」の語は使わない。
 *
 * 3カラムは 1040px 以上だけ（768px で3カラムにすると1枚 約190px になり、図版の擬似UIが
 * 折れて「壊れたモック」になる）。640〜1039px は図版を左・文字を右に置いた横並びの1カラム。
 */
const FIGURE =
  "flex h-[140px] flex-col justify-center gap-3 rounded-[16px] bg-[linear-gradient(135deg,#f4e8f3_0%,rgba(255,255,255,0.7)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

function ModeFigure() {
  return (
    <div aria-hidden="true" className={FIGURE}>
      <div className="flex w-fit gap-1 rounded-pill bg-white/70 p-1">
        <span className="rounded-pill bg-white px-3 py-1 text-caption font-medium whitespace-nowrap text-brand shadow-[var(--shadow-card)]">
          下書きまで
        </span>
        <span className="rounded-pill px-3 py-1 text-caption font-medium whitespace-nowrap text-ink-2">
          そのまま投稿
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("size-2.5 rounded-pill", SLOT_DOT_CLASS.post)} />
          そのまま投稿
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("size-2.5 rounded-pill", SLOT_DOT_CLASS.draft)} />
          下書きまで
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("size-2.5 rounded-pill", SLOT_DOT_CLASS.none)} />
          なし
        </span>
      </div>
    </div>
  );
}

function ConsentFigure() {
  return (
    <div aria-hidden="true" className={FIGURE}>
      <div className="rounded-[12px] bg-white/80 p-3 shadow-[var(--shadow-card)]">
        <p className="text-caption font-medium text-ink">自動投稿の同意</p>
        <p className="mt-2 flex items-start gap-2 text-caption text-ink-2">
          <span className="mt-0.5 inline-block size-4 shrink-0 rounded-chip border border-brand bg-white" />
          対象・実行条件・停止方法を確認しました
        </p>
        <p className="mt-2 text-caption text-ink-3">
          X連携は同意ではありません
        </p>
      </div>
    </div>
  );
}

function StopFigure() {
  return (
    <div aria-hidden="true" className={FIGURE}>
      <span className="w-fit rounded-pill border border-brand bg-white px-4 py-1.5 text-caption font-medium whitespace-nowrap text-brand">
        すべて停止
      </span>
      <div>
        <div className="flex items-center justify-between text-caption text-ink-2">
          <span>今日の投稿</span>
          <span className="tabular-nums">12 / 50</span>
        </div>
        <div className="mt-1 h-2 rounded-pill bg-black/[0.06]">
          <div className="h-2 w-[24%] rounded-pill bg-brand" />
        </div>
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
    icon: "drafts",
    title: "既定は下書きまで",
    body: "枠ごとに選べます。確認するのはあなた。",
    figure: <ModeFigure />,
  },
  {
    icon: "verified_user",
    title: "同意してから、始まる",
    body: "版付きの同意の後だけ動きます。投稿直前にも同意を再検証。",
    figure: <ConsentFigure />,
  },
  {
    icon: "lock",
    title: "止めれば、実行待ちも止まる",
    body: "設定から即時停止。1アカウント1日50ポストの安全上限つき。",
    figure: <StopFigure />,
  },
];

export function ControlCards() {
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
              <h3 className={cn("text-[20px] leading-[1.4]", HEADING)}>
                {card.title}
              </h3>
            </div>
            <p className="mt-2 text-sm leading-[1.8] text-ink-2">{card.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
