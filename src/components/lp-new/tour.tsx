import { AppShot } from "@/components/lp/screenshot";
import { Icon } from "@/components/ui/icon";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { THEME_LABELS } from "./facts";
import {
  ANCHOR,
  CHIP_CLASS,
  CHIP_LABEL,
  H2,
  HEADING,
  SHOT_SHADOW,
  SUB,
  type Who,
} from "./tokens";

/**
 * 「実際の画面で、工程を追う」（T-M8-419。4周目・2026-09-04 に構造を変更、5周目で CTA を右列末尾へ）。
 *
 * FAQ と同型の2カラム。左列＝h2＋サブ＋停止の索引を sticky（top 88px＝ヘッダー64＋24。
 * FAQ の h2 と同じ値なのでページ内で見出しが止まる高さが揃う）。右列＝停止4件を静的に縦積みし、
 * 最後に CTA（`cta`・page.tsx の CtaRow）を置く。画像には sticky を付けない。動きは自然なスクロールだけ。
 *
 * 旧構造（article ごとに右のスクショを sticky にして差し替える）は、1停止のうち画像が止まる区間が
 * 約29%しかなく「引っかかって離れる」・次の画像が被さらず2枚同時に流れる・テキストと画像の同期が
 * ずれる・最後の停止だけ挙動が違う・停止距離がビューポート高で変わる、という違和感（運営者の指摘
 * 2026-09-04）の原因そのものだった。sticky を画像から見出しへ移し、微調整ではなく原因ごと消す。
 * 代わりに画像幅が 640→739px（1280幅）に広がり、4停止が同じ高さ・同じ挙動で並ぶ。
 *
 * 5周目: 左列にあった「料金を見る」文字リンクは削除（sticky が外れる瞬間に直後の CtaRow の同名ピルと
 * 同じ列に2つ並び、連れ立って上がるのが残った違和感。880px以上はヘッダーnavにも「料金」がある）。
 * CtaRow は右列の最後（停止04の直下）へ移し、読み終わりの位置に受け皿を置く。grid の下端が CtaRow の
 * 下になるので、sticky はそこで自然に外れる。
 *
 * sticky の条件（FAQ と同じ罠）: 左列は `self-start` 必須（既定の stretch だと grid セルいっぱいに
 * 伸びて動く余地が無い）。grid・section・祖先に overflow-hidden／clip を付けない（sticky が黙って死ぬ）。
 * `overflow-y-auto` で吸収しない（overflow は sticky を殺す）。
 * ビューポート高 560px未満では sticky を外して普通に流す（左列は実測 約350〜370px〔サブ文が2行に折れる
 * 1024幅が最大〕＋top 88px。sticky は自身のはみ出しを見せないので、ズームや最小フォント設定で
 * 左列が伸びても切れない余裕を取る）。
 * 880px未満は1カラム縦積み（sticky なし）。全画面のスクショは幅350pxでは判読できないため、
 * 元画像をそのまま開く「拡大して見る」リンクを添える（JS不要）。
 */
interface Stop {
  no: string;
  title: string;
  who: Who[];
  body: string;
  note?: string;
  src: string;
  alt: string;
  /**
   * スクショ枠に足すクラス（`ShotFrame` の figure に付く）。元画像の下が空白の画面は、
   * `[&_img]:max-h-… [&_img]:object-cover [&_img]:object-top` で上を残して切る（JS不要。
   * overflow-hidden と fadeBottom はそのまま効く）。
   */
  shotClassName?: string;
}

/**
 * ホーム画面（app-home.jpg）は「フォロワー43・次回の自動実行 予定なし・初期設定ガイド」の
 * 空の初期状態で、「測る」の証拠にならない（むしろ逆メッセージ）。運用中の状態で撮り直した
 * 画像（assetWishlist）が届くまで停止から外す。1・7・30日の自動記録は図面板のリング図が担う。
 */
const HOME_SHOT_READY = false;
const HOME_STOP: Omit<Stop, "no"> = {
  title: "測る",
  who: ["auto"],
  body: "フォロワー数・今週の投稿・未確認の下書き・次回の自動実行がホームの4枚に。",
  src: "/lp-shots/app-home.jpg",
  alt: "ホーム画面（実際の管理画面）",
};

/**
 * 停止の見出しは図面板のリング図の工程名に揃える（集める・作る・投稿・反映。「出す」「育てる」は
 * リングに無く対応づけられなかった——6周目で最後の停止も「育てる」→「反映」へ）。
 */
const STOP_SOURCE: Omit<Stop, "no">[] = [
  {
    title: "集める",
    who: ["auto"],
    // 分野名のチップ列は出さない（スクショに分野が写っていて重複し、この停止だけ帯が高くなる）。
    body: `${THEME_LABELS.length}分野の新着が重要度つきで並ぶ。気になった記事から「すぐに投稿作成」。`,
    src: "/lp-shots/news.jpg",
    alt: "最新ニュース画面（実際の管理画面）",
  },
  {
    title: "作る",
    who: ["auto"],
    body: "型を選んで60〜90秒。プロンプトは画面に見えて、そのまま書き換えられる。",
    // 画像生成の提供元はアプリ画面と同じ表示名（OpenAI／Gemini）。「ChatGPT」と書かない。
    // BYOK の開示は「何のキーか」まで書く（「キー登録時」だけでは初心者に読めない）。
    note: `画像も各ポストに1枚（OpenAI／Gemini）。${PLANS.standard.displayName}は自分のAPIキーで使います。`,
    src: "/lp-shots/compose.jpg",
    alt: "投稿作成画面（実際の管理画面）",
  },
  {
    title: "投稿",
    who: ["you", "auto"],
    // 「枠」はスケジュール枠の内部用語で初心者に伝わらない（6周目）。主語を置き、体言止めを1つにする。
    body: "予約した時間ごとに「下書きまで」か「そのまま投稿」を選べる。次に動く時刻も表示。",
    src: "/lp-shots/schedule.jpg",
    alt: "スケジュール画面（実際の管理画面）",
    // この画面だけ元画像の下 約35% が空白（予定2件の状態で撮影）。739px幅では「読み込み途中」に見えるので、
    // 上を残して切る。撮り直し（予定3〜4件）が届いたら外す。
    shotClassName:
      "[&_img]:max-h-[clamp(240px,30vw,400px)] [&_img]:object-cover [&_img]:object-top",
  },
  ...(HOME_SHOT_READY ? [HOME_STOP] : []),
  {
    title: "反映",
    // リング図の「反映」（7）と同じ語にする（反映した改善案の行き先がこの画面）。
    who: ["you"],
    // 「アカウント.md」はページ内でここが初出（「複数のプロンプトを管理」より前）なので、一言の補足を付ける。
    body: "反映した改善案は、アカウント.md（あなたの発信方針のメモ）と型ごとのプロンプトに残っていく。",
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

/**
 * 索引の行。880px以上は FAQ と同じ hairline 行、未満は横並びのピル。
 * 880px以上は sticky で常時見えている分、押せることが伝わらないと「ただの目次」に見えるので、
 * 行末に chevron を置き、hover で行全体（-mx-2/px-2 の面）が反応する（6周目）。現在地の追随は
 * しない（JS禁止。右列の番号が常に見えている）。
 */
const INDEX_LINK =
  "group/index inline-flex h-8 items-center gap-1.5 rounded-pill bg-white/70 px-3 text-caption font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:text-brand min-[880px]:-mx-2 min-[880px]:flex min-[880px]:h-10 min-[880px]:gap-3 min-[880px]:rounded-lg min-[880px]:bg-transparent min-[880px]:px-2 min-[880px]:text-sm min-[880px]:shadow-none min-[880px]:hover:bg-white/60";

export function Tour({ cta }: { cta?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-[clamp(24px,4vw,56px)] min-[880px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
      {/* 左列: self-start が必須（stretch だと sticky が動かない）。低い画面では sticky を外す。 */}
      <div className="self-start min-[880px]:top-[88px] min-[880px]:[@media(min-height:560px)]:sticky">
        <h2 className={H2}>
          <span className="inline-block">実際の画面で、</span>
          <span className="inline-block">工程を追う</span>
        </h2>
        <p className={SUB}>実際の管理画面です（一部を切り出し）。</p>
        {/* 停止の索引（JS不要のアンカー）。現在地の追随はしない（右列の番号が常に見えている）。 */}
        <ol className="mt-6 flex flex-wrap gap-2 min-[880px]:mt-8 min-[880px]:flex-col min-[880px]:gap-0">
          {STOPS.map((stop) => (
            <li
              className="min-[880px]:border-t min-[880px]:border-hairline min-[880px]:last:border-b"
              key={stop.no}
            >
              <a className={INDEX_LINK} href={`#${stopId(stop)}`}>
                <span className="text-brand tabular-nums">{stop.no}</span>
                {stop.title}
                <span className="ml-auto hidden text-ink-3 transition-colors group-hover/index:text-brand min-[880px]:inline-flex">
                  <Icon name="chevron_right" size={16} />
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* 右列: 停止を兄弟として縦積み。間隔は gap で持たせ、margin と scroll-mt を干渉させない。 */}
      <div className="flex min-w-0 flex-col gap-[clamp(40px,6vw,72px)]">
        {STOPS.map((stop) => (
          <article
            className={cn(
              ANCHOR,
              // 索引から飛んだとき、番号の行が sticky の h2 と同じ y=88 に来る。到着した停止は見出しを brand に。
              "group/stop min-[880px]:scroll-mt-[88px]",
            )}
            id={stopId(stop)}
            key={stop.no}
          >
            {/* 帯: 番号＋見出し＋記法チップを1行に（帯の高さを4停止で揃える）。 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-caption font-bold tracking-[0.08em] text-brand tabular-nums">
                {stop.no}
              </span>
              <h3
                className={cn(
                  "text-[24px] leading-[1.3] transition-colors group-target/stop:text-brand",
                  HEADING,
                )}
              >
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
            <p className="mt-3 max-w-[560px] text-sm leading-[1.8] text-ink-2">
              {stop.body}
            </p>
            {stop.note ? (
              <p className="mt-2 max-w-[560px] text-caption text-ink-3">{stop.note}</p>
            ) : null}
            <div className="mt-6 min-w-0">
              <AppShot
                alt={stop.alt}
                className={cn(SHOT_SHADOW, stop.shotClassName)}
                // 列幅（1280で739px）に合わせる。640のままだと小さい候補を拡大して甘くなる。
                sizes="(min-width: 880px) 740px, 100vw"
                src={stop.src}
              />
              <a
                className="mt-2 inline-flex min-h-6 items-center gap-1 text-caption font-medium text-brand min-[880px]:hidden"
                href={stop.src}
                rel="noopener noreferrer"
                target="_blank"
              >
                画像を拡大して見る
                {/* 新しいタブで開くことは視覚（アイコン）以外にも伝える（フッターのXリンクと同じ書き方）。 */}
                <span className="sr-only">（新しいタブで開く）</span>
                <Icon name="open_in_new" size={13} />
              </a>
            </div>
          </article>
        ))}
        {/* 納得の直後に受け皿（読み終わりの位置＝最後のスクショの直下）。間隔は停止間と同じ gap。 */}
        {cta ? <div>{cta}</div> : null}
      </div>
    </div>
  );
}
