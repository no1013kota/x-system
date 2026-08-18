export type AuthFormStatus = "idle" | "error" | "email_unconfirmed" | "success";

export interface AuthFormState {
  status: AuthFormStatus;
  message: string;
  email?: string;
  fieldErrors?: Record<string, string[]>;
  /**
   * 文言に添える導線（T-M8-127）。「既に登録されています」だけでは次に何をするか分からないので、
   * ログイン画面などへの行き先を一緒に返す（押せるものが無い行き止まりを作らない）。
   */
  action?: { href: string; label: string };
}

export const INITIAL_AUTH_FORM_STATE: AuthFormState = {
  status: "idle",
  message: "",
};
