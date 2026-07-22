import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

import type { AiKeyProvider } from "./api-keys";

const VERIFY_TIMEOUT_MS = 10_000;

/** Lightweight authenticated model-list calls; no generation tokens are used. */
export async function verifyProviderApiKey(
  provider: AiKeyProvider,
  apiKey: string,
): Promise<void> {
  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({
        apiKey,
        maxRetries: 0,
        timeout: VERIFY_TIMEOUT_MS,
      });
      await client.models.list({ limit: 1 });
      return;
    }
    case "openai": {
      const client = new OpenAI({
        apiKey,
        maxRetries: 0,
        timeout: VERIFY_TIMEOUT_MS,
      });
      await client.models.list();
      return;
    }
    case "google": {
      const client = new GoogleGenAI({ apiKey });
      await client.models.list({
        config: {
          abortSignal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
          pageSize: 1,
        },
      });
    }
  }
}
