// sharp 0.35 で `sharp.Metadata` の名前空間型が無くなったため、型は名前付きでimportする（T-M7-32）。
import type { Metadata } from "sharp";

/*
  **sharpは使う瞬間まで読み込まない**（T-M8-385）。静的importにすると、この module を
  経由する route（/app/posts のServer Action束）全体が sharp のネイティブバイナリに依存し、
  Vercelで同梱が漏れた瞬間に**画像と無関係なボタンまで全部500**になる——実際に
  T-M8-353のデプロイ後、本番の投稿作成の全Actionが「画面を読み込めませんでした」に
  なっていた（ローカルはmacバイナリ・E2Eはnext devで原理的に見えない）。
  遅延なら、読み込み失敗は画像を処理する操作だけの失敗として呼び出し元のcatchへ落ち、
  トーストで理由が出る。
*/
let sharpModule: typeof import("sharp") | null = null;
async function loadSharp(): Promise<typeof import("sharp").default> {
  sharpModule ??= await import("sharp");
  return sharpModule.default;
}

/**
 * プロバイダ返却画像の検証と正規化（プロンプト設計書 §5.5, 要件06 §6）。
 *
 * プロバイダ返却画像をデコードし、形式・実寸・MIME・容量を検証する。X へ投稿可能な形式
 * （JPG/PNG/WEBP）かつ 5MB 以下へ変換・圧縮する。既に許可形式かつ 5MB 以下ならそのまま返し、
 * 超過・未対応形式のときだけ再エンコード（品質低下→縮小の順）する。画像処理は sharp を使う。
 * この層はプロバイダに依存しないため、`image.ts` のアダプタとは分離する。
 */

/** X 添付の上限（要件06 §6：5MB 以下に正規化）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** X へ投稿可能な形式（要件06 §6）。 */
export const ALLOWED_FORMATS = ["jpeg", "png", "webp"] as const;
export type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

const MIME_BY_FORMAT: Record<AllowedFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type ImageValidationReason =
  | "unreadable"
  | "invalid_dimensions"
  | "too_large_after_compression";

export class ImageValidationError extends Error {
  readonly code = "image_invalid";
  constructor(
    readonly reason: ImageValidationReason,
    message?: string,
  ) {
    super(message ?? `image_invalid: ${reason}`);
    this.name = "ImageValidationError";
  }
}

export interface InspectedImage {
  /** sharp が判定した実フォーマット（申告MIMEではなく実データ由来）。 */
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * 画像をデコードして形式・実寸・容量を得る（申告MIMEに頼らず実データから判定）。
 * デコード不能・寸法不明は検証エラーにする。
 */
export async function inspectImage(bytes: Buffer): Promise<InspectedImage> {
  let meta: Metadata;
  try {
    meta = await (await loadSharp())(bytes).metadata();
  // eslint-disable-next-line no-restricted-syntax -- デコード不能そのものが判定結果。ImageValidationError で呼び出し元へ伝わる
  } catch {
    throw new ImageValidationError("unreadable", "image could not be decoded");
  }
  if (!meta.format || !meta.width || !meta.height) {
    throw new ImageValidationError("invalid_dimensions", "image has no format/dimensions");
  }
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    sizeBytes: bytes.length,
  };
}

export interface NormalizedImage {
  bytes: Buffer;
  mime: string;
  format: AllowedFormat;
  width: number;
  height: number;
}

export interface NormalizeOptions {
  /** 変換先形式。未指定なら PNG は PNG 維持、それ以外は WEBP へ変換する。 */
  targetFormat?: AllowedFormat;
  /** 容量上限（既定 5MB）。テスト等で下げられる。 */
  maxBytes?: number;
}

function isAllowedFormat(format: string): format is AllowedFormat {
  return (ALLOWED_FORMATS as readonly string[]).includes(format);
}

async function encode(
  bytes: Buffer,
  format: AllowedFormat,
  quality: number,
  scale: number,
  sourceWidth: number,
): Promise<Buffer> {
  const sharp = await loadSharp();
  let pipeline = sharp(bytes).rotate(); // EXIF 回転を焼き込む
  if (scale < 1) {
    // 元画像の幅は inspectImage で判定済み（申告MIME前の実データ由来）。圧縮ループで
    // 毎回 sharp().metadata() を呼び直さず、既知の幅から縮小先を決める。
    const width = Math.max(16, Math.round(sourceWidth * scale));
    pipeline = pipeline.resize({ width, withoutEnlargement: true });
  }
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality }).toBuffer();
    case "webp":
      return pipeline.webp({ quality }).toBuffer();
    case "png":
      // PNG は非可逆品質を持たないため縮小のみで容量を落とす。
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
  }
}

/**
 * X へ投稿可能な形式（JPG/PNG/WEBP）かつ 5MB 以下へ正規化する（§5.5, 要件06 §6）。
 * 既に許可形式かつ上限以下で targetFormat 指定がなければそのまま返す。それ以外は
 * 品質を下げ、届かなければ縮小して上限内に収める。収まらなければ検証エラー。
 */
/**
 * 形式→拡張子。**Storageのpathを作る側が2か所ある**（生成・アップロード）ので、
 * 変換した形式と拡張子の対応はここ1か所に置く（T-M8-353）。
 */
export const EXT_BY_FORMAT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export async function normalizeForX(
  bytes: Buffer,
  opts: NormalizeOptions = {},
): Promise<NormalizedImage> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const meta = await inspectImage(bytes);

  if (!opts.targetFormat && isAllowedFormat(meta.format) && meta.sizeBytes <= maxBytes) {
    return {
      bytes,
      mime: MIME_BY_FORMAT[meta.format],
      format: meta.format,
      width: meta.width,
      height: meta.height,
    };
  }

  const targetFormat: AllowedFormat =
    opts.targetFormat ?? (meta.format === "png" ? "png" : "webp");

  let quality = 90;
  let scale = 1;
  for (let attempt = 0; attempt < 16; attempt++) {
    const out = await encode(bytes, targetFormat, quality, scale, meta.width);
    if (out.length <= maxBytes) {
      const outMeta = await (await loadSharp())(out).metadata();
      return {
        bytes: out,
        mime: MIME_BY_FORMAT[targetFormat],
        format: targetFormat,
        width: outMeta.width ?? meta.width,
        height: outMeta.height ?? meta.height,
      };
    }
    // 収まらなければ次の試行で圧縮を強める：JPEG/WEBP は品質→縮小、PNG は縮小のみ。
    if (targetFormat !== "png" && quality > 40) {
      quality -= 15;
    } else {
      scale *= 0.8;
    }
  }
  throw new ImageValidationError(
    "too_large_after_compression",
    `image still exceeds ${maxBytes} bytes after compression`,
  );
}
