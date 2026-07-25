/** Formats a number in the Japanese locale (e.g. 2980 → "2,980"). Prefix the
 * currency symbol at the call site (`¥{yen(value)}`). */
export function yen(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}

/**
 * Formats an ISO timestamp as a JST date+time in the Japanese locale
 * (`dateStyle: short` + `timeStyle: short`, `Asia/Tokyo`). Single source for the
 * timestamp shown across drafts / history / news / analytics / notifications and
 * the AI-settings editors. Callers own the empty/null case and choose their own
 * placeholder ("-", "—", …) at the call site — this takes a concrete ISO string.
 */
export function formatJst(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}
