import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CODE_ATTEMPT_WINDOW_MS } from "./code-attempts";
import { EMAIL_CODE_LENGTH } from "./email-code";

/**
 * T-M8-144。**Supabase Auth の設定値が3か所に散っているのを機械的に突き合わせる。**
 *
 * 同じ値が (1) `supabase/config.toml`（ローカル） (2) `scripts/push-auth-templates.mjs` の
 * `AUTH_SETTINGS`（リモートへ送る値） (3) アプリのコード定数（画面の検証・失敗数えの窓）
 * にある。**コメントは「必ず一致させる」と書いていたが、照合していなかった**（T-M8-144）。
 *
 * ずれると出方が分かりにくい: 桁数がずれれば入力欄と実際のコードが合わず、
 * 有効期間がずれれば「コードは生きているのに数えは切れている」状態になる。
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = readFileSync(`${ROOT}supabase/config.toml`, "utf8");

/** `[auth.email]` セクション内の `key = value` を読む（他セクションの同名キーを拾わない）。 */
function emailSetting(key: string): string | null {
  const section = CONFIG.split(/^\[auth\.email\]$/m)[1];
  if (!section) return null;
  const body = section.split(/^\[/m)[0];
  const m = new RegExp(`^${key}\\s*=\\s*"?([^"\\n]+)"?`, "m").exec(body);
  return m ? m[1].trim() : null;
}

/** `[auth.email.template.<name>]` の subject。 */
function templateSubject(name: string): string | null {
  const m = new RegExp(
    `^\\[auth\\.email\\.template\\.${name}\\]$([\\s\\S]*?)(?=^\\[|\\Z)`,
    "m",
  ).exec(CONFIG);
  if (!m) return null;
  const s = /^subject\s*=\s*"([^"]+)"/m.exec(m[1]);
  return s ? s[1] : null;
}

describe("Supabase Auth の設定値がコードと一致する（T-M8-144）", () => {
  it("検出器が空振りしていない（config.toml を読めている）", () => {
    // **0件で緑にしない。** 書式が変わって読めなくなったのを見逃さないため。
    expect(emailSetting("otp_length"), "config.toml の otp_length を読めない").not.toBeNull();
    expect(emailSetting("otp_expiry"), "config.toml の otp_expiry を読めない").not.toBeNull();
    expect(templateSubject("confirmation"), "confirmation の subject を読めない").not.toBeNull();
  });

  it("確認コードの桁数が3か所で一致する", async () => {
    const { AUTH_SETTINGS } = await import("../../../scripts/auth-settings.mjs");
    expect(Number(emailSetting("otp_length")), "config.toml ↔ アプリ").toBe(EMAIL_CODE_LENGTH);
    expect(AUTH_SETTINGS.mailer_otp_length, "リモートへ送る値 ↔ アプリ").toBe(EMAIL_CODE_LENGTH);
  });

  it("コードの有効期間が config.toml・リモート・失敗数えの窓で一致する", async () => {
    const { AUTH_SETTINGS } = await import("../../../scripts/auth-settings.mjs");
    const expiry = Number(emailSetting("otp_expiry"));
    expect(AUTH_SETTINGS.mailer_otp_exp, "リモートへ送る値 ↔ config.toml").toBe(expiry);
    // 失敗数えの窓は有効期間と同じにする（片方だけ切れる状態を作らない）。
    expect(CODE_ATTEMPT_WINDOW_MS, "失敗数えの窓 ↔ 有効期間").toBe(expiry * 1000);
  });

  it("メール確認の省略がローカルとリモートで一致する（T-M8-202。食い違うとE2Eと本番で挙動が割れる）", async () => {
    const { AUTH_SETTINGS } = await import("../../../scripts/auth-settings.mjs");
    // mailer_autoconfirm: true ⇔ enable_confirmations = false（意味が反転している点に注意）。
    expect(AUTH_SETTINGS.mailer_autoconfirm, "リモートへ送る値 ↔ config.toml").toBe(
      emailSetting("enable_confirmations") === "false",
    );
  });

  it("メールの件名が config.toml とリモートへ送る値で一致する", async () => {
    const { TEMPLATES } = await import("../../../scripts/auth-settings.mjs");
    for (const tpl of TEMPLATES) {
      const name = tpl.contentKey.includes("confirmation") ? "confirmation" : "recovery";
      expect(templateSubject(name), `${name} の件名`).toBe(tpl.subject);
    }
  });
});
