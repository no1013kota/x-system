import Image from "next/image";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * ロゴ（T-M8-04、T-M8-111で画像へ差し替え）。
 *
 * **差し替えは `public/logo.png` を置き換えるだけ**（運営者が扱えるようにコードを触らせない）。
 * 同じ絵柄を favicon（`src/app/icon.png`）・Appleアイコン・OGPでも使うため、それらも
 * 合わせて更新する（生成手順は要件06 §2.2）。
 *
 * 画像は**透過PNG**であることを前提にする。背景を焼き込んだ画像を入れると、
 * 薄いグレーの面（LPフッターの `bg-page`）で白い四角が浮く。
 * 変換は `npm run logo -- <元画像>` が行う（トリミング・透過化・4ファイル生成）。
 */

/**
 * 表示サイズ（**高さ**）。幅はCSSの `w-auto` が縦横比から決めるので、
 * **画像を差し替えて比率が変わってもコードを直す必要がない**（原則3）。
 * 正方形の枠に収める（object-contain）と横長のマークが枠内で小さく見えるため、高さ基準にする。
 */
const HEIGHT_CLASS = {
  20: "h-5 w-auto",
  24: "h-6 w-auto",
  28: "h-7 w-auto",
  40: "h-10 w-auto",
} as const;

/** ロゴマーク単体。ワードマーク無しで置く場所（LPのヒーローモック・フッター・最終CTA）用。 */
export function LogoTile({
  size = 28,
  className,
  priority = false,
}: {
  /** ロゴの**高さ**（px）。幅は画像の縦横比で決まる。 */
  size?: keyof typeof HEIGHT_CLASS;
  className?: string;
  /** 折り返し上部に出る場合だけ true（LP・アプリのヘッダー）。 */
  priority?: boolean;
}) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={cn("flex-none", HEIGHT_CLASS[size], className)}
      // width/height は「元画像の寸法」。実際の表示サイズは上のクラス（高さ固定・幅auto）が決める。
      height={120}
      priority={priority}
      src="/logo.png"
      /**
       * **最適化を通さない**（T-M8-111）。最適化経由だと`w`指定で作られた画像の縦横比が
       * ブラウザ側で正しく解釈されず、`w-auto` が潰れて正方形に描画される事象が実機で出た。
       * ロゴは高さ120px・数十KBの固定素材で、最大でも40pxでしか使わないため最適化の利点が無い。
       */
      unoptimized
      width={186}
    />
  );
}

export function BrandLogo({
  className,
  href = "/app",
  priority = false,
}: {
  className?: string;
  href?: string;
  priority?: boolean;
}) {
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-2 rounded-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        className,
      )}
      href={href}
    >
      <LogoTile priority={priority} size={28} />
      <span className="text-[17px] font-bold tracking-tight text-ink">{APP_NAME}</span>
    </Link>
  );
}
