#!/usr/bin/env node
//
// 依存監査ゲート（要件01 §8, T-M6-20 / T-M7-13）。
//
// 判定は **本番依存（--omit=dev）** に対して行う:
//   - critical は必ず失敗（allowlist に関わらず）
//   - high は allowlist 外なら失敗
//   - moderate / low は報告のみ
// devDependencies だけに存在する脆弱性は利用者へ配布されないため、件数の報告に留める。
//
// registry が使えないときは bulk advisory endpoint へ直接問い合わせてフォールバックする
// （2026-07-26: npm の audit が Content-Encoding 無しの gzip 応答を解釈できず失敗する事象を確認）。
// 監査結果を取得できなければ **必ず exit 2 で止める**（「0件」と誤認して素通りさせない）。
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const LOCK_FILE = new URL("../package-lock.json", import.meta.url);
const ALLOWLIST_FILE = new URL("./audit-allowlist.json", import.meta.url);

/*
  **package-lock.json が無ければ、監査の前に止める**（T-M8-434）。
  `npm audit` も下のフォールバックも lock を読むので、無いと「監査レポートを返しませんでした…
  フォールバックも失敗しました: ENOENT」という2段の失敗文だけが出て、次の一手が読めない
  （このスクリプトは配布キットにそのまま同梱され、npm install 前のプロジェクトで実測した）。
*/
if (!existsSync(LOCK_FILE)) {
  console.error("audit-check: package-lock.json がありません。`npm install` を1回実行して作ってください");
  console.error("  （pnpm / yarn のプロジェクトではこの検査は使えません。その場合は package.json の scripts から audit:check を消してください）");
  process.exit(2);
}

/**
 * 既知 high のうち、対応に追加検証が要るもの（要決定で追跡する）。critical には適用しない。
 *
 * 一覧は隣の `audit-allowlist.json`（`{ "<package>": "<なぜ今直さないか>" }`）。**理由の無い項目は受け付けない。**
 * ファイルが無ければ「何も許さない」（最も厳しい側に倒す）。
 * このスクリプトは配布キット（`npm run dev-kit`）に同梱するため、本リポジトリ固有の一覧を
 * コードの外へ出した（キットには空の一覧を添える）。
 *
 * 経緯: sharp / postcss / next は 2026-08-01（T-M7-32）に解消した。sharp は 0.35.3 へ上げ、
 * next が optionalDependencies で pin する nested 0.34.5 も package.json の overrides で 0.35.3 へ寄せた
 * （0.34 系のままでは libvips CVE群が残る）。postcss も overrides で 8.5.x へ寄せ、next のビルドが
 * 通ることを実測して確認した。
 */
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Map();
  const raw = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    console.error("audit-check: audit-allowlist.json は { \"<package>\": \"<理由>\" } の形にしてください");
    process.exit(2);
  }
  for (const [name, why] of Object.entries(raw)) {
    if (typeof why !== "string" || why.trim() === "") {
      console.error(`audit-check: audit-allowlist.json の "${name}" に「なぜ今直さないか」を書いてください`);
      process.exit(2);
    }
  }
  return new Map(Object.entries(raw));
}
const HIGH_ALLOWLIST = loadAllowlist();

const BULK_ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"];

function runAudit(extraArgs = "") {
  try {
    // vuln があると npm audit は非0終了するが JSON は stdout に出る。
    return execSync(`npm audit --json ${extraArgs}`.trim(), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const out = err.stdout ? err.stdout.toString() : "";
    if (out) return out;
    throw err;
  }
}

function parseAudit(extraArgs) {
  try {
    return JSON.parse(runAudit(extraArgs));
  } catch {
    return null;
  }
}

/**
 * registry がエラーを返すと npm は `{ "message": ..., "error": {...} }` を stdout へ出す。
 * これも valid JSON なので、監査レポートの体裁を確認しないと「脆弱性0件」に見えてしまう。
 */
function looksLikeReport(audit) {
  const counts = audit?.metadata?.vulnerabilities;
  return (
    audit?.auditReportVersion !== undefined &&
    counts !== null &&
    typeof counts === "object" &&
    typeof counts.total === "number"
  );
}

/** package-lock.json のインストール済みパッケージを {name: [version]} にする。 */
function lockedPackages({ productionOnly }) {
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  const byName = new Map();
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith("node_modules/") || !info.version) continue;
    if (productionOnly && (info.dev || info.devOptional)) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const versions = byName.get(name) ?? new Set();
    versions.add(info.version);
    byName.set(name, versions);
  }
  return Object.fromEntries([...byName].map(([n, v]) => [n, [...v]]));
}

/**
 * `npm audit` が使えないときのフォールバック。npm と違い依存元への伝播は行わず、
 * 実際に advisory を持つパッケージだけを報告する（ゲート判定には十分）。
 */
async function auditViaBulkEndpoint() {
  const packages = lockedPackages({ productionOnly: true });
  const names = Object.keys(packages);
  const found = {};
  const BATCH = 250;
  for (let i = 0; i < names.length; i += BATCH) {
    const body = {};
    for (const n of names.slice(i, i + BATCH)) body[n] = packages[n];
    const res = await fetch(BULK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bulk endpoint ${res.status}`);
    const raw = Buffer.from(await res.arrayBuffer());
    // この endpoint は Content-Encoding を付けずに gzip 本文を返すことがある。
    const text =
      raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    if (!text.trim()) continue;
    Object.assign(found, JSON.parse(text));
  }
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const vulnerabilities = {};
  for (const [name, advisories] of Object.entries(found)) {
    let worst = "info";
    for (const a of advisories) {
      if (SEVERITY_ORDER.indexOf(a.severity) > SEVERITY_ORDER.indexOf(worst)) worst = a.severity;
    }
    vulnerabilities[name] = { severity: worst };
    counts[worst] += 1;
    counts.total += 1;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: counts },
    viaFallback: true,
  };
}

// --- 本番依存の監査（判定対象） ---
let prod = parseAudit("--omit=dev");
if (!looksLikeReport(prod)) {
  console.warn(
    `audit-check: npm audit が監査レポートを返しませんでした（${
      prod?.message ?? "metadata.vulnerabilities がありません"
    }）。bulk advisory endpoint へ直接問い合わせます。`,
  );
  try {
    prod = await auditViaBulkEndpoint();
  } catch (err) {
    console.error(`audit-check: フォールバックも失敗しました: ${err.message}`);
    process.exit(2);
  }
}

const counts = prod.metadata?.vulnerabilities ?? {};
const via = prod.viaFallback ? "（bulk endpoint 直接問い合わせ）" : "";
console.log(
  `audit${via} 本番依存: critical=${counts.critical ?? 0} high=${counts.high ?? 0} ` +
    `moderate=${counts.moderate ?? 0} low=${counts.low ?? 0}`,
);

// dev だけの脆弱性は配布されないため、参考として件数だけ出す（取得できたときのみ）。
const all = parseAudit("");
if (looksLikeReport(all)) {
  const a = all.metadata.vulnerabilities;
  console.log(
    `（参考）dev込み: critical=${a.critical} high=${a.high} moderate=${a.moderate} low=${a.low}`,
  );
}

const blocking = [];
for (const [name, info] of Object.entries(prod.vulnerabilities ?? {})) {
  if (info.severity === "critical") blocking.push(`${name} (critical)`);
  else if (info.severity === "high" && !HIGH_ALLOWLIST.has(name)) blocking.push(`${name} (high)`);
}

if (blocking.length > 0) {
  console.error("audit-check FAILED — allowlist 外の high/critical（本番依存）:");
  for (const b of blocking) console.error(`  - ${b}`);
  console.error("修正するか、breaking upgrade を要決定で合意のうえ scripts/audit-allowlist.json へ理由付きで足してください。");
  process.exit(1);
}

console.log("audit-check OK");
for (const [name, why] of HIGH_ALLOWLIST) {
  if (prod.vulnerabilities?.[name]) console.log(`  allowlisted high: ${name} — ${why}`);
}
