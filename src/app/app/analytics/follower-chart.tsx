"use client";

import { useMemo, useState } from "react";

import { followerSeriesSummary, type FollowerPoint } from "@/lib/analytics";
import { CardTitle } from "@/components/ui/card";

/**
 * SC-09 フォロワー数推移グラフ（K-3, 要件06 §2, T-M5-16）。依存を増やさず inline SVG で描画する。
 * 期間切替（7/30/90日）、欠損日は点を作らずスキップ（実日付でx配置しgapを表現）、未収集は空状態。
 * アクセシビリティ: role=img＋aria-label、点はcircleマーカー（色以外の表現）、数値サマリと表を併記。
 */

const PERIODS = [7, 30, 90] as const;
const DAY_MS = 86_400_000;
const W = 640;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 24, left: 44 };

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(
    new Date(`${iso}T00:00:00+09:00`),
  );
}

export function FollowerChart({ points }: { points: FollowerPoint[] }) {
  const [days, setDays] = useState<number>(30);
  // マウント時点の now を一度だけ確定（render中の Date.now 呼び出しを避ける）。
  const [nowMs] = useState(() => Date.now());

  const filtered = useMemo(() => {
    const cutoff = nowMs - days * DAY_MS;
    return points.filter((p) => new Date(`${p.date}T00:00:00+09:00`).getTime() >= cutoff);
  }, [points, days, nowMs]);

  const summary = followerSeriesSummary(filtered);

  const geom = useMemo(() => {
    if (filtered.length === 0) return null;
    const times = filtered.map((p) => new Date(`${p.date}T00:00:00+09:00`).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const minC = summary.min ?? 0;
    const maxC = summary.max ?? 0;
    const spanC = Math.max(1, maxC - minC);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (t: number) => (maxT === minT ? PAD.left + innerW / 2 : PAD.left + ((t - minT) / (maxT - minT)) * innerW);
    const y = (c: number) => PAD.top + innerH - ((c - minC) / spanC) * innerH;
    return {
      pts: filtered.map((p, i) => ({ ...p, cx: x(times[i]), cy: y(p.count) })),
      yMin: minC,
      yMax: maxC,
    };
  }, [filtered, summary.min, summary.max]);

  return (
    <section className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>フォロワー数の推移</CardTitle>
        <div className="ml-auto inline-flex rounded-lg border p-0.5">
          {PERIODS.map((d) => (
            <button
              aria-pressed={days === d}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors duration-150 ${
                days === d ? "bg-brand text-white" : "text-ink-2 hover:text-ink"
              }`}
              key={d}
              onClick={() => setDays(d)}
              type="button"
            >
              {d}日
            </button>
          ))}
        </div>
      </div>

      {geom === null ? (
        <p className="mt-4 rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          この期間のフォロワー数記録はまだありません。フォロワー数は毎日自動で記録され、日を追うごとに推移が表示されます。
        </p>
      ) : (
        <>
          <dl className="mt-3 flex flex-wrap gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">現在</dt>
              <dd className="text-lg font-semibold tabular-nums">{summary.latest?.toLocaleString() ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">期間増減</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {summary.delta === null ? "--" : `${summary.delta >= 0 ? "+" : ""}${summary.delta.toLocaleString()}`}
              </dd>
            </div>
          </dl>

          <svg
            aria-label={`フォロワー数推移（直近${days}日、${summary.points}日分の記録）。現在 ${summary.latest ?? "不明"} 人。`}
            className="mt-3 h-auto w-full"
            role="img"
            viewBox={`0 0 ${W} ${H}`}
          >
            {/* 水平グリッド（デザイン §画面一覧 5.分析）。薄い線で目盛りだけを示す。 */}
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const y = PAD.top + (H - PAD.top - PAD.bottom) * r;
              return (
                <line
                  key={r}
                  stroke="rgba(0,0,0,.05)"
                  strokeWidth="1"
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                />
              );
            })}
            {/* y軸ラベル（最小・最大） */}
            <text fill="rgba(0,0,0,.45)" fontSize="10" x="4" y={PAD.top + 4}>
              {geom.yMax.toLocaleString()}
            </text>
            <text fill="rgba(0,0,0,.45)" fontSize="10" x="4" y={H - PAD.bottom}>
              {geom.yMin.toLocaleString()}
            </text>
            {/* 面塗り（線の下）。淡いキー色で推移の量感を出す。 */}
            {geom.pts.length > 1 ? (
              <polygon
                fill="var(--brand-subtle)"
                points={[
                  `${geom.pts[0].cx},${H - PAD.bottom}`,
                  ...geom.pts.map((p) => `${p.cx},${p.cy}`),
                  `${geom.pts[geom.pts.length - 1].cx},${H - PAD.bottom}`,
                ].join(" ")}
              />
            ) : null}
            {/* 折れ線（2点以上） */}
            {geom.pts.length > 1 ? (
              <polyline
                fill="none"
                points={geom.pts.map((p) => `${p.cx},${p.cy}`).join(" ")}
                stroke="var(--brand)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
              />
            ) : null}
            {/* 各snapshotの点（色以外の形状マーカー） */}
            {/*
              最新値の数値ラベルはデザインでは折れ線の右に置くが、この幅では最終点と必ず重なる
              （実際に描いて確認した）。同じ数値は上の「現在」に出しているので、ここでは
              **最終点を大きくする**ことで最新であることだけを示す。
            */}
            {geom.pts.map((p, i) => (
              <circle
                cx={p.cx}
                cy={p.cy}
                fill="var(--brand)"
                key={p.date}
                r={i === geom.pts.length - 1 ? 4.5 : 3}
              >
                <title>{`${fmtDate(p.date)}: ${p.count.toLocaleString()}人`}</title>
              </circle>
            ))}
          </svg>

          {/* 色に依存しないデータ表（アクセシビリティ・スクリーンリーダー併用） */}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">データを表で見る</summary>
            <div className="mt-2 max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">日付</th>
                    <th className="py-1 font-medium">フォロワー数</th>
                  </tr>
                </thead>
                <tbody>
                  {geom.pts.map((p) => (
                    <tr className="border-b last:border-0" key={p.date}>
                      <td className="py-1 pr-4">{fmtDate(p.date)}</td>
                      <td className="py-1 tabular-nums">{p.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
