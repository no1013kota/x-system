import { z } from "zod";

/**
 * Shared auth-form field schemas (signup / login / password-reset / resend).
 * Keeping the message and limits in one place prevents them from drifting
 * between forms.
 */
export const captchaTokenSchema = z
  .string()
  .min(1, "あなたが人間であることの確認を完了してください。")
  .max(2048);

export const emailSchema = z
  .string()
  .trim()
  .email("メールアドレスを確認してください。");
