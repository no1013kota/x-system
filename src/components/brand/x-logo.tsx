import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * X（旧Twitter）のロゴ（T-M8-183）。
 *
 * Material Symbols には無いため `icon-paths.ts`（`npm run icons:generate`）の対象外で、
 * X公式ブランド素材の形状をインラインSVGで持つ。色は `fill-current` で周囲の文字色に従う。
 * 装飾としてのみ使う（読み上げラベルは置く側のリンク／ボタンが持つ）。
 */
export function XLogo({
  className,
  size = 18,
  ...props
}: Omit<ComponentProps<"svg">, "children"> & { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("inline-block shrink-0 fill-current", className)}
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
