import { z } from "zod";

import { authPasswordSchema } from "./signup";

export const signInSchema = z.object({
  captcha_token: z.string().max(2048).optional().default(""),
  email: z.string().trim().email("メールアドレスを確認してください。"),
  next: z.string().max(2048).optional().default(""),
  password: authPasswordSchema,
});

export function signInInputFromFormData(formData: FormData) {
  return signInSchema.safeParse({
    captcha_token: formData.get("captcha_token") ?? "",
    email: formData.get("email"),
    next: formData.get("next") ?? "",
    password: formData.get("password"),
  });
}
