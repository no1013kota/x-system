import { AppError } from "@/lib/observability/errors";

interface PostgrestSingleResult<T> {
  data: T | null;
  error: unknown;
}

/**
 * PostgREST の `maybeSingle()` / `single()` の結果から1行を取り出す（T-M8-158）。
 *
 * **「行が無い」と「読めなかった」を同じ null にしない**（CLAUDE.md 原則1）。supabase-js は
 * `.throwOnError()` を付けない限り失敗も `{ data: null, error }` で resolve するため、
 * `result.data` をそのまま返すコードは取得失敗を正常な空として扱ってしまう。実際に
 * App Shell（全バナーが消える）と設定画面（連携済みなのに「Xアカウントを選択してください」）で
 * 行き止まりを作っていた。
 *
 * 失敗は `AppError` で包んで投げる。**素の `throw result.error` にしない**——PostgrestError は
 * Error インスタンスではない素のオブジェクトで、stack が残らず記録先で追えなくなる。
 * `at` には「どこの読み取りか」を人が読める形で渡す（`toUserFacingError` は internal_error へ
 * 丸めるので、利用者向け文言には出ない）。
 */
export function readSingleRow<T>(
  result: PostgrestSingleResult<T>,
  at: string,
): T | null {
  if (result.error) {
    throw new AppError("internal_error", {
      cause: result.error,
      message: `Failed to read ${at}.`,
    });
  }
  return result.data;
}
