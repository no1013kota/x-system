import type { PoolClient } from "pg";

/**
 * kind別のジョブ処理ハンドラのレジストリ（要件04 §2）。M0骨格では各ハンドラは
 * プレースホルダ（外部処理なしで成功）。実処理は後続マイルストーンで差し替える:
 * post_generation→M3, image_generation→M3, post_publish→M3,
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

const HANDLERS: Record<JobKind, JobHandler> = {
  post_generation: placeholder,
  image_generation: placeholder,
  post_publish: placeholder,
  learning_analysis: placeholder,
  md_merge: placeholder,
  suggestion: placeholder,
};

export function getJobHandler(kind: JobKind): JobHandler {
  return HANDLERS[kind];
}
