/**
 * Validates browser mutation requests against the single application origin.
 * Browser Origin values never contain a trailing slash, so require the exact
 * canonical origin instead of accepting a prefix or caller-provided URL.
 */

/**
 * `127.0.0.1` と `localhost` を**開発時だけ**同じものとして扱う（T-M8-128）。
 *
 * ローカルの `APP_BASE_URL` は `http://127.0.0.1:3000`（X OAuth が `localhost` を許さないため）。
 * ところがブラウザは `localhost:3000` でも開けるので、そこで「プランを変更」「解約する」
 * 「7日間無料で利用」を押すと Origin が一致せず **403** になり、画面には
 * 「プラン管理画面を開けませんでした。時間をおいてもう一度お試しください」と出た。
 * **待っても直らないのに待てと言う**うえ、原因（開いているURLが違う）が画面から辿れない
 * （CLAUDE.md 原則1・2）。2026-08-18 に運営者が実際に踏んだ。
 *
 * `CLAUDE.md` にも「`localhost` ではなく `127.0.0.1`」と書いてあったが、**手順を記憶に
 * 依存させていた**のが誤り（原則3）。忘れても壊れない形にする。
 *
 * **本番の守りは変えない。** 等価にするのは、設定側が `127.0.0.1`／`localhost` の
 * どちらかを指しているときだけ。つまりローカル開発に限られる。
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * ループバックのオリジンだけを、比べられる共通の形へ寄せる。
 *
 * **`new URL().origin` を返してはいけない。** それは末尾スラッシュ付きの
 * `https://example.com/` も `https://example.com` へ正規化してしまい、
 * 「Originに末尾スラッシュは付かない」という前提の検査（＝厳密一致）を緩める。
 * ループバックでないものは `null` を返し、呼び出し側の厳密一致に委ねる。
 */
function loopbackKey(origin: string): string | null {
  // Originは `scheme://host[:port]` の形しか取らない。それ以外（パス付き等）は対象にしない。
  const match = /^(https?:)\/\/(\[[0-9a-fA-F:]+\]|[^/:]+)(?::(\d+))?$/.exec(origin);
  if (!match) return null;
  const [, protocol, host, port] = match;
  if (!LOOPBACK_HOSTS.has(host)) return null;
  // ポートとスキームは区別する（3000と3001は別のアプリ／httpとhttpsも別）。
  return `${protocol}//loopback:${port ?? ""}`;
}

export function hasExactAppOrigin(
  requestOrigin: string | null,
  appBaseUrl: string,
): boolean {
  if (!requestOrigin) return false;

  try {
    const expected = new URL(appBaseUrl).origin;
    if (requestOrigin === expected) return true;
    // ローカル開発だけ 127.0.0.1 ⇄ localhost を許す（上のコメント参照）。
    // **両方がループバックのときだけ**等価にする。片方でも非ループバックなら厳密一致のまま。
    const from = loopbackKey(requestOrigin);
    const to = loopbackKey(expected);
    return from !== null && from === to;
  // eslint-disable-next-line no-restricted-syntax -- URLとして解釈できない設定値は不一致として扱う（false）
  } catch {
    return false;
  }
}
