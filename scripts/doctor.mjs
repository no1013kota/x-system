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
const { projectRefFromCsp } = await import("../src/lib/ops/release-gate.ts");
const { AUTH_TOKEN_ENV, judgeAuthUrls, parseAllowList, unknownAuthUrls } = await import(
  "../src/lib/ops/auth-url-status.ts"
);
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

  /*
    **ローカルの確認メールの行き先**（T-M8-136・運営者の報告 2026-08-18）。

    ローカルのSupabaseは確認メールを実際のメールボックスへ送らず、Mailpit（メール受信箱の
    ふりをするツール）が全部受け取る。**これを知らないと「メールが届かない＝壊れている」
    と見える**（実際に運営者がそう報告した）。届いているのかどうかと、どこで読めるのかを
    ここで必ず出す。ログを読ませない（原則2）。
  */
  /*
    **溜まったテストデータ**（T-M8-137）。E2Eは終了時に自分の作成分を消すが、
    途中で落ちた回の分は残る。active なXアカウントが溜まると、全アカウントを走査する処理
    （metrics-collector 等）のDBテストが件数上限に触れて落ち始め、**コードの不具合と
    見分けがつかない**（実際に、原因の分からない単発失敗として4回observedした・当時は
    follower-snapshot の走査上限100で発生。T-M8-255でバッチ自体は廃止済み）。掃除する導線を出す。
  */
  if (dbOk) {
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
      await client.connect();
      const { rows } = await client.query(
        `select count(*)::int as active from x_accounts where status = 'active'`,
      );
      await client.end();
      const active = rows[0]?.active ?? 0;
      // 100は掃除を促すしきい値（旧 FOLLOWER_ACCOUNT_LIMIT 由来。溜まるほどDBテストが不安定になる）。
      const LIMIT = 100;
      checks.push(
        active < LIMIT
          ? {
              name: "溜まったテストデータ",
              level: "ok",
              detail: `activeなXアカウントは ${active} 件（上限 ${LIMIT}）`,
            }
          : {
              name: "溜まったテストデータ",
              level: "error",
              detail:
                `activeなXアカウントが ${active} 件で走査上限 ${LIMIT} を超えています。` +
                "**この状態ではDBテストが落ち始め、コードの不具合と見分けがつきません**",
              nextAction: "`npm run db:clean-test-data -- --apply` を実行してください（実アカウントには触れません）",
            },
      );
    } catch {
      // 数えられないだけなら他の検査を止めない。
    }
  }

  const MAILPIT = "http://127.0.0.1:54324";
  try {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=1`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    const total = Number(body.total ?? 0);
    checks.push({
      name: "確認メールの行き先（ローカル）",
      level: "ok",
      detail:
        `Mailpit が受け取っています（現在 ${total} 通）。` +
        "**ローカルでは実際のメールボックスへ送られません**",
      nextAction: `6桁コードは ${MAILPIT} を開いて確認してください`,
    });
  } catch {
    checks.push({
      name: "確認メールの行き先（ローカル）",
      level: "error",
      detail: `Mailpit（${MAILPIT}）に接続できません。**新規登録の6桁コードを読む手段がありません**`,
      nextAction: "ターミナルで `supabase start` を実行してください",
    });
  }
}

// --- アプリが応答するか ---
let appUp = false;
// 反映先がどのSupabaseプロジェクトを使っているかはCSPヘッダから読める（release-gate と同じ手）。
let appCsp = null;
try {
  const res = await fetch(base, { signal: AbortSignal.timeout(8000) });
  appUp = res.ok;
  appCsp = res.headers.get("content-security-policy");
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

/**
 * 登録・再設定メールの行き先（T-M8-90）。
 *
 * **ローカルは対象外**。`supabase/config.toml` がリポジトリにあり設定はコードから読めるので、
 * 「コードに現れない設定」の問題が起きない。デプロイ先だけ Management API で確かめる。
 */
async function authUrlCheck() {
  const token = envValue(AUTH_TOKEN_ENV);
  if (!token) return unknownAuthUrls(`${AUTH_TOKEN_ENV} が見つかりません`);
  const ref = projectRefFromCsp(appCsp);
  if (!ref) return unknownAuthUrls("反映先が使うSupabaseプロジェクトを特定できません");
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      return unknownAuthUrls(`${AUTH_TOKEN_ENV} でこのプロジェクトを読めません（${res.status}）`);
    }
    if (!res.ok) return unknownAuthUrls(`Supabaseの応答が異常です（${res.status}）`);
    const body = await res.json();
    return judgeAuthUrls({
      appBaseUrl: base,
      // 確認メールのリンクに token_hash が付いているか（T-M8-120）。URLの許可リストが
      // 正しくても、テンプレートが既定のままなら利用者は登録を完了できない。
      confirmationTemplate: body.mailer_templates_confirmation_content ?? "",
      siteUrl: body.site_url ?? null,
      smtpHost: body.smtp_host ?? null,
      // 差出人名（T-M8-136）。既定のままだと見知らぬ差出人から6桁コードが届く。
      smtpSenderName: body.smtp_sender_name ?? null,
      uriAllowList: parseAllowList(body.uri_allow_list),
    });
  } catch (error) {
    return unknownAuthUrls(String(error.message).slice(0, 60));
  }
}

if (appUp && !isLocal) {
  checks.push(await authUrlCheck());
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
