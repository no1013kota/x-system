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
export const BLOG_FRONT_MATTER_KEYS = [
  "title",
  "description",
  "date",
  "updated",
  "draft",
  "tags",
  "image",
] as const;
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
  /**
   * アイキャッチ画像（任意）。`/blog-images/…` で始まるサイト内パス（2026-09-05 のブログ改善）。
   * 記事ヘッダ・一覧のサムネイル・OGP（`og:image`／Twitter card）に使う。
   * `npm run blog:eyecatch -- <slug>` が生成して front matter へ書き足す。
   */
  image?: string;
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
 * `image` に書けるパス。`public/blog-images/` 配下だけ（外部URLは不可＝置き忘れを実在確認で
 * 拾えるようにする）。ディレクトリは英数字・`_`・`-`、拡張子は画像4種＋SVG。`..`・`//`・空白は
 * 形に合わないので弾かれる。
 */
export const BLOG_IMAGE_PATH_PATTERN = /^\/blog-images\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|svg)$/;

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
):
  | { kind: "none" }
  | { kind: "unclosed" }
  | { kind: "ok"; header: string; body: string; bodyStartLine: number } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // 開きも閉じも**行全体が `---`**（前後の空白は許す）。`----` や `--- x` は区切りとみなさない
  // （黙って読み飛ばさない）。
  if (lines[0].trim() !== "---") return { kind: "none" };
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closeIndex < 0) return { kind: "unclosed" };
  const header = lines.slice(1, closeIndex).join("\n");
  const body = lines.slice(closeIndex + 1).join("\n");
  // 本文1行目がファイルの何行目か（1始まり）。検査の行番号はファイル基準で出す（エディタで飛べる）。
  return { kind: "ok", header, body, bodyStartLine: closeIndex + 2 };
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

  const imageRaw = fields.get("image");
  const image = imageRaw === undefined ? undefined : unquote(imageRaw);
  if (image !== undefined && !BLOG_IMAGE_PATH_PATTERN.test(image)) {
    errors.push(
      `image「${image}」は /blog-images/ 配下のサイト内パス（.png/.jpg/.jpeg/.webp/.svg）にしてください（例: /blog-images/eyecatch/${slug}.png。npm run blog:eyecatch -- ${slug} で生成できます）`,
    );
  }

  const body = split.body.trim();
  if (!body) errors.push("本文がありません");
  for (const img of markdownImages(split.body)) {
    if (!img.alt.trim()) {
      errors.push(
        `画像 ${img.src} に代替テキストがありません（![説明](${img.src}) の形で書いてください）`,
      );
    }
  }
  // 太字にならない `**` は画面に記号のまま残る（2026-09-05 に4記事中3記事で発生・2026-09-05 のブログ改善）。
  // 描画してみないと分からない種類の不備なので、ここで止めて行番号つきで示す。
  errors.push(...unrenderableBoldErrors(split.body, split.bodyStartLine));

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    post: { slug, title, description, date, updated, draft, tags, image, body: split.body },
  };
}

/** `unrenderableBoldMarkers` の結果を、行ごとに1つの理由へまとめる（同じ行の2箇所は同じ直し方で消える）。 */
function unrenderableBoldErrors(body: string, bodyStartLine: number): string[] {
  const byLine = new Map<number, UnrenderableBoldMarker[]>();
  for (const marker of unrenderableBoldMarkers(body)) {
    const list = byLine.get(marker.line) ?? [];
    list.push(marker);
    byLine.set(marker.line, list);
  }
  return [...byLine.entries()].map(([line, markers]) => {
    const places = markers
      .map((m) => `直前「${m.before || "行頭"}」直後「${m.after || "行末"}」`)
      .join("／");
    return `${bodyStartLine + line - 1}行目の ** が太字にならず、記号のまま表示されます（${markers.length}箇所: ${places}）: 「${markers[0].snippet}」。約物（「」（）、。など）を太字の外へ出してください（例: は**「配る」**へ → は「**配る**」へ）`;
  });
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
 * 本文が参照する**サイト内の画像パス**（`/blog-images/x.png` のように `/` で始まるもの）と、
 * front matter の `image`（アイキャッチ）。置き忘れ・コミット漏れは本番で初めて壊れるので、
 * 読み出し側が `public/` の実在を確かめる。
 */
export function localImagePaths(body: string, image?: string): string[] {
  return [
    ...new Set(
      [...(image ? [image] : []), ...markdownImages(body).map((img) => img.src)].filter(
        (src) => src.startsWith("/") && !src.startsWith("//"),
      ),
    ),
  ];
}

/** 太字にならずに画面へ残る `**`（`unrenderableBoldMarkers` の1件）。 */
export interface UnrenderableBoldMarker {
  /** 本文の行番号（1始まり。front matter は数えない）。 */
  line: number;
  /** `**` の直前の文字。行頭なら空文字。 */
  before: string;
  /** `**` の直後の文字。行末なら空文字。 */
  after: string;
  /** その行の前後を含む抜粋。 */
  snippet: string;
}

/**
 * CommonMark の「約物」（Unicode の P と S）。react-markdown が使う micromark と同じ判定
 * （`/\p{P}|\p{S}/u`）。日本語の 「」（）、。 も、全角の ＝ や → もここに入る。
 */
const MARKDOWN_PUNCTUATION = /\p{P}|\p{S}/u;
const MARKDOWN_WHITESPACE = /\s/u;

/** `**` の前後の1文字（サロゲートペアは1文字として返す）。境界なら空文字。 */
function charBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const code = text.charCodeAt(index - 1);
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text[index - 1];
}
function charAfter(text: string, index: number): string {
  if (index >= text.length) return "";
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) return text.slice(index, index + 2);
  return text[index];
}

/** 1つのインライン文脈（段落・見出し・箇条書きの1項目・表の1セル）。 */
interface InlineContext {
  text: string;
  /** `text` の各行が本文の何行目か（`text` は "\n" 区切り）。 */
  lines: number[];
}

/**
 * 本文をインライン文脈へ分ける。強調は段落・見出し・箇条書きの項目・表のセルをまたがないので、
 * ブロックの境目で区切る（区切らないと、別々の項目の `**` が対になったように見えて見逃す）。
 * コードブロックの中は対象外。
 */
function inlineContexts(body: string): InlineContext[] {
  const contexts: InlineContext[] = [];
  let current: InlineContext | null = null;
  const flush = () => {
    if (current) contexts.push(current);
    current = null;
  };
  const push = (text: string, line: number, continues: boolean) => {
    if (continues && current) {
      current.text += "\n" + text;
      current.lines.push(line);
    } else {
      flush();
      current = { text, lines: [line] };
    }
  };
  let fence: string | null = null;
  body.split("\n").forEach((rawLine, index) => {
    const line = index + 1;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(rawLine);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      return;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      return;
    }
    // 引用の `>` は外して中身を見る（引用の中でも強調の規則は同じ）。
    const text = rawLine.replace(/^(\s{0,3}>\s?)+/, "");
    if (text.trim() === "") return flush();
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) return flush(); // 区切り線
    const heading = /^\s{0,3}#{1,6}(?:\s+(.*?))?\s*#*\s*$/.exec(text);
    if (heading) {
      push(heading[1] ?? "", line, false);
      return flush();
    }
    if (/^\s*\|/.test(text)) {
      flush();
      if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text)) return; // 表のヘッダ区切り
      // 表は1セルずつ別の文脈（GFM はセルごとにインラインを解釈する）。`\|` はセル内の文字。
      for (const cell of text.split(/(?<!\\)\|/)) push(cell, line, false);
      return flush();
    }
    const listItem = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(text);
    if (listItem) return push(listItem[1], line, false);
    push(text, line, true);
  });
  flush();
  return contexts;
}

/**
 * 太字にならず画面に残る `**` を列挙する（純粋関数。`npm run blog:check` と画面が同じ判定で使う）。
 *
 * CommonMark の規則（left-/right-flanking）では、`**` の隣が約物（「」（）、。など）のとき、
 * その反対側が空白か約物でないと太字の開始・終了になれない。日本語は約物を太字の中に入れがちで、
 * `は**「配る」**へ`（開始の直後が「、直前が文字）や `（ギット）**は`（終了の直前が）、直後が文字）が
 * 記号のまま表示される（2026-09-05 に公開4記事のうち3記事で発生）。判定は micromark と同じ
 * flanking 規則と対応付け（delimiter run の処理・3の倍数規則）を実装し、**実際に描画されない
 * `**` だけ**を返す（`（**一次資料**）` や `**重み**（設定）` は正しく太字になるので返さない）。
 * コードブロック・インラインコードの中と、`\*` でエスケープした記号は対象外。
 */
export function unrenderableBoldMarkers(body: string): UnrenderableBoldMarker[] {
  const found: UnrenderableBoldMarker[] = [];
  for (const context of inlineContexts(body)) {
    // インラインコードは中身ごと同じ長さのバッククォートに置き換える（隣接文字の種類＝約物を保つ）。
    // エスケープ済みの `\*` は区切りではないので、約物のまま別の記号へ逃がす。
    const text = context.text
      .replace(/(`+)[^`]*?\1/g, (m) => "`".repeat(m.length))
      .replace(/\\\\|\\\*/g, (m) => (m === "\\*" ? "\\∗" : m));
    const runs = delimiterRuns(text);
    pairDelimiters(runs);
    const contextLines = context.text.split("\n");
    for (const run of runs) {
      if (run.remaining < 2) continue;
      const lineIndex = text.slice(0, run.start).split("\n").length - 1;
      const lineText = contextLines[lineIndex];
      const column = run.start - (text.lastIndexOf("\n", run.start - 1) + 1);
      const from = Math.max(0, column - 12);
      const to = Math.min(lineText.length, column + run.length + 12);
      const snippet = `${from > 0 ? "…" : ""}${lineText.slice(from, to)}${to < lineText.length ? "…" : ""}`;
      found.push({ line: context.lines[lineIndex], before: run.before, after: run.after, snippet });
    }
  }
  return found;
}

interface DelimiterRun {
  start: number;
  end: number;
  length: number;
  before: string;
  after: string;
  canOpen: boolean;
  canClose: boolean;
  /** 対応付けの後に残った `*` の数。0 なら全部が強調記号として消費された。 */
  remaining: number;
  /** スタックから外れた（対応済み・対応不能で確定）。 */
  removed: boolean;
}

/** `*` の連なりを CommonMark の flanking 規則つきで列挙する。 */
function delimiterRuns(text: string): DelimiterRun[] {
  const runs: DelimiterRun[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "*") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] === "*") j += 1;
    const before = charBefore(text, i);
    const after = charAfter(text, j);
    const beforeWhitespace = before === "" || MARKDOWN_WHITESPACE.test(before);
    const afterWhitespace = after === "" || MARKDOWN_WHITESPACE.test(after);
    const beforePunctuation = before !== "" && MARKDOWN_PUNCTUATION.test(before);
    const afterPunctuation = after !== "" && MARKDOWN_PUNCTUATION.test(after);
    const leftFlanking = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
    const rightFlanking = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
    runs.push({
      start: i,
      end: j,
      length: j - i,
      before,
      after,
      canOpen: leftFlanking,
      canClose: rightFlanking,
      remaining: j - i,
      removed: false,
    });
    i = j;
  }
  return runs;
}

/** CommonMark「process emphasis」の `*` 限定版。対にできた分だけ `remaining` を減らす。 */
function pairDelimiters(runs: DelimiterRun[]): void {
  for (let c = 0; c < runs.length; c += 1) {
    const closer = runs[c];
    if (closer.removed || !closer.canClose) continue;
    while (closer.remaining > 0) {
      let openerIndex = -1;
      for (let o = c - 1; o >= 0; o -= 1) {
        const candidate = runs[o];
        if (candidate.removed || !candidate.canOpen || candidate.remaining === 0) continue;
        // 「3の倍数」規則: 開閉どちらにもなれる記号が絡むとき、長さの和が3の倍数なら対にしない
        // （両方が3の倍数なら例外）。commonmark.js と同じ式。
        const oddMatch =
          (closer.canOpen || candidate.canClose) &&
          closer.length % 3 !== 0 &&
          (candidate.length + closer.length) % 3 === 0;
        if (oddMatch) continue;
        openerIndex = o;
        break;
      }
      if (openerIndex < 0) {
        if (!closer.canOpen) closer.removed = true;
        break;
      }
      const opener = runs[openerIndex];
      const use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
      opener.remaining -= use;
      closer.remaining -= use;
      // 開始と終了の間に残った記号は対にならず文字として残る。
      for (let k = openerIndex + 1; k < c; k += 1) runs[k].removed = true;
      if (opener.remaining === 0) opener.removed = true;
      if (closer.remaining === 0) closer.removed = true;
    }
  }
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
