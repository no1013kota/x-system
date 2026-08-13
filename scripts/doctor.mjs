#!/usr/bin/env node
//
// 運営者向けの状態確認（T-M7-34）。**ログを読まずに「いま何が壊れているか」が分かる**ことが目的。
//
//   npm run doctor                                   # ローカル
//   npm run doctor -- --base https://<staging>       # デプロイ先
//
// 判定と文言は src/lib/ops/diagnostics.ts に集約されている（この script は表示だけ）。
// ローカル基盤の状態（DB接続・未適用migration）だけはアプリを介さず直接見る。
import { readdirSync } from "node:fs";
import { argOf, baseUrl, envValue } from "./lib/cli.mjs";

const MARK = { ok: "✅", warn: "⚠️ ", error: "❌" };

const base = baseUrl();
const isLocal = base.includes("127.0.0.1") || base.includes("localhost");
const { cronSecretEnvName } = await import("../src/lib/ops/release-gate.ts");
const checks = [];

// --- ローカル基盤（デプロイ先には当てはまらないので飛ばす） ---
if (isLocal) {
  const dbUrl =
    envValue("DATABASE_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  let dbOk = false;
  let applied = new Set();
  try {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
    await client.connect();
    const { rows } = await client.query(
      "select version from supabase_migrations.schema_migrations",
    );
    applied = new Set(rows.map((r) => r.version));
    await client.end();
    dbOk = true;
    checks.push({ name: "データの保存先", level: "ok", detail: "起動しています" });
  } catch (error) {
    checks.push({
      name: "データの保存先",
      level: "error",
      detail: `接続できません（${String(error.message).slice(0, 60)}）`,
      nextAction: "ターミナルで `supabase start` を実行してください",
    });
  }

  if (dbOk) {
    const pending = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0])
      .filter((version) => !applied.has(version));
    checks.push(
      pending.length === 0
        ? { name: "データ構造の更新", level: "ok", detail: "すべて適用済みです" }
        : {
            name: "データ構造の更新",
            level: "error",
            detail: `${pending.length} 件が未適用です`,
            nextAction: "ターミナルで `supabase db reset` を実行してください（ローカルのデータは消えます）",
          },
    );
  }
}

// --- アプリが応答するか ---
let appUp = false;
try {
  const res = await fetch(base, { signal: AbortSignal.timeout(8000) });
  appUp = res.ok;
  checks.push(
    appUp
      ? { name: "アプリ", level: "ok", detail: `応答しています（${base}）` }
      : {
          name: "アプリ",
          level: "error",
          detail: `応答が異常です（${res.status}）`,
          nextAction: isLocal ? "`npm run dev` を再起動してください" : "デプロイの状態を確認してください",
        },
  );
} catch {
  checks.push({
    name: "アプリ",
    level: "error",
    detail: `応答しません（${base}）`,
    nextAction: isLocal
      ? "ターミナルで `npm run dev` を実行してください"
      : "デプロイが完了しているか確認してください",
  });
}

// --- データの状態（アプリ経由。判定はサーバー側と共通） ---
if (appUp) {
  // 鍵は環境ごとに違う。ローカルの鍵でデプロイ先を叩くと401になり、「壊れている」と
  // 見分けがつかない（2026-08-01、staging宛の doctor が実際にそうなった）。
  // 対応表は smoke:live と共通の `cronSecretEnvName`（release-gate.ts）に集約する。
  const secretName = argOf("secret-env") ?? cronSecretEnvName(base, {
    stagingBaseUrl: envValue("STAGING_BASE_URL"),
    productionBaseUrl: envValue("PRODUCTION_BASE_URL"),
  });
  const secret = envValue(secretName);
  if (!secret) {
    checks.push({
      name: "データの状態",
      level: "warn",
      detail: `確認用の鍵（${secretName}）が見つからないため確認できません`,
      nextAction: `\`.env.local\` に ${secretName} があるか確認してください`,
    });
  } else {
    try {
      const res = await fetch(`${base}/api/cron/doctor`, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        checks.push({
          name: "データの状態",
          level: "warn",
          detail: `確認用の鍵（${secretName}）の値が ${isLocal ? "ローカル" : base} 側と一致しません`,
          nextAction: isLocal
            ? "`.env.local` の CRON_SECRET と `npm run dev` の起動時の値をそろえてください"
            : `Vercel のこの環境に設定した CRON_SECRET と同じ値を、\`.env.local\` の ${secretName} へ入れてください`,
        });
      } else if (!body?.checks) {
        checks.push({
          name: "データの状態",
          level: "warn",
          detail: `想定外の応答です（${res.status}）`,
        });
      } else {
        checks.push(...body.checks);
      }
    } catch (error) {
      checks.push({
        name: "データの状態",
        level: "warn",
        detail: `確認できませんでした（${String(error.message).slice(0, 60)}）`,
      });
    }
  }
}

// --- 表示 ---
console.log(`\n■ Exos AI の状態（${isLocal ? "ローカル" : base}）\n`);
for (const c of checks) {
  console.log(`${MARK[c.level] ?? "  "} ${c.name}`);
  console.log(`    ${c.detail}`);
  if (c.nextAction) console.log(`    → ${c.nextAction}`);
}

// まとめ1行と終了コードは `src/lib/ops/check.ts` が正本（この script は表示だけ・R31）。
const { summarize, exitCodeFor } = await import("../src/lib/ops/check.ts");
console.log(`\n${summarize(checks)}\n`);
process.exit(exitCodeFor(checks));
