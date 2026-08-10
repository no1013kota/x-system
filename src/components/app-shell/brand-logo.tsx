import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * ロゴ（T-M8-04）。28pxのグラデーション角丸タイル＋白い「S」＋Inter 700 のサービス名。
 *
 * グラデーションは**ロゴ・AI生成の瞬間・プレミアムバッジだけ**に使う（デザイン §カラー）。
 * 多用すると「AIが動いている」という合図としての意味が失われる。
 */
/** タイルの寸法セット。LP（ヒーローモック20・フッター24・ヘッダー28・最終CTA40）と共有する。 */
const TILE_SIZES = {
  20: { radius: 6, font: 11 },
  24: { radius: 7, font: 12 },
  28: { radius: 8, font: 15 },
  40: { radius: 10, font: 20 },
} as const;

/** ロゴのグラデーションタイル単体。ワードマーク無しで置く場所（LPのフッター・最終CTA等）用。 */
export function LogoTile({
  size = 28,
  className,
}: {
  size?: keyof typeof TILE_SIZES;
  className?: string;
}) {
  const tile = TILE_SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn("grid flex-none place-items-center font-bold text-white", className)}
      style={{
        width: size,
        height: size,
        borderRadius: tile.radius,
        fontSize: tile.font,
        backgroundImage: "var(--brand-gradient-logo)",
      }}
    >
      S
    </span>
  );
}

export function BrandLogo({
  className,
  href = "/app",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-2 rounded-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
      href={href}
    >
      <LogoTile size={28} />
      <span className="text-[17px] font-bold tracking-tight text-ink">{APP_NAME}</span>
    </Link>
  );
}
