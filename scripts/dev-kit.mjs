#!/usr/bin/env node
//
// 配布用の Claude Code 開発キット（プラグイン docdd）を作る（T-M8-434。T-M8-435 で zip 配布を廃止しプラグインに一本化、
// T-M8-436 で配布物から本リポジトリ固有の文言を除いた）。
//
//   npm run dev-kit                    # 生成（dist/・kit/BUILD.json）
//   npm run dev-kit -- --check         # 生成せず、kit/BUILD.json が正本と一致するかだけ見る（vitest が呼ぶ）
//   npm run dev-kit -- --same-version  # 中身が変わっても kit/VERSION を上げずに作り直す（公開前の試行錯誤用）
//
// 正本（運営者向けの手順は kit/PUBLISHING.md）:
//   - kit/README.md（利用者向け説明書。プラグインに同梱）・kit/MARKETPLACE_README.md（公開リポジトリ直下）・kit/VERSION
//   - kit/skills/<名前>/（配布用スキル。.claude/skills/<名前>/ を汎用化した派生。固有名・作業ID・固有コマンド・パスを含まない）
//   - kit/templates/（雛形。CLAUDE.template.md は出力時に CLAUDE.md へ改名）
//   - kit/plugin-skills/init/SKILL.md（プラグイン専用。書き換えずにそのまま写す）
//   - ルートの .mcp.json・.claude/settings.json（permissions だけ）・scripts/check-doc-dates.mjs・
//     check-doc-refs.mjs・audit-check.mjs（**このリポジトリのものをそのまま配る**。kit/ 側に写しを持たない）
//
// 出力:
//   (a) dist/docdd/（gitignore 済み）— プラグインのマーケットプレイス一式。公開リポジトリの直下へ中身を置く。
//       スキル本文の `/add-task` は `/docdd:add-task` へ書き換え、冒頭に前提ブロックを差し込む。
//       雛形（CLAUDE.md・docs・tasks）も同じ書き換えを施す。init はそのまま。
//   (b) kit/BUILD.json — 版・中身のハッシュ・日付・元スキル（.claude/skills/）のハッシュ。
//       **中身が変わったのに版が同じなら次回の生成で止める**（同じ版のままだと利用者側が更新を検知しない）。
//
// 忘れても止まる: src/lib/ops/dev-kit.test.ts が `--check` を呼び、(1) kit/BUILD.json が正本からずれている、
// (2) 元スキル .claude/skills/<名前>/ が変わったのに派生 kit/skills/<名前>/ の確認（npm run dev-kit）がされていない、のどちらでも赤にする。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const PLUGIN_NAME = "docdd";
const MARKETPLACE_NAME = "claude-docdd-dev-kit";
const OWNER = { name: "no1013kota" };
/** 公開リポジトリ（`<owner>/<repo>`）。README・スキルの前提ブロックの「配布リポジトリ」もここから埋める。 */
const GITHUB_REPO = "no1013kota/claude-docdd-dev-kit";
const DESCRIPTION =
  "非エンジニアが Claude Code で Web アプリを作り続けるための開発キット。CLAUDE.md・仕様書・バックログの雛形と、タスク起票・開発サイクル・docs同期・検証などの手順書（スキル）12本と、雛形を置く init";
/** ブログ運用専用（本リポジトリだけの仕組み）。派生を作らない。 */
const EXCLUDED_SKILLS = ["blog-write", "blog-publish"];
/**
 * 配布物（.md／.json）に残っていたら止める、本リポジトリ固有の文言（運営者の指示 2026-09-05・T-M8-436）。
 * ブログ記事へのリンク（README）だけは許す。
 */
const FORBIDDEN = [
  { re: /Exos/g, what: "アプリ名（Exos）" },
  { re: /x-system/gi, what: "リポジトリ名（x-system）" },
  { re: /exosai\.net(?!\/blog\/claude-code-non-engineer-workflow)/g, what: "exosai.net への参照（記事リンク以外）" },
  { re: /T-M\d/g, what: "作業ID（T-M…）" },
  { re: /REQUIRE_DB/g, what: "固有の環境変数（REQUIRE_DB）" },
  { re: /smoke:live|check:providers|check:turnstile|check:csp-nonce|release:(?:check|staging|production)|seed:review|db:clean-test-data/g, what: "固有の npm script" },
  { re: /要件定義書\.md|プロンプト設計書\.md/g, what: "固有の文書ファイル名" },
];

const KIT_DIR = join(root, "kit");
const TEMPLATES_DIR = join(KIT_DIR, "templates");
const SKILLS_DIR = join(KIT_DIR, "skills");
const SOURCE_SKILLS_DIR = join(root, ".claude/skills");
const INIT_SRC = join(KIT_DIR, "plugin-skills/init/SKILL.md");
const BUILD_JSON = join(KIT_DIR, "BUILD.json");
const DIST_DIR = join(root, "dist", PLUGIN_NAME);
const PLUGIN_DIR = join(DIST_DIR, "plugins", PLUGIN_NAME);
/** ルートから取り込む雛形（相対パスのまま雛形の同名ファイルになる）。 */
const ROOT_TEMPLATE_FILES = [
  ".mcp.json",
  "scripts/check-doc-dates.mjs",
  "scripts/check-doc-refs.mjs",
  "scripts/audit-check.mjs",
];
const ROOT_SETTINGS = join(root, ".claude/settings.json");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const SAME_VERSION = args.includes("--same-version");
for (const a of args) {
  if (!["--check", "--same-version"].includes(a)) fail(`不明な引数: ${a}（使えるのは --check / --same-version）`);
}

const rel = (p) => relative(root, p);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** `from` が無ければ止める置換（黙って何も変えない置換を防ぐ）。 */
function mustReplace(text, from, to, what) {
  if (!text.includes(from)) fail(`${what} が見つかりません（置換対象が変わった）: ${from}`);
  return text.replaceAll(from, to);
}

// --- 入力の確認（無いものを黙って空で出さない） ---
if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPO)) fail(`GITHUB_REPO が <owner>/<repo> の形ではありません: "${GITHUB_REPO}"`);
for (const required of [
  join(KIT_DIR, "README.md"),
  join(KIT_DIR, "MARKETPLACE_README.md"),
  join(KIT_DIR, "VERSION"),
  SKILLS_DIR,
  INIT_SRC,
  join(TEMPLATES_DIR, "CLAUDE.template.md"),
  join(TEMPLATES_DIR, "package.scripts.json"),
  join(TEMPLATES_DIR, "scripts/audit-allowlist.json"),
  ROOT_SETTINGS,
  ...ROOT_TEMPLATE_FILES.map((f) => join(root, f)),
]) {
  if (!existsSync(required)) fail(`${rel(required)} がありません（正本が欠けています）`);
}

const version = readFileSync(join(KIT_DIR, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`kit/VERSION が semver（例 0.1.0）ではありません: "${version}"`);
}

const listSkillDirs = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
const skills = listSkillDirs(SKILLS_DIR);
const sourceSkills = listSkillDirs(SOURCE_SKILLS_DIR).filter((n) => !EXCLUDED_SKILLS.includes(n));
for (const name of skills) {
  if (!existsSync(join(SKILLS_DIR, name, "SKILL.md"))) fail(`kit/skills/${name}/SKILL.md がありません`);
  if (!existsSync(join(SOURCE_SKILLS_DIR, name, "SKILL.md"))) fail(`kit/skills/${name} の元になる .claude/skills/${name}/SKILL.md がありません（元スキルが消えたなら派生も消す）`);
}
for (const name of sourceSkills) {
  // 本リポジトリにスキルが増えたのに派生が無い＝配布物が黙って欠ける。気付けるように止める。
  if (!skills.includes(name)) fail(`.claude/skills/${name} の派生 kit/skills/${name}/SKILL.md がありません（汎用化して作るか、EXCLUDED_SKILLS に理由付きで足す）`);
}
for (const name of EXCLUDED_SKILLS) {
  if (!existsSync(join(SOURCE_SKILLS_DIR, name))) fail(`除外対象 .claude/skills/${name} が見つかりません（EXCLUDED_SKILLS を見直してください）`);
  if (skills.includes(name)) fail(`kit/skills/${name} は除外対象（本リポジトリ専用）です`);
}
if (skills.length === 0) fail("同梱するスキルが0本です");
if (skills.includes("init")) fail("kit/skills/init はプラグイン専用の名前と衝突します");

// --- 呼び名の書き換え（/dev-loop → /docdd:dev-loop） ---
// パス（`skills/dev-loop`）・URL・`./refactor` は書き換えない: 直前が英数字・`/`・`.`・`-` なら対象外。
// 直後が英数字・`-` なら別の語（`/refactoring` など）なので対象外。
const SLASH_RE = new RegExp(`(?<![\\w/.-])/(${skills.join("|")})(?![\\w-])`, "g");
let rewritten = 0;
function rewriteSlashNames(text) {
  return text.replace(SLASH_RE, (_m, name) => {
    rewritten += 1;
    return `/${PLUGIN_NAME}:${name}`;
  });
}

/** 各 SKILL.md 冒頭（front matter の直後）に差し込む前提。プラグインではスキル本文を利用者が直せないため。 */
const SKILL_PREAMBLE = `> **前提（プラグイン版）**: この手順書の「型検査」「単体テスト」「E2E」「全検査」は、あなたのプロジェクトの \`CLAUDE.md\`「検証コマンド」表のコマンドを指す。表に無いものは飛ばして理由を報告する（黙って省略しない）。
> 手順書の本文そのものを直したいときは、配布リポジトリ（https://github.com/${GITHUB_REPO}）の \`plugins/${PLUGIN_NAME}/skills/<名前>/\` を自分の \`.claude/skills/\` へ写して直す（プラグインは外し、写したスキルと \`CLAUDE.md\` の \`${PLUGIN_NAME}:\` を消す）。
`;

function withPreamble(text, what) {
  if (!text.startsWith("---\n")) fail(`${what} が front matter（---）で始まっていません`);
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) fail(`${what} の front matter が閉じていません`);
  const head = text.slice(0, end + "\n---\n".length);
  const body = text.slice(head.length).replace(/^\n+/, "");
  return `${head}\n${SKILL_PREAMBLE}\n${body}`;
}

/** 雛形 CLAUDE.md の `.claude/skills/` 行。プラグインではそのフォルダを作らないので、行ごと差し替える。 */
const SKILLS_ROW_TEMPLATE = "| `.claude/skills/` | 開発用スキル。一覧は下の「スキルの地図」 |";
const SKILLS_ROW_PLUGIN = `| スキル | プラグイン \`${PLUGIN_NAME}\` が提供する（\`/${PLUGIN_NAME}:add-task\` など。一覧は下の「スキルの地図」）。手順書の本文を直したいときは配布リポジトリの \`plugins/${PLUGIN_NAME}/skills/\` を \`.claude/skills/\` へ写す |`;

// --- README の描画（{{GITHUB_REPO}} の穴埋め。埋め残しは止める） ---
function fillRepo(text, what) {
  if (!text.includes("{{GITHUB_REPO}}")) fail(`${what} に {{GITHUB_REPO}} がありません`);
  const out = text.replaceAll("{{GITHUB_REPO}}", GITHUB_REPO);
  if (out.includes("{{")) fail(`${what} に埋め残しの {{…}} があります`);
  return out;
}

// --- 雛形の組み立て ---
/** ディレクトリ配下の全ファイル（相対パス）。 */
function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(p, base);
    return entry.name === ".DS_Store" ? [] : [relative(base, p)];
  });
}

/**
 * ルートの検査スクリプトはそのまま配るが、本リポジトリ固有の文書名を持つ行だけ配布版で一般化する
 * （check-doc-dates.mjs の SPEC_DOC。無い文書名が並ぶと「なぜこの名前？」になる）。置換対象が無ければ止める。
 */
const ROOT_FILE_REWRITES = {
  "scripts/check-doc-dates.mjs": [
    ["|PRD\\.md|要件定義書\\.md|プロンプト設計書\\.md)/;", "|PRD\\.md)/;"],
  ],
};
function rootFileForKit(path, text) {
  let out = text;
  for (const [from, to] of ROOT_FILE_REWRITES[path] ?? []) out = mustReplace(out, from, to, `${path} の配布版置換`);
  return out;
}

/** 相対パス → 中身（init がプロジェクトへ置く雛形）。 */
function buildTemplateTree() {
  const tree = new Map();
  const put = (path, data) => {
    if (tree.has(path)) fail(`雛形のパスが重複しています: ${path}`);
    tree.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  put("CLAUDE.md", readFileSync(join(TEMPLATES_DIR, "CLAUDE.template.md")));
  for (const f of listFiles(TEMPLATES_DIR)) {
    if (f === "CLAUDE.template.md") continue;
    if (f === "CLAUDE.md") fail("kit/templates/CLAUDE.md ではなく CLAUDE.template.md に置いてください（この名前だと本リポジトリの Claude Code が指示として読む）");
    if (ROOT_TEMPLATE_FILES.includes(f) || f === ".claude/settings.json") {
      fail(`kit/templates/${f} はルートの同名ファイルを生成時に取り込むので、kit/ に写しを置かないでください`);
    }
    put(f, readFileSync(join(TEMPLATES_DIR, f)));
  }
  for (const f of ROOT_TEMPLATE_FILES) put(f, rootFileForKit(f, readFileSync(join(root, f), "utf8")));
  const settings = JSON.parse(readFileSync(ROOT_SETTINGS, "utf8"));
  if (!settings.permissions || typeof settings.permissions !== "object") fail(".claude/settings.json に permissions がありません");
  // sandbox 設定や個人のパスは配らない。許可設定（permissions）だけ。
  put(".claude/settings.json", JSON.stringify({ permissions: settings.permissions }, null, 2) + "\n");
  return tree;
}

/** 雛形の .md は呼び名を書き換え、CLAUDE.md の `.claude/skills/` 行を差し替える。 */
function templateTransform(path, buf) {
  if (!path.endsWith(".md")) return buf;
  let text = rewriteSlashNames(buf.toString("utf8"));
  if (path === "CLAUDE.md") text = mustReplace(text, SKILLS_ROW_TEMPLATE, SKILLS_ROW_PLUGIN, "雛形 CLAUDE.md の `.claude/skills/` 行");
  return Buffer.from(text);
}

function writeTree(tree, dir, transform = (_path, buf) => buf) {
  for (const [path, buf] of tree) {
    const to = join(dir, path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, transform(path, buf));
  }
}

// --- 作業ディレクトリに全部を組み立てる（正本を読むだけ。出力先はまだ触らない） ---
const work = join(tmpdir(), `${PLUGIN_NAME}-dev-kit-${process.pid}`);
rmSync(work, { recursive: true, force: true });
const distWork = join(work, "dist");
const pluginWork = join(distWork, "plugins", PLUGIN_NAME);
mkdirSync(join(distWork, ".claude-plugin"), { recursive: true });
mkdirSync(join(pluginWork, ".claude-plugin"), { recursive: true });

const keywords = ["workflow", "docs", "backlog", "non-engineer", "japanese"];
writeFileSync(
  join(distWork, ".claude-plugin/marketplace.json"),
  JSON.stringify(
    {
      name: MARKETPLACE_NAME,
      owner: OWNER,
      metadata: { description: DESCRIPTION, version },
      plugins: [
        { name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, description: DESCRIPTION, version, author: OWNER, license: "Apache-2.0", keywords },
      ],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  join(pluginWork, ".claude-plugin/plugin.json"),
  JSON.stringify({ name: PLUGIN_NAME, version, description: DESCRIPTION, author: OWNER, license: "Apache-2.0", keywords }, null, 2) + "\n",
);
for (const name of skills) {
  const from = join(SKILLS_DIR, name);
  const to = join(pluginWork, "skills", name);
  for (const f of listFiles(from)) {
    const dest = join(to, f);
    mkdirSync(dirname(dest), { recursive: true });
    if (!f.endsWith(".md")) {
      cpSync(join(from, f), dest);
      continue;
    }
    let text = rewriteSlashNames(readFileSync(join(from, f), "utf8"));
    if (f === "SKILL.md") text = withPreamble(text, `kit/skills/${name}/SKILL.md`);
    writeFileSync(dest, text);
  }
}
// init は書き換えない（本文が「/add-task を /docdd:add-task に」と説明しているため、書き換えると自己矛盾する）。
mkdirSync(join(pluginWork, "skills/init"), { recursive: true });
cpSync(INIT_SRC, join(pluginWork, "skills/init/SKILL.md"));
writeTree(buildTemplateTree(), join(pluginWork, "templates"), templateTransform);
writeFileSync(join(pluginWork, "README.md"), fillRepo(readFileSync(join(KIT_DIR, "README.md"), "utf8"), "kit/README.md"));
writeFileSync(join(distWork, "README.md"), fillRepo(readFileSync(join(KIT_DIR, "MARKETPLACE_README.md"), "utf8"), "kit/MARKETPLACE_README.md"));
// LICENSE は公開リポジトリ側（Apache-2.0）が持つ。ここでは生成しない（上書きしない）。

// --- 出力の自己検査（書き換え漏れ・除外漏れ・init の改変・固有文言・zip の案内を黙って通さない） ---
const problems = [];
for (const f of listFiles(join(pluginWork, "skills")).filter((f) => f.endsWith(".md") && !f.startsWith("init/"))) {
  const text = readFileSync(join(pluginWork, "skills", f), "utf8");
  for (const m of text.matchAll(SLASH_RE)) problems.push(`skills/${f}: ${m[0]}（呼び名の書き換え漏れ）`);
  for (const name of EXCLUDED_SKILLS) {
    if (text.includes(`/${name}`)) problems.push(`skills/${f}: /${name}（除外したスキルへの参照）`);
  }
}
for (const f of listFiles(join(pluginWork, "templates")).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(join(pluginWork, "templates", f), "utf8");
  for (const m of text.matchAll(SLASH_RE)) problems.push(`templates/${f}: ${m[0]}（呼び名の書き換え漏れ）`);
}
for (const f of listFiles(distWork).filter((f) => /\.(md|json)$/.test(f))) {
  const text = readFileSync(join(distWork, f), "utf8");
  for (const { re, what } of FORBIDDEN) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) problems.push(`${f}: ${what} → "${m[0]}"（配布物に本リポジトリ固有の文言）`);
  }
}
for (const f of ["README.md", "skills/init/SKILL.md", "templates/CLAUDE.md"]) {
  // zip 配布は廃止済み（T-M8-435）。読者に無い配布物を案内しない。
  if (/zip/i.test(readFileSync(join(pluginWork, f), "utf8"))) problems.push(`plugins/${PLUGIN_NAME}/${f}: 「zip」への言及（zip 配布は廃止済み）`);
}
if (/zip/i.test(readFileSync(join(distWork, "README.md"), "utf8"))) problems.push("README.md: 「zip」への言及（zip 配布は廃止済み）");
if (problems.length > 0) {
  rmSync(work, { recursive: true, force: true });
  console.error("❌ 配布物に問題があります:");
  for (const p of problems) console.error(`   ${p}`);
  process.exit(1);
}
if (rewritten === 0) fail("呼び名を1件も書き換えませんでした（検出器が空振りしています）");
if (!readFileSync(join(pluginWork, "skills/init/SKILL.md")).equals(readFileSync(INIT_SRC))) {
  fail("プラグインの init が kit/plugin-skills/init/SKILL.md と一致しません（書き換えてはいけない）");
}
if (!readFileSync(join(pluginWork, "templates/CLAUDE.md"), "utf8").includes(`/${PLUGIN_NAME}:add-task`)) {
  fail("プラグインの templates/CLAUDE.md に呼び名の書き換えが反映されていません");
}

// --- ハッシュ ---
function hashEntries(entries) {
  const h = createHash("sha256");
  for (const [p, b] of entries) {
    h.update(p);
    h.update("\0");
    h.update(b);
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}
function treeEntries(dir, prefix) {
  return listFiles(dir)
    .sort()
    .map((f) => [`${prefix}/${f}`, readFileSync(join(dir, f))]);
}
/** 配布物の中身（利用者に届くものだけ。版・年を含む manifest と LICENSE は除く）。 */
const hash = hashEntries([
  ...treeEntries(join(pluginWork, "skills"), "plugin/skills"),
  ...treeEntries(join(pluginWork, "templates"), "plugin/templates"),
  ["plugin/README.md", readFileSync(join(pluginWork, "README.md"))],
  ["marketplace/README.md", readFileSync(join(distWork, "README.md"))],
]);
/** 元スキル（.claude/skills/<名前>/）ごとのハッシュ。派生 kit/skills/ の見直し漏れを止めるための記録。 */
const sources = Object.fromEntries(skills.map((name) => [name, hashEntries(treeEntries(join(SOURCE_SKILLS_DIR, name), name))]));
const prev = existsSync(BUILD_JSON) ? JSON.parse(readFileSync(BUILD_JSON, "utf8")) : null;
const today = new Date().toISOString().slice(0, 10);
// ======================= --check: 突き合わせだけ =======================
if (CHECK) {
  rmSync(work, { recursive: true, force: true });
  const found = [];
  if (!prev) found.push("kit/BUILD.json がありません");
  else {
    if (prev.version !== version) found.push(`kit/BUILD.json の版（${prev.version}）と kit/VERSION（${version}）が違います`);
    if (prev.hash !== hash) found.push("配布物の中身（kit/skills・雛形・ルートの設定／検査スクリプト・README）が kit/BUILD.json の記録と違います");
    for (const name of skills) {
      if (!prev.sources || prev.sources[name] !== sources[name]) {
        found.push(`元スキル .claude/skills/${name}/ が変わりました。派生 kit/skills/${name}/ へ反映するか判断してください（反映不要でも npm run dev-kit で記録を更新する）`);
      }
    }
  }
  if (found.length > 0) {
    console.error("❌ 配布キットが正本と一致しません:");
    for (const p of found) console.error(`   ${p}`);
    console.error("   → `npm run dev-kit` を実行してください（配布物が変わっていれば kit/VERSION も上げ、dist/docdd/ を公開リポジトリへ push する）");
    process.exit(1);
  }
  console.log(`✅ 配布キットは正本と一致しています（v${version}・kit/BUILD.json・元スキル ${skills.length} 本の記録）`);
  process.exit(0);
}

// ======================= 生成 =======================
if (prev && prev.version === version && prev.hash !== hash && !SAME_VERSION) {
  rmSync(work, { recursive: true, force: true });
  fail(
    `配布物の中身が変わりましたが kit/VERSION が ${version} のままです。kit/VERSION を上げてください（例 ${version} → ${bump(version)}）。` +
      "\n   同じ版のままだと利用者側が更新を検知しません。公開前の試行錯誤で意図して同じ版にするなら `npm run dev-kit -- --same-version`",
  );
}
function bump(v) {
  const [a, b, c] = v.split(".").map(Number);
  return `${a}.${b}.${c + 1}`;
}
// 版が変わった日を記録する（同じ版の作り直しでは日付を動かさない）。
const built = prev && prev.version === version && prev.built ? prev.built : today;

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(dirname(DIST_DIR), { recursive: true });
renameSync(distWork, DIST_DIR);
rmSync(work, { recursive: true, force: true });

writeFileSync(BUILD_JSON, JSON.stringify({ version, hash, built, sources }, null, 2) + "\n");

// --- claude CLI があれば plugin validate --strict まで通す ---
function validate(path) {
  const r = spawnSync("claude", ["plugin", "validate", path, "--strict"], { encoding: "utf8" });
  if (r.error?.code === "ENOENT") return null;
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) {
    console.error(`❌ claude plugin validate --strict が失敗しました: ${rel(path)}\n${out}`);
    process.exit(1);
  }
  return out.trim();
}
const validated = validate(DIST_DIR) !== null && validate(PLUGIN_DIR) !== null;

// --- 報告 ---
console.log(`✅ ${rel(DIST_DIR)}/（プラグイン ${PLUGIN_NAME} v${version}・マーケットプレイス ${MARKETPLACE_NAME}・配布先 ${GITHUB_REPO}）`);
console.log(`   同梱スキル ${skills.length} 本 ＋ init: ${skills.join(", ")}（除外: ${EXCLUDED_SKILLS.join(", ")}）`);
console.log(`   呼び名を ${rewritten} 件 /${PLUGIN_NAME}:<name> へ書き換え、各 SKILL.md に前提ブロックを差し込みました（init はそのまま）。固有文言の検査: 問題なし`);
console.log(`✅ kit/BUILD.json（v${version}・${hash.slice(0, 19)}…・${built}・元スキル ${skills.length} 本の記録）${prev && prev.hash !== hash && SAME_VERSION ? "（--same-version: 中身が変わりましたが版は据え置き）" : ""}`);
if (validated) {
  console.log("✅ claude plugin validate --strict: marketplace と plugin の両方が通りました");
} else {
  console.log("⚠️ claude コマンドが見つからないため plugin validate は未実行です（公開前に `claude plugin validate dist/docdd --strict` を通してください）");
}
console.log("   公開の手順は kit/PUBLISHING.md（dist/docdd/ の中身を公開リポジトリへ push する）");
