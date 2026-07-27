#!/usr/bin/env node
//
// 実物スモーク（T-M7-25）。起動中のアプリの `/api/cron/canary` を叩き、結果を整形して返す。
//
//   npm run smoke:live                      # ニュースのみ
//   npm run smoke:live -- --account <uuid>  # 生成・画像も含める
//   npm run smoke:live -- --base https://x-system-stg.vercel.app --account <uuid>
//
// 判定は route 側（`src/lib/smoke/scenarios.ts`）にあり、ローカルもデプロイ先も同じものを使う。
// ここはトリガーと表示だけを持つ。**実費が発生し、生成枠も消費する。**
import { readFileSync } from "node:fs";

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** CRON_SECRET は .env.local → .env → 環境変数の順で探す（値は出力しない）。 */
function cronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  for (const file of [".env.local", ".env"]) {
    try {
      const m = /^CRON_SECRET=(.*)$/m.exec(readFileSync(file, "utf8"));
      if (m?.[1]) return m[1].trim();
    } catch {
      // ファイルが無いのは正常。次の候補へ。
    }
  }
  return undefined;
}

const base = (argOf("base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const account = argOf("account");
const secret = cronSecret();

if (!secret) {
  console.error("CRON_SECRET が見つかりません（.env.local / .env / 環境変数）。");
  process.exit(2);
}

const url = new URL(`${base}/api/cron/canary`);
if (account) url.searchParams.set("xAccountId", account);

console.log(`実物スモークを実行します: ${base}${account ? "" : "（生成系はskip: --account 未指定）"}`);
console.log("実APIを叩くため費用が発生します。数十秒かかります。\n");

const started = Date.now();
let res;
try {
  res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
} catch (error) {
  console.error(`接続できません（${base}）: ${error.message}`);
  console.error("ローカルなら `npm run dev` が起動しているか確認してください。");
  process.exit(2);
}

if (res.status === 401) {
  console.error("401: CRON_SECRET が一致しません。");
  process.exit(2);
}

const body = await res.json().catch(() => null);
if (!body?.results) {
  console.error(`想定外の応答（status=${res.status}）:`, String(body).slice(0, 300));
  process.exit(2);
}

for (const r of body.results) {
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}`);
  console.log(`   ${r.detail}  ($${r.costUsd.toFixed(4)})`);
  if (r.warning) console.log(`   ⚠️  ${r.warning}`);
}
for (const s of body.skipped ?? []) console.log(`⏭️  skip: ${s}`);

console.log(
  `\n合計 $${body.totalCostUsd.toFixed(4)} / ${Math.round((Date.now() - started) / 1000)}秒 → ${
    body.ok ? "全シナリオ成功" : "失敗あり"
  }`,
);
process.exit(body.ok ? 0 : 1);
