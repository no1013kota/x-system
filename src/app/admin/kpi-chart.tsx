"use client";

import { useMemo, useState } from "react";

import { CardTitle } from "@/components/ui/card";

/**
 * 運営ダッシュボードの時系列チャート（T-M8-373）。
 * `follower-chart.tsx`（SC-09）と同じ方針: 依存を増やさず inline SVG、
 * 欠損日は点を作らずスキップ、role=img＋aria-label、数値サマリを併記する。
 */

const PERIODS = [30, 90, 400] as const;
const DAY_MS = 86_400_000;
const W = 640;
const H = 180;
const PAD = { top: 14, right: 14, bottom: 22, left: 56 };

export interface KpiChartPoint {
  date: string;
  value: number;
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${iso}T00:00:00+09:00`));
}

function fmtValue(v: number, unit: string): string {
  return `${Math.round(v).toLocaleString("ja-JP")}${unit}`;
}

export function KpiChart({
  points,
  title,
  unit,
}: {
  points: KpiChartPoint[];
  title: string;
  unit: string;
}) {
  const [days, setDays] = useState<number>(90);
  const [nowMs] = useState(() => Date.now());
  /** ホバー中の点のindex（filtered基準）。タッチでも同じ経路で更新する（T-M8-374）。 */
  const [hover, setHover] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const cutoff = nowMs - days * DAY_MS;
    return points.filter((p) => new Date(`${p.date}T00:00:00+09:00`).getTime() >= cutoff);
  }, [points, days, nowMs]);

  const latest = filtered.at(-1);
  const max = filtered.reduce((acc, p) => Math.max(acc, p.value), 0);

  const geom = useMemo(() => {
    if (filtered.length === 0) return null;
    const times = filtered.map((p) => new Date(`${p.date}T00:00:00+09:00`).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const minV = Math.min(...filtered.map((p) => p.value), 0);
    const spanV = Math.max(1, max - minV);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (t: number) =>
      maxT === minT ? PAD.left + innerW / 2 : PAD.left + ((t - minT) / (maxT - minT)) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - minV) / spanV) * innerH;
    const path = filtered
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(" ");
    return { path, x, y, times, minV };
  }, [filtered, max]);

  /*
    **カーソル位置から最も近い点を選ぶ**（T-M8-374・運営者の指示）。
    viewBoxで縮尺が変わるため、clientX をそのまま使わず svg の実描画幅で
    viewBox座標へ換算してから、各点のx座標と比べる。点そのものへのホバーを
    要求すると半径2.5pxを狙うことになり実用にならない。
  */
  function pickNearest(e: { clientX: number; currentTarget: SVGSVGElement }) {
    if (!geom || filtered.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < filtered.length; i++) {
      const d = Math.abs(geom.x(geom.times[i]) - vx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  }

  const hovered = hover != null ? filtered[hover] : null;

  return (
    <section aria-label={title} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle as="h3">{title}</CardTitle>
        <div className="flex gap-1" role="group" aria-label={`${title}の期間`}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              aria-pressed={days === p}
              className={`rounded-md px-2 py-1 text-xs ${
                days === p ? "bg-ink text-surface" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              {p}日
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">まだデータがありません（日次スナップショットが貯めます）。</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2" aria-live="polite">
            {hovered ? (
              <>
                <span className="font-bold text-ink">
                  {fmtDate(hovered.date)} {fmtValue(hovered.value, unit)}
                </span>
                {" ／ 期間最大 "}
                {fmtValue(max, unit)}
              </>
            ) : (
              <>
                最新 {latest ? `${fmtDate(latest.date)} ${fmtValue(latest.value, unit)}` : "—"} ／ 期間最大{" "}
                {fmtValue(max, unit)}
              </>
            )}
          </p>
          <svg
            className="mt-2 h-auto w-full max-w-full"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${title}の推移（${days}日間・最新 ${latest ? fmtValue(latest.value, unit) : "なし"}）`}
            onMouseMove={pickNearest}
            onMouseLeave={() => setHover(null)}
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (t) pickNearest({ clientX: t.clientX, currentTarget: e.currentTarget });
            }}
          >
            {geom ? (
              <>
                <line
                  x1={PAD.left}
                  y1={H - PAD.bottom}
                  x2={W - PAD.right}
                  y2={H - PAD.bottom}
                  stroke="var(--color-hairline)"
                />
                <path d={geom.path} fill="none" stroke="var(--color-brand)" strokeWidth="2" />
                {filtered.map((p, i) => (
                  <circle
                    key={p.date}
                    cx={geom.x(geom.times[i])}
                    cy={geom.y(p.value)}
                    r={hover === i ? 4.5 : 2.5}
                    fill="var(--color-brand)"
                  >
                    {/* ネイティブのtooltip（マウスが点上で止まったときの補助）。 */}
                    <title>{`${fmtDate(p.date)} ${fmtValue(p.value, unit)}`}</title>
                  </circle>
                ))}
                {hovered && geom ? (
                  <g pointerEvents="none">
                    {/* 縦の目印線と、点の近くの値ラベル（枠外へはみ出す側を避けて左右を切替）。 */}
                    <line
                      x1={geom.x(geom.times[hover ?? 0])}
                      y1={PAD.top}
                      x2={geom.x(geom.times[hover ?? 0])}
                      y2={H - PAD.bottom}
                      stroke="var(--color-hairline)"
                    />
                    <text
                      fill="var(--color-ink)"
                      fontSize="11"
                      fontWeight="bold"
                      x={
                        geom.x(geom.times[hover ?? 0]) + (geom.x(geom.times[hover ?? 0]) > W / 2 ? -8 : 8)
                      }
                      y={Math.max(PAD.top + 12, geom.y(hovered.value) - 8)}
                      textAnchor={geom.x(geom.times[hover ?? 0]) > W / 2 ? "end" : "start"}
                    >
                      {`${fmtDate(hovered.date)} ${fmtValue(hovered.value, unit)}`}
                    </text>
                  </g>
                ) : null}
                {/* SVG内の軸ラベルは follower-chart.tsx と同じ fontSize 属性で指定する
                    （15px未満の任意値クラスは type-scale.test.ts が禁止している）。 */}
                <text fill="rgba(0,0,0,.45)" fontSize="10" x={PAD.left} y={PAD.top + 4}>
                  {fmtValue(max, unit)}
                </text>
                <text fill="rgba(0,0,0,.45)" fontSize="10" x={PAD.left} y={H - 8}>
                  {fmtDate(filtered[0].date)}
                </text>
                <text fill="rgba(0,0,0,.45)" fontSize="10" x={W - PAD.right} y={H - 8} textAnchor="end">
                  {latest ? fmtDate(latest.date) : ""}
                </text>
              </>
            ) : null}
          </svg>
        </>
      )}
    </section>
  );
}
