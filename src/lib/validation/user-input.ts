import type { ZodError, ZodType } from "zod";

/**
 * Turning zod validation failures into messages we are willing to show a user (F8).
 *
 * zod's built-in messages are English and describe the schema, not the mistake:
 * `"Too big: expected string to have <=512 characters"`, `"Unrecognized key: \"foo\""`,
 * `"Invalid option: expected one of ..."`. Showing those breaks 要件06 §8
 * (internal wording must never reach the screen), so we cannot simply surface
 * `error.issues[0].message` the way `api-keys.ts` used to.
 *
 * We also cannot make `toUserFacingError` prefer `AppError.message`: `AppError` falls back to
 * `super(options?.message ?? code)`, so a message-less AppError would render the internal code
 * (`"validation_error"`) on screen. `observability/errors.test.ts` pins that contract.
 *
 * The approach: pass a per-parse error map that returns a sentinel. zod applies it **only where
 * the author did not write a message** — author messages win over the map, and the map wins over
 * the built-ins. Anything still holding the sentinel is a built-in we must not show.
 *
 * Measured with zod 4.4.3 (re-check if the dependency moves):
 *   author message present            → ["作者の文言です。"]
 *   .max(3) violated                  → ["__SENT__"]
 *   .strict() unknown key             → ["__SENT__"]
 *   z.enum mismatch / type mismatch   → ["__SENT__"]
 *   .url() + author refine            → ["__SENT__", "httpsのURLを指定してください。"]
 *
 * That last case is why we look for the **first non-sentinel** issue rather than `issues[0]`.
 */

/** Marker for "zod's own wording" — internal only, never shown to a user. */
const GENERIC_ISSUE = "__zod_default_message__";

/**
 * Parse options for anything that came from a user.
 *
 * Per-parse rather than a global `z.config({ customError })` so behaviour does not depend on
 * module initialisation order.
 */
export const USER_FACING_PARSE = { error: () => GENERIC_ISSUE } as const;

/** `schema.safeParse` for user input, with the sentinel applied. */
export function parseUserInput<T>(schema: ZodType<T>, input: unknown) {
  return schema.safeParse(input, USER_FACING_PARSE);
}

/**
 * 画面に出してよい理由（作者が自分で書いた文言）を1つ返す。無ければ undefined。
 *
 * `issues[0]` ではなく**最初の非sentinel**を探す。`.url()` と作者 refine が並ぶと
 * 作者文言が先頭に来ないため（上の実測参照）。
 */
export function firstAuthoredIssueMessage(error: ZodError): string | undefined {
  return error.issues.find((issue) => issue.message !== GENERIC_ISSUE)?.message;
}

/**
 * 項目ごとの理由（作者が書いた文言だけ）。フォームの各欄へ出すのに使う。
 * 作者文言が1つも無い項目はキーごと落とす（既定文言を出さないため）。
 */
export function authoredFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    if (issue.message === GENERIC_ISSUE) continue;
    const key = issue.path.join(".");
    if (!key) continue;
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** テスト専用。sentinel の値そのものに依存したテストを書けるようにする。 */
export const GENERIC_ISSUE_FOR_TEST = GENERIC_ISSUE;
