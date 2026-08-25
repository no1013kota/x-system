// 招待プログラムを運営者が止める／戻す道具（要決定D-40・T-M8-302・原則2「画面かコマンド1つ」）。
//
//   npm run affiliate:moderate                        … 停止中の招待者・保留中の報酬を一覧
//   npm run affiliate:moderate -- --suspend <code>    … 招待者を停止（新しい帰属・新しい報酬が止まる）
//   npm run affiliate:moderate -- --activate <code>   … 停止を解除
//   npm run affiliate:moderate -- --hold <報酬id>     … 1件の報酬を保留（振込に束ねられなくなる）
//   npm run affiliate:moderate -- --release <報酬id>  … 保留を解除
//
// **止めても既にある報酬は消えない。** 停止は「これ以上増やさない」であって、
// 確定した分の取り上げではない（取り上げが要るなら --hold で1件ずつ止める）。
// 不正が疑われるときに、DBを直接触らずその場で止められることが目的。
import pg from "pg";

// 表示前に制御文字を落とす（DBに紛れても端末を偽装させない・多層防御）。
const clean = (value) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f\u2066-\u2069\u202a-\u202e]/g, "");
const yen = (n) => `¥${Number(n).toLocaleString("ja-JP")}`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const suspend = flag("suspend");
  const activate = flag("activate");
  const hold = flag("hold");
  const release = flag("release");

  if (suspend || activate) {
    const code = String(suspend ?? activate).toLowerCase();
    const next = suspend ? "suspended" : "active";
    const { rows } = await client.query(
      `update affiliate_accounts set status = $2 where code = $1 returning id, status`,
      [code, next],
    );
    if (rows.length === 0) {
      console.log(`招待コード ${clean(code)} が見つかりません。`);
      process.exitCode = 1;
    } else if (suspend) {
      console.log(`✅ ${clean(code)} を停止しました。新しい帰属と新しい報酬が止まります。`);
      console.log("   既にある報酬は残ります（1件ずつ止めるなら --hold <報酬id>）。");
    } else {
      console.log(`✅ ${clean(code)} の停止を解除しました。`);
    }
  } else if (hold || release) {
    const id = String(hold ?? release);
    if (hold) {
      // 保留にできるのは**まだ払っていない**もの（paid には触らない）。
      const { rows } = await client.query(
        `update affiliate_commissions
            set status = 'held', payout_id = null
          where id = $1 and status in ('pending', 'payable')
          returning commission_amount`,
        [id],
      );
      if (rows.length === 0) {
        console.log("対象がありません（IDの誤り、または既に支払済み・取消済み）。");
        process.exitCode = 1;
      } else {
        console.log(
          `✅ ${yen(rows[0].commission_amount)} の報酬を保留しました（振込に束ねられません）。`,
        );
      }
    } else {
      /*
        保留の解除は**確認期間の経過で行き先を決める**（`available_at` を過ぎていれば payable、
        まだなら pending）。一律 payable にすると、確認期間中の報酬を先に払えてしまう。
      */
      const { rows } = await client.query(
        `update affiliate_commissions
            set status = case when available_at <= now() then 'payable' else 'pending' end
          where id = $1 and status = 'held'
          returning status, commission_amount`,
        [id],
      );
      if (rows.length === 0) {
        console.log("対象がありません（IDの誤り、または保留中ではありません）。");
        process.exitCode = 1;
      } else {
        console.log(
          `✅ 保留を解除しました（${clean(rows[0].status)}・${yen(rows[0].commission_amount)}）。`,
        );
      }
    }
  } else {
    const suspended = await client.query(
      `select a.code, a.id, u.email
         from affiliate_accounts a
         join auth.users u on u.id = a.user_id
        where a.status <> 'active'
        order by a.created_at`,
    );
    console.log(`■ 停止中の招待者: ${suspended.rows.length}件`);
    for (const r of suspended.rows) {
      console.log(`   ${clean(r.code)}  ${clean(r.email)}  (${r.id})`);
    }
    const held = await client.query(
      `select c.id, c.commission_amount, a.code
         from affiliate_commissions c
         join affiliate_accounts a on a.id = c.affiliate_account_id
        where c.status = 'held'
        order by c.created_at`,
    );
    console.log(`\n■ 保留中の報酬: ${held.rows.length}件`);
    for (const r of held.rows) {
      console.log(`   ${r.id}  ${yen(r.commission_amount)}  招待コード ${clean(r.code)}`);
    }
    if (suspended.rows.length === 0 && held.rows.length === 0) {
      console.log("\n止めているものはありません。");
    }
    console.log("\n止めるとき: npm run affiliate:moderate -- --suspend <招待コード>");
    console.log("1件だけ止めるとき: npm run affiliate:moderate -- --hold <報酬id>");
  }
} finally {
  await client.end();
}
