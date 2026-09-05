#!/usr/bin/env node
//
// 配布用の Claude Code 開発キットを作る（T-M8-434。旧 blog-kit.mjs の置き換え）。
//
//   npm run dev-kit                    # 生成（zip・dist/・kit/BUILD.json・記事の「約NNKB」）
//   npm run dev-kit -- --check         # 生成せず、いまの zip と kit/BUILD.json が正本と一致するかだけ見る（vitest が呼ぶ）
//   npm run dev-kit -- --same-version  # 中身が変わっても kit/VERSION を上げずに作り直す（公開前の試行錯誤用）
//
// 正本（運営者向けの手順は kit/PUBLISHING.md）:
//   - kit/README.md（利用者向け説明書）・kit/MARKETPLACE_README.md（公開リポジトリ直下）・kit/VERSION
//   - kit/templates/（雛形。CLAUDE.template.md は出力時に CLAUDE.md へ改名）
//   - kit/plugin-skills/init/SKILL.md（プラグイン専用。書き換えずにそのまま写す）
//   - ルートの .mcp.json・.claude/settings.json（permissions だけ）・scripts/check-doc-dates.mjs・
//     check-doc-refs.mjs・audit-check.mjs（**このリポジトリのものをそのまま配る**。kit/ 側に写しを持たない）
//   - .claude/skills/（本リポジトリで実際に使っているスキル。ブログ運用専用の blog-write / blog-publish だけ除く）
//
// 出力:
//   (a) public/blog-files/claude-code-dev-kit.zip — 記事の読者向け（コミット対象）。README＋雛形＋スキル11本（本文はそのまま）。
//   (b) dist/docdd/（gitignore 済み）— プラグインのマーケットプレイス一式。スキル本文の `/add-task` は
//       `/docdd:add-task` へ書き換え、冒頭に「npm run … は元アプリの実例」の前提ブロックを差し込む。
//       雛形（CLAUDE.md・docs・tasks）も同じ書き換えを施す。init はそのまま。
//   (c) kit/BUILD.json — 版・中身のハッシュ・日付。**中身が変わったのに版が同じなら次回の生成で止める**
//       （同じ版のままだと利用者側が更新を検知しない）。
//
// 忘れても止まる: src/lib/blog/dev-kit-zip.test.ts が `--check` を呼び、zip と BUILD.json が正本からずれていれば赤にする。
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const PLUGIN_NAME = "docdd";
const MARKETPLACE_NAME = "claude-docdd-dev-kit";
const OWNER = { name: "no1013kota" };
/**
 * 公開リポジトリ（例 "your-name/docdd"）。決まったらここを1か所直す。
 * 空のあいだは、zip の README の「B. プラグイン」節を「準備中」として出し（読者に実行できない手順を見せない）、
 * dist の README には `<GITHUB_REPO 未設定>` が残る（手元試用のため生成は止めない。公開前に必ず埋める）。
 */
const GITHUB_REPO = "no1013kota/claude-docdd-dev-kit";
const DESCRIPTION =
  "非エンジニアが Claude Code で Web アプリを作り続けるための開発キット。CLAUDE.md・仕様書・バックログの雛形と、タスク起票・開発サイクル・docs同期・検証などの手順書（スキル）11本";
/** ブログ運用専用（本リポジトリだけの仕組み）。キットへは入れない。 */
const EXCLUDED_SKILLS = ["blog-write", "blog-publish"];
/** 記事の「約NNKB」に許す差。圧縮結果は OS の zip 実装で数百バイト揺れるので、KB 単位の一致までは求めない。 */
const ARTICLE_SIZE_TOLERANCE_KB = 2;

const KIT_DIR = join(root, "kit");
const TEMPLATES_DIR = join(KIT_DIR, "templates");
const SKILLS_DIR = join(root, ".claude/skills");
const INIT_SRC = join(KIT_DIR, "plugin-skills/init/SKILL.md");
const BUILD_JSON = join(KIT_DIR, "BUILD.json");
const ZIP_OUT = join(root, "public/blog-files/claude-code-dev-kit.zip");
const ARTICLE = join(root, "blog/published/claude-code-non-engineer-workflow.md");
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
for (const required of [
  join(KIT_DIR, "README.md"),
  join(KIT_DIR, "MARKETPLACE_README.md"),
  join(KIT_DIR, "VERSION"),
  INIT_SRC,
  join(TEMPLATES_DIR, "CLAUDE.template.md"),
  join(TEMPLATES_DIR, "package.scripts.json"),
  join(TEMPLATES_DIR, "scripts/audit-allowlist.json"),
  ROOT_SETTINGS,
  ARTICLE,
  ...ROOT_TEMPLATE_FILES.map((f) => join(root, f)),
]) {
  if (!existsSync(required)) fail(`${rel(required)} がありません（正本が欠けています）`);
}

const version = readFileSync(join(KIT_DIR, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`kit/VERSION が semver（例 0.1.0）ではありません: "${version}"`);
}

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !EXCLUDED_SKILLS.includes(d.name))
  .map((d) => d.name)
  .sort();
for (const name of skills) {
  if (!existsSync(join(SKILLS_DIR, name, "SKILL.md"))) fail(`.claude/skills/${name}/SKILL.md がありません`);
}
for (const name of EXCLUDED_SKILLS) {
  // 除外対象が消えているなら、この一覧そのものが古い。気付けるように止める。
  if (!existsSync(join(SKILLS_DIR, name))) fail(`除外対象 .claude/skills/${name} が見つかりません（EXCLUDED_SKILLS を見直してください）`);
}
if (skills.length === 0) fail("同梱するスキルが0本です");
if (skills.includes("init")) fail(".claude/skills/init はプラグイン専用の名前と衝突します");

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

/** プラグイン版の各 SKILL.md 冒頭（front matter の直後）に差し込む前提。B ではスキル本文を利用者が直せないため。 */
const SKILL_PREAMBLE = `> **前提（プラグイン版）**: この手順書の \`npm run …\`・\`src/…\`・\`T-M8-…\` は、元のアプリ（Exos AI・Next.js／Supabase）での実例。
> コマンドはあなたのプロジェクトの \`CLAUDE.md\`「検証コマンド」表と「変更影響 → 必須の検証」表、\`package.json\` の \`scripts\` を正とし、無いものは飛ばして理由を報告する（黙って省略しない）。
> 手順書の本文そのものを直したいときは、プラグインではなく zip 版（\`.claude/skills/\` に実ファイルとして置く）へ切り替える。
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
const SKILLS_ROW_ZIP = "| `.claude/skills/` | 開発用スキル。一覧は下の「スキルの地図」 |";
const SKILLS_ROW_PLUGIN = `| スキル | プラグイン \`${PLUGIN_NAME}\` が提供する（\`/${PLUGIN_NAME}:add-task\` など。一覧は下の「スキルの地図」）。手順書の本文を直したいときは zip 版へ切り替える |`;

// --- README の描画（GITHUB_REPO の穴埋め／未設定なら B 節を「準備中」に） ---
const PLUGIN_BLOCK = /<!-- plugin:start -->\n?([\s\S]*?)<!-- plugin:end -->\n?/;
const PLUGIN_PENDING = `### B. プラグインとして入れる（準備中）

Claude Code のプラグイン（\`/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}\`）としても入れられるよう作ってありますが、配布元のリポジトリはまだ公開していません。公開したら上のブログ記事に手順を足します。それまでは A で入れてください。
`;

function renderKitReadme(text) {
  if (text.split("<!-- plugin:start -->").length !== 2) fail("kit/README.md には <!-- plugin:start --> … <!-- plugin:end --> の節が1つ必要です");
  const out = GITHUB_REPO
    ? text.replace(PLUGIN_BLOCK, (_m, body) => body).replaceAll("{{GITHUB_REPO}}", GITHUB_REPO)
    : text.replace(PLUGIN_BLOCK, PLUGIN_PENDING);
  if (out.includes("{{")) fail("kit/README.md に埋め残しの {{…}} があります（plugin ブロックの外で使っている）");
  return out;
}

function renderMarketplaceReadme(text) {
  if (!text.includes("{{GITHUB_REPO}}")) fail("kit/MARKETPLACE_README.md に {{GITHUB_REPO}} がありません");
  return text.replaceAll("{{GITHUB_REPO}}", GITHUB_REPO || "<GITHUB_REPO 未設定>");
}

// --- 雛形の組み立て（zip とプラグインの templates で共通） ---
/** ディレクトリ配下の全ファイル（相対パス）。 */
function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(p, base);
    return entry.name === ".DS_Store" ? [] : [relative(base, p)];
  });
}

/** 相対パス → 中身。README.md も含む（zip はそのまま、プラグインは templates/ の外へ出す）。 */
function buildKitTree() {
  const tree = new Map();
  const put = (path, data) => {
    if (tree.has(path)) fail(`雛形のパスが重複しています: ${path}`);
    tree.set(path, Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  put("README.md", renderKitReadme(readFileSync(join(KIT_DIR, "README.md"), "utf8")));
  put("CLAUDE.md", readFileSync(join(TEMPLATES_DIR, "CLAUDE.template.md")));
  for (const f of listFiles(TEMPLATES_DIR)) {
    if (f === "CLAUDE.template.md") continue;
    if (f === "CLAUDE.md") fail("kit/templates/CLAUDE.md ではなく CLAUDE.template.md に置いてください（この名前だと本リポジトリの Claude Code が指示として読む）");
    if (ROOT_TEMPLATE_FILES.includes(f) || f === ".claude/settings.json") {
      fail(`kit/templates/${f} はルートの同名ファイルを生成時に取り込むので、kit/ に写しを置かないでください`);
    }
    put(f, readFileSync(join(TEMPLATES_DIR, f)));
  }
  for (const f of ROOT_TEMPLATE_FILES) put(f, readFileSync(join(root, f)));
  const settings = JSON.parse(readFileSync(ROOT_SETTINGS, "utf8"));
  if (!settings.permissions || typeof settings.permissions !== "object") fail(".claude/settings.json に permissions がありません");
  // sandbox 設定や個人のパスは配らない。許可設定（permissions）だけ。
  put(".claude/settings.json", JSON.stringify({ permissions: settings.permissions }, null, 2) + "\n");
  return tree;
}

function writeTree(tree, dir, transform = (_path, buf) => buf) {
  for (const [path, buf] of tree) {
    const to = join(dir, path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, transform(path, buf));
  }
}

function copyDir(from, to) {
  cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });
}

/** プラグインの templates/: .md の呼び名を書き換え、CLAUDE.md の `.claude/skills/` 行を差し替える。 */
function pluginTemplateTransform(path, buf) {
  if (!path.endsWith(".md")) return buf;
  let text = rewriteSlashNames(buf.toString("utf8"));
  if (path === "CLAUDE.md") text = mustReplace(text, SKILLS_ROW_ZIP, SKILLS_ROW_PLUGIN, "雛形 CLAUDE.md の `.claude/skills/` 行");
  return Buffer.from(text);
}

// --- 作業ディレクトリに全部を組み立てる（正本を読むだけ。出力先はまだ触らない） ---
const work = join(tmpdir(), `claude-code-dev-kit-${process.pid}`);
rmSync(work, { recursive: true, force: true });
const stage = join(work, "zip");
const distWork = join(work, "dist");
const pluginWork = join(distWork, "plugins", PLUGIN_NAME);
mkdirSync(stage, { recursive: true });
mkdirSync(join(distWork, ".claude-plugin"), { recursive: true });
mkdirSync(join(pluginWork, ".claude-plugin"), { recursive: true });

const kitTree = buildKitTree();

// (a) zip の中身: README＋雛形＋スキル（本文はそのまま）
writeTree(kitTree, stage);
for (const name of skills) copyDir(join(SKILLS_DIR, name), join(stage, ".claude/skills", name));

// (b) プラグイン一式
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
    if (f === "SKILL.md") text = withPreamble(text, `.claude/skills/${name}/SKILL.md`);
    writeFileSync(dest, text);
  }
}
// init は書き換えない（本文が「/add-task を /docdd:add-task に」と説明しているため、書き換えると自己矛盾する）。
mkdirSync(join(pluginWork, "skills/init"), { recursive: true });
cpSync(INIT_SRC, join(pluginWork, "skills/init/SKILL.md"));
const pluginTemplates = new Map([...kitTree].filter(([p]) => p !== "README.md"));
writeTree(pluginTemplates, join(pluginWork, "templates"), pluginTemplateTransform);
writeFileSync(join(pluginWork, "README.md"), kitTree.get("README.md"));
writeFileSync(join(distWork, "README.md"), renderMarketplaceReadme(readFileSync(join(KIT_DIR, "MARKETPLACE_README.md"), "utf8")));
// LICENSE は公開リポジトリ側（Apache-2.0）が持つ。ここでは生成しない（上書きしない）。

// --- 出力の自己検査（書き換え漏れ・除外漏れ・init の改変を黙って通さない） ---
const leftovers = [];
for (const f of listFiles(join(pluginWork, "skills")).filter((f) => f.endsWith(".md") && !f.startsWith("init/"))) {
  const text = readFileSync(join(pluginWork, "skills", f), "utf8");
  for (const m of text.matchAll(SLASH_RE)) leftovers.push(`skills/${f}: ${m[0]}`);
  for (const name of EXCLUDED_SKILLS) {
    if (text.includes(`/${name}`)) leftovers.push(`skills/${f}: /${name}（除外したスキルへの参照）`);
  }
}
for (const f of listFiles(join(pluginWork, "templates")).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(join(pluginWork, "templates", f), "utf8");
  for (const m of text.matchAll(SLASH_RE)) leftovers.push(`templates/${f}: ${m[0]}`);
}
if (leftovers.length > 0) {
  console.error("❌ プラグインのスキル本文・雛形に書き換え漏れがあります:");
  for (const l of leftovers) console.error(`   ${l}`);
  process.exit(1);
}
if (rewritten === 0) fail("呼び名を1件も書き換えませんでした（検出器が空振りしています）");
if (!readFileSync(join(pluginWork, "skills/init/SKILL.md")).equals(readFileSync(INIT_SRC))) {
  fail("プラグインの init が kit/plugin-skills/init/SKILL.md と一致しません（書き換えてはいけない）");
}
if (!readFileSync(join(pluginWork, "templates/CLAUDE.md"), "utf8").includes(`/${PLUGIN_NAME}:add-task`)) {
  fail("プラグインの templates/CLAUDE.md に呼び名の書き換えが反映されていません");
}

// --- 中身のハッシュ（利用者に届くものだけ。版・年を含む manifest と LICENSE は除く） ---
function treeEntries(dir, prefix) {
  return listFiles(dir)
    .sort()
    .map((f) => [`${prefix}/${f}`, readFileSync(join(dir, f))]);
}
const hash = (() => {
  const h = createHash("sha256");
  for (const [p, b] of [
    ...treeEntries(stage, "zip"),
    ...treeEntries(join(pluginWork, "skills"), "plugin/skills"),
    ...treeEntries(join(pluginWork, "templates"), "plugin/templates"),
    ["plugin/README.md", readFileSync(join(pluginWork, "README.md"))],
    ["marketplace/README.md", readFileSync(join(distWork, "README.md"))],
  ]) {
    h.update(p);
    h.update("\0");
    h.update(b);
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
})();
const prev = existsSync(BUILD_JSON) ? JSON.parse(readFileSync(BUILD_JSON, "utf8")) : null;
const today = new Date().toISOString().slice(0, 10);

const ARTICLE_SIZE_RE = /claude-code-dev-kit\.zip（約(\d+)KB）/g;
const zipKb = (path) => Math.round(statSync(path).size / 1024);

// ======================= --check: 突き合わせだけ =======================
if (CHECK) {
  const problems = [];
  if (!prev) problems.push("kit/BUILD.json がありません");
  else {
    if (prev.version !== version) problems.push(`kit/BUILD.json の版（${prev.version}）と kit/VERSION（${version}）が違います`);
    if (prev.hash !== hash) problems.push("キットの中身（スキル・雛形・ルートの設定／検査スクリプト・README）が kit/BUILD.json の記録と違います");
  }
  if (!existsSync(ZIP_OUT)) problems.push(`${rel(ZIP_OUT)} がありません`);
  else {
    const unzipped = join(work, "unzipped");
    mkdirSync(unzipped, { recursive: true });
    execFileSync("unzip", ["-q", "-o", ZIP_OUT, "-d", unzipped]);
    const expected = listFiles(stage).sort();
    const actual = listFiles(unzipped).sort();
    for (const f of expected) if (!actual.includes(f)) problems.push(`zip に無い: ${f}`);
    for (const f of actual) if (!expected.includes(f)) problems.push(`zip にだけある: ${f}`);
    for (const f of expected) {
      if (actual.includes(f) && !readFileSync(join(stage, f)).equals(readFileSync(join(unzipped, f)))) problems.push(`zip の中身が正本と違う: ${f}`);
    }
    const article = readFileSync(ARTICLE, "utf8");
    const sizes = [...article.matchAll(ARTICLE_SIZE_RE)].map((m) => Number(m[1]));
    if (sizes.length === 0) problems.push(`${rel(ARTICLE)} に「claude-code-dev-kit.zip（約NNKB）」の記述がありません`);
    for (const s of sizes) {
      if (Math.abs(s - zipKb(ZIP_OUT)) > ARTICLE_SIZE_TOLERANCE_KB) problems.push(`記事の「約${s}KB」が zip の実際の大きさ（約${zipKb(ZIP_OUT)}KB）と違います`);
    }
  }
  rmSync(work, { recursive: true, force: true });
  if (problems.length > 0) {
    console.error("❌ 配布キットが正本と一致しません:");
    for (const p of problems) console.error(`   ${p}`);
    console.error("   → `npm run dev-kit` を実行してください（中身が変わっていれば kit/VERSION も上げる）");
    process.exit(1);
  }
  console.log(`✅ 配布キットは正本と一致しています（v${version}・${rel(ZIP_OUT)}・kit/BUILD.json）`);
  process.exit(0);
}

// ======================= 生成 =======================
if (prev && prev.version === version && prev.hash !== hash && !SAME_VERSION) {
  fail(
    `キットの中身が変わりましたが kit/VERSION が ${version} のままです。kit/VERSION を上げてください（例 ${version} → ${bump(version)}）。` +
      "\n   同じ版のままだと利用者側が更新を検知しません。公開前の試行錯誤で意図して同じ版にするなら `npm run dev-kit -- --same-version`",
  );
}
function bump(v) {
  const [a, b, c] = v.split(".").map(Number);
  return `${a}.${b}.${c + 1}`;
}
// zip の中のファイル日時を固定する（同じ中身なら同じ zip になり、git に無意味な差分を積まない）。版が変わった日を使う。
const built = prev && prev.version === version && prev.built ? prev.built : today;
const stamp = new Date(`${built}T00:00:00Z`);
for (const f of listFiles(stage)) utimesSync(join(stage, f), stamp, stamp);
for (const d of listDirs(stage)) utimesSync(d, stamp, stamp);
utimesSync(stage, stamp, stamp);
function listDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => [join(dir, e.name), ...listDirs(join(dir, e.name))]);
}

mkdirSync(dirname(ZIP_OUT), { recursive: true });
rmSync(ZIP_OUT, { force: true });
// zip は macOS / CI（ubuntu）に標準で入っている。-X で拡張属性を落とす。
execFileSync("zip", ["-r", "-X", "-q", ZIP_OUT, ".", "-x", ".DS_Store", "*/.DS_Store"], { cwd: stage, stdio: "inherit" });
if (!existsSync(ZIP_OUT)) fail("zip を作れませんでした");
const zipFileCount = listFiles(stage).length;

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(dirname(DIST_DIR), { recursive: true });
renameSync(distWork, DIST_DIR);
rmSync(work, { recursive: true, force: true });

writeFileSync(BUILD_JSON, JSON.stringify({ version, hash, built }, null, 2) + "\n");

// 記事の「約NNKB」を実測に合わせる（手で直す手順を残さない）。
const kb = zipKb(ZIP_OUT);
const articleBefore = readFileSync(ARTICLE, "utf8");
if (!ARTICLE_SIZE_RE.test(articleBefore)) fail(`${rel(ARTICLE)} に「claude-code-dev-kit.zip（約NNKB）」の記述がありません`);
ARTICLE_SIZE_RE.lastIndex = 0;
const articleAfter = articleBefore.replace(ARTICLE_SIZE_RE, `claude-code-dev-kit.zip（約${kb}KB）`);
const articleChanged = articleAfter !== articleBefore;
if (articleChanged) writeFileSync(ARTICLE, articleAfter);

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
console.log(`✅ ${rel(ZIP_OUT)}（約${kb}KB・${zipFileCount}ファイル）${articleChanged ? `。記事の「約NNKB」を約${kb}KBに書き換えました` : ""}`);
console.log(`   同梱スキル ${skills.length} 本: ${skills.join(", ")}（除外: ${EXCLUDED_SKILLS.join(", ")}）`);
console.log(`✅ ${rel(DIST_DIR)}/（プラグイン ${PLUGIN_NAME} v${version}・マーケットプレイス ${MARKETPLACE_NAME}）`);
console.log(`   呼び名を ${rewritten} 件 /${PLUGIN_NAME}:<name> へ書き換え、各 SKILL.md に前提ブロックを差し込みました（init はそのまま）`);
console.log(`✅ kit/BUILD.json（v${version}・${hash.slice(0, 19)}…・${built}）${prev && prev.hash !== hash && SAME_VERSION ? "（--same-version: 中身が変わりましたが版は据え置き）" : ""}`);
if (!GITHUB_REPO) {
  console.log("⚠️ GITHUB_REPO が未設定です（scripts/dev-kit.mjs）。zip の README は「B. プラグイン」を準備中として出し、dist の README には <GITHUB_REPO 未設定> が残っています。公開前に埋めて作り直してください");
}
if (validated) {
  console.log("✅ claude plugin validate --strict: marketplace と plugin の両方が通りました");
} else {
  console.log("⚠️ claude コマンドが見つからないため plugin validate は未実行です（公開前に `claude plugin validate dist/docdd --strict` を通してください）");
}
console.log("   公開の手順は kit/PUBLISHING.md");
