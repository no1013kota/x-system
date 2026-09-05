// docs の「更新日」が、その文書を最後に変えたコミットより古くないかを検査する。
//
// **この手順は人の記憶に預けられていた**（CLAUDE.md 原則3）。実際に9本の文書で
// 更新日が置き去りになっており（T-M8-129 / T-M8-133 / T-M8-88 と doc-sync の各コミット）、
// 「docs/ は常に実装の現状と一致する」という最重要ルールの一部が守られていなかった。
// 忘れても止まる形にする。
//
//   node scripts/check-doc-dates.mjs
//
// **更新日の行だけを変えたコミットは無視する。** そうしないと、日付を直すコミット自身が
// 「また古い」と言われて永久に収束しない。
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DATE_ROW = /\|\s*更新日\s*\|\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\s*\|/;
const DATE_LINE = /最終更新[:：]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/;

/*
  `-c core.quotepath=false` を必ず付ける。付けないと日本語のパスが
  `"docs/\343\203\227…"` のように8進エスケープで返り、ファイルを開けない
  （`docs/プロンプト設計書.md` で実際に踏んだ）。
*/
const git = (args) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8" }).trim();

/*
  **浅いcloneでは判定できないので止める**（2026-08-18）。
  この検査は「その文書を最後に変えたコミットの日付」を git履歴から読む。
  CIの既定（`actions/checkout` の depth 1）だと履歴が1件しか無く、
  **全文書が「今日変わった」ように見えて誤検知する**（実際にCIだけが落ちた）。
  黙って通すのではなく、原因と直し方を出して止める。
*/
if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
  console.error("❌ 履歴が浅いclone（shallow）のため更新日を判定できません");
  console.error("   → CIなら actions/checkout に `fetch-depth: 0` を付けてください");
  console.error("   → 手元なら `git fetch --unshallow` を実行してください");
  process.exit(1);
}

/*
  **コミットが1件も無いリポジトリでは判定できないので止める**（T-M8-434）。
  `git init` 直後に実行すると `git log` が「まだコミットがありません」で失敗し、
  Node のスタックトレースだけが出る（配布キットを空のリポジトリへ置いて実測）。
  読む人が次の一手を分かる形で止める。
*/
if (spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" }).status !== 0) {
  console.error("❌ まだコミットが1件もありません。最初のコミットの後に実行してください");
  console.error("   （この検査は「その文書を最後に変えたコミットの日付」を読むため、履歴が要ります）");
  process.exit(1);
}

/** 追跡下の docs/**.md すべて。 */
const files = git(["ls-files", "docs/*.md", "docs/**/*.md"]).split("\n").filter(Boolean);

/** 更新日の行**以外**を変えた最後のコミット日。無ければ null。 */
function lastContentChange(file) {
  const shas = git(["log", "--format=%H", "--", file]).split("\n").filter(Boolean);
  for (const sha of shas) {
    // -U0 で文脈行を落とし、変更行だけを見る。
    const diff = execFileSync(
      "git",
      ["-c", "core.quotepath=false", "show", "-U0", "--format=", sha, "--", file],
      { encoding: "utf8" },
    );
    const changed = diff
      .split("\n")
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
      .map((l) => l.slice(1));
    // 更新日の行しか動いていないコミットは「内容の変更」ではない。
    const substantive = changed.some((l) => !DATE_ROW.test(l) && !DATE_LINE.test(l));
    if (substantive) return git(["log", "-1", "--format=%ad", "--date=short", sha]);
  }
  return null;
}

const stale = [];
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const m = DATE_ROW.exec(text) ?? DATE_LINE.exec(text);
  // 更新日を持たない文書（README・ADR）は対象外。別の書式を使っている。
  if (!m) continue;
  checked += 1;
  const commit = lastContentChange(file);
  if (commit && m[1] < commit) stale.push({ file, doc: m[1], commit });
}

if (checked === 0) {
  // **0件で緑にしない。** 書式が変わって検出器が空振りしたのを見逃さないため。
  console.error("❌ 更新日を持つ文書が1件も見つかりませんでした（検出器が空振りしています）");
  process.exit(1);
}

if (stale.length > 0) {
  console.error(`❌ 更新日が置き去りの文書が ${stale.length} 件あります（${checked} 件を検査）\n`);
  for (const s of stale) {
    console.error(`   ${s.file}`);
    console.error(`     記載: ${s.doc} / 最後に内容が変わったコミット: ${s.commit}`);
  }
  console.error("\n   → 各文書の冒頭「更新日」を直してください（docs/README.md の運用ルール）");
  process.exit(1);
}

/*
  **冒頭ヘッダの version と末尾の変更履歴が食い違っていないか**（T-M8-144）。

  実際に要件06 が「冒頭 v1.92 / 履歴の最新 v1.84」で8版分ずれ、しかも
  **変更履歴の表ヘッダを失って孤立1行になっていた**（表として読めない状態）。
  version は上げても履歴を書き足すのを忘れる——ここも人の記憶に預かっていた手順。
*/
const VERSION_ROW = /\|\s*バージョン\s*\|\s*v([0-9.]+)\s*\|/;
const CHANGELOG_ROW = /^\|\s*v([0-9.]+)(?:〜v[0-9.]+)?\s*\|/gm;
const CHANGELOG_ROW_FIRST = /^\|\s*v[0-9.]+(?:〜v[0-9.]+)?\s*\|/m;

/*
  **変更履歴を求めるのは仕様の正本だけ**（PRD・requirements/・要件定義書・プロンプト設計書。
  文書を増やしたらこの正規表現へ足す）。`docs/README.md` の運用ルール
  （「仕様変更時は冒頭の更新日と末尾の変更履歴を更新する」）は仕様の正本に対するもので、
  運営手順の文書はversionと更新日だけを持つ。全docsへ広げると、
  手順書に意味の薄い履歴表を強制することになる。
  `requirements/README.md` は分け方の案内（配布キットの雛形は本文に `| バージョン | v1.0 |` の例を
  含む）なので対象外。**このファイルは配布キット（`npm run dev-kit`）にそのまま同梱される**——
  本リポジトリ固有の文書名が並ぶのはそのためで、無い文書は単に対象が無いだけ。
*/
const SPEC_DOC = /^docs\/(requirements\/(?!README\.md$)|PRD\.md|要件定義書\.md|プロンプト設計書\.md)/;

const versionDrift = [];
let versioned = 0;
for (const file of files) {
  if (!SPEC_DOC.test(file)) continue;
  const text = readFileSync(file, "utf8");
  const head = VERSION_ROW.exec(text);
  if (!head) continue;
  versioned += 1;
  const rows = [...text.matchAll(CHANGELOG_ROW)].map((m) => m[1]);
  if (rows.length === 0) {
    versionDrift.push({ file, reason: "変更履歴の行が見つかりません" });
    continue;
  }
  /*
    **表ヘッダも見る。** 行だけ残ってヘッダが消えると Markdown の表として描画されず、
    履歴が読めない孤立した行になる（要件06 が実際にこの状態だった）。
    行があることだけを見ていると気付けない。
  */
  const firstRow = text.search(CHANGELOG_ROW_FIRST);
  const before = text.slice(Math.max(0, firstRow - 200), firstRow);
  // 表記は `version` と `バージョン` の両方が使われている（どちらでもよい）。
  if (!/\|\s*(version|バージョン)\s*\|/i.test(before) || !/\|\s*-{3,}\s*\|/.test(before)) {
    versionDrift.push({
      file,
      reason: "変更履歴の表ヘッダ（`| バージョン | 日付 | 内容 |` などと区切り行）がありません",
    });
    continue;
  }
  // 末尾の行が最新。範囲表記（v1.86〜v1.90）は開始側で拾うので、含む場合は最後の行の右端も見る。
  const lastLine = text.slice(text.lastIndexOf("\n| v")).split("\n")[1] ?? "";
  const latest = /v([0-9.]+)\s*\|/g;
  const all = [...text.matchAll(/^\|\s*v[0-9.]+(?:〜v([0-9.]+))?\s*\|/gm)];
  const newest = all.length ? (all[all.length - 1][1] ?? rows[rows.length - 1]) : rows[rows.length - 1];
  if (newest !== head[1]) {
    versionDrift.push({
      file,
      reason: `冒頭 v${head[1]} に対し変更履歴の最新は v${newest}`,
    });
  }
  void lastLine;
  void latest;
}

if (versioned === 0) {
  console.error("❌ 変更履歴を持つべき正本が1件も見つかりませんでした（検出器が空振りしています）");
  process.exit(1);
}

if (versionDrift.length > 0) {
  console.error(`❌ versionと変更履歴が合わない文書が ${versionDrift.length} 件あります\n`);
  for (const d of versionDrift) console.error(`   ${d.file}\n     ${d.reason}`);
  console.error("\n   → 末尾の変更履歴へ行を足すか、冒頭のversionを直してください");
  process.exit(1);
}

console.log(`✅ 更新日は ${checked} 件すべて最新でした（version と変更履歴の一致も ${versioned} 件確認）`);
