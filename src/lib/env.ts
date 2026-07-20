import "server-only";

import { buildServerEnv } from "./env-schema";

/**
 * Validated server-side environment. Importing this module from a Client
 * Component fails the build via `server-only`, so secrets never reach the
 * browser bundle. Validation runs once at module load and throws on any
 * misconfiguration — there is no silent fallback.
 */
export const env = buildServerEnv(process.env);

export type ServerEnv = typeof env;
