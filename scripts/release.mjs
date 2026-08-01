#!/usr/bin/env node
//
// リリースを1コマンドへ畳む（T-M7-35・CLAUDE.md 原則3）。
//
//   npm run release:staging      # stg → staging
//   npm run release:production    # main → production
//
// `deployment.md` の手順は24ステップあり、**migration適用を飛ばすとX連携が internal_error で
// 壊れる**。この「忘れたら壊れる」を記憶に依存させないため、順番をコマンドが強制する。
//
// 判定は `src/lib/ops/release-gate.ts`（純粋関数・単体テストあり）。ここは実際のコマンド実行と
// 日本語の表示だけを担う。**止まったら理由と次の一手を出して終わる**（黙って進めない）。
//
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const target = process.argv[2] === "production" ? "production" : "staging";
const apply = process.argv.includes("--apply");

function sh(cmd, { allowFail = false } = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFail) return "";
    throw error;
  }
}

// --- 判定の材料を集める ---

const expectedBranch = target === "staging" ? "stg" : "main";
const currentBranch = sh("git rev-parse --abbrev-ref HEAD");
const dirty = sh("git status --porcelain") !== "";
const unpushed = Number(
  sh(`git rev-list --count origin/${expectedBranch}..${expectedBranch}`, { allowFail: true }) || "0",
);

/** GitHub Actions の結論（gh CLI が無い/未認証なら null）。 */
function ciConclusion() {
  const raw = sh(
    `gh run list --branch ${expectedBranch} --limit 1 --json status,conclusion 2>/dev/null`,
    { allowFail: true },
  );
  if (!raw) return null;
  try {
    const runs = JSON.parse(raw);
    if (!Array.isArray(runs) || runs.length === 0) return null;
    const run = runs[0];
    return run.status === "completed" ? run.conclusion : run.status;
  } catch {
    return null;
  }
}

/** 未適用のmigration（`supabase migration list --linked` の出力から Local/Remote の差を読む）。 */
function unappliedMigrations() {
  const local = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.split("_")[0]);
  const raw = sh("supabase migration list --linked 2>/dev/null", { allowFail: true });
  if (!raw) return { list: local, linked: false };
  // 出力例: "  20260720000001 | 20260720000001 | 2026-07-20 ..." （Local | Remote | 時刻）
  const appliedRemote = new Set(
    raw
      .split("\n")
      .map((line) => line.split("|").map((c) => c.trim()))
      .filter((cols) => cols.length >= 2 && /^\d{14}$/.test(cols[1]))
      .map((cols) => cols[1]),
  );
  return { list: local.filter((v) => !appliedRemote.has(v)), linked: true };
}

/** 反映先URL。`-- --base <URL>` が最優先、無ければ環境変数。 */
const baseUrl = (() => {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return (target === "staging" ? process.env.STAGING_BASE_URL : process.env.PRODUCTION_BASE_URL) ?? "";
})();

/** 検証に使うXアカウント。`-- --account <uuid>` が最優先、無ければ環境変数。 */
const smokeAccount = (() => {
  const i = process.argv.indexOf("--account");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.SMOKE_X_ACCOUNT_ID ?? "";
})();

const { list: unapplied, linked } = unappliedMigrations();

const { evaluateReleaseGate, firstStop, onlyMigrationsPending, summarizeGate } = await import(
  "../src/lib/ops/release-gate.ts"
).catch(async () => {
  // TypeScript を直接 import できない実行環境向けのフォールバック（tsx等が無い場合）。
  console.error("release: 判定モジュールを読み込めませんでした。`npx tsx scripts/release.mjs` で実行してください。");
  process.exit(2);
});

const steps = evaluateReleaseGate({
  target,
  expectedBranch,
  currentBranch,
  dirty,
  unpushed,
  ciConclusion: ciConclusion(),
  unappliedMigrations: unapplied,
  baseUrl,
});

// --- 表示 ---

console.log(`\n■ ${target} への反映（${expectedBranch} ブランチ）\n`);
for (const step of steps) {
  console.log(`${step.level === "ok" ? "✅" : "❌"} ${step.name}`);
  console.log(`    ${step.detail}`);
  if (step.nextAction) console.log(`    → ${step.nextAction}`);
}
if (!linked) {
  console.log("\n⚠️  Supabase プロジェクトへ未接続のため、未適用migrationは「ローカルの全件」として扱いました。");
  console.log("    `supabase link --project-ref <ref>` で接続すると正確に判定できます。");
}

const stop = firstStop(steps);
if (!stop) {
  console.log(`\n${summarizeGate(steps)}。`);
} else if (onlyMigrationsPending(steps) && apply) {
  console.log("\n未適用のmigrationを適用します（--apply 指定あり）…");
  try {
    execSync("supabase db push --linked", { stdio: "inherit" });
  } catch {
    console.error("\n❌ migrationの適用に失敗しました。反映を中止します（未適用のまま進めません）。");
    process.exit(1);
  }
  console.log("✅ 適用しました。もう一度このコマンドを実行して、残りの確認を通してください。");
  process.exit(0);
} else {
  console.log(`\n${summarizeGate(steps)}`);
  if (onlyMigrationsPending(steps)) {
    console.log("適用してよければ `-- --apply` を付けて実行してください。");
  }
  process.exit(1);
}

// --- デプロイ後の検証（ここまで来たら全部通っている） ---

console.log("\n■ デプロイ後の検証");
console.log(`実物スモークを ${baseUrl} に対して実行します（実費 約$0.30・要 xAccountId）。`);
const args = [`--base ${baseUrl}`, smokeAccount ? `--account ${smokeAccount}` : ""]
  .filter(Boolean)
  .join(" ");
if (!smokeAccount) {
  console.log("⚠️  SMOKE_X_ACCOUNT_ID が未設定のため、ニュース取得だけを検証します。");
}
try {
  execSync(`node scripts/smoke-live.mjs ${args}`, { stdio: "inherit" });
} catch {
  console.error("\n❌ デプロイ後の検証で失敗しました。ロールバックの判断は deployment.md §8 を見てください。");
  process.exit(1);
}
console.log(`\n✅ ${target} への反映と検証が完了しました。`);
