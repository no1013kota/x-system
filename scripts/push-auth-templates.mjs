#!/usr/bin/env node
//
// 認証メールのテンプレートをリモートSupabaseへ反映する（T-M8-120・CLAUDE.md 原則3）。
//
//   npm run auth:templates -- --target production        # 差分を出すだけ
//   npm run auth:templates -- --target production --apply # 反映する
//
// 反映先のSupabaseプロジェクトは、そのURLのCSPヘッダから自動で特定する（`doctor` と同じ）。
//
// ## なぜ要るか
//
// `supabase/config.toml` の `[auth.email.template.*]` は **ローカル専用**で、`supabase db push` でも
// `supabase link` でもリモートへは行かない。リモートは既定テンプレート（`{{ .ConfirmationURL }}`）の
// ままになり、**アプリの `/auth/confirm` が要求する `token_hash` がリンクに付かない**。
// 結果、利用者は登録も再設定もできず「リンクを確認できませんでした」だけを見る。
//
// 2026-08-02 と 2026-08-18 の2回、実際にこれで新規登録が止まった。`deployment.md` に手順を
// 書いてあったが**人の記憶に依存していたので忘れられた**。手順を1コマンドへ畳む。
//
// テンプレートの正本は `supabase/templates/*.html`（ローカルとリモートで同じものを使う）。
//
// 確認メールは**6桁コード**（`{{ .Token }}`）、再設定はリンク（`{{ .TokenHash }}`）。
// どちらの目印が要るかは `TEMPLATES[].requires` が持つ。
import { readFileSync } from "node:fs";

/**
 * 反映先のURL。**project refはここから自動で特定する**（`doctor` と同じ作法・`projectRefFromCsp`）。
 * refをenvへ増やすと環境ごとに増えて忘れる。URLだけ渡せば足りる形にする。
 */
const TARGETS = {
  staging: "https://x-system-stg.vercel.app",
  production: "https://exosai.net",
};

/**
 * 反映する2種類。`subject` は config.toml と同じ文言にそろえる。
 *
 * `requires` は「これが本文に無ければ、開いても／入力しても必ず失敗する」目印。
 * 確認は**6桁コード**方式（`{{ .Token }}`）にしたので `TokenHash` は不要（T-M8-121）。
 * 再設定はリンク方式のまま（`token_hash` で `/auth/confirm` へ入る）。
 */
const TEMPLATES = [
  {
    label: "Confirm signup",
    file: "supabase/templates/confirmation.html",
    subjectKey: "mailer_subjects_confirmation",
    contentKey: "mailer_templates_confirmation_content",
    subject: "Exos AIのメールアドレス確認",
    requires: "Token",
    brokenHint:
      "確認コード（{{ .Token }}）が本文にありません。このままでは登録画面に入力するコードが届きません",
  },
  {
    label: "Reset password",
    file: "supabase/templates/recovery.html",
    subjectKey: "mailer_subjects_recovery",
    contentKey: "mailer_templates_recovery_content",
    subject: "Exos AIのパスワード再設定",
    requires: "TokenHash",
    brokenHint:
      "token_hash がリンクに付いていません（このままでは必ず「リンクを確認できませんでした」になります）",
  },
];

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

const target = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : null;
const apply = process.argv.includes("--apply");

if (!target || !(target in TARGETS)) {
  fail(`--target を指定してください（${Object.keys(TARGETS).join(" / ")}）`);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  fail(
    "SUPABASE_ACCESS_TOKEN が未設定です。https://supabase.com/dashboard/account/tokens で発行し .env.local へ置いてください",
  );
}

const { projectRefFromCsp } = await import("../src/lib/ops/release-gate.ts");
// 差出人名は doctor の検査と同じ定数を使う（別々に書くと片方だけ直して食い違う）。
const { EXPECTED_SENDER_NAME } = await import("../src/lib/ops/auth-url-status.ts");

const baseUrl = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : TARGETS[target];

const csp = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) })
  .then((r) => r.headers.get("content-security-policy"))
  .catch(() => null);
const projectRef = projectRefFromCsp(csp);
if (!projectRef) {
  fail(
    `${baseUrl} が使うSupabaseプロジェクトを特定できませんでした（アプリが応答しているか確認してください）`,
  );
}

const api = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

/**
 * テンプレート以外の認証設定（T-M8-123）。**リモートだけが既定のまま取り残される**ので、
 * `supabase/config.toml`（ローカルの正本）と同じ値をリモートへ揃える。
 *
 * 2026-08-18、この2つが原因で本番の登録が完了できなかった:
 * - `mailer_otp_length` が **8**（ローカルは6）。画面は6桁前提なので**桁数が合わない**
 * - `rate_limit_email_sent` が **2通/時**。2回試すと以降メールが届かず、
 *   利用者には「送信しました」と出るのに何も来ない（原則1違反）
 *
 * どちらも「コードに現れない設定」で、テストでは原理的に見えない。だからここで揃える。
 */
const AUTH_SETTINGS = {
  /** 確認コードの桁数。`EMAIL_CODE_LENGTH`（画面側）と必ず一致させる。 */
  mailer_otp_length: 6,
  /** コードの有効期間（秒）。画面の案内文（1時間）と合わせる。 */
  mailer_otp_exp: 3600,
  /**
   * 1時間に送れるメール数。既定の2は**動作確認すら通らない**（登録＋再送で使い切る）。
   * カスタムSMTP前提で30へ。総当たりの入口を広げすぎない範囲で、利用者が詰まらない値。
   */
  rate_limit_email_sent: 30,
  /**
   * 5分あたりのコード検証回数（IPごと）。**総当たり対策の本体**。
   * 6桁＝100万通りに対して5分30回なので、現実的な時間では当たらない。
   * 打ち間違いを数回する利用者は困らない値（Supabaseの既定と同じ）。
   */
  rate_limit_verify: 30,
  /** 5分あたりの登録・ログイン試行（IPごと）。 */
  rate_limit_anonymous_users: 30,
};

/**
 * カスタムSMTPも一緒に設定する（T-M8-120）。
 *
 * **Freeプラン＋内蔵送信ではテンプレートを変更できない**（Management APIが
 * `Email template modification is not available for free tier projects using the default email
 * provider` を返す）。しかも内蔵送信は **2通/時・組織メンバー宛のみ**で、他人には永久に届かない
 * のに画面は「送信しました」と出る。**テンプレートの前にSMTPを入れる必要がある**。
 *
 * 資格情報はアプリの通知メールと同じもの（`SMTP_*`）を流用する。**秘密値はenvから読むだけで、
 * ログにも引数にも出さない。**
 */
function smtpPatch() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  if (!host || !port || !user || !pass) return null;
  return {
    smtp_host: host,
    smtp_port: String(port),
    smtp_user: user,
    smtp_pass: pass,
    smtp_admin_email: user,
    smtp_sender_name: EXPECTED_SENDER_NAME,
  };
}

const current = await fetch(api, { headers }).then(async (r) => {
  const body = await r.json();
  if (!r.ok) fail(`Supabase Management API: ${body.message ?? r.status}`);
  return body;
});

console.log(`\n■ 認証メールのテンプレート（${target} / ${projectRef}）\n`);

const patch = {};
let broken = 0;
for (const t of TEMPLATES) {
  const want = readFileSync(t.file, "utf8").trim();
  const have = (current[t.contentKey] ?? "").trim();
  // **これが本質的な検査**: 目印が無い本文は、利用者が何をしても登録・再設定を完了できない。
  const usable = have.includes(t.requires);
  if (!usable) broken += 1;

  if (have === want && current[t.subjectKey] === t.subject) {
    console.log(`✅ ${t.label}\n    リポジトリの正本と一致しています`);
    continue;
  }
  console.log(
    `${usable ? "⚠️ " : "❌"} ${t.label}\n    ${
      have === "" ? "未設定（Supabaseの既定テンプレート）" : usable ? "内容が正本と違います" : t.brokenHint
    }`,
  );
  patch[t.contentKey] = want;
  patch[t.subjectKey] = t.subject;
}

/*
  **届くのか／誰から届くのか**を先に出す（T-M8-136）。テンプレートが正しくても、
  内蔵送信のままなら利用者には届かず、差出人名が既定なら見知らぬ相手から届く。
*/
console.log("");
if (!current.smtp_host) {
  console.log(
    "❌ カスタムSMTP: 未設定（内蔵送信）\n" +
      "    **利用者に確認メールが届きません**（内蔵送信は2通/時・組織メンバー宛のみ。画面には「送信しました」と出ます）",
  );
  broken += 1;
} else {
  console.log(`✅ カスタムSMTP: ${current.smtp_host}`);
}
if (current.smtp_sender_name === EXPECTED_SENDER_NAME) {
  console.log(`✅ 差出人名: ${current.smtp_sender_name}`);
} else {
  console.log(
    `❌ 差出人名: ${current.smtp_sender_name || "(未設定)"} → ${EXPECTED_SENDER_NAME} にします\n` +
      "    見知らぬ差出人から6桁コードが届く状態で、迷惑メール判定にも不利です",
  );
  broken += 1;
}

// テンプレート以外の設定のずれ（桁数・送信上限・検証上限）。
console.log("");
for (const [key, want] of Object.entries(AUTH_SETTINGS)) {
  const have = current[key];
  if (String(have) === String(want)) {
    console.log(`✅ ${key}: ${have}`);
    continue;
  }
  console.log(`❌ ${key}: ${have} → ${want} にします`);
  patch[key] = want;
  broken += 1;
}

if (Object.keys(patch).length === 0) {
  console.log("\n✅ 反映は不要です。");
  process.exit(0);
}

if (!apply) {
  console.log(
    `\n差分があります。反映するには --apply を付けて実行してください:\n    npm run auth:templates -- --target ${target} --apply`,
  );
  // 使えない状態（token_hash無し）は失敗として返す。CIやdoctorから呼んだときに気付けるように。
  process.exit(broken > 0 ? 1 : 0);
}

/*
  **差出人名は毎回そろえる**（T-M8-136・運営者の質問 2026-08-18）。
  以前は「SMTPが未設定のときだけ」設定していたため、**一度別の名前で設定された環境は
  永久に直らなかった**（利用者には `Admin` 等の見知らぬ差出人から6桁コードが届く）。
  SMTPの有無に依らず、名前が違えば直す。
*/
if (current.smtp_host && current.smtp_sender_name !== EXPECTED_SENDER_NAME) {
  console.log(
    `\n→ 差出人名が「${current.smtp_sender_name || "(未設定)"}」なので「${EXPECTED_SENDER_NAME}」へ直します`,
  );
  await fetch(api, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ smtp_sender_name: EXPECTED_SENDER_NAME }),
  }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) fail(`差出人名の設定に失敗しました: ${body.message ?? r.status}`);
  });
  console.log("✅ 差出人名を設定しました");
}

// SMTPが未設定ならテンプレート変更は拒否されるので、先に入れる。
if (!current.smtp_host) {
  const smtp = smtpPatch();
  if (!smtp) {
    fail(
      "カスタムSMTPが未設定です。Freeプラン＋内蔵送信ではテンプレートを変更できず、内蔵送信は2通/時・組織メンバー宛にしか届きません。\n" +
        "   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_APP_PASSWORD を .env.local へ置いて再実行してください（アプリの通知メールと同じ資格情報を流用できます）。",
    );
  }
  console.log(`\n→ カスタムSMTPが未設定のため先に設定します（送信元: ${smtp.smtp_user}）`);
  await fetch(api, { method: "PATCH", headers, body: JSON.stringify(smtp) }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) fail(`SMTPの設定に失敗しました: ${body.message ?? r.status}`);
  });
  console.log("✅ カスタムSMTPを設定しました");
}

await fetch(api, { method: "PATCH", headers, body: JSON.stringify(patch) }).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) fail(`反映に失敗しました: ${body.message ?? r.status}`);
});

// 反映後に読み直して確認する（PATCHが通っても内容が入っていないことがある）。
const after = await fetch(api, { headers }).then((r) => r.json());
for (const t of TEMPLATES) {
  const ok = (after[t.contentKey] ?? "").includes(t.requires);
  console.log(`${ok ? "✅" : "❌"} ${t.label}: ${ok ? "反映を確認しました" : "反映されていません"}`);
  if (!ok) process.exitCode = 1;
}
for (const [key, want] of Object.entries(AUTH_SETTINGS)) {
  const ok = String(after[key]) === String(want);
  console.log(`${ok ? "✅" : "❌"} ${key}: ${after[key]}`);
  if (!ok) process.exitCode = 1;
}
console.log("\n実際に新規登録して、確認メールのリンクが開けることを確かめてください。");
