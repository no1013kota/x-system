/**
 * 人間確認（Cloudflare Turnstile）が失敗した理由の分類（T-M7-48・CLAUDE.md 原則1「黙って壊れない」／原則2）。
 *
 * Turnstile は `error-callback` にエラーコードを渡してくるが、これを捨てて「もう一度お試しください」
 * だけを出すと、**再試行では絶対に直らない設定の問題**を利用者が延々と再試行することになる。
 *
 * 2026-08-01、staging でコード **110200（ドメイン未許可）** が発生し、ログインと新規登録が両方
 * 不可能になっていた。画面には「もう一度お試しください」しか出ず、コードもログにしか無かったため、
 * 運営者には「壊れている」ことも「どこを直せばよいか」も分からなかった。
 *
 * ここは純粋関数だけを置く（表示は `TurnstileWidget`、事前検知は `scripts/check-turnstile.mjs`）。
 *
 * コード表: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */

export type TurnstileFailureKind =
  /** 運営者の設定が原因。**再試行しても直らない**。 */
  | "setting"
  /** 利用者の端末・ネットワークが原因。運営者側は正常。 */
  | "visitor_environment"
  /** 一時的な失敗。再試行で直り得る。 */
  | "transient";

export interface TurnstileFailure {
  kind: TurnstileFailureKind;
  /** 画面に出す文（利用者が読む）。コードを含め、問い合わせで伝えられるようにする。 */
  message: string;
  /**
   * 運営者向けの直し方。`setting` のときだけ入る。
   * 画面には出さない（利用者に設定手順を見せない）。状態確認・ドキュメント側で使う。
   */
  operatorHint?: string;
  /** Turnstile が返したコード（不明なときは空文字）。 */
  code: string;
}

/** 設定が原因のコード → 運営者がどこを直すか。 */
const SETTING_CODES: Record<string, string> = {
  "110100": "サイトキーが正しくありません。Cloudflare の Turnstile ダッシュボードで確認してください",
  "110110":
    "サイトキーが見つかりません。NEXT_PUBLIC_TURNSTILE_SITE_KEY の値とダッシュボードの表示が一致しているか確認してください",
  "110200":
    "このドメインが許可されていません。Cloudflare の Turnstile → 該当ウィジェット → Hostname Management へ、いまのドメインを追加してください",
  "400020": "サイトキーが正しくありません。Cloudflare の Turnstile ダッシュボードで確認してください",
  "400070":
    "サイトキーが無効化されています。Cloudflare の Turnstile ダッシュボードで状態を確認してください",
};

/** 利用者の端末・ネットワークが原因のコード → 利用者への案内。 */
const VISITOR_CODES: Record<string, string> = {
  "200100":
    "端末の時刻がずれているか、通信の途中で古い内容が使われています。時刻設定を確認して、ページを再読み込みしてください",
  "200500":
    "人間であることの確認（challenges.cloudflare.com）へ接続できません。広告ブロックや拡張機能、社内ネットワークの制限を確認してください",
};

/**
 * コードから失敗の種類と文言を決める。
 *
 * **判断できないコードは `transient` に寄せる**（設定の問題だと断定して「運営者へ問い合わせ」と
 * 言い切るより、まず再試行を促す方が害が小さい）。ただしコードは必ず文面に残す。
 */
export function classifyTurnstileError(rawCode: unknown): TurnstileFailure {
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode).trim() : "";
  const suffix = code ? `（コード ${code}）` : "";

  const settingHint = SETTING_CODES[code];
  if (settingHint) {
    return {
      kind: "setting",
      // 再試行を促さない。何度やっても直らないため。
      message: `人間であることの確認が利用できない設定になっています${suffix}。お手数ですが運営者へお知らせください。`,
      operatorHint: settingHint,
      code,
    };
  }

  const visitorMessage = VISITOR_CODES[code];
  if (visitorMessage) {
    return { kind: "visitor_environment", message: `${visitorMessage}${suffix}。`, code };
  }

  return {
    kind: "transient",
    message: `人間であることの確認を完了できませんでした${suffix}。もう一度お試しください。`,
    code,
  };
}

/** 設定の問題かどうか（運営者への通知・事前検知の判定に使う）。 */
export function isTurnstileSettingError(rawCode: unknown): boolean {
  return classifyTurnstileError(rawCode).kind === "setting";
}
