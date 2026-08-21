import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  isBlogArticleFile,
  localImagePaths,
  parseBlogPost,
  publishedPosts,
  slugFromFileName,
  type BlogPost,
} from "./blog-content";

/**
 * `blog/` ディレクトリの読み出し（T-M8-184）。判定は `blog-content.ts`、ここはファイルI/Oだけ。
 *
 * `scripts/blog-check.mjs`（`npm run blog:check`）は判定（`blog-content.ts`・import無し）だけを
 * Node から直接読み、ディレクトリ走査はこのファイルと同じ規則で自前に行う（`.ts` 同士の拡張子付き
 * import は tsconfig が許さないため）。E2E（`e2e/blog.spec.ts`）はこのファイルの関数で
 * 「いま公開されている記事」を数え、画面と突き合わせる。
 *
 * Vercel では `next.config.ts` の `outputFileTracingIncludes` が `blog/**` を同梱する。
 * これが無いと**本番だけ記事0件**になる（ローカルと dev は cwd から直接読めるので気付けない）。
 */

/** 記事ディレクトリ。テストは一時ディレクトリを渡す。 */
export const BLOG_DIR = join(process.cwd(), "blog");
/** 本文が `/blog-images/x.png` で参照する画像の置き場（Next.js の静的ファイル）。 */
export const PUBLIC_DIR = join(process.cwd(), "public");

/**
 * 本文が参照するサイト内画像のうち `public/` に無いもの。
 * 画像の置き忘れ・コミット漏れは**本番で初めて壊れる**ので、不備として公開側に出さない。
 */
export function missingLocalImages(body: string, publicDir: string = PUBLIC_DIR): string[] {
  return localImagePaths(body).filter((src) => !existsSync(join(publicDir, decodeURI(src))));
}

export interface InvalidBlogFile {
  file: string;
  errors: string[];
}

export interface BlogCollection {
  /** 解析できた全記事（下書き含む・未ソート）。 */
  posts: BlogPost[];
  /** front matter の不備などで**公開側に出さなかった**ファイルと理由。空なら問題なし。 */
  invalid: InvalidBlogFile[];
  /** ディレクトリが無い＝記事0件と区別する（配置忘れ・同梱忘れを見分けるため）。 */
  directoryExists: boolean;
}

/** `dir` の記事ファイルをすべて読む。ディレクトリが無ければ空＋`directoryExists: false`。 */
export function readBlogCollection(
  dir: string = BLOG_DIR,
  publicDir: string = PUBLIC_DIR,
): BlogCollection {
  // 「ディレクトリが無い」は失敗ではなく**判定結果**（`directoryExists: false`）として返し、
  // 呼び出し側（/blog の診断表示・doctor「ブログ記事の同梱」）が同梱漏れとして扱う。
  // それ以外（権限など）は本当の失敗なので投げる。
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { posts: [], invalid: [], directoryExists: false };
  }
  const names = readdirSync(dir);
  const posts: BlogPost[] = [];
  const invalid: InvalidBlogFile[] = [];
  for (const name of names.filter(isBlogArticleFile).sort()) {
    const source = readFileSync(join(dir, name), "utf8");
    const result = parseBlogPost(source, slugFromFileName(name));
    if (!result.ok) {
      invalid.push({ file: name, errors: result.errors });
      continue;
    }
    const missing = missingLocalImages(result.post.body, publicDir);
    if (missing.length > 0) {
      invalid.push({
        file: name,
        errors: missing.map((src) => `画像 ${src} が public${src} にありません（置き忘れかコミット漏れ）`),
      });
      continue;
    }
    posts.push(result.post);
  }
  return { posts, invalid, directoryExists: true };
}

/** 公開記事を新しい順に。 */
export function listPublishedPosts(dir: string = BLOG_DIR, publicDir: string = PUBLIC_DIR): BlogPost[] {
  return publishedPosts(readBlogCollection(dir, publicDir).posts);
}

/** slug の公開記事。無い・下書き・不備はすべて null（404にする）。 */
export function findPublishedPost(
  slug: string,
  dir: string = BLOG_DIR,
  publicDir: string = PUBLIC_DIR,
): BlogPost | null {
  return listPublishedPosts(dir, publicDir).find((post) => post.slug === slug) ?? null;
}
