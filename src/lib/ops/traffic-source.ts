/**
 * 流入元（`?src=<slug>`）の純粋部分（T-M8-423・運営者の依頼 2026-09-04）。
 *
 * 運営者が /admin で登録した流入元ごとに追跡URL `https://exosai.net/?src=<slug>` を配り、
 * そのURLから来た閲覧（`page_views.source`）と登録（`profiles.signup_source`）を数える。
 * Cookie は足さない（要件02 §3.32）。値の形式は DB の CHECK（`^[a-z0-9_-]{1,32}$`）と同じで、
 * `check-constraints.db.test.ts` が突き合わせる。
 */

export const TRAFFIC_SOURCE_SLUG_RE = /^[a-z0-9_-]{1,32}$/;
export const TRAFFIC_SOURCE_LABEL_MAX = 60;
/** URLパラメータ名。 */
export const TRAFFIC_SOURCE_PARAM = "src";
/** 直接・不明（パラメータ無し・形式外・未登録）を表す値。DBの既定値と同じ。 */
export const DIRECT_SOURCE = "";

/**
 * URLの `src` を正規化する。形式に合わないものは '' （直接・不明）。
 * 大文字は小文字へ寄せる（QRコードや手打ちで大文字になっても同じ流入元として数える）。
 */
export function parseTrafficSource(raw: unknown): string {
  if (typeof raw !== "string") return DIRECT_SOURCE;
  const slug = raw.trim().toLowerCase();
  return TRAFFIC_SOURCE_SLUG_RE.test(slug) ? slug : DIRECT_SOURCE;
}

/** 流入元の名前（表示用）を検証する。空・長すぎは null。 */
export function normalizeTrafficSourceLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim();
  if (label.length === 0 || label.length > TRAFFIC_SOURCE_LABEL_MAX) return null;
  return label;
}

/** 追跡URL（`<base>/?src=<slug>`）。 */
export function trackingUrlFor(baseUrl: string, slug: string): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set(TRAFFIC_SOURCE_PARAM, slug);
  return url.toString();
}

/**
 * LP内のリンクへ流入元を引き継ぐ（`/signup` → `/signup?src=<slug>`）。'' なら何も足さない。
 * ページ内アンカー（`#pricing`）や外部URLには使わない（呼び出し側がパスだけ渡す）。
 */
export function withTrafficSource(href: string, source: string): string {
  if (source === DIRECT_SOURCE) return href;
  const [path, hash] = href.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${TRAFFIC_SOURCE_PARAM}=${encodeURIComponent(source)}${hash ? `#${hash}` : ""}`;
}
