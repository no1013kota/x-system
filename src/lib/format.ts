/** Formats a number in the Japanese locale (e.g. 2980 → "2,980"). Prefix the
 * currency symbol at the call site (`¥{yen(value)}`). */
export function yen(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}
