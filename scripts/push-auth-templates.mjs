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
import { readFileSync } from "node:fs";

/**
 * 反映先のURL。**project refはここから自動で特定する**（`doctor` と同じ作法・`projectRefFromCsp`）。
 * refをenvへ増やすと環境ごとに増えて忘れる。URLだけ渡せば足りる形にする。
 */
const TARGETS = {
  staging: "https://x-system-stg.vercel.app",
  production: "https://exosai.net",
};

/** 反映する2種類。`subject` は config.toml と同じ文言にそろえる。 */
const TEMPLATES = [
  {
    label: "Confirm signup",
    file: "supabase/templates/confirmation.html",
    subjectKey: "mailer_subjects_confirmation",
    contentKey: "mailer_templates_confirmation_content",
    subject: "Exos AIのメールアドレス確認",
  },
  {
    label: "Reset password",
    file: "supabase/templates/recovery.html",
    subjectKey: "mailer_subjects_recovery",
    contentKey: "mailer_templates_recovery_content",
    subject: "Exos AIのパスワード再設定",
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
    smtp_sender_name: "Exos AI",
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
  // **これが本質的な検査**: token_hash が無いリンクは、開いても必ずエラーになる。
  const usable = have.includes("TokenHash");
  if (!usable) broken += 1;

  if (have === want && current[t.subjectKey] === t.subject) {
    console.log(`✅ ${t.label}\n    リポジトリの正本と一致しています`);
    continue;
  }
  console.log(
    `${usable ? "⚠️ " : "❌"} ${t.label}\n    ${
      have === "" ? "未設定（Supabaseの既定テンプレート）" : usable ? "内容が正本と違います" : "token_hash がリンクに付いていません（このままでは必ず「リンクを確認できませんでした」になります）"
    }`,
  );
  patch[t.contentKey] = want;
  patch[t.subjectKey] = t.subject;
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
  const ok = (after[t.contentKey] ?? "").includes("TokenHash");
  console.log(`${ok ? "✅" : "❌"} ${t.label}: ${ok ? "反映を確認しました" : "反映されていません"}`);
  if (!ok) process.exitCode = 1;
}
console.log("\n実際に新規登録して、確認メールのリンクが開けることを確かめてください。");
