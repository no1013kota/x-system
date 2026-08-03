import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * ロゴ（T-M8-04）。28pxのグラデーション角丸タイル＋白い「S」＋Inter 700 のサービス名。
 *
 * グラデーションは**ロゴ・AI生成の瞬間・プレミアムバッジだけ**に使う（デザイン §カラー）。
 * 多用すると「AIが動いている」という合図としての意味が失われる。
 */
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
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-card text-[15px] font-bold text-white"
        style={{ backgroundImage: "var(--brand-gradient-logo)" }}
      >
        S
      </span>
      <span className="text-[17px] font-bold tracking-tight text-ink">{APP_NAME}</span>
    </Link>
  );
}
