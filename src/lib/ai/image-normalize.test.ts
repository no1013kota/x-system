import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ImageValidationError,
  MAX_IMAGE_BYTES,
  inspectImage,
  normalizeForX,
} from "./image-normalize";

/**
 * 決定的な擬似ノイズ RGB（圧縮されにくい＝容量テストに使える。Math.random に依存しない）。
 * LCG の下位バイトは周期が短く PNG で高圧縮されてしまうため、上位バイトを採る。
 */
function noiseRaw(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  let s = 0x9e3779b9 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    buf[i] = (s >>> 24) & 0xff;
  }
  return buf;
}

function noisePng(width: number, height: number): Promise<Buffer> {
  return sharp(noiseRaw(width, height), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

function solid(
  format: "png" | "jpeg" | "webp",
  width = 64,
  height = 36,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } },
  });
  if (format === "jpeg") return base.jpeg().toBuffer();
  if (format === "webp") return base.webp().toBuffer();
  return base.png().toBuffer();
}

describe("inspectImage", () => {
  it("decodes format and real dimensions from the bytes", async () => {
    const png = await solid("png", 320, 180);
    const info = await inspectImage(png);
    expect(info.format).toBe("png");
    expect(info.width).toBe(320);
    expect(info.height).toBe(180);
    expect(info.sizeBytes).toBe(png.length);
  });

  it("detects the real format regardless of the declared MIME (jpeg)", async () => {
    const jpeg = await solid("jpeg");
    expect((await inspectImage(jpeg)).format).toBe("jpeg");
  });

  it("rejects undecodable bytes", async () => {
    await expect(inspectImage(Buffer.from("not an image at all"))).rejects.toBeInstanceOf(
      ImageValidationError,
    );
  });
});

describe("normalizeForX pass-through", () => {
  it("returns allowed, small images unchanged with the right MIME", async () => {
    for (const [format, mime] of [
      ["png", "image/png"],
      ["jpeg", "image/jpeg"],
      ["webp", "image/webp"],
    ] as const) {
      const bytes = await solid(format);
      const out = await normalizeForX(bytes);
      expect(out.format).toBe(format);
      expect(out.mime).toBe(mime);
      expect(out.bytes).toBe(bytes); // 変換不要ならそのまま
    }
  });
});

describe("normalizeForX conversion", () => {
  it("converts to the requested target format (png -> jpeg)", async () => {
    const png = await solid("png");
    const out = await normalizeForX(png, { targetFormat: "jpeg" });
    expect(out.format).toBe("jpeg");
    expect(out.mime).toBe("image/jpeg");
    expect((await inspectImage(out.bytes)).format).toBe("jpeg");
  });

  it("converts to webp and compresses under a tight byte budget", async () => {
    const png = await noisePng(500, 500);
    const budget = 30_000;
    const out = await normalizeForX(png, { targetFormat: "webp", maxBytes: budget });
    expect(out.format).toBe("webp");
    expect(out.mime).toBe("image/webp");
    expect(out.bytes.length).toBeLessThanOrEqual(budget);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it("throws when it cannot reach the budget even after downscaling", async () => {
    const png = await noisePng(200, 200);
    // 1 byte には決して収まらない。
    await expect(normalizeForX(png, { targetFormat: "jpeg", maxBytes: 1 })).rejects.toMatchObject({
      reason: "too_large_after_compression",
    });
  });
});

describe("normalizeForX 5MB budget", () => {
  let bigPng: Buffer;
  beforeAll(async () => {
    bigPng = await noisePng(1600, 1600); // 非圧縮ノイズPNGは5MB超になる
  });

  it("compresses an over-5MB image down to <=5MB", async () => {
    expect(bigPng.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    const out = await normalizeForX(bigPng);
    expect(out.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(["jpeg", "png", "webp"]).toContain(out.format);
    expect((await inspectImage(out.bytes)).sizeBytes).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  });
});
