#!/usr/bin/env node
//
// ブログ記事（blog/*.md）の front matter を検証する（T-M8-184）。
//
//   npm run blog:check            # 全記事
//   npm run blog:check -- <file>  # 1記事（/blog-publish が使う）
//
// 判定は src/lib/blog/blog-content.ts（画面 /blog と同じもの・import を持たないので直接読める）。
// 不備があれば**理由をすべて**出して exit 1。下書き（draft: true）は不備ではなく「未公開」として数える。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// 判定モジュールは import を持たない前提（blog-content.test.ts が固定）。読めなければ理由を出して止まる。
const { isBlogArticleFile, localImagePaths, parseBlogPost, slugFromFileName } = await import(
  "../src/lib/blog/blog-content.ts"
).catch((error) => {
  console.error(
    `❌ 判定モジュール src/lib/blog/blog-content.ts を読めませんでした（import を持たない .ts であることが前提です）: ${error.message}`,
  );
  process.exit(2);
});

const BLOG_DIR = resolve("blog");
const PUBLIC_DIR = resolve("public");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function targetFiles() {
  if (args.length > 0) {
    return args.map((arg) => {
      const path = arg.includes("/") ? resolve(arg) : join(BLOG_DIR, arg);
      const name = basename(path);
      if (!isBlogArticleFile(name)) {
        console.error(`❌ ${arg} は記事ファイルではありません（blog/ 直下の .md で、README.md と _ 始まりを除く）`);
        process.exit(2);
      }
      try {
        statSync(path);
      } catch {
        console.error(`❌ ${arg} が見つかりません（blog/ 直下のファイル名か、パスを指定してください）`);
        process.exit(2);
      }
      return path;
    });
  }
  try {
    if (!statSync(BLOG_DIR).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`❌ 記事ディレクトリ ${BLOG_DIR} がありません`);
    process.exit(2);
  }
  return readdirSync(BLOG_DIR)
    .filter(isBlogArticleFile)
    .sort()
    .map((name) => join(BLOG_DIR, name));
}

let published = 0;
let drafts = 0;
let invalid = 0;
for (const path of targetFiles()) {
  const name = basename(path);
  const result = parseBlogPost(readFileSync(path, "utf8"), slugFromFileName(name));
  // 本文が参照するサイト内画像の実在（blog-files.ts の missingLocalImages と同じ規則）。
  const missingImages = result.ok
    ? localImagePaths(result.post.body).filter((src) => !existsSync(join(PUBLIC_DIR, decodeURI(src))))
    : [];
  if (!result.ok || missingImages.length > 0) {
    invalid += 1;
    console.log(`❌ ${name}`);
    const errors = result.ok
      ? missingImages.map((src) => `画像 ${src} が public${src} にありません（置き忘れかコミット漏れ）`)
      : result.errors;
    for (const error of errors) console.log(`   - ${error}`);
    continue;
  }
  if (result.post.draft) {
    drafts += 1;
    console.log(`📝 ${name}  下書き（draft: true）「${result.post.title}」`);
  } else {
    published += 1;
    console.log(`✅ ${name}  公開 ${result.post.date}「${result.post.title}」 → /blog/${result.post.slug}`);
  }
}

console.log("");
if (invalid > 0) {
  console.log(`❌ 不備 ${invalid} 件（公開 ${published}・下書き ${drafts}）。上の理由を直してから再実行してください`);
  process.exit(1);
}
console.log(`✅ 不備なし（公開 ${published}・下書き ${drafts}）`);
