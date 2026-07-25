/**
 * Single source of truth for the account password policy, shared by the
 * server-side zod schema (`authPasswordSchema`) and the client-side live
 * feedback (`PasswordRulesHint`). Keeping the rule here prevents the form hint
 * and the server validation from drifting apart.
 *
 * Length is the only enforced rule. Any character is accepted (symbols
 * included) so browser/password-manager generated values are never blocked
 * (要件03). The 72-byte cap exists because Supabase Auth hashes with bcrypt,
 * which silently truncates input beyond 72 bytes.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_MAX_BYTES = 72;

/** User-facing helper copy shown under the password field. */
export const PASSWORD_HELP_TEXT = "8文字以上の英数字で入力してください";

const utf8 = new TextEncoder();

export interface PasswordChecks {
  /** At least PASSWORD_MIN_LENGTH characters. */
  minLength: boolean;
  /** At most PASSWORD_MAX_LENGTH characters. */
  maxLength: boolean;
  /** At most PASSWORD_MAX_BYTES bytes when UTF-8 encoded. */
  withinBytes: boolean;
}

/** Evaluates each password rule independently for granular UI feedback. */
export function checkPassword(password: string): PasswordChecks {
  const characters = Array.from(password).length;
  return {
    minLength: characters >= PASSWORD_MIN_LENGTH,
    maxLength: characters <= PASSWORD_MAX_LENGTH,
    withinBytes: utf8.encode(password).byteLength <= PASSWORD_MAX_BYTES,
  };
}

/** True when every password rule is satisfied. */
export function isPasswordValid(password: string): boolean {
  const checks = checkPassword(password);
  return checks.minLength && checks.maxLength && checks.withinBytes;
}
