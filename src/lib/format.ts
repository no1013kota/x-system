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

/**
 * DB の timestamp（`Date | string`）を ISO 文字列へ正規化する。string も Date を経由して
 * 正準表記に揃える。各 view builder（drafts/notifications/learning/prompt-templates 等）で
 * 重複していた変換の単一正本。
 */
export function toIso(value: Date | string): string {
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

/** `toIso` の null 許容版（null/undefined はそのまま null を返す）。 */
export function toIsoOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIso(value);
}
