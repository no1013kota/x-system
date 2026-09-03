import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * 実アプリのスクリーンショット（T-M8-415・運営者提供の実データ画面）。
 *
 * CSSで描いた図版より「本物の画面」の方が信頼に効くため、ブラウザ風フレームに入れて
 * 実画面だと分かる形で出す。元画像は public/lp-shots/*.jpg（1600×1171へ最適化済み）。
 * LPは server component のまま（クライアント化はlanding-page.test.tsが禁止している）。
 */
/** 図版の共通フレーム（角丸カード＋影。上部のブラウザ風バーはT-M8-418で撤去・運営者の指示）。 */
export function ShotFrame({
  children,
  className,
  fadeBottom = false,
  inset = false,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * 下端をフェードで溶かす（T-M8-417・運営者の指摘「枠と画像の位置がずれている」）。
   * スクショは実画面の途中で切れるため、フェード無しだと行やカードが
   * 中途半端に断ち切られて「ずれ」に見える。意図した見切れに整える。
   */
  fadeBottom?: boolean;
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
      <div className={inset ? "relative p-3" : "relative"}>
        {children}
        {fadeBottom ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 [background:linear-gradient(to_bottom,rgba(255,255,255,0),#fff_92%)]"
          />
        ) : null}
      </div>
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
    <ShotFrame className={className} fadeBottom>
      <Image
        alt={alt}
        className="block h-auto w-full"
        height={height}
        priority={priority}
        sizes={sizes}
        src={src}
        width={width}
      />
    </ShotFrame>
  );
}
