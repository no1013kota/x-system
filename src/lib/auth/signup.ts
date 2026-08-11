import { z } from "zod";
import { parseUserInput } from "@/lib/validation/user-input";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

import { captchaTokenSchema, emailSchema } from "./form-schemas";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
} from "./password-policy";

export const authPasswordSchema = z.string().superRefine((password, ctx) => {
  const checks = checkPassword(password);
  if (!checks.minLength || !checks.maxLength) {
    ctx.addIssue({
      code: "custom",
      message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上${PASSWORD_MAX_LENGTH}文字以内で入力してください。`,
    });
  }
  if (!checks.withinBytes) {
    ctx.addIssue({
      code: "custom",
      message: `パスワードはUTF-8で${PASSWORD_MAX_BYTES}バイト以内にしてください。`,
    });
  }
});

export const signUpSchema = z
  .object({
    captcha_token: captchaTokenSchema,
    email: emailSchema,
    password: authPasswordSchema,
    password_confirmation: z.string(),
    privacy_acknowledged: z.literal("on", {
      error: "プライバシーポリシーの確認が必要です。",
    }),
    privacy_version: z.literal(CURRENT_PRIVACY_VERSION, {
      error: "プライバシーポリシーが更新されています。再度ご確認ください。",
    }),
    terms_accepted: z.literal("on", {
      error: "利用規約への同意が必要です。",
    }),
    terms_version: z.literal(CURRENT_TERMS_VERSION, {
      error: "利用規約が更新されています。再度ご確認ください。",
    }),
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

export type SignUpInput = z.infer<typeof signUpSchema>;

export function signUpInputFromFormData(formData: FormData) {
  return parseUserInput(signUpSchema, {
    captcha_token: formData.get("captcha_token") ?? "",
    email: formData.get("email"),
    password: formData.get("password"),
    password_confirmation: formData.get("password_confirmation"),
    privacy_acknowledged: formData.get("privacy_acknowledged"),
    privacy_version: formData.get("privacy_version"),
    terms_accepted: formData.get("terms_accepted"),
    terms_version: formData.get("terms_version"),
  });
}
