/**
 * 失敗の原因を残すための**生の文面**の組み立て（F4）。
 *
 * T-M7-39 で `provider_raw_error` を入れたのに、**最も多い失敗である「AIの出力が検証に
 * 通らなかった」ときだけ空**だった。`InvalidProviderOutputError` が応答本文を持たず、
 * 呼び出し側に渡すものが無かったためである。その結果 `invalid_output` の記録は code だけで、
 * 運営者は「AIが何を返して落ちたのか」を辿れなかった（CLAUDE.md 原則2）。
 *
 * この値は**画面には出さない**（要件06 §5・要件01 §8）。運営者はDBと
 * `npm run smoke:live` で見る。読むのは非エンジニアなのでラベルは日本語にする。
 */

/**
 * 保存する生文面の上限。
 *
 * 2,000字から引き上げた（F4）。1つの値に「例外の要約＋初回の応答＋修復callの応答」を
 * 入れるため、2,000字では2回目が丸ごと切れて肝心の差分が読めない。
 */
export const RAW_ERROR_MAX = 4000;

/** 空なら null、超過は末尾を `…` にして切る。 */
export function truncateRawError(text: string | null | undefined, max = RAW_ERROR_MAX): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** 例外を1行の要約にする（`cause` があれば添える）。 */
export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.cause ? ` / cause: ${String(error.cause)}` : ""}`;
  }
  return String(error);
}

/**
 * 各試行の応答本文にラベルを付けて1つの値へ畳む。
 *
 * **両方を残す**。2026-07-27 の事例では初回が妥当なJSONで長さ超過、修復callは
 * `{"items":[]}` と中身が違い、片方だけでは原因が特定できなかった。
 */
export function formatProviderAttempts(attempts: readonly string[]): string | null {
  if (attempts.length === 0) return null;
  const per = Math.floor(RAW_ERROR_MAX / 2);
  const parts = attempts.map((text, index) => {
    const label =
      index === 0 ? "1回目の応答" : index === 1 ? "2回目の応答（修復指示つき）" : `${index + 1}回目の応答`;
    // **空の応答も飛ばさず「（空）」と書く。** 何も返ってこなかったこと自体が原因の手がかりで
    // （providerの問題であってスキーマの問題ではない）、行が消えると「そのcallが無かった」と
    // 読めてしまう。番号も試行の実際の順番を指す。
    return `${label}: ${truncateRawError(text, per) ?? "（空）"}`;
  });
  return truncateRawError(parts.join("\n"));
}

/**
 * 失敗記録に入れる文面（例外の要約＋あれば応答本文）。
 * 生成・学習・画像・提案の各jobから共用する。
 */
export function formatFailureRawError(error: unknown, rawOutput: string | null): string | null {
  const head = summarizeError(error);
  const body = rawOutput?.trim();
  return truncateRawError(body ? `${head}\n${body}` : head);
}

/**
 * 検証で落とした候補の中身を1つの値へ畳む（T-M8-86）。
 *
 * ニュース取得は `generation_jobs` を持たず、器の検証は通っているのに **item ごとに
 * 契約違反で落ちる**（title が長い・summary が長い等）。件数だけでは
 * 「プロンプトを直すべきか」が判断できないので、落ちた候補の中身を残す。
 *
 * 件ごとに予算を割るのは `formatProviderAttempts` と同じ理由で、後ろの件が丸ごと
 * 消えると比較ができないため。**先頭5件までを本文で残し、残りは件数だけ**にする
 * （毎窓上書きで長大な値が残り続けるのを避ける）。
 */
const MAX_REJECTED_DETAILS = 5;

export function formatRejectedItems(
  rejected: readonly { reasons: string[]; raw: unknown }[],
): string | null {
  if (rejected.length === 0) return null;
  const shown = rejected.slice(0, MAX_REJECTED_DETAILS);
  const per = Math.floor(RAW_ERROR_MAX / Math.max(shown.length, 1));
  const parts = shown.map((item, index) => {
    const reasons = item.reasons.join("・") || "理由不明";
    const body = truncateRawError(safeJson(item.raw), per) ?? "（空）";
    return `${index + 1}件目（${reasons}）: ${body}`;
  });
  if (rejected.length > shown.length) {
    parts.push(`ほか${rejected.length - shown.length}件（中身は省略）`);
  }
  return truncateRawError(parts.join("\n"));
}

/** JSON化できない値でも落ちないようにする（循環参照など）。 */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  // eslint-disable-next-line no-restricted-syntax -- 文字列化できないことが結果（文字列へ倒す）
  } catch {
    return String(value);
  }
}
