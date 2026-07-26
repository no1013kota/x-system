/**
 * Validates browser mutation requests against the single application origin.
 * Browser Origin values never contain a trailing slash, so require the exact
 * canonical origin instead of accepting a prefix or caller-provided URL.
 */
export function hasExactAppOrigin(
  requestOrigin: string | null,
  appBaseUrl: string,
): boolean {
  if (!requestOrigin) return false;

  try {
    return requestOrigin === new URL(appBaseUrl).origin;
  // eslint-disable-next-line no-restricted-syntax -- URLとして解釈できない設定値は不一致として扱う（false）
  } catch {
    return false;
  }
}
