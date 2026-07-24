import "server-only";

import { resolveTextProvider } from "../ai/resolve-provider-server";
import type { Provider } from "../ai/types";
import { getPool } from "../db/pool";
import { env } from "../env";
import { gatherExecutionPrereqInputs } from "../execution-prereqs-server";
import type { PlanId } from "../plans";
import { validateSourceUrlServer } from "../post/source-url-server";
import type { Queryable } from "../x/token-refresh";
import type { JobContext } from "./handlers";
import { executePostGeneration } from "./post-generation";

/**
 * post_generation ハンドラの server-only 配線（要件04 §8, T-M3-05）。pool・provider解決・前提収集を
 * 束ねて純粋層 executePostGeneration を実値で駆動する。DBは pool（都度取得・即解放）で、失敗時の
 * error/usage/通知が handler tx のロールバックに巻き込まれないようにする。
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

export async function postGenerationHandler(ctx: JobContext): Promise<void> {
  await executePostGeneration({
    db: pooledDb,
    jobId: ctx.jobId,
    resolveProvider: async ({ plan, userId, deadline }) => {
      const resolved = await resolveTextProvider(
        { plan: plan as PlanId, userId },
        { deadline },
      );
      return {
        textGen: resolved.textGen,
        provider: resolved.provider,
        model: textModelFor(resolved.provider),
      };
    },
    gatherPrereqInputs: (userId, opts) => gatherExecutionPrereqInputs(userId, opts),
    validateSource: (url) => validateSourceUrlServer(url),
    quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
  });
}
