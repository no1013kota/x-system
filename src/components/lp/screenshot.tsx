import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * 実アプリのスクリーンショット（T-M8-415・運営者提供の実データ画面）。
 *
 * CSSで描いた図版より「本物の画面」の方が信頼に効くため、ブラウザ風フレームに入れて
 * 実画面だと分かる形で出す。元画像は public/lp-shots/*.jpg（1600×1171へ最適化済み）。
 * LPは server component のまま（クライアント化はlanding-page.test.tsが禁止している）。
 */
/** ブラウザ風フレーム（装飾）。CSS図版も同じ枠に入れて見た目を揃える（レビュー1周目）。 */
export function ShotFrame({
  children,
  className,
  inset = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** CSS図版用: 中身の周りに余白を付ける（スクショは付けない）。 */
  inset?: boolean;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[14px] border border-hairline bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="flex items-center gap-1.5 border-b border-hairline bg-page px-3 py-2"
      >
        <span className="size-2 rounded-full bg-black/[0.12]" />
        <span className="size-2 rounded-full bg-black/[0.12]" />
        <span className="size-2 rounded-full bg-black/[0.12]" />
      </div>
      <div className={inset ? "p-3" : undefined}>{children}</div>
    </figure>
  );
}

export function AppShot({
  alt,
  className,
  height = 1096,
  priority = false,
  sizes = "(min-width: 760px) 560px, 100vw",
  src,
  width = 1600,
}: {
  alt: string;
  className?: string;
  height?: number;
  priority?: boolean;
  sizes?: string;
  src: string;
  width?: number;
}) {
  return (
    <ShotFrame className={className}>
      <Image
        alt={alt}
        className="block h-auto w-full"
        height={height}
        priority={priority}
        quality={82}
        sizes={sizes}
        src={src}
        width={width}
      />
    </ShotFrame>
  );
}
