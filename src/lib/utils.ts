import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge に**カスタムのフォントサイズトークンを教える**（T-M8-71）。
 *
 * `text-caption` / `text-body`（globals.css の --text-* トークン）は、素の twMerge だと
 * 「未知の text-*」＝**文字色**として分類され、`cn("text-body", "text-brand")` のように
 * 色クラスと並ぶと**サイズ側が黙って消える**（実際に tab-nav で 13px 指定が落ちた）。
 * font-size グループとして登録すれば、色とサイズは別グループとして両方残る。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-caption", "text-body"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
