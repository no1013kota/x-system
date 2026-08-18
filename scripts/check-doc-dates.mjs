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
import { execFileSync } from "node:child_process";
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

console.log(`✅ 更新日は ${checked} 件すべて最新でした`);
