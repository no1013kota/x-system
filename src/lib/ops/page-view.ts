import { createHmac } from "node:crypto";

/**
 * 公開ページの閲覧記録の純粋部分（T-M8-378）。server配線は `page-view-server.ts`。
 *
 * 数えるのは3ページだけ: ホーム（LP）→ 新規登録 → 料金。ファネルの入口として
 * 「登録した人」の分母を見るための最小限で、行動の追跡はしない。
 */

export const TRACKED_PAGES = ["/", "/signup", "/plans"] as const;
export type TrackedPage = (typeof TRACKED_PAGES)[number];

/**
 * 数えないUA。**最小限にする**——広く弾くと実利用者まで消えて数字が嘘になる。
 * HeadlessChrome はわざと弾かない（E2Eがこの記録自体を検証する経路になるため。
 * 本物の利用者がheadlessで来ることは無いが、来ても1票の誤差でしかない）。
 */
const BOT_UA = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|monitoring|uptime/i;

export function isCountableUserAgent(ua: string | null): boolean {
  if (!ua || ua.trim() === "") return false;
  return !BOT_UA.test(ua);
}

/**
 * 訪問者の日次ハッシュ。**生のIP・UAはここで捨てる**（保存されるのはこの値だけ）。
 * 塩（日付）が変わると同じ人でも別の値になる＝日をまたいだ突合はできない設計。
 * Plausible等のCookieレス解析と同じ考え方で、Cookie追加もポリシー改定も要らない。
 */
export function visitorHashFor(
  secret: string,
  jstDate: string,
  ip: string,
  userAgent: string,
): string {
  return createHmac("sha256", secret)
    .update(`${jstDate}|${ip}|${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}
