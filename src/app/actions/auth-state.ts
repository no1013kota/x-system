export type AuthFormStatus = "idle" | "error" | "email_unconfirmed" | "success";

export interface AuthFormState {
  status: AuthFormStatus;
  message: string;
  email?: string;
  fieldErrors?: Record<string, string[]>;
}

export const INITIAL_AUTH_FORM_STATE: AuthFormState = {
  status: "idle",
  message: "",
};
