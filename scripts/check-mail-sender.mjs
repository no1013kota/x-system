// Exos AIの差出人アドレスで実際に送れるかを確かめる（T-M8-342）。
//
//   npm run check:mail-sender              # 接続と「名乗れるか」だけ確認（メールは送らない）
//   npm run check:mail-sender -- --send    # 実際に1通、SUPPORT_EMAIL 宛へ送る
//
// **なぜコマンドが要るか**: 差出人を support@exosai.net にしても、送信側（Gmail/Workspace）で
// そのアドレスを名乗る許可が無ければ、そのアドレスでは届かない。
//
// **重要（2026-08-27に実際に踏んだ）**: Gmailは許可の無いFromを**拒否せず、黙って
// ログインアカウントのアドレスへ書き換える**。SMTPは 250 OK を返し、送信側からは成功に見える。
// つまり**「送れた」ことは「そのアドレスで届いた」ことを意味しない**。
// 判定できるのは**受信したメールのFromヘッダだけ**なので、このコマンドは
// 「送信まで到達したか」しか言わない。最後は受信箱の差出人表示を人が見る必要がある。
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
    `⚠️  ログインユーザーと差出人が違います（${EXPECTED_SENDER_EMAIL} を名乗る形）。\n` +
      "    Gmail/Workspace では「他のアドレスとしてメールを送信」の認証が要ります。\n" +
      "    **認証が無くても送信は成功します**——Gmailは拒否せず、Fromを黙って\n" +
      `    @${userDomain} のアドレスへ書き換えます（2026-08-27に実際に踏んだ）。\n` +
      "    確かめられるのは受信箱のFromヘッダだけです。",
  );
}

/*
  **差出人と宛先が同じだと届かない**（T-M8-343）。Gmailは自分が送ったメールを自分の
  受信トレイに入れないため、アラートの宛先が差出人と同じだと**異常が起きても気付けない**。
  2026-08-25に同じ罠を踏んでいる。
*/
const alertTo = to;
if (alertTo && alertTo.toLowerCase() === EXPECTED_SENDER_EMAIL.toLowerCase()) {
  console.log(
    `\n❌ 運営者向けアラートの宛先が差出人と同じ（${EXPECTED_SENDER_EMAIL}）です。\n` +
      "    Gmailは自分宛のメールを受信トレイに入れないため、**異常が起きても気付けません**。\n" +
      "    `SUPPORT_EMAIL` には運営者自身の受け取れるアドレス（差出人とは別）を設定してください。",
  );
} else if (alertTo) {
  console.log(`✅ アラートの宛先は差出人と別です`);
}

if (!send) {
  console.log(
    "\n実際にそのアドレスで届くかは、送って**受信箱のFromを見る**まで分かりません。\n" +
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
  console.log(`\n✅ 送信まで到達しました（宛先: ${to}）`);
  console.log("");
  /*
    **ログインしているアドレス自身が差出人なら、書き換えは起きない**（T-M8-353）。
    以前はこの場合でも「書き換えられています」の対処を出しており、
    同じアドレスが2行並ぶ意味の通らない案内になっていた（2026-08-28に実際に出た）。
  */
  if (senderMatchesLogin) {
    console.log(`👉 受信箱の差出人が「${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>」なら設定は正しいです。`);
    console.log(
      "    ログインしているアドレス自身が差出人なので、送信側で書き換えられることはありません。",
    );
    console.log("    届かない場合は迷惑メールに入っていないかを見てください（SPF/DKIMの設定漏れで起きます）。");
  } else {
    console.log("⚠️  **これは「そのアドレスで届いた」ことを意味しません。**");
    console.log(
      `    Gmailは許可の無いFromを拒否せず、黙って @${userDomain} のアドレスへ書き換えます\n` +
        "    （SMTPは 250 OK を返すため、送信側からは成功に見える）。",
    );
    console.log("");
    console.log("👉 受信箱を開き、**差出人の表示**を確かめてください:");
    console.log(`    ・「${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>」→ 設定は正しい`);
    console.log(`    ・「${EXPECTED_SENDER_NAME} <${user}>」→ **書き換えられています**（下の対処が必要）`);
    console.log("");
    console.log("書き換えられていた場合の対処（どちらか）:");
    console.log(
      `    A. Gmail → 設定 → アカウント → 「他のアドレスとしてメールを送信」へ ${EXPECTED_SENDER_EMAIL} を追加し、\n` +
        "       確認コードのメールを受け取って認証する（そのアドレスで受信できることが前提）",
    );
    console.log(
      `    B. ${EXPECTED_SENDER_EMAIL} 自体のSMTP資格情報を SMTP_USER / SMTP_APP_PASSWORD に入れる\n` +
        "       （Google Workspace等でそのアドレスのメールボックスがある場合）",
    );
  }
  if (info.rejected?.length) console.log(`    ⚠️ 拒否された宛先: ${info.rejected.length}件`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ 送信できませんでした: ${message}`);
  if (/not allowed|5\.7\.\d|553|550/i.test(message)) {
    console.error(
      `    **${EXPECTED_SENDER_EMAIL} を名乗る許可がありません**（拒否まで返るのは珍しい形）。\n` +
        "    Gmail → 設定 → アカウント → 「他のアドレスとしてメールを送信」で追加し、\n" +
        "    確認メールのリンクを踏んでから、もう一度実行してください。",
    );
  }
  process.exit(1);
}
