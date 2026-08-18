// docs が `バッククォート` で指しているファイルパスが実在するかを検査する。
//
// **参照先の実在は人の記憶に預けられていた**（CLAUDE.md 原則2・原則3）。
// 実際に `src/lib/post/post-patterns.ts` が T-M8-129 で消えたあとも、要件06 と ADR-0006 が
// 「これを単一の正とする」と案内し続けていた（T-M8-137）。存在しないファイルを指す正本は、
// 読んだ人を行き止まりへ送る。
//
//   node scripts/check-doc-refs.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (args) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { encoding: "utf8" }).trim();

const tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean));

/**
 * 書き方の揺れを吸収する。docs は `src/` を省いて `lib/post/x.ts` と書くことがある。
 * 末尾一致も許すのは、正本の位置を1文字ずつ縛るのが目的ではないため。
 */
function exists(ref) {
  if (tracked.has(ref)) return true;
  for (const f of tracked) if (f.endsWith("/" + ref)) return true;
  return false;
}

/**
 * 実ファイルを指していない書き方の除外。
 * - `NNNN-...` のような命名テンプレート
 * - `*` を含むglob
 * - 相対リンク（Markdownのリンクとして別に解決される）
 */
function isTemplate(ref) {
  return /NNNN|[*<>{}]|^\.{1,2}\//.test(ref);
}

const FILE_REF = /`([a-zA-Z0-9_./-]+\.(?:ts|tsx|mjs|sql|toml|json|css))`/g;

const docs = git(["ls-files", "docs/*.md", "docs/**/*.md", "CLAUDE.md"])
  .split("\n")
  .filter(Boolean);

const missing = [];
let checked = 0;
for (const doc of docs) {
  const lines = readFileSync(doc, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(FILE_REF)) {
      const ref = m[1];
      if (isTemplate(ref)) continue;
      checked += 1;
      if (!exists(ref)) missing.push({ doc, line: i + 1, ref });
    }
  });
}

if (checked === 0) {
  // **0件で緑にしない。** 書き方が変わって検出器が空振りしたのを見逃さないため。
  console.error("❌ docs内のファイル参照が1件も見つかりませんでした（検出器が空振りしています）");
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`❌ 実在しないファイルを指す記述が ${missing.length} 件あります（${checked} 件を検査）\n`);
  for (const m of missing) console.error(`   ${m.doc}:${m.line}  →  ${m.ref}`);
  console.error("\n   → 移動・改名したなら正しい位置へ、消えたなら記述ごと見直してください");
  process.exit(1);
}

console.log(`✅ docsのファイル参照は ${checked} 件すべて実在しました`);
