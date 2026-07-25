import { z } from "zod";

import {
  decryptWithKey,
  encryptWithKey,
} from "@/lib/crypto/envelope";

import { captchaTokenSchema, emailSchema } from "./form-schemas";
import { authPasswordSchema } from "./signup";

export const RECOVERY_SESSION_COOKIE = "space-ai-recovery";
export const RECOVERY_SESSION_MAX_AGE_SEC = 15 * 60;

export const passwordResetRequestSchema = z.object({
  captcha_token: captchaTokenSchema,
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: authPasswordSchema,
    password_confirmation: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.password_confirmation) {
      ctx.addIssue({
        code: "custom",
        message: "確認用パスワードが一致しません。",
        path: ["password_confirmation"],
      });
    }
  });

interface RecoverySessionMarker {
  userId: string;
  issuedAt: number;
}

export class RecoverySessionError extends Error {
  readonly code = "invalid_recovery_session";

  constructor(message: string) {
    super(message);
    this.name = "RecoverySessionError";
  }
}

export function passwordResetRequestInputFromFormData(formData: FormData) {
  return passwordResetRequestSchema.safeParse({
    captcha_token: formData.get("captcha_token") ?? "",
    email: formData.get("email"),
  });
}

export function updatePasswordInputFromFormData(formData: FormData) {
  return updatePasswordSchema.safeParse({
    password: formData.get("password"),
    password_confirmation: formData.get("password_confirmation"),
  });
}

export function sealRecoverySession(
  marker: RecoverySessionMarker,
  key: Buffer,
): string {
  return encryptWithKey(JSON.stringify(marker), key);
}

export function verifyRecoverySession(
  sealed: string | undefined,
  key: Buffer,
  expected: { userId: string; now: number; maxAgeSec?: number },
): void {
  if (!sealed) throw new RecoverySessionError("recovery marker is missing");

  let marker: RecoverySessionMarker;
  try {
    marker = JSON.parse(decryptWithKey(sealed, key)) as RecoverySessionMarker;
  } catch {
    throw new RecoverySessionError("recovery marker is invalid");
  }

  const maxAgeMs =
    (expected.maxAgeSec ?? RECOVERY_SESSION_MAX_AGE_SEC) * 1000;
  if (
    !marker.userId ||
    !Number.isFinite(marker.issuedAt) ||
    marker.userId !== expected.userId ||
    marker.issuedAt > expected.now ||
    expected.now - marker.issuedAt > maxAgeMs
  ) {
    throw new RecoverySessionError("recovery marker does not match");
  }
}
