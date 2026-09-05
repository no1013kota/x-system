import type { ImageProvider } from "./resolve-provider";

/**
 * 画像生成アダプタの共通契約（プロンプト設計書 §5.5 GEN-IMG, 要件06 §6）。
 *
 * テキスト側（`TextGen`）と同様、プロバイダ差異をアダプタへ閉じ込める。共通仕様として扱うのは
 * 「16:9 などのアスペクト比」だけで、OpenAI（`1536x1024` 等の pixel size 文字列）と
 * Gemini/Imagen（`16:9` 等の aspect ratio 文字列）の表現差はアダプタ内で吸収する
 * （特定APIの size 文字列を共通仕様にしない）。返却画像はここでデコードし、生バイト＋申告MIMEで返す。
 * 形式/実寸/MIME/容量の検証と JPG/PNG/WEBP・5MB以下への変換・圧縮は `image-normalize.ts` が担う。
 * 実SDK配線は `image-client.ts`（server-only）。
 */

/** サービス共通のアスペクト比指定（特定APIの size 文字列は使わない）。MVPは 16:9 固定。 */
export type AspectRatio = "16:9" | "1:1" | "9:16";

export interface ImageGenRequest {
  /**
   * 画像の生成指示（PT-IMG でテキストモデルが生成したもの, §5.5）。言語は指定しない。
   * 画像内に描く文字は日本語（運営者の指示 2026-08-26・T-M8-315）。
   */
  prompt: string;
  aspectRatio: AspectRatio;
  /** この1回の provider call の timeout ms（呼び出し側が deadline から算出, §5.6）。 */
  timeoutMs: number;
}

/** プロバイダが返した画像をデコードした生データ（正規化前）。 */
export interface RawImage {
  bytes: Buffer;
  /** プロバイダ申告のMIME（未申告なら null。実MIMEは image-normalize が実寸込みで再判定する）。 */
  declaredMime: string | null;
}

export interface ImageGenResult {
  provider: ImageProvider;
  requestId: string | null;
  image: RawImage;
  /** アダプタが選んだプロバイダ固有の size/aspect 表現（監査・デバッグ用）。 */
  requestedSize: string;
}

export interface ImageGen {
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

/** 生成失敗（プロバイダが画像データを返さない等）。job側で failed 化する。 */
export class ImageGenError extends Error {
  readonly code = "image_generation_failed";
  constructor(
    readonly provider: ImageProvider,
    message: string,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}

/** プロバイダの対応 size/aspect。`label` を API へ渡し、比率選択には width/height を使う。 */
export interface SizeOption {
  /** プロバイダAPIへ渡す値（OpenAI=`1536x1024`, Gemini=`16:9` 等）。 */
  label: string;
  width: number;
  height: number;
}

function aspectFraction(a: AspectRatio): number {
  const [w, h] = a.split(":").map(Number);
  return w / h;
}

/**
 * 要求アスペクト比に最も近い対応値を選ぶ（プロバイダ固有 size のフォールバック規則, §5.5）。
 * 比率差が同じなら先頭（=より基準的な値）を優先する。
 */
export function pickNearestSize(
  aspectRatio: AspectRatio,
  supported: readonly SizeOption[],
): SizeOption {
  const target = aspectFraction(aspectRatio);
  let best = supported[0];
  let bestDelta = Math.abs(best.width / best.height - target);
  for (const opt of supported.slice(1)) {
    const delta = Math.abs(opt.width / opt.height - target);
    if (delta < bestDelta) {
      best = opt;
      bestDelta = delta;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// OpenAI 画像アダプタ（gpt-image-1 系）
// ---------------------------------------------------------------------------

/** OpenAI Images API が対応する size（gpt-image-1 の既定集合）。model 差はアダプタに閉じる。 */
export const DEFAULT_OPENAI_IMAGE_SIZES: readonly SizeOption[] = [
  { label: "1024x1024", width: 1024, height: 1024 },
  { label: "1536x1024", width: 1536, height: 1024 },
  { label: "1024x1536", width: 1024, height: 1536 },
];

export interface RawOpenAIImageParams {
  model: string;
  prompt: string;
  /** アダプタが 16:9 → 最近傍へ変換した pixel size 文字列。 */
  size: string;
  n: 1;
}

export interface RawOpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

export type RawOpenAIImageCreate = (
  params: RawOpenAIImageParams,
  opts: { timeoutMs: number },
) => Promise<RawOpenAIImageResponse>;

export interface OpenAIImageGenOptions {
  create: RawOpenAIImageCreate;
  model: string;
  supportedSizes?: readonly SizeOption[];
}

export class OpenAIImageGen implements ImageGen {
  private readonly create: RawOpenAIImageCreate;
  private readonly model: string;
  private readonly sizes: readonly SizeOption[];

  constructor(opts: OpenAIImageGenOptions) {
    this.create = opts.create;
    this.model = opts.model;
    this.sizes = opts.supportedSizes ?? DEFAULT_OPENAI_IMAGE_SIZES;
  }

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const size = pickNearestSize(req.aspectRatio, this.sizes).label;
    const res = await this.create(
      { model: this.model, prompt: req.prompt, size, n: 1 },
      { timeoutMs: req.timeoutMs },
    );
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageGenError("openai", "OpenAI returned no base64 image data");
    }
    return {
      provider: "openai",
      requestId: null,
      image: { bytes: Buffer.from(b64, "base64"), declaredMime: null },
      requestedSize: size,
    };
  }
}

// ---------------------------------------------------------------------------
// Gemini 画像アダプタ（Imagen 系 generateImages）
// ---------------------------------------------------------------------------

/** Imagen が対応する aspect ratio（label をそのまま API の aspectRatio へ渡す）。 */
export const DEFAULT_GEMINI_IMAGE_SIZES: readonly SizeOption[] = [
  { label: "1:1", width: 1, height: 1 },
  { label: "3:4", width: 3, height: 4 },
  { label: "4:3", width: 4, height: 3 },
  { label: "9:16", width: 9, height: 16 },
  { label: "16:9", width: 16, height: 9 },
];

export interface RawGeminiImageParams {
  model: string;
  prompt: string;
  config: { numberOfImages: 1; aspectRatio: string };
}

export interface RawGeminiImageResponse {
  generatedImages?: Array<{
    image?: { imageBytes?: string; mimeType?: string };
  }>;
}

export type RawGeminiImageCreate = (
  params: RawGeminiImageParams,
  opts: { timeoutMs: number },
) => Promise<RawGeminiImageResponse>;

export interface GeminiImageGenOptions {
  create: RawGeminiImageCreate;
  model: string;
  supportedSizes?: readonly SizeOption[];
}

export class GeminiImageGen implements ImageGen {
  private readonly create: RawGeminiImageCreate;
  private readonly model: string;
  private readonly sizes: readonly SizeOption[];

  constructor(opts: GeminiImageGenOptions) {
    this.create = opts.create;
    this.model = opts.model;
    this.sizes = opts.supportedSizes ?? DEFAULT_GEMINI_IMAGE_SIZES;
  }

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const aspectRatio = pickNearestSize(req.aspectRatio, this.sizes).label;
    const res = await this.create(
      { model: this.model, prompt: req.prompt, config: { numberOfImages: 1, aspectRatio } },
      { timeoutMs: req.timeoutMs },
    );
    const generated = res.generatedImages?.[0]?.image;
    if (!generated?.imageBytes) {
      throw new ImageGenError("google", "Gemini returned no image bytes");
    }
    return {
      provider: "google",
      requestId: null,
      image: {
        bytes: Buffer.from(generated.imageBytes, "base64"),
        declaredMime: generated.mimeType ?? null,
      },
      requestedSize: aspectRatio,
    };
  }
}

// ---------------------------------------------------------------------------
// provider による呼び分け（純粋・注入版）
// ---------------------------------------------------------------------------

export interface MakeImageGenOptions {
  provider: ImageProvider;
  model: string;
  /** OpenAI選択時に必須。 */
  openai?: RawOpenAIImageCreate;
  /** Gemini選択時に必須。 */
  gemini?: RawGeminiImageCreate;
  supportedSizes?: readonly SizeOption[];
}

/**
 * resolveImageProvider が返した provider に応じてアダプタを組む（テスト可能な純粋版）。
 * 実SDK create の注入は `image-client.ts` が行う。
 */
export function makeImageGen(opts: MakeImageGenOptions): ImageGen {
  if (opts.provider === "openai") {
    if (!opts.openai) throw new Error("openai image create fn is required");
    return new OpenAIImageGen({
      create: opts.openai,
      model: opts.model,
      supportedSizes: opts.supportedSizes,
    });
  }
  if (!opts.gemini) throw new Error("gemini image create fn is required");
  return new GeminiImageGen({
    create: opts.gemini,
    model: opts.model,
    supportedSizes: opts.supportedSizes,
  });
}
