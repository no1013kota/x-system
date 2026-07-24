/**
 * ニュース source_url の canonical 化（要件04 §2, ADR-0003, T-M4-11）。窓の重なりで同一記事が
 * 別URL（トラッキングパラメータ・末尾スラッシュ・大文字ホスト・fragment等の差）として届いても、
 * `news_items.source_url` の unique 制約で1件へ collapse させるための正規化。パスの大小は
 * 区別する（サーバによって意味が変わり得るため）。
 */

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "cmpid",
  "spm",
  "s_kwcid",
]);

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

/** source_url を dedup 用 canonical 形へ正規化する。解釈不能なら trim のみ返す。 */
export function canonicalizeSourceUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  // 既定ポートは除去（https:443 / http:80）。
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
    u.port = "";
  }
  // トラッキングパラメータを除去し、残りをキー順で安定化する。
  const kept = [...u.searchParams.entries()].filter(([k]) => !isTracking(k));
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  // 末尾スラッシュを除去（"https://a.com/" と "https://a.com" を同一視）。
  return u.toString().replace(/\/+$/, "");
}
