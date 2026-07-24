import type { PoolClient } from "pg";

/**
 * kind別のジョブ処理ハンドラのレジストリ（要件04 §2）。post_generation は T-M3-05、
 * image_generation は T-M3-15、post_publish は T-M3-18 で実装済み。実処理（env・pool・provider
 * 配線）は動的importで遅延ロードし、レジストリ読込だけでenv検証を走らせない。
 * 残りは後続マイルストーンで差し替える:
 * learning_analysis/md_merge→M5, suggestion→M5。
 */

export type JobKind =
  | "post_generation"
  | "image_generation"
  | "post_publish"
  | "learning_analysis"
  | "md_merge"
  | "suggestion";

export interface JobContext {
  jobId: string;
  kind: JobKind;
  workerId: string;
}

/** ハンドラは lease 済みジョブの本処理を行う。throw で失敗扱い。 */
export type JobHandler = (ctx: JobContext, client: PoolClient) => Promise<void>;

const placeholder: JobHandler = async () => {
  // M0: no-op. 実処理は後続マイルストーンで実装する。
};

const postGeneration: JobHandler = async (ctx) => {
  const { postGenerationHandler } = await import("./post-generation-server");
  await postGenerationHandler(ctx);
};

const imageGeneration: JobHandler = async (ctx) => {
  const { imageGenerationHandler } = await import("./image-generation-server");
  await imageGenerationHandler(ctx);
};

const postPublish: JobHandler = async (ctx) => {
  const { postPublishHandler } = await import("./post-publish-server");
  await postPublishHandler(ctx);
};

const HANDLERS: Record<JobKind, JobHandler> = {
  post_generation: postGeneration,
  image_generation: imageGeneration,
  post_publish: postPublish,
  learning_analysis: placeholder,
  md_merge: placeholder,
  suggestion: placeholder,
};

export function getJobHandler(kind: JobKind): JobHandler {
  return HANDLERS[kind];
}
