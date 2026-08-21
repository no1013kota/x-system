/**
 * ブログ記事（`blog/*.md`）の front matter 解析と検証（T-M8-184）。
 *
 * 記事はDBではなく**リポジトリの `blog/` ディレクトリ**で管理する（投稿＝コミット＋通常の反映）。
 * 1ファイル＝1記事、slug＝ファイル名（拡張子を除く）。先頭の `---` 〜 `---` が front matter で、
 * 形式は `key: value` の1行1項目だけ（YAMLの入れ子・複数行は使わない。非エンジニアの運営者と
 * 執筆スキルが確実に書ける範囲に絞る）。
 *
 * **この文書は import を持たない。** `scripts/blog-check.mjs`（`npm run blog:check`）が
 * Node から直接読み、画面（`/blog`）と**同じ判定**で検証するため（判定が2つあると片方だけ古くなる）。
 *
 * 判定は「正常な空」と「失敗」を分ける（CLAUDE.md 原則1）: 下書き（`draft: true`）は正常に非公開、
 * front matter の不備は `invalid` として理由つきで返し、公開側には出さない。
 */

/** front matter で受け付けるキー。これ以外があれば誤記として止める（黙って捨てない）。 */
export const BLOG_FRONT_MATTER_KEYS = ["title", "description", "date", "updated", "draft", "tags"] as const;
export type BlogFrontMatterKey = (typeof BLOG_FRONT_MATTER_KEYS)[number];

/** 公開ページが扱う1記事。 */
export interface BlogPost {
  /** URLの一部（`/blog/<slug>`）。ファイル名（拡張子なし）。 */
  slug: string;
  title: string;
  /** 一覧・OGPに出す要約（1〜2文）。 */
  description: string;
  /** 公開日 `YYYY-MM-DD`。一覧の並び順に使う。 */
  date: string;
  /** 更新日 `YYYY-MM-DD`（任意）。 */
  updated?: string;
  draft: boolean;
  tags: string[];
  /** front matter を除いたMarkdown本文。 */
  body: string;
}

export type BlogParseResult =
  | { ok: true; post: BlogPost }
  | { ok: false; errors: string[] };

/** URLに安全なslug。小文字英数字とハイフンのみ（日本語ファイル名は percent-encoding で読みにくくなる）。 */
export const BLOG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** slugの上限。長すぎるURLはXでの共有時に切れる。 */
const MAX_SLUG_LENGTH = 80;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 200;

/**
 * `blog/` 配下でブログ記事として扱うファイルか。
 * `README.md` と `_` 始まり（メモ・テンプレート）は記事にしない。
 */
export function isBlogArticleFile(fileName: string): boolean {
  return fileName.endsWith(".md") && fileName !== "README.md" && !fileName.startsWith("_");
}

export function slugFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/, "");
}

/** 実在する日付か（`2026-02-30` のような値を弾く）。 */
function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 文字数（絵文字などサロゲートペアを1文字と数える。`length` は UTF-16 単位で2になる）。 */
function charCount(value: string): number {
  return [...value].length;
}

/** `"..."` / `'...'` で囲まれていれば外す（YAML風の引用に寛容にする）。 */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `[a, b]` または `a, b` をタグ配列にする。空要素は落とし、重複は最初の1つだけ残す。 */
function parseTags(value: string): string[] {
  let inner = unquote(value);
  if (inner.startsWith("[") && inner.endsWith("]")) inner = inner.slice(1, -1);
  const tags = inner
    .split(",")
    .map((tag) => unquote(tag))
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
}

/**
 * front matter と本文を切り出す。`---` で始まっていなければ front matter 無し。
 * 閉じの `---` が無い場合は null を返し、呼び出し側がエラーにする。
 */
function splitFrontMatter(
  source: string,
): { kind: "none" } | { kind: "unclosed" } | { kind: "ok"; header: string; body: string } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // 開きも閉じも**行全体が `---`**（前後の空白は許す）。`----` や `--- x` は区切りとみなさない
  // （黙って読み飛ばさない）。
  if (lines[0].trim() !== "---") return { kind: "none" };
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closeIndex < 0) return { kind: "unclosed" };
  const header = lines.slice(1, closeIndex).join("\n");
  const body = lines.slice(closeIndex + 1).join("\n");
  return { kind: "ok", header, body };
}

/**
 * 1記事を解析する。失敗は**理由をすべて**列挙する（1つ直すたびに次が出る形にしない）。
 * @param source ファイル全文
 * @param slug ファイル名から得たslug
 */
export function parseBlogPost(source: string, slug: string): BlogParseResult {
  const errors: string[] = [];
  if (!BLOG_SLUG_PATTERN.test(slug)) {
    errors.push(
      `ファイル名（slug）「${slug}」はURLに使えません。小文字英数字とハイフンだけにしてください（例: x-prompt-basics.md）`,
    );
  } else if (slug.length > MAX_SLUG_LENGTH) {
    errors.push(`ファイル名（slug）が長すぎます（${slug.length}文字。上限${MAX_SLUG_LENGTH}）`);
  }

  const split = splitFrontMatter(source);
  if (split.kind === "none") {
    errors.push("先頭に front matter（--- で囲んだ title/description/date）がありません");
    return { ok: false, errors };
  }
  if (split.kind === "unclosed") {
    errors.push("front matter の閉じ（---）がありません");
    return { ok: false, errors };
  }

  const fields = new Map<string, string>();
  for (const [index, rawLine] of split.header.split("\n").entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      errors.push(`front matter ${index + 1}行目「${line}」は key: value の形ではありません`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!(BLOG_FRONT_MATTER_KEYS as readonly string[]).includes(key)) {
      errors.push(
        `front matter のキー「${key}」は使えません（使えるのは ${BLOG_FRONT_MATTER_KEYS.join(" / ")}）`,
      );
      continue;
    }
    if (fields.has(key)) {
      errors.push(`front matter のキー「${key}」が2回あります`);
      continue;
    }
    fields.set(key, value);
  }

  const title = unquote(fields.get("title") ?? "");
  if (!title) errors.push("title がありません");
  else if (charCount(title) > MAX_TITLE_LENGTH) {
    errors.push(`title が長すぎます（${charCount(title)}文字。上限${MAX_TITLE_LENGTH}）`);
  }

  const description = unquote(fields.get("description") ?? "");
  if (!description) errors.push("description（一覧に出す要約）がありません");
  else if (charCount(description) > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description が長すぎます（${charCount(description)}文字。上限${MAX_DESCRIPTION_LENGTH}）`,
    );
  }

  const date = unquote(fields.get("date") ?? "");
  if (!date) errors.push("date（公開日 YYYY-MM-DD）がありません");
  else if (!isRealDate(date)) errors.push(`date「${date}」は YYYY-MM-DD の実在する日付ではありません`);

  const updatedRaw = fields.get("updated");
  const updated = updatedRaw === undefined ? undefined : unquote(updatedRaw);
  if (updated !== undefined && !isRealDate(updated)) {
    errors.push(`updated「${updated}」は YYYY-MM-DD の実在する日付ではありません`);
  }
  if (updated && date && isRealDate(date) && isRealDate(updated) && updated < date) {
    errors.push(`updated（${updated}）が date（${date}）より前です`);
  }

  const draftRaw = fields.get("draft");
  let draft = false;
  if (draftRaw !== undefined) {
    const normalized = unquote(draftRaw).toLowerCase();
    if (normalized === "true") draft = true;
    else if (normalized === "false") draft = false;
    else errors.push(`draft「${draftRaw}」は true か false にしてください`);
  }

  const tags = fields.has("tags") ? parseTags(fields.get("tags")!) : [];

  const body = split.body.trim();
  if (!body) errors.push("本文がありません");
  for (const image of markdownImages(split.body)) {
    if (!image.alt.trim()) {
      errors.push(
        `画像 ${image.src} に代替テキストがありません（![説明](${image.src}) の形で書いてください）`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    post: { slug, title, description, date, updated, draft, tags, body: split.body },
  };
}

/** 本文中の Markdown 画像 `![alt](src)`。コードブロック内は除く。 */
export function markdownImages(body: string): { alt: string; src: string }[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...withoutCode.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({
    alt: m[1],
    src: m[2],
  }));
}

/**
 * 本文が参照する**サイト内の画像パス**（`/blog-images/x.png` のように `/` で始まるもの）。
 * 置き忘れ・コミット漏れは本番で初めて壊れるので、読み出し側が `public/` の実在を確かめる。
 */
export function localImagePaths(body: string): string[] {
  return [
    ...new Set(
      markdownImages(body)
        .map((image) => image.src)
        .filter((src) => src.startsWith("/") && !src.startsWith("//")),
    ),
  ];
}

/** 公開する記事だけを新しい順（date 降順・同日はslug昇順で安定）に並べる。 */
export function publishedPosts(posts: readonly BlogPost[]): BlogPost[] {
  return posts
    .filter((post) => !post.draft)
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

/** `2026-08-21` → `2026年8月21日`。一覧・記事ヘッダの表示用。 */
export function formatBlogDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}
