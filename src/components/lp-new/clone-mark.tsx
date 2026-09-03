import { cn } from "@/lib/utils";

/**
 * 「クローンの印」（/new の署名モチーフ）。中心の点を同心円が取り囲み、
 * ページを下るほど輪が増える（ヒーロー2輪 → 図面板3輪 → 育つ3輪 → 最終4輪＋弧矢印）。
 * 装飾なので常に aria-hidden。輪の半径は最外周98で固定し、輪の数で内側を等分する。
 */
export function CloneMark({
  rings,
  className,
  stroke = "rgba(125,31,117,0.45)",
  core = "#7d1f75",
  id = "clone-mark",
}: {
  rings: 2 | 3 | 4;
  className?: string;
  /** 輪の色。透明度は色の alpha で作る（opacity プロパティは使わない）。 */
  stroke?: string;
  /** 中心の点の色。背景に敷くときは null で輪だけにする（すりガラス越しに点が滲むため）。 */
  core?: string | null;
  /** marker の id 衝突を避けるため、同一ページで複数置くときは変える。 */
  id?: string;
}) {
  const INNER = 18;
  const OUTER = 98;
  const radii = Array.from(
    { length: rings },
    (_, index) => INNER + ((OUTER - INNER) * (index + 1)) / rings,
  );
  return (
    <svg
      aria-hidden="true"
      className={cn("block", className)}
      fill="none"
      viewBox="0 0 200 200"
    >
      <defs>
        <marker
          id={`${id}-arrow`}
          markerHeight="6"
          markerWidth="6"
          orient="auto-start-reverse"
          refX="3"
          refY="3"
          viewBox="0 0 6 6"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill={core ?? stroke} />
        </marker>
      </defs>
      {radii.map((r, index) => (
        <circle
          cx="100"
          cy="100"
          key={r}
          r={r}
          stroke={stroke}
          strokeWidth={index === 0 ? 2 : index === 1 ? 1.5 : 1}
        />
      ))}
      {rings === 4 ? (
        <path
          d="M 100 2 A 98 98 0 0 1 198 100"
          markerEnd={`url(#${id}-arrow)`}
          stroke={core ?? stroke}
          strokeWidth="2"
        />
      ) : null}
      {core ? <circle cx="100" cy="100" fill={core} r={INNER} /> : null}
    </svg>
  );
}
