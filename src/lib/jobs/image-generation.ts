import { randomUUID } from "node:crypto";

import { z } from "zod";

import { extractBaseMdSection } from "@/lib/persona-settings";
import { resolvePromptTemplate } from "@/lib/prompts/prompt-templates";

import type { ThreadItem } from "../ai/gen-output";
import type { AspectRatio, ImageGen } from "../ai/image";
import { normalizeForX } from "../ai/image-normalize";
import type { ProviderCall } from "../ai/normalize";
import { providerRawOutputOf, runTextGeneration } from "../ai/pipeline";
import { formatFailureRawError } from "../ai/raw-error";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { reserveIfPremium } from "../usage/reserve-if-premium";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { createDraftCreatedNotification } from "./notifications";
import { defaultRecordStage } from "./stale";

/**
 * image_generation ジョブの中核（要件04 §8/§9, プロンプト設計書 §5.5/§6.8 GEN-IMG, T-M3-15）。
 * post_generation の成功後に連鎖起動される子job。PT-IMG（base_mdセクション3＋1ポスト目本文）で
 * 英語プロンプトを作り→画像生成→正規化（JPG/PNG/WEBP・5MB以下）→private Storage保存→
 * drafts.images更新→draft_created通知まで行う。
 *
 * 画像生成またはStorage保存の最終失敗時は本文生成jobを失敗させず、draftを画像なし＋警告で確定し
 * （drafts.imagesにstatus=failedの印を残す）通知したうえで throw する（子jobはfailed）。
 * DB・provider解決・アップロードは注入し、workerが server で実配線する。
 */

/** PT-IMG の出力（プロンプト設計書 §6.8）。aspect は 16:9 既定。 */
const imagePromptSchema = z.object({
  prompt: z.string().min(1),
  aspect: z.string().optional(),
});

/**
 * PT-IMG に渡す structured output のJSON Schema（プロンプト設計書 §5.1・§6.8）。
 *
 * providerのstrictな検証に合わせて **`additionalProperties: false` を明示し、全プロパティを
 * `required` に入れる**。2026-07-27 に Anthropic が
 * `output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly
 * set to false` を返し、画像生成が必ず「画像なし（生成失敗）」になっていた。OpenAIのstrict
 * モードは加えて全プロパティのrequiredを要求するため、両方を満たす形にしてある。
 * `aspect` を必須にしても、想定外の値・空文字は `toAspectRatio` が 16:9 へ倒す。
 */
export const IMAGE_PROMPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    aspect: { type: "string" },
  },
  required: ["prompt", "aspect"],
  additionalProperties: false,
} as const;

const SUPPORTED_ASPECTS: readonly AspectRatio[] = ["16:9", "1:1", "9:16"];
function toAspectRatio(raw: string | undefined): AspectRatio {
  return SUPPORTED_ASPECTS.find((a) => a === raw) ?? "16:9";
}

const EXT_BY_FORMAT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

/** 画像生成の終端エラー（retry非対象）。draftは画像なしで確定済み。runJob が failed にする。 */
export class ImageGenerationTerminalError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message = "image generation failed",
  ) {
    super(message);
    this.name = "ImageGenerationTerminalError";
  }
}

interface ImageJobRow {
  draft_id: string | null;
  x_account_id: string;
  user_id: string;
  base_md: string;
  plan: string;
  input: {
    regenerate?: boolean;
    /** この生成にだけ使う画像プロンプト／ベースmd（T-M8-93）。親jobから引き継がれる。再生成では引き継がない。 */
    image_prompt_override?: string | null;
    base_md_override?: string | null;
  } | null;
}

interface DraftRow {
  thread: ThreadItem[];
  images: { status?: string; storage_path?: string }[];
}

export interface ImageGenerationDeps {
  db: Queryable;
  jobId: string;
  /** 画像枠 reserve/refund を1 transactionで束ねる（server配線は withTransaction）。 */
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** PT-IMG 用の text provider 解決（server配線は resolveTextProvider）。 */
  resolveTextProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  /** 画像 provider（openai/google）解決とアダプタ構築（server配線は resolveImageProvider→resolveImageGen）。 */
  resolveImage: (input: {
    plan: string;
    userId: string;
  }) => Promise<{ imageGen: ImageGen; provider: string }>;
  /** private Storage へ保存（server配線は Supabase admin storage.upload）。 */
  uploadImage: (params: { path: string; bytes: Buffer; contentType: string }) => Promise<void>;
  /** 旧object削除（再生成の置換後 best-effort。server配線は Supabase admin storage.remove）。 */
  deleteImages?: (paths: string[]) => Promise<void>;
  now?: () => number;
  makeDeadline?: () => Deadline;
  /** 画像 local_id 生成（テストで固定可能）。既定 randomUUID。 */
  newId?: () => string;
  /** stage 進捗の記録（既定 heartbeat・独自tx）。テストで no-op 化できるよう注入する。 */
  recordStage?: (stage: string) => Promise<void>;
}

export interface ImageGenerationResult {
  status: "created" | "already_done";
  draftId: string;
}

async function loadImageJob(db: Queryable, jobId: string): Promise<ImageJobRow | null> {
  const { rows } = await db.query<ImageJobRow>(
    `select gj.draft_id, gj.x_account_id, gj.input, xa.user_id, xa.base_md, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

async function loadDraft(db: Queryable, draftId: string): Promise<DraftRow | null> {
  const { rows } = await db.query<DraftRow>(
    `select thread, images from drafts where id = $1`,
    [draftId],
  );
  return rows[0] ?? null;
}

async function saveJobUsage(
  db: Queryable,
  ctx: { jobId: string; userId: string; xAccountId: string },
  calls: ProviderCall[],
): Promise<void> {
  const usage: GenerationUsage = {
    calls,
    estimated_cost_usd_total: calls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0),
  };
  await db.query(`update generation_jobs set usage = $2::jsonb where id = $1`, [
    ctx.jobId,
    JSON.stringify(usage),
  ]);
  // 画像プロンプト生成＋画像生成の全 call を原価台帳へ冪等記録する（要件02 §3.17）。
  await recordProviderCalls(db, calls, {
    userId: ctx.userId,
    xAccountId: ctx.xAccountId,
    jobId: ctx.jobId,
    keyPrefix: `img:${ctx.jobId}`,
  });
}

/** 画像失敗の確定：draftを画像なし＋failed印で残し、error/usageを保存して通知する。 */
async function persistImageFailure(
  deps: ImageGenerationDeps,
  ctx: { userId: string; xAccountId: string; draftId: string; postLocalId: string | null; provider: string | null },
  error: { code: string; providerRawError?: string | null },
  calls: ProviderCall[],
  newId: () => string,
): Promise<void> {
  const { db, jobId } = deps;
  await db.query(
    `update drafts set images = $2::jsonb, updated_at = now() where id = $1`,
    [
      ctx.draftId,
      JSON.stringify([
        {
          local_id: newId(),
          post_local_id: ctx.postLocalId ?? undefined,
          storage_path: "",
          provider: ctx.provider ?? undefined,
          status: "failed",
        },
      ]),
    ],
  );
  const usage: GenerationUsage = {
    calls,
    estimated_cost_usd_total: calls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0),
  };
  await db.query(
    `update generation_jobs set error = $2::jsonb, usage = $3::jsonb where id = $1`,
    [
      jobId,
      JSON.stringify({
        code: error.code,
        message: "画像を生成できませんでした。本文のみの下書きを保存しました。",
        retryable: false,
        stage: "image",
        provider_raw_error: error.providerRawError ?? null,
      }),
      JSON.stringify(usage),
    ],
  );
  // 失敗確定前に発生した call（画像プロンプト生成等）の原価も記録する（要件02 §3.17）。
  await recordProviderCalls(db, calls, {
    userId: ctx.userId,
    xAccountId: ctx.xAccountId,
    jobId,
    keyPrefix: `img:${jobId}`,
  });
  // 本文は使えるため draft_created は送る（UIは画像failedバッジを表示する）。
  await createDraftCreatedNotification(db, { userId: ctx.userId, draftId: ctx.draftId });
}

export async function executeImageGeneration(
  deps: ImageGenerationDeps,
): Promise<ImageGenerationResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;

  const job = await loadImageJob(db, jobId);
  if (!job) throw new ImageGenerationTerminalError("not_found", "job not found");
  if (!job.draft_id) throw new ImageGenerationTerminalError("not_found", "job has no draft");
  const draftId = job.draft_id;

  const draft = await loadDraft(db, draftId);
  if (!draft) throw new ImageGenerationTerminalError("not_found", "draft not found");

  const isRegenerate = Boolean(job.input?.regenerate);
  // 冪等: 初回生成は既に画像が確定していれば作り直さない（worker再実行安全）。
  // 再生成(regenerate)は既存画像があっても新規生成する（成功後に置換する）。
  if (!isRegenerate && draft.images.some((img) => img.status === "ready")) {
    return { status: "already_done", draftId };
  }
  // 置換前の既存ready画像のpath（成功後に best-effort 削除する。要件04 §9）。
  const oldReadyPaths = draft.images
    .filter((img) => img.status === "ready" && img.storage_path)
    .map((img) => img.storage_path as string);

  const firstPost = draft.thread[0];
  if (!firstPost) throw new ImageGenerationTerminalError("empty_thread", "draft has no posts");
  const postLocalId = firstPost.local_id;

  const recordStage = deps.recordStage ?? defaultRecordStage(jobId);
  await recordStage("image");

  const deadline = (deps.makeDeadline ?? createDeadline)();
  const calls: ProviderCall[] = [];
  let provider: string | null = null;
  // premium は画像枠を +1 reserve（月次上限確認・冪等）。BYOK/standard/mdは消費しない。再生成も新規消費。

  try {
    // 開始時に画像枠を reserve（上限到達は catch で画像なし確定＋refund no-op）。生成枠(親job)は別勘定。
    await reserveIfPremium(deps.runInTx, {
      plan: job.plan,
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      type: "image",
    });
    // --- PT-IMG: 英語画像プロンプトの生成（base_mdセクション3＋1ポスト目本文）---
    // 「この生成にだけ」の指定（T-M8-93）があれば通常の解決・保存版base_mdを飛ばす。
    const imageOverride = job.input?.image_prompt_override?.trim() ? job.input.image_prompt_override : null;
    const baseMdOverride = job.input?.base_md_override?.trim() ? job.input.base_md_override : null;
    const template =
      imageOverride ??
      (await resolvePromptTemplate(db, {
        xAccountId: job.x_account_id,
        kind: "image",
      }));
    const toneSection = extractBaseMdSection(baseMdOverride ?? job.base_md, 3);
    const promptUser = template
      .replaceAll("{{post_text}}", firstPost.text)
      .replaceAll("{{tone_section}}", toneSection);

    const { textGen, provider: textProviderId, model } = await deps.resolveTextProvider({
      plan: job.plan,
      userId: job.user_id,
      deadline,
    });
    const prompted = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request: {
        system: [],
        user: promptUser,
        // provider の strict な structured output に合わせる（2026-07-27 実測）:
        // Anthropic は object に `additionalProperties: false` の明示を要求し、無いと
        // `400 invalid_request_error` で画像プロンプト生成が必ず失敗する。OpenAI の strict
        // モードは加えて全プロパティが `required` にあることを要求するため、`aspect` も
        // 必須にして常に返させる（値の既定化は `toAspectRatio` が担う）。
        jsonSchema: IMAGE_PROMPT_JSON_SCHEMA,
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: imagePromptSchema,
      model,
      operation: "text_generation",
      now,
    });
    calls.push(...prompted.usage.calls);

    // --- 画像生成 → 正規化（JPG/PNG/WEBP・5MB以下）→ Storage 保存 ---
    const { imageGen, provider: imageProvider } = await deps.resolveImage({
      plan: job.plan,
      userId: job.user_id,
    });
    provider = imageProvider;
    const imgStart = now();
    const generated = await imageGen.generate({
      prompt: prompted.parsed.prompt,
      aspectRatio: toAspectRatio(prompted.parsed.aspect),
      timeoutMs: deadline.callTimeoutMs(),
    });
    // 画像生成 call を原価台帳用に記録する（要件02 §3.17）。画像は単価表を持たないため estimated_cost_usd は null。
    calls.push({
      // resolveImage は openai/google のみ返す（api_provider enum に含まれる）。
      provider: imageProvider as Provider,
      model: "",
      operation: "image_generation",
      request_id: generated.requestId,
      status: "succeeded",
      stop_reason: null,
      latency_ms: now() - imgStart,
      input_tokens: 0,
      output_tokens: 0,
      web_search_count: 0,
      cache_hit: false,
      citations: [],
      error_code: null,
      estimated_cost_usd: null,
    });
    const normalized = await normalizeForX(generated.image.bytes);

    const localId = newId();
    const ext = EXT_BY_FORMAT[normalized.format] ?? "bin";
    const path = `${job.user_id}/${job.x_account_id}/${draftId}/${localId}.${ext}`;
    await deps.uploadImage({ path, bytes: normalized.bytes, contentType: normalized.mime });

    // --- drafts.images 更新（成功印）→ usage 保存 → 通知 ---
    await db.query(`update drafts set images = $2::jsonb, updated_at = now() where id = $1`, [
      draftId,
      JSON.stringify([
        {
          local_id: localId,
          post_local_id: postLocalId,
          storage_path: path,
          provider: imageProvider,
          mime_type: normalized.mime,
          size_bytes: normalized.bytes.length,
          status: "ready",
        },
      ]),
    ]);
    await saveJobUsage(db, { jobId, userId: job.user_id, xAccountId: job.x_account_id }, calls);
    // 初回生成のみ draft_created を送る（再生成はdraft既存・UIがjob pollで検知する）。
    if (!isRegenerate) {
      await createDraftCreatedNotification(db, { userId: job.user_id, draftId });
    }
    // 置換成功後に旧objectを best-effort 削除（再生成時のみ対象があり得る。要件04 §9）。
    if (oldReadyPaths.length > 0 && deps.deleteImages) {
      await deps.deleteImages(oldReadyPaths).catch(() => {});
    }

    return { status: "created", draftId };
  } catch (error) {
    // 画像枠の返還は runJob の failJob が失敗確定時に行う（要件03 §7.3）。生成枠は親jobの勘定
    // なので触れない（要件03 §7.5・成功済み本文の枠は返還しない）。
    if (error instanceof ImageGenerationTerminalError) throw error;
    // 例外の要約に加え、**検証失敗なら providerの応答本文も残す**（F4・F5）。
    // 上限と切り詰めは `ai/raw-error.ts` が正本（以前は message を無加工で入れており上限が無かった）。
    const providerRawError = formatFailureRawError(error, providerRawOutputOf(error));
    if (isRegenerate) {
      // 再生成失敗時は既存画像を維持する（drafts.imagesへ触れない）。error/usageだけ記録する（要件04 §9）。
      await saveJobUsage(db, { jobId, userId: job.user_id, xAccountId: job.x_account_id }, calls);
      await db.query(
        `update generation_jobs set error = $2::jsonb where id = $1`,
        [
          jobId,
          JSON.stringify({
            code: "image_generation_failed",
            message: "画像を再生成できませんでした。既存の画像はそのままです。",
            retryable: false,
            stage: "image",
            provider_raw_error: providerRawError,
          }),
        ],
      );
    } else {
      // 初回失敗は本文を画像なしで確定して通知する（子jobはfailed）。
      await persistImageFailure(
        deps,
        { userId: job.user_id, xAccountId: job.x_account_id, draftId, postLocalId, provider },
        { code: "image_generation_failed", providerRawError },
        calls,
        newId,
      );
    }
    throw new ImageGenerationTerminalError("image_generation_failed", "image pipeline failed");
  }
}
