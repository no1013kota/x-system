import { z } from "zod";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

const utf8 = new TextEncoder();

const passwordSchema = z.string().superRefine((password, ctx) => {
  const characters = Array.from(password).length;
  if (characters < 12 || characters > 64) {
    ctx.addIssue({
      code: "custom",
      message: "パスワードは12〜64文字で入力してください。",
    });
  }
  if (utf8.encode(password).byteLength > 72) {
    ctx.addIssue({
      code: "custom",
      message: "パスワードはUTF-8で72バイト以内にしてください。",
    });
  }
});

export const signUpSchema = z
  .object({
    captcha_token: z.string().max(2048).optional().default(""),
    email: z.string().trim().email("メールアドレスを確認してください。"),
    password: passwordSchema,
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
  return signUpSchema.safeParse({
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
