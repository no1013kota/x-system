#!/usr/bin/env node
//
// 依存監査ゲート（要件01 §8, T-M6-20）。`npm audit --json` を解析し:
//   - critical は必ず失敗（allowlist に関わらず）
//   - high は allowlist 外なら失敗
//   - moderate / low は報告のみ（ゲートしない）
// allowlist（postcss / sharp）は upgrade に追加検証が要る既知の high で、tasks/BACKLOG.md の
// 「要決定」D-7 で追跡する。新規の high/critical はここで release を止める。
//
// ネットワーク（registry）が必要。CI では利用可能。ローカル検証時も registry へ到達できること。
import { execSync } from "node:child_process";

// 既知 high のうち、対応に追加検証が要るもの（要決定 D-7 で追跡）。critical には適用しない。
//   sharp   : 0.34→0.35 の breaking upgrade（libvips CVE群）。画像正規化の再検証が必要。
//   postcss : next が pin する nested 8.4.31。next を上げても解消しないため next 側の修正待ち。
// next は 16.2.12 で解消済みのため allowlist から外した（再発したらここで止まる）。
const HIGH_ALLOWLIST = new Set(["postcss", "sharp"]);

function runAudit() {
  try {
    // vuln があると npm audit は非0終了するが JSON は stdout に出る。
    return execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const out = err.stdout ? err.stdout.toString() : "";
    if (out) return out;
    throw err;
  }
}

let audit;
try {
  audit = JSON.parse(runAudit());
} catch (err) {
  console.error(`audit-check: npm audit を実行/解析できませんでした（registry 到達不可の可能性）: ${err.message}`);
  process.exit(2);
}

// registry がエラーを返すと npm は `{ "message": ..., "error": {...} }` を stdout へ出す。
// これも valid JSON なので、監査結果として扱うと「脆弱性0件」に見えてゲートを素通りする。
// 監査レポートの体裁（auditReportVersion と metadata.vulnerabilities の件数）を必ず確認する。
const counts = audit?.metadata?.vulnerabilities;
const looksLikeReport =
  audit?.auditReportVersion !== undefined &&
  counts !== null &&
  typeof counts === "object" &&
  typeof counts.total === "number";
if (!looksLikeReport) {
  console.error(
    `audit-check: npm audit が監査レポートを返しませんでした（registry エラーの可能性）: ${
      audit?.message ?? "metadata.vulnerabilities がありません"
    }`,
  );
  process.exit(2);
}

const vulns = audit.vulnerabilities ?? {};
const blocking = [];
for (const [name, info] of Object.entries(vulns)) {
  if (info.severity === "critical") blocking.push(`${name} (critical)`);
  else if (info.severity === "high" && !HIGH_ALLOWLIST.has(name)) blocking.push(`${name} (high)`);
}

const c = audit.metadata?.vulnerabilities ?? {};
console.log(
  `audit: critical=${c.critical ?? 0} high=${c.high ?? 0} moderate=${c.moderate ?? 0} low=${c.low ?? 0}`,
);

if (blocking.length > 0) {
  console.error("audit-check FAILED — allowlist 外の high/critical:");
  for (const b of blocking) console.error(`  - ${b}`);
  console.error("修正するか、breaking upgrade を要決定で合意のうえ allowlist を更新してください。");
  process.exit(1);
}

console.log(
  `audit-check OK（allowlisted high: ${[...HIGH_ALLOWLIST].join(", ")} — breaking upgradeは要決定で追跡）`,
);
