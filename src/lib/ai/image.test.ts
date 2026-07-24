import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GEMINI_IMAGE_SIZES,
  DEFAULT_OPENAI_IMAGE_SIZES,
  ImageGenError,
  makeImageGen,
  pickNearestSize,
  type ImageGenRequest,
  type RawGeminiImageCreate,
  type RawOpenAIImageCreate,
} from "./image";

const PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC";

const req = (over: Partial<ImageGenRequest> = {}): ImageGenRequest => ({
  prompt: "a wide landscape",
  aspectRatio: "16:9",
  timeoutMs: 30_000,
  ...over,
});

describe("pickNearestSize", () => {
  it("maps 16:9 to OpenAI's nearest landscape size (1536x1024)", () => {
    expect(pickNearestSize("16:9", DEFAULT_OPENAI_IMAGE_SIZES).label).toBe("1536x1024");
  });

  it("maps 16:9 to Gemini's exact aspect ratio string", () => {
    expect(pickNearestSize("16:9", DEFAULT_GEMINI_IMAGE_SIZES).label).toBe("16:9");
  });

  it("maps 1:1 to the square size on both providers", () => {
    expect(pickNearestSize("1:1", DEFAULT_OPENAI_IMAGE_SIZES).label).toBe("1024x1024");
    expect(pickNearestSize("1:1", DEFAULT_GEMINI_IMAGE_SIZES).label).toBe("1:1");
  });

  it("maps 9:16 to the portrait option", () => {
    expect(pickNearestSize("9:16", DEFAULT_OPENAI_IMAGE_SIZES).label).toBe("1024x1536");
    expect(pickNearestSize("9:16", DEFAULT_GEMINI_IMAGE_SIZES).label).toBe("9:16");
  });
});

describe("makeImageGen dispatch", () => {
  it("routes openai to the OpenAI adapter and passes the pixel size string", async () => {
    const create: RawOpenAIImageCreate = vi.fn(async () => ({
      data: [{ b64_json: PIXEL_PNG_B64 }],
    }));
    const gen = makeImageGen({ provider: "openai", model: "gpt-image-1", openai: create });
    const res = await gen.generate(req());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      { model: "gpt-image-1", prompt: "a wide landscape", size: "1536x1024", n: 1 },
      { timeoutMs: 30_000 },
    );
    expect(res.provider).toBe("openai");
    expect(res.requestedSize).toBe("1536x1024");
    // decode: base64 -> bytes (PNG magic bytes)
    expect(res.image.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("routes google to the Gemini adapter and passes the aspect ratio string", async () => {
    const create: RawGeminiImageCreate = vi.fn(async () => ({
      generatedImages: [{ image: { imageBytes: PIXEL_PNG_B64, mimeType: "image/png" } }],
    }));
    const gen = makeImageGen({ provider: "google", model: "imagen-4", gemini: create });
    const res = await gen.generate(req());

    expect(create).toHaveBeenCalledWith(
      {
        model: "imagen-4",
        prompt: "a wide landscape",
        config: { numberOfImages: 1, aspectRatio: "16:9" },
      },
      { timeoutMs: 30_000 },
    );
    expect(res.provider).toBe("google");
    expect(res.image.declaredMime).toBe("image/png");
    expect(res.image.bytes.length).toBeGreaterThan(0);
  });

  it("requires the matching create fn for the selected provider", () => {
    expect(() => makeImageGen({ provider: "openai", model: "m" })).toThrow(/openai image create/);
    expect(() => makeImageGen({ provider: "google", model: "m" })).toThrow(/gemini image create/);
  });
});

describe("image adapter error handling", () => {
  it("throws when OpenAI returns no base64 image data", async () => {
    const create: RawOpenAIImageCreate = async () => ({ data: [{ url: "https://x/y.png" }] });
    const gen = makeImageGen({ provider: "openai", model: "gpt-image-1", openai: create });
    await expect(gen.generate(req())).rejects.toBeInstanceOf(ImageGenError);
  });

  it("throws when Gemini returns no image bytes", async () => {
    const create: RawGeminiImageCreate = async () => ({ generatedImages: [] });
    const gen = makeImageGen({ provider: "google", model: "imagen-4", gemini: create });
    await expect(gen.generate(req())).rejects.toBeInstanceOf(ImageGenError);
  });
});
