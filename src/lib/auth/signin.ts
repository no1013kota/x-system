import { z } from "zod";
import { parseUserInput } from "@/lib/validation/user-input";

import { captchaTokenSchema, emailSchema } from "./form-schemas";
import { authPasswordSchema } from "./signup";

export const signInSchema = z.object({
  captcha_token: captchaTokenSchema,
  email: emailSchema,
  next: z.string().max(2048).optional().default(""),
  password: authPasswordSchema,
});

export function signInInputFromFormData(formData: FormData) {
  return parseUserInput(signInSchema, {
    captcha_token: formData.get("captcha_token") ?? "",
    email: formData.get("email"),
    next: formData.get("next") ?? "",
    password: formData.get("password"),
  });
}
