#!/usr/bin/env node
//
// ブログ記事の front matter を検証する（T-M8-184/193）。
// 記事は blog/published/（公開済み）と blog/drafts/（下書き）に分かれる（T-M8-193）。
//
//   npm run blog:check            # 全記事（published＋drafts）
//   npm run blog:check -- <file>  # 1記事（/blog-publish が使う。両フォルダから探す）
//
// 判定は src/lib/blog/blog-content.ts（画面 /blog と同じもの・import を持たないので直接読める）。
// 不備があれば**理由をすべて**出して exit 1。下書き（drafts/ の draft: true）は「未公開」として数える。
// フォルダと draft フラグの食い違い（published に draft:true・drafts に draft 無し・blog/ 直下の
// 置き忘れ）は不備として出す——画面は published しか読まないため、置き場所を誤ると黙って
// 「公開したつもり」「下書きのつもりが宙に浮く」になる（原則1）。
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

const BLOG_ROOT = resolve("blog");
const PUBLISHED_DIR = join(BLOG_ROOT, "published");
const DRAFTS_DIR = join(BLOG_ROOT, "drafts");
const PUBLIC_DIR = resolve("public");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function listArticles(dir) {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter(isBlogArticleFile)
    .sort()
    .map((name) => join(dir, name));
}

function targetFiles() {
  if (args.length > 0) {
    return args.flatMap((arg) => {
      // ファイル名だけなら published と drafts の**両方**を対象にする（片方だけ検証して
      // 同名の壊れた下書きを見逃さない・T-M8-192のレビュー指摘）。
      const candidates = arg.includes("/")
        ? [resolve(arg)]
        : [join(PUBLISHED_DIR, arg), join(DRAFTS_DIR, arg)];
      const name = basename(candidates[0]);
      if (!isBlogArticleFile(name)) {
        console.error(`❌ ${arg} は記事ファイルではありません（.md で、README.md と _ 始まりを除く）`);
        process.exit(2);
      }
      const found = candidates.filter((c) => {
        try {
          statSync(c);
          return true;
        } catch {
          return false;
        }
      });
      if (found.length === 0) {
        console.error(`❌ ${arg} が見つかりません（blog/published/ か blog/drafts/ のファイル名か、パスを指定してください）`);
        process.exit(2);
      }
      if (found.length > 1) {
        console.log(`ℹ️ ${name} は published と drafts の両方にあります（両方を検証。公開時は同名の下書きを整理してください）`);
      }
      return found;
    });
  }
  try {
    if (!statSync(BLOG_ROOT).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`❌ 記事ディレクトリ ${BLOG_ROOT} がありません`);
    process.exit(2);
  }
  return [...listArticles(PUBLISHED_DIR), ...listArticles(DRAFTS_DIR), ...listArticles(BLOG_ROOT)];
}

let published = 0;
let drafts = 0;
let invalid = 0;
for (const path of targetFiles()) {
  const name = basename(path);
  const normalized = path.replace(/\\/g, "/");
  const inDrafts = normalized.includes("/blog/drafts/");
  const inPublished = normalized.includes("/blog/published/");
  // blog/ 直下の置き忘れ（旧配置）。画面は published しか読まないので、ここにあると黙って出ない。
  if (!inDrafts && !inPublished) {
    invalid += 1;
    console.log(`❌ ${name}`);
    console.log(`   - blog/ 直下に置かれています。公開なら blog/published/ へ、下書きなら blog/drafts/ へ移動してください（T-M8-193）`);
    continue;
  }
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
  // フォルダと draft フラグの食い違いは不備（置き場所とフラグの二重の印を一致させる）。
  if (inPublished && result.post.draft) {
    invalid += 1;
    console.log(`❌ ${name}`);
    console.log(`   - blog/published/ に draft: true の記事があります（/blog-publish で公開するか blog/drafts/ へ移動してください）`);
    continue;
  }
  if (inDrafts && !result.post.draft) {
    invalid += 1;
    console.log(`❌ ${name}`);
    console.log(`   - blog/drafts/ の記事に draft: true がありません（下書きなら front matter へ draft: true を足し、公開するなら /blog-publish を使ってください）`);
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
