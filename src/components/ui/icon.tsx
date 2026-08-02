import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import { ICON_PATHS, type IconName } from "./icon-paths";

/**
 * アイコン（T-M8-02）。デザインは Material Symbols Outlined を指定している。
 *
 * **フォントではなくインラインSVGで持つ。** Material Symbols の可変フォントは3.8MBあり、
 * 全ページへ載せるには重すぎる（実際にダウンロードして確認した）。使う41個だけをSVGの
 * pathとして持つと12.6KBで済み、CSPのフォント制限とも無関係になる。
 *
 * 定義は `icon-paths.ts`（`npm run icons:generate` で再生成）。増やすときは
 * `scripts/generate-icons.mjs` の一覧へ追記する。**手で貼らない。**
 */
export interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: IconName;
  /**
   * 読み上げるラベル。**省略時は装飾として読み上げから除外する**（`aria-hidden`）。
   * アイコンだけで意味を伝えるボタンには必ず渡す。
   */
  label?: string;
  /** 一辺の大きさ（px）。デザインは14〜24pxを使い分ける。 */
  size?: number;
}

export function Icon({ className, label, name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("inline-block shrink-0 fill-current", className)}
      height={size}
      role={label ? "img" : undefined}
      // Material Symbols は 960 グリッドで、y軸が -960..0 の範囲にある。
      viewBox="0 -960 960 960"
      width={size}
      {...props}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export type { IconName };
