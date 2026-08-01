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

/**
 * **いまのコミット（HEAD）に対する** GitHub Actions の結論（gh が無い/未認証/未実行なら null）。
 *
 * ブランチの「最新の実行」を見てはいけない。pushした直後にCIがまだ始まっていないと、**1つ前の
 * コミットの緑を自分の緑と誤認する**（2026-08-01に実装の穴として発見）。そのまま反映すると
 * 「CIを通っていないコミットが本番へ出る」ことになる。SHAで突き合わせる。
 */
function ciConclusion() {
  const head = sh("git rev-parse HEAD", { allowFail: true });
  if (!head) return null;
  const raw = sh(
    `gh run list --branch ${expectedBranch} --limit 20 --json headSha,status,conclusion 2>/dev/null`,
    { allowFail: true },
  );
  if (!raw) return null;
  try {
    const runs = JSON.parse(raw);
    if (!Array.isArray(runs)) return null;
    const run = runs.find((r) => r.headSha === head);
    if (!run) return null; // このコミットのCIはまだ無い＝止める
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

  // CLIのバージョンで出力形式が変わる。**両方に対応する**。
  // 誤って「未適用」と読むと、適用済みなのに永久に先へ進めなくなる（2026-08-01に実際に発生）。
  const appliedRemote = parseAppliedRemote(raw);
  if (appliedRemote === null) {
    // 解釈できない出力。**適用済みと決めつけない**（安全側＝未適用として止める）。
    console.error("release: migrationの一覧を解釈できませんでした。出力の先頭:");
    console.error(`  ${raw.split("\n").slice(0, 2).join(" / ").slice(0, 200)}`);
    return { list: local, linked: false };
  }
  return { list: local.filter((v) => !appliedRemote.has(v)), linked: true };
}


/** 反映先URL。`-- --base <URL>` が最優先、無ければ環境変数。 */
const baseUrl = (() => {
  const i = process.argv.indexOf("--base");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return (target === "staging" ? process.env.STAGING_BASE_URL : process.env.PRODUCTION_BASE_URL) ?? "";
})();

/** 検証に使うXアカウント。`-- --account <Xのユーザー名 または UUID>` が最優先、無ければ環境変数。 */
const smokeAccount = (() => {
  const i = process.argv.indexOf("--account");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.SMOKE_X_ACCOUNT_ID ?? "";
})();

// 判定ロジックは純粋関数側（単体テストあり）。migrationの解釈にも使うので先に読み込む。
const { evaluateReleaseGate, firstStop, onlyMigrationsPending, parseAppliedRemote, summarizeGate } =
  await import("../src/lib/ops/release-gate.ts").catch(async () => {
  // TypeScript を直接 import できない実行環境向けのフォールバック（tsx等が無い場合）。
  console.error("release: 判定モジュールを読み込めませんでした。`npx tsx scripts/release.mjs` で実行してください。");
  process.exit(2);
});

const { list: unapplied, linked } = unappliedMigrations();


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

// 1) 人間確認（Turnstile）。費用ゼロなので先に見る。**壊れていると誰もログインできない**。
//    許可ドメインは Cloudflare 側の設定で、モックしたテストでは原理的に検出できない（T-M7-48）。
let turnstileOk = true;
console.log("\n[1/2] 人間確認（Turnstile）");
try {
  execSync(
    `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-turnstile.mjs --base ${baseUrl}`,
    { stdio: "inherit" },
  );
} catch {
  turnstileOk = false;
}

console.log("\n[2/2] 実物スモーク");
console.log(`${baseUrl} に対して実行します（実費 約$0.30・要 Xアカウントの指定）。`);
const args = [`--base ${baseUrl}`, smokeAccount ? `--account ${smokeAccount}` : ""]
  .filter(Boolean)
  .join(" ");
if (!smokeAccount) {
  console.log("⚠️  検証するXアカウントの指定が無いため、ニュース取得だけを検証します。");
  console.log("    生成・画像も見るには `-- --account <Xのユーザー名>`（または SMOKE_X_ACCOUNT_ID）を渡してください。");
}
let smokeOk = true;
try {
  execSync(`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/smoke-live.mjs ${args}`, {
    stdio: "inherit",
  });
} catch {
  smokeOk = false;
}

// 片方で止めず、両方の結果を出してから判断を求める（CLAUDE.md 原則5）。
if (turnstileOk && smokeOk) {
  console.log(`\n✅ ${target} への反映と検証が完了しました。`);
} else {
  console.error("\n❌ デプロイ後の検証で問題が見つかりました:");
  if (!turnstileOk) {
    console.error("  - 人間確認（Turnstile）: 上の指示どおり設定を直してください（ログイン・新規登録が止まります）");
  }
  if (!smokeOk) {
    console.error("  - 実物スモーク: ロールバックの判断は deployment.md §8 を見てください");
  }
  process.exit(1);
}
