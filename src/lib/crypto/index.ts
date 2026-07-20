import "server-only";

import { env } from "@/lib/env";

import { decryptWithKey, encryptWithKey, resolveKey } from "./envelope";

/**
 * Server-only encryption bound to the validated APP_ENCRYPTION_KEY. Importing
 * this from a Client Component fails the build, so the key never reaches the
 * browser bundle. Store `encrypt()` output in *_ciphertext columns.
 */
const key = resolveKey(env.APP_ENCRYPTION_KEY as string);

export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, key);
}

export function decrypt(serialized: string): string {
  return decryptWithKey(serialized, key);
}
