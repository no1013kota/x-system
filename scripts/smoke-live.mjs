#!/usr/bin/env node
//
// 実物スモーク（T-M7-25）。起動中のアプリの `/api/cron/canary` を叩き、結果を整形して返す。
//
//   npm run smoke:live                      # ニュースのみ
//   npm run smoke:live -- --account ai_newinfo   # 生成・画像も含める（Xのユーザー名でよい）
//   npm run smoke:live -- --base https://x-system-stg.vercel.app --account ai_newinfo
//
// 判定は route 側（`src/lib/smoke/scenarios.ts`）にあり、ローカルもデプロイ先も同じものを使う。
// ここはトリガーと表示だけを持つ。**実費が発生し、生成枠も消費する。**
import { argOf, baseUrl, envValue } from "./lib/cli.mjs";

const base = baseUrl();
const account = argOf("account");
const { cronSecretEnvName } = await import("../src/lib/ops/release-gate.ts");
const secretName =
  argOf("secret-env") ??
  cronSecretEnvName(base, {
    stagingBaseUrl: envValue("STAGING_BASE_URL"),
    productionBaseUrl: envValue("PRODUCTION_BASE_URL"),
  });
const secret = envValue(secretName);

if (!secret) {
  console.error(`${secretName} が見つかりません（.env.local / .env / 環境変数）。`);
  console.error(`  ${base} を検証するには、その環境の CRON_SECRET を ${secretName} として置いてください。`);
  console.error("  （鍵は環境ごとに違います。ローカルの鍵ではデプロイ先の認証を通れません）");
  process.exit(2);
}

const url = new URL(`${base}/api/cron/canary`);
if (account) url.searchParams.set("account", account);

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
  console.error(`401: 鍵が一致しません（使用した設定名: ${secretName}）。`);
  console.error(`  ${base} の環境に設定されている CRON_SECRET と同じ値か確認してください。`);
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
  // 生成物の実物を出す。シナリオは下書きを削除するため、ここで見せないと目で確認できない。
  if (r.sample) console.log(r.sample.split("\n").map((line) => `   │ ${line}`).join("\n"));
}
for (const s of body.skipped ?? []) console.log(`⏭️  skip: ${s}`);

console.log(
  `\n合計 $${body.totalCostUsd.toFixed(4)} / ${Math.round((Date.now() - started) / 1000)}秒 → ${
    body.ok ? "全シナリオ成功" : "失敗あり"
  }`,
);
process.exit(body.ok ? 0 : 1);
