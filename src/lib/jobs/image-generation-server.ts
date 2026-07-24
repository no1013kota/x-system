import "server-only";

import { resolveImageGen } from "../ai/image-client";
import { resolveImageProvider } from "../ai/resolve-provider-server";
import { resolveTextProvider } from "../ai/resolve-provider-server";
import type { Provider } from "../ai/types";
import { getPool, withTransaction } from "../db/pool";
import { env } from "../env";
import type { PlanId } from "../plans";
import { createSupabaseAdminClient } from "../supabase/admin";
import type { Queryable } from "../x/token-refresh";
import type { JobContext } from "./handlers";
import { executeImageGeneration } from "./image-generation";

/**
 * image_generation ハンドラの server-only 配線（要件04 §9, プロンプト設計書 §5.5, T-M3-15）。
 * pool・text/image provider解決・Storageアップロードを束ねて純粋層 executeImageGeneration を駆動する。
 * DBは pool（都度取得・即解放）で、失敗時の drafts/error/usage/通知が handler tx のロールバックに
 * 巻き込まれないようにする（post_generation と同じ方針）。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

function textModelFor(provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return env.ANTHROPIC_TEXT_MODEL ?? "";
    case "openai":
      return env.OPENAI_TEXT_MODEL ?? "";
    case "google":
      return env.GEMINI_TEXT_MODEL ?? "";
  }
}

export async function imageGenerationHandler(ctx: JobContext): Promise<void> {
  const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;
  await executeImageGeneration({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
    resolveTextProvider: async ({ plan, userId, deadline }) => {
      const resolved = await resolveTextProvider({ plan: plan as PlanId, userId }, { deadline });
      return {
        textGen: resolved.textGen,
        provider: resolved.provider,
        model: textModelFor(resolved.provider),
      };
    },
    resolveImage: async ({ plan, userId }) => {
      const key = await resolveImageProvider({ plan: plan as PlanId, userId });
      return { imageGen: resolveImageGen(key), provider: key.provider };
    },
    uploadImage: async ({ path, bytes, contentType }) => {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    deleteImages: async (paths) => {
      if (paths.length === 0) return;
      const admin = createSupabaseAdminClient();
      await admin.storage.from(bucket).remove(paths);
    },
  });
}
