import { AppShot } from "@/components/lp/screenshot";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { THEME_LABELS } from "./facts";
import {
  ANCHOR,
  CHIP_CLASS,
  CHIP_LABEL,
  HEADING,
  SHOT_SHADOW,
  type Who,
} from "./tokens";

/**
 * 「実際の画面で、工程を追う」（T-M8-419）。
 *
 * 実画面をここに集中投下し、他セクションはCSS図版で抽象化する。
 * 880px以上では右のスクショを sticky にして、スクロールで次の行の画面が下から差し替わる
 * （JS不要の「画面切替」）。行や section に overflow-hidden を付けない（sticky が効かなくなる）。
 * 880px未満はテキスト→画像の縦積み。全画面のスクショは幅350pxでは判読できないため、
 * 元画像をそのまま開く「拡大して見る」リンクを添える（JS不要）。
 */
interface Stop {
  no: string;
  title: string;
  who: Who[];
  body: string;
  note?: string;
  chips?: readonly string[];
  src: string;
  alt: string;
}

/**
 * ホーム画面（app-home.jpg）は「フォロワー43・次回の自動実行 予定なし・初期設定ガイド」の
 * 空の初期状態で、「測る」の証拠にならない（むしろ逆メッセージ）。運用中の状態で撮り直した
 * 画像（assetWishlist）が届くまで停止から外す。1・7・30日の自動記録は数字のセクションが担う。
 */
const HOME_SHOT_READY = false;
const HOME_STOP: Omit<Stop, "no"> = {
  title: "測る",
  who: ["auto"],
  body: "フォロワー数・今週の投稿・未確認の下書き・次回の自動実行がホームの4枚に。",
  src: "/lp-shots/app-home.jpg",
  alt: "ホーム画面（実際の管理画面）",
};

const STOP_SOURCE: Omit<Stop, "no">[] = [
  {
    title: "集める",
    who: ["auto"],
    body: `${THEME_LABELS.length}分野の新着が重要度つきで並ぶ。気になった記事から「すぐに投稿作成」。`,
    chips: THEME_LABELS,
    src: "/lp-shots/news.jpg",
    alt: "最新ニュース画面（実際の管理画面）",
  },
  {
    title: "作る",
    who: ["auto"],
    body: "型を選んで60〜90秒。プロンプトは画面に見えて、そのまま書き換えられる。",
    // 画像生成の提供元はアプリ画面と同じ表示名（OpenAI／Gemini）。「ChatGPT」と書かない。
    note: "画像も各ポストに1枚（OpenAI／Gemini）。スタンダードはキー登録時。",
    src: "/lp-shots/compose.jpg",
    alt: "投稿作成画面（実際の管理画面）",
  },
  {
    title: "出す",
    who: ["you", "auto"],
    body: "枠ごとに「下書きまで」か「そのまま投稿」。次回の実行時刻まで表示。",
    src: "/lp-shots/schedule.jpg",
    alt: "スケジュール画面（実際の管理画面）",
  },
  ...(HOME_SHOT_READY ? [HOME_STOP] : []),
  {
    title: "育てる",
    who: ["you"],
    body: "アカウント.mdと型ごとのプロンプトが、あなたの資産として残る。",
    src: "/lp-shots/prompts.jpg",
    alt: "プロンプト編集画面（実際の管理画面）",
  },
];

const STOPS: Stop[] = STOP_SOURCE.map((stop, index) => ({
  ...stop,
  no: String(index + 1).padStart(2, "0"),
}));

function stopId(stop: Stop): string {
  return `tour-${stop.no}`;
}

export function Tour() {
  return (
    <div className="mt-[clamp(16px,3vw,32px)]">
      {/* 停止の索引: 参照サイトの「機能リストを常時見せる」の代わり（JS不要のアンカー）。 */}
      <ol className="flex flex-wrap gap-2">
        {STOPS.map((stop) => (
          <li key={stop.no}>
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-white/70 px-3 text-caption font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:text-brand"
              href={`#${stopId(stop)}`}
            >
              <span className="text-brand tabular-nums">{stop.no}</span>
              {stop.title}
            </a>
          </li>
        ))}
      </ol>
      {STOPS.map((stop, index) => (
        <article
          className={cn(
            ANCHOR,
            "grid grid-cols-1 items-center gap-[clamp(24px,4vw,56px)] py-8 min-[880px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]",
          )}
          id={stopId(stop)}
          key={stop.no}
        >
          {/* テキスト列に高さを持たせ、右の画像が sticky で留まる距離を作る（画像 約444px に対し 90vh）。最後の停止は次のCTAまでの空きを作らないよう短く。 */}
          <div
            className={cn(
              "min-[880px]:flex min-[880px]:flex-col min-[880px]:justify-center",
              index === STOPS.length - 1
                ? "min-[880px]:min-h-[60vh]"
                : "min-[880px]:min-h-[90vh]",
            )}
          >
            <p className="text-caption font-bold tracking-[0.08em] text-brand tabular-nums">
              {stop.no}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h3 className={cn("text-[24px] leading-[1.3]", HEADING)}>
                {stop.title}
              </h3>
              <span className="flex items-center gap-1">
                {stop.who.map((who) => (
                  <span className={CHIP_CLASS[who]} key={who}>
                    {CHIP_LABEL[who]}
                  </span>
                ))}
              </span>
            </div>
            <p className="mt-3 max-w-[420px] text-sm leading-[1.8] text-ink-2">
              {stop.body}
            </p>
            {stop.note ? (
              <p className="mt-2 text-caption text-ink-3">{stop.note}</p>
            ) : null}
            {stop.chips ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {stop.chips.map((chip) => (
                  <span
                    className="inline-flex h-7 items-center rounded-pill bg-white/70 px-3 text-caption font-medium text-ink-2 shadow-[var(--shadow-card)]"
                    key={chip}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="min-w-0 min-[880px]:sticky min-[880px]:top-[88px] min-[880px]:self-start">
            <AppShot
              alt={stop.alt}
              className={SHOT_SHADOW}
              sizes="(min-width: 880px) 640px, 100vw"
              src={stop.src}
            />
            <a
              className="mt-2 inline-flex min-h-6 items-center gap-1 text-caption font-medium text-brand min-[880px]:hidden"
              href={stop.src}
              rel="noopener noreferrer"
              target="_blank"
            >
              画像を拡大して見る
              <Icon name="open_in_new" size={13} />
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
