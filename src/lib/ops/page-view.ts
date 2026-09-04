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

export interface CountableRequestInput {
  userAgent: string | null;
  /** `sec-fetch-dest` ヘッダ。ブラウザの画面遷移は `document`。 */
  secFetchDest: string | null;
  /** `sec-fetch-mode` ヘッダ。画面遷移は `navigate`。 */
  secFetchMode: string | null;
  /** proxy が検証したログイン中のメール（未ログイン・検証不能は null）。 */
  viewerEmail: string | null;
  /** 運営者のメール（`SUPPORT_EMAIL`）。未設定なら運営者除外はしない。 */
  operatorEmail: string | null;
}

/**
 * 数えるリクエストか（T-M8-422）。UA判定に加えて:
 * - **画面遷移だけ数える**（`sec-fetch-dest: document`）。curl・Node の fetch・スキャナ・監視は
 *   このヘッダを送らないか `empty` で来る。以前は release／doctor の疎通確認（Node fetch・UA "node"）が
 *   本番 `/` に毎回1票入っていた。ヘッダを送らない古いブラウザ（Safari 16.3以前）は数える側に倒す
 *   （実利用者を消す方が数字の嘘として大きい）。
 * - **運営者自身は数えない**（proxy が検証したメールが `SUPPORT_EMAIL` と一致するとき）。
 */
export function isCountableRequest(input: CountableRequestInput): boolean {
  if (!isCountableUserAgent(input.userAgent)) return false;
  if (input.secFetchDest !== null && input.secFetchDest !== "document") return false;
  if (input.secFetchMode !== null && input.secFetchMode !== "navigate") return false;
  if (
    input.operatorEmail &&
    input.viewerEmail &&
    input.viewerEmail.toLowerCase() === input.operatorEmail.toLowerCase()
  ) {
    return false;
  }
  return true;
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
