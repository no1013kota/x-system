/**
 * 人間確認（CAPTCHA）が**その環境で実際に効いているか**の確認（T-M7-53）。
 *
 * ## なぜ必要か
 *
 * アプリはトークンの真偽を検証していない。`captchaTokenSchema` は「空でない文字列」しか見ておらず、
 * 実際の検証は `supabase.auth.*` へ渡した `captchaToken` を **Supabase が** 行う。つまり保護の有無は
 * **Supabase ダッシュボードの Attack Protection → CAPTCHA のトグル1つ**に依存する。
 *
 * 2026-08-02、staging がまさに**無効のまま**だった。画面には人間確認の欄が出ており、Cloudflare 側の
 * ドメイン許可も直した後だったのに、**検証自体が行われていなかった**。任意の文字列で通る状態で、
 * 画面は完全に正常に見えるため、運営者にも利用者にも永久に気付けない。
 *
 * ## なぜアプリ側で検証しないのか
 *
 * **Turnstile のトークンは1回しか検証できない**（再検証は `timeout-or-duplicate` で失敗する。
 * Cloudflare公式ドキュメントで確認）。アプリが `siteverify` を先に呼ぶと、続けて Supabase が行う
 * 検証が必ず失敗し、**ログインが全滅する**。つまり二重化は原理的に不可能で、どちらか一方しか選べない。
 *
 * Supabase 側に任せる構成は正しい（利用者のトークンが1度だけ使われる）。問題は「効いているかが
 * 見えない」ことだったので、**見えるようにする**方向で解く（CLAUDE.md 原則1・2）。
 *
 * ## 判定方法
 *
 * 存在しない資格情報で、captchaトークンを**付けずに**ログインを試す。
 * - CAPTCHA有効: `400 captcha_failed`（「captcha_token が無い」と言われる＝検証が働いている）
 * - CAPTCHA無効: `400 invalid_credentials`（資格情報の判定まで進む＝検証が無い）
 *
 * **副作用が無い**（アカウントを作らない・メールを送らない・存在するユーザーに触れない）ので、
 * 状態確認から安全に叩ける。
 */

/** 判定結果。`unknown` は「確認できなかった」で、無効と同一視しない。 */
export type CaptchaState = "enabled" | "disabled" | "unknown";

export interface CaptchaProbeResult {
  state: CaptchaState;
  /** 判定の根拠（運営者向けの表示に使う）。 */
  detail: string;
}

/**
 * 応答から状態を決める。**判断できない応答は `unknown`**（有効だと決めつけない）。
 */
export function classifyCaptchaProbe(input: {
  status: number;
  body: string;
}): CaptchaProbeResult {
  const body = input.body.toLowerCase();
  if (body.includes("captcha")) {
    return { state: "enabled", detail: "人間確認が要求されました（有効）" };
  }
  if (body.includes("invalid_credentials") || body.includes("invalid login")) {
    return {
      state: "disabled",
      detail: "人間確認を求められずに資格情報の判定まで進みました（無効）",
    };
  }
  return {
    state: "unknown",
    detail: `想定外の応答のため判定できません（${input.status}）`,
  };
}

/** 存在しないアドレス。実在のアカウントに触れないよう `.invalid` を使う（RFC 2606）。 */
const PROBE_EMAIL = "captcha-probe@example.invalid";

export interface CaptchaProbeDeps {
  supabaseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 実際に叩いて状態を調べる。設定が足りなければ `unknown`。 */
export async function probeCaptcha(deps: CaptchaProbeDeps): Promise<CaptchaProbeResult> {
  const { supabaseUrl, anonKey, fetchImpl, timeoutMs = 8000 } = deps;
  if (!supabaseUrl || !anonKey) {
    return { state: "unknown", detail: "Supabaseの接続情報が無いため確認できません" };
  }
  // 既定は素の `fetch`。テストのために差し替えられるが、**既定の呼び出しは静的検査から見える形**で
  // 書く（`lib/ops/outbound-channels.ts` の一覧に載せるため）。
  const send = (url: string, init: RequestInit) =>
    fetchImpl ? fetchImpl(url, init) : fetch(url, init);
  try {
    const res = await send(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: PROBE_EMAIL, password: "probe-only-never-valid" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return classifyCaptchaProbe({ status: res.status, body: await res.text() });
  } catch (error) {
    return {
      state: "unknown",
      detail: `確認できませんでした（${String((error as Error).message).slice(0, 60)}）`,
    };
  }
}

export interface CaptchaCheck {
  name: string;
  level: "ok" | "warn" | "error";
  detail: string;
  nextAction?: string;
}

/**
 * 運営者向けの判定。**無効は `error`**（黙って保護が外れている状態を注意で済ませない）。
 */
export function judgeCaptcha(result: CaptchaProbeResult): CaptchaCheck {
  const name = "人間確認（ボット対策）";
  if (result.state === "enabled") {
    return { name, level: "ok", detail: "有効です" };
  }
  if (result.state === "disabled") {
    return {
      name,
      level: "error",
      detail: "**無効です。** 画面に確認欄は出ますが素通りできます",
      nextAction:
        "Supabase → Authentication → Attack Protection → CAPTCHA を有効にし、Cloudflare の Secret Key を設定してください",
    };
  }
  return { name, level: "warn", detail: result.detail };
}
