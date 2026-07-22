import "server-only";

import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";

import type {
  AiPurposeConfigPatch,
  ImageAiProvider,
} from "./ai-purpose-config";
import { updateAiPurposeConfigRecord } from "./ai-purpose-config-store";

export function operatorImageProviders(): ReadonlySet<ImageAiProvider> {
  const providers = new Set<ImageAiProvider>();
  if (env.OPENAI_API_KEY) providers.add("openai");
  if (env.GEMINI_API_KEY) providers.add("google");
  return providers;
}

export function updateAiPurposeConfigForUser(input: {
  patch: AiPurposeConfigPatch;
  userId: string;
}) {
  return withTransaction((client) =>
    updateAiPurposeConfigRecord(client, {
      operatorImageProviders: operatorImageProviders(),
      patch: input.patch,
      userId: input.userId,
    }),
  );
}
