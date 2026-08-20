// 招待報酬の振込を運営者が1コマンドで進める道具（T-M8-174・原則2「画面かコマンド1つ」）。
//
//   npm run affiliate:payouts                 … 未払いPayoutの一覧（振込先・金額・期限）
//   npm run affiliate:payouts -- --show <id>  … 1件の詳細＋口座番号の全桁（振込作業用に復号）
//   npm run affiliate:payouts -- --paid <id>  … 振込完了を記録（束ねた報酬もpaidへ）
//
// 口座番号はAES-256-GCM暗号文で保存されており（要決定D-33）、全桁は --show でだけ表示する。
import { createDecipheriv } from "node:crypto";

import pg from "pg";

function resolveKey(rawKey) {
  const candidates = [];
  if (Buffer.byteLength(rawKey, "utf8") === 32) candidates.push(Buffer.from(rawKey, "utf8"));
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) candidates.push(Buffer.from(rawKey, "hex"));
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)) {
    const decoded = Buffer.from(rawKey, "base64");
    if (decoded.length === 32) candidates.push(decoded);
  }
  const key = candidates.find((b) => b.length === 32);
  if (!key) throw new Error("APP_ENCRYPTION_KEY が32バイトに解決できません。");
  return key;
}

function decrypt(serialized, key) {
  const env = JSON.parse(serialized);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.n, "base64"));
  decipher.setAuthTag(Buffer.from(env.t, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(env.c, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const showId = flag("show");
  const paidId = flag("paid");

  if (paidId) {
    const updated = await client.query(
      `update affiliate_payouts
          set status = 'paid', paid_at = now(), updated_at = now()
        where id = $1 and status = 'created' returning id`,
      [paidId],
    );
    if (updated.rowCount === 0) {
      console.log("対象がありません（IDの誤り、または既に支払済み）。");
    } else {
      await client.query(`update affiliate_commissions set status = 'paid' where payout_id = $1`, [paidId]);
      console.log(`✅ ${paidId} を支払済みにしました（束ねた報酬もpaidへ）。`);
    }
  } else if (showId) {
    const { rows } = await client.query(
      `select p.id, p.gross_amount, p.fee_amount, p.net_amount, p.payment_due_at,
              a.bank_name, a.branch_name, a.account_type, a.account_number_ciphertext,
              a.account_holder_name, u.email
         from affiliate_payouts p
         join affiliate_accounts acc on acc.id = p.affiliate_account_id
         join auth.users u on u.id = acc.user_id
         left join affiliate_payout_accounts a on a.affiliate_account_id = p.affiliate_account_id
        where p.id = $1`,
      [showId],
    );
    if (rows.length === 0) {
      console.log("対象がありません。");
    } else {
      const r = rows[0];
      const key = resolveKey(process.env.APP_ENCRYPTION_KEY ?? "");
      const number = r.account_number_ciphertext
        ? decrypt(r.account_number_ciphertext, key)
        : "（口座未登録）";
      console.log(`利用者: ${r.email}`);
      console.log(`振込額: ¥${r.net_amount}（報酬¥${r.gross_amount} − 手数料¥${r.fee_amount}）`);
      console.log(`期限: ${new Date(r.payment_due_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
      console.log(`振込先: ${r.bank_name} ${r.branch_name} ${r.account_type === "ordinary" ? "普通" : "当座"} ${number}`);
      console.log(`名義: ${r.account_holder_name}`);
      console.log(`\n振込が済んだら: npm run affiliate:payouts -- --paid ${showId}`);
    }
  } else {
    const { rows } = await client.query(
      `select p.id, p.net_amount, p.payment_due_at, p.period_start, u.email
         from affiliate_payouts p
         join affiliate_accounts acc on acc.id = p.affiliate_account_id
         join auth.users u on u.id = acc.user_id
        where p.status = 'created'
        order by p.payment_due_at asc`,
    );
    if (rows.length === 0) {
      console.log("未払いの振込はありません。");
    } else {
      console.log(`未払いの振込 ${rows.length}件:\n`);
      for (const r of rows) {
        const due = new Date(r.payment_due_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
        console.log(`  ${r.id}  ¥${r.net_amount}  期限 ${due}  ${r.email}`);
      }
      console.log(`\n詳細と口座番号: npm run affiliate:payouts -- --show <id>`);
    }
  }
} finally {
  await client.end();
}
