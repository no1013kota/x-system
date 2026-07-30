#!/usr/bin/env node
//
// 運営者向けの状態確認（T-M7-34）。**ログを読まずに「いま何が壊れているか」が分かる**ことが目的。
//
//   npm run doctor                                   # ローカル
//   npm run doctor -- --base https://<staging>       # デプロイ先
//
// 判定と文言は src/lib/ops/diagnostics.ts に集約されている（この script は表示だけ）。
// ローカル基盤の状態（DB接続・未適用migration）だけはアプリを介さず直接見る。
import { readdirSync, readFileSync } from "node:fs";

const MARK = { ok: "✅", warn: "⚠️ ", error: "❌" };

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file, "utf8"));
      if (m?.[1]) return m[1].trim();
    } catch {
      // ファイルが無いのは正常。
    }
  }
  return undefined;
}

const base = (argOf("base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const isLocal = base.includes("127.0.0.1") || base.includes("localhost");
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
  const secret = envValue("CRON_SECRET");
  if (!secret) {
    checks.push({
      name: "データの状態",
      level: "warn",
      detail: "確認用の鍵（CRON_SECRET）が見つからないため確認できません",
      nextAction: "`.env.local` に CRON_SECRET があるか確認してください",
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
          detail: "確認用の鍵が一致しません",
          nextAction: "その環境の CRON_SECRET を指定してください",
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
console.log(`\n■ Space AI の状態（${isLocal ? "ローカル" : base}）\n`);
for (const c of checks) {
  console.log(`${MARK[c.level] ?? "  "} ${c.name}`);
  console.log(`    ${c.detail}`);
  if (c.nextAction) console.log(`    → ${c.nextAction}`);
}

const errors = checks.filter((c) => c.level === "error").length;
const warns = checks.filter((c) => c.level === "warn").length;
console.log(
  `\n${
    errors > 0
      ? `対応が必要な問題が ${errors} 件あります（注意 ${warns} 件）`
      : warns > 0
        ? `すぐ困る問題はありませんが、注意が ${warns} 件あります`
        : `${checks.length} 項目すべて正常です`
  }\n`,
);
process.exit(errors > 0 ? 1 : 0);
