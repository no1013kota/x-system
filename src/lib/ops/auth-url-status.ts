/**
 * 会員登録・パスワード再設定メールの**行き先**が、その環境で正しいかの確認（T-M8-90）。
 *
 * アプリは `emailRedirectTo` に `${APP_BASE_URL}/auth/confirm` を渡す（`app/actions/auth.ts` の
 * `confirmationRedirectUrl()`）。しかし **Supabase は許可リスト（Redirect URLs）に無い行き先を
 * 黙って Site URL へ差し替える**。エラーにならないので、`signUp` の応答は成功で返る。
 *
 * 2026-08-14、本番（exosai.net）がまさにこの状態だった。Site URL が既定の localhost のままで、
 * **確認メールのリンクが localhost を指し、登録の最後の一歩が踏めなかった**。
 * アプリ側は正しく `https://exosai.net/auth/confirm` を渡していた。
 *
 * これで「相手側の設定はコードに現れない」不具合は3件目（stagingのTurnstile許可ドメイン・T-M7-48／
 * 本番のCAPTCHA無効／今回）。前2件は無認証で探査できたが、**これは探査できない**——
 * 公開エンドポイント `GET /auth/v1/settings` は `site_url` を返さない（2026-08-14 実測）。
 * そのため Management API（`GET /v1/projects/{ref}/config/auth`）で読む。
 *
 * ここは判定だけを持つ（importを持たないので `scripts/doctor.mjs` から直接読める）。
 * 取得は `scripts/doctor.mjs` が行う。
 */

import type { Check } from "./check";

/** 運営者向けの見出し。doctor の一覧に出る。 */
export const AUTH_URL_CHECK_NAME = "登録・再設定メールの行き先（Supabase）";

/** Management APIのトークンを置く環境変数名。 */
export const AUTH_TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";

/**
 * アプリが渡す確認メールの行き先。**`app/actions/auth.ts` と同じ組み立てにすること。**
 * ここがずれると、実際に渡す値ではないURLを検査してしまう。
 */
export function confirmRedirectUrl(appBaseUrl: string): string {
  return new URL("/auth/confirm", appBaseUrl).toString();
}

/**
 * 許可リストの1エントリが対象URLを許すか。
 *
 * Supabaseのワイルドカードに合わせる: `**` はパス区切りを含めて何にでも一致し、
 * `*` は区切りを含めない。`?` は1文字。それ以外は完全一致。
 * **緩く判定してはいけない**——許していないものを許すと判定すると、この検査は何も守らなくなる。
 */
export function allowsUrl(entry: string, url: string): boolean {
  // `**` を先に退避する（`*` の置換に食われないように）。URLに現れない文字を目印に使う。
  const DOUBLE = "\u0000";
  const escaped = entry.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*/g, DOUBLE)
    .replace(/\*/g, "[^/]*")
    .split(DOUBLE)
    .join(".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`).test(url);
}

/**
 * Management API の `uri_allow_list` を配列にする。
 *
 * **カンマ区切りの1本の文字列で返ってくる**（Dashboardの複数行入力とは形が違う）。
 * 配列で返す実装差も起こりうるので両方受ける。空文字を要素として数えないこと——
 * 数えると「空の許可リスト」を「1件ある」と誤認する。
 */
export function parseAllowList(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(",")
      : [];
  return parts.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** 許可リストのどれかが対象URLを許すか。 */
export function isRedirectAllowed(uriAllowList: readonly string[], url: string): boolean {
  return uriAllowList.some((entry) => allowsUrl(entry.trim(), url));
}

/** 同じオリジンを指しているか（末尾スラッシュの差は無視する）。 */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  // eslint-disable-next-line no-restricted-syntax -- URLとして読めない値は「同じオリジンではない」が答え。失敗自体が判定結果なので記録しない
  } catch {
    return false;
  }
}

/**
 * トークンが無いときの結果。**「確認できません」を ✅ にしない**（原則1）。
 * `PRODUCTION_CRON_SECRET` が無いときの「データの状態」と同じ振る舞いに揃える。
 */
export function unknownAuthUrls(reason: string): Check {
  return {
    name: AUTH_URL_CHECK_NAME,
    level: "warn",
    detail: `確認できません（${reason}）`,
    nextAction:
      `\`.env.local\` に ${AUTH_TOKEN_ENV} を置くと確認できます` +
      "（Supabase Dashboard → Account → Access Tokens で発行）",
  };
}

/**
 * Supabaseのauth設定が、この環境のURLと合っているかを判定する。
 *
 * - 許可リストが確認URLを含まない → **error**。メールのリンクが Site URL へ差し替わる＝登録が完了できない
 * - 含むが Site URL のオリジンが違う → **warn**。明示的な行き先を渡さない経路（招待メール等）が別の場所へ向く
 * - どちらも合っている → ok
 */
export function judgeAuthUrls(input: {
  appBaseUrl: string;
  siteUrl: string | null;
  uriAllowList: readonly string[];
  /**
   * リモートの確認メール本文（`mailer_templates_confirmation_content`）。
   * 未取得なら undefined（その場合はこの観点を判定しない）。
   */
  confirmationTemplate?: string | null;
  /** リモートのSMTPホスト。未設定＝Supabase内蔵送信。 */
  smtpHost?: string | null;
}): Check {
  const target = confirmRedirectUrl(input.appBaseUrl);
  const allowed = isRedirectAllowed(input.uriAllowList, target);
  const siteMatches = input.siteUrl ? sameOrigin(input.siteUrl, input.appBaseUrl) : false;
  const site = input.siteUrl ?? "(未設定)";

  /**
   * **確認メールに6桁コードが入っているか**（T-M8-120・T-M8-121）。
   *
   * `supabase/config.toml` のテンプレート指定はローカル専用で、リモートは既定
   * （`{{ .ConfirmationURL }}`）のまま。確認は**コード方式**（`{{ .Token }}`）にしたので、
   * 既定テンプレートには入力すべきコードがどこにも書かれていない。URLの許可リストが
   * 正しくても**利用者は登録を完了できない**。2026-08-02 と 2026-08-18 の2回これで止まった。
   * URLの検査だけでは原理的に見えないので、ここで本文まで見る。
   */
  if (input.confirmationTemplate) {
    if (!input.confirmationTemplate.includes("{{ .Token }}")) {
      return {
        name: AUTH_URL_CHECK_NAME,
        level: "error",
        detail:
          "確認メールに6桁コード（{{ .Token }}）が入っていません（Supabaseの既定テンプレートのままです）。" +
          "**このままでは新規登録を完了できません**（入力するコードが届きません）",
        nextAction:
          "`npm run auth:templates -- --target production --apply` を実行してください" +
          (input.smtpHost
            ? ""
            : "（カスタムSMTPが未設定だとテンプレートを変更できないため、同じコマンドが先にSMTPも設定します）"),
      };
    }
  }

  if (!allowed) {
    return {
      name: AUTH_URL_CHECK_NAME,
      level: "error",
      detail:
        `${target} が許可リストにありません。` +
        `**確認メールのリンクは ${site} へ差し替えられます**（Supabaseは黙って置き換えます）`,
      nextAction:
        "Supabase → Authentication → URL Configuration の Redirect URLs へ " +
        `${new URL(input.appBaseUrl).origin}/** を追加し、Site URL も同じオリジンにしてください`,
    };
  }
  if (!siteMatches) {
    return {
      name: AUTH_URL_CHECK_NAME,
      level: "warn",
      detail:
        `確認メールの行き先は正しい（${target}）が、Site URL が ${site} でこの環境と違います。` +
        "行き先を明示しない経路のメールは別の場所へ向きます",
      nextAction: `Supabase → Authentication → URL Configuration の Site URL を ${new URL(input.appBaseUrl).origin} にしてください`,
    };
  }
  return {
    name: AUTH_URL_CHECK_NAME,
    level: "ok",
    detail: `${target} が許可されており、Site URL も ${site} で一致しています`,
  };
}
