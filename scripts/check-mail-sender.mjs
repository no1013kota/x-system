// Exos AIの差出人アドレスで実際に送れるかを確かめる（T-M8-342）。
//
//   npm run check:mail-sender              # 接続と「名乗れるか」だけ確認（メールは送らない）
//   npm run check:mail-sender -- --send    # 実際に1通、SUPPORT_EMAIL 宛へ送る
//
// **なぜコマンドが要るか**: 差出人を support@exosai.net にしても、送信側（Gmail/Workspace）で
// そのアドレスを名乗る許可が無ければ送信は拒否される。設定画面をいくら見ても分からず、
// 「利用者に確認メールが届かない」形でしか表面化しない（画面には「送信しました」と出る）。
// **押す前に分かる**ようにする（CLAUDE.md 原則2）。
//
// 秘密値は表示しない。SMTPのユーザー名はドメインだけを出す。

import nodemailer from "nodemailer";

const EXPECTED_SENDER_EMAIL = "support@exosai.net";
const EXPECTED_SENDER_NAME = "Exos AI";

const send = process.argv.includes("--send");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_APP_PASSWORD;
const to = process.env.SUPPORT_EMAIL;

if (!host || !user || !pass) {
  fail("SMTP_HOST / SMTP_USER / SMTP_APP_PASSWORD が未設定です（.env.local を確認してください）");
}

// ユーザー名そのものは出さない（アドレスは秘密ではないが、ログに残す理由も無い）。
const userDomain = user.includes("@") ? user.split("@")[1] : "(ドメイン不明)";
console.log(`\n■ 差出人の確認（${host} / ログインは @${userDomain}）\n`);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  requireTLS: port === 587,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log("✅ SMTPへ接続・認証できました");
} catch (error) {
  fail(`SMTPへ接続できません: ${error instanceof Error ? error.message : String(error)}`);
}

const senderMatchesLogin = user.toLowerCase() === EXPECTED_SENDER_EMAIL.toLowerCase();
if (senderMatchesLogin) {
  console.log(`✅ ログインユーザー自身が ${EXPECTED_SENDER_EMAIL} です（別名の認証は不要）`);
} else {
  console.log(
    `ℹ️  ログインユーザーと差出人が違います（${EXPECTED_SENDER_EMAIL} を名乗る形）。\n` +
      "    Gmail/Workspace では「他のアドレスとしてメールを送信」の認証が必要です。" +
      "認証が無いと送信時に 5xx で拒否されます。",
  );
}

if (!send) {
  console.log(
    "\n実際に送れるかは、送ってみないと分かりません（拒否は送信時にしか返らない）。\n" +
      `  npm run check:mail-sender -- --send    # ${to ?? "SUPPORT_EMAIL"} 宛に1通送ります\n`,
  );
  process.exit(0);
}

if (!to) fail("SUPPORT_EMAIL が未設定です（送信先が決まりません）");

/*
  **送り先は運営者自身のアドレス（SUPPORT_EMAIL）だけ**に固定する。
  2026-07-27に98通の誤送信を起こしているので、宛先を引数で受けられるようにはしない。
*/
try {
  const info = await transporter.sendMail({
    from: `${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>`,
    to,
    subject: "[Exos AI] 差出人の確認",
    text:
      "このメールは差出人アドレスの確認のために送信されました。\n" +
      `差出人が「${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>」になっていれば設定は正しいです。\n`,
  });
  console.log(`\n✅ 送信できました（${EXPECTED_SENDER_EMAIL} を名乗れています）`);
  console.log(`    宛先: ${to}`);
  console.log(`    受信箱で**差出人の表示**を確認してください（「〜に代わって送信」と出ていないか）`);
  if (info.rejected?.length) console.log(`    ⚠️ 拒否された宛先: ${info.rejected.length}件`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ 送信できませんでした: ${message}`);
  if (/not allowed|5\.7\.\d|553|550/i.test(message)) {
    console.error(
      `    **${EXPECTED_SENDER_EMAIL} を名乗る許可がありません。**\n` +
        "    Gmail → 設定 → アカウント → 「他のアドレスとしてメールを送信」で追加し、\n" +
        "    確認メールのリンクを踏んでから、もう一度実行してください。",
    );
  }
  process.exit(1);
}
