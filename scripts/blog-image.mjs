#!/usr/bin/env node
//
// ブログの画像を作る（2026-09-05 のブログ改善）。SVG を組み立て、sharp で PNG にする。
//
//   npm run blog:eyecatch -- <slug>
//     blog/published/ か blog/drafts/ の記事を読み、アイキャッチ（1200×630）を
//     public/blog-images/eyecatch/<slug>.png に書く。front matter に image が無ければ
//     `image: /blog-images/eyecatch/<slug>.png` を書き足す（既存キーの順は変えない）。
//     title を変えたら実行し直す（画像の文字は生成時の title）。
//
//   npm run blog:diagram -- <in.svg> <out.png>
//     図の SVG（blog/diagrams/<slug>-<name>.svg に置く）を2倍密度で PNG にし
//     public/blog-images/<out.png> に書く。本文には ![説明](/blog-images/<out.png>) で貼る。
//     あわせてスマホ表示の実寸（幅 375px）に縮めたプレビューを一時ディレクトリに書く。開いて文字が
//     読めるか確かめる（2026-09-05 の読者レビュー: 幅 1200・22px の図はスマホで約 7px になり読めなかった）。
//
// 手作業（デザインツールで作る・書き出す・パスを書き写す）を覚えておかなくて済むようにする道具
// （CLAUDE.md 原則3）。生成後は PNG を開いて日本語が □（豆腐）になっていないか確かめる。
// 文字は SVG の font-family "Hiragino Sans, Noto Sans JP, sans-serif" で描く（mac は Hiragino、
// Linux は Noto Sans JP/CJK が入っていれば使われる。どちらも無いと豆腐になる）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BLOG_ROOT = join(ROOT, "blog");
const PUBLIC_IMAGES = join(ROOT, "public", "blog-images");

const BRAND = "#7d1f75";
const BRAND_SUBTLE = "#f4e8f3";
const INK = "#1f1a1e";
const FONT_FAMILY = "Hiragino Sans, Noto Sans JP, sans-serif";
const WIDTH = 1200;
const HEIGHT = 630;
/** 図の文字の下限。スマホ（表示幅 375px）に縮めたときに 12px を切ると読めない（幅 1200 なら 40px）。 */
const PHONE_WIDTH = 375;
const MIN_PHONE_TEXT_PX = 12;

const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 文字幅の見積もり（em 単位）。全角（日本語）は 1、英数字はおよそ 0.55〜0.65、空白は 0.3。
 * フォントの実測はできない（sharp は SVG を描くだけ）ので、余白を多めに取って折り返す。
 */
function charWidth(ch) {
  const code = ch.codePointAt(0);
  if (code === 0x20) return 0.3;
  if (code < 0x7f) return /[A-Z0-9]/.test(ch) ? 0.64 : /[a-z]/.test(ch) ? 0.56 : 0.4;
  if (code >= 0x2e80) return 1; // CJK・全角記号・全角英数
  return 0.7;
}

function textWidth(text, size) {
  let width = 0;
  for (const ch of text) width += charWidth(ch) * size;
  return width;
}

/** 行頭に来られない約物（ぶら下げる）と、行末に置けない約物（次の行へ送る）。 */
const NO_LINE_START = "」』）］】〉》、。，．・ー〜！？:;,.!?)]}";
const NO_LINE_END = "「『（［【〈《([{";

/** 文字単位の折り返し（日本語向け）。英単語の途中では切らず、直前の空白まで戻る。 */
function wrapLines(text, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    const w = charWidth(ch) * size;
    if (line && textWidth(line, size) + w > maxWidth) {
      if (NO_LINE_START.includes(ch)) {
        line += ch;
        continue;
      }
      let carry = "";
      const last = [...line].at(-1) ?? "";
      if (NO_LINE_END.includes(last)) {
        carry = last;
        line = line.slice(0, -last.length);
      } else if (/[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]/.test(last)) {
        const space = line.lastIndexOf(" ");
        if (space > 0 && line.length - space <= 15) {
          carry = line.slice(space + 1);
          line = line.slice(0, space);
        }
      }
      lines.push(line.trimEnd());
      line = (carry + ch).trimStart();
      continue;
    }
    line += ch;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** 長さに応じて 44px から 26px まで縮め、最大3行に収める。収まらなければ3行目を「…」で切る。 */
function fitTitle(title, maxWidth) {
  for (const size of [44, 40, 36, 32, 30, 28, 26]) {
    const lines = wrapLines(title, size, maxWidth);
    if (lines.length <= 3) return { size, lines };
  }
  const size = 26;
  const lines = wrapLines(title, size, maxWidth).slice(0, 3);
  lines[2] = [...lines[2]].slice(0, -1).join("") + "…";
  return { size, lines, truncated: true };
}

function eyecatchSvg({ title, tags }) {
  const margin = 80;
  const { size, lines, truncated } = fitTitle(title, WIDTH - margin * 2);
  const lineHeight = Math.round(size * 1.5);
  const blockHeight = lineHeight * lines.length;
  const centerY = 320;
  const firstBaseline = centerY - blockHeight / 2 + size * 0.85;
  const titleText = lines
    .map(
      (line, i) =>
        `<text x="${WIDTH / 2}" y="${(firstBaseline + i * lineHeight).toFixed(1)}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="700" fill="${INK}">${escapeXml(line)}</text>`,
    )
    .join("\n    ");

  // タグは左下に丸いラベルで並べる。幅を超える分は出さない（3つ程度を想定）。
  const tagSize = 22;
  let x = margin;
  const tagY = 530;
  const pills = [];
  for (const tag of tags) {
    const label = `#${tag}`;
    const w = Math.ceil(textWidth(label, tagSize) + 36);
    if (x + w > WIDTH - margin) break;
    pills.push(
      `<rect x="${x}" y="${tagY}" width="${w}" height="42" rx="21" fill="#ffffff" stroke="${BRAND}" stroke-opacity="0.35" stroke-width="1.5"/>` +
        `<text x="${x + w / 2}" y="${tagY + 29}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${tagSize}" font-weight="600" fill="${BRAND}">${escapeXml(label)}</text>`,
    );
    x += w + 12;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND_SUBTLE}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="1090" cy="70" r="300" fill="${BRAND}" fill-opacity="0.05"/>
  <circle cx="120" cy="620" r="180" fill="${BRAND}" fill-opacity="0.04"/>
  <rect x="0" y="${HEIGHT - 12}" width="${WIDTH}" height="12" fill="${BRAND}"/>
  <text x="${margin}" y="98" font-family="${FONT_FAMILY}" font-size="26" font-weight="700" letter-spacing="1" fill="${BRAND}">Exos AI Blog</text>
  <g>
    ${titleText}
  </g>
  ${pills.join("\n  ")}
</svg>`;
  return { svg, size, lines, truncated };
}

function findArticle(slugArg) {
  const slug = slugArg.replace(/\.md$/, "");
  const candidates = [join(BLOG_ROOT, "published", `${slug}.md`), join(BLOG_ROOT, "drafts", `${slug}.md`)];
  const found = candidates.filter((path) => existsSync(path));
  if (found.length === 0) {
    fail(`${slug}.md が blog/published/ にも blog/drafts/ にもありません`);
  }
  if (found.length > 1) {
    fail(`${slug}.md が published と drafts の両方にあります。どちらかを整理してから実行してください`);
  }
  return { slug, path: found[0] };
}

/** front matter に image が無ければ、閉じの --- の直前へ書き足す（既存キーの順は保つ）。 */
function ensureImageKey(path, imagePath) {
  const raw = readFileSync(path, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(eol);
  if (lines[0].trim() !== "---") fail(`${basename(path)} の先頭に front matter がありません`);
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close < 0) fail(`${basename(path)} の front matter が閉じていません`);
  const existing = lines.slice(1, close).find((line) => /^\s*image\s*:/.test(line));
  if (existing) {
    const value = existing.slice(existing.indexOf(":") + 1).trim();
    return { changed: false, value };
  }
  lines.splice(close, 0, `image: ${imagePath}`);
  writeFileSync(path, lines.join(eol));
  return { changed: true, value: imagePath };
}

async function eyecatch() {
  const [slugArg] = args;
  if (!slugArg) fail("使い方: npm run blog:eyecatch -- <slug>");
  const { parseBlogPost } = await import("../src/lib/blog/blog-content.ts");
  const { slug, path } = findArticle(slugArg);
  const parsed = parseBlogPost(readFileSync(path, "utf8"), slug);
  if (!parsed.ok) {
    console.error(`❌ ${basename(path)} に不備があるため画像を作れません（title と tags を読むために解析します）:`);
    for (const error of parsed.errors) console.error(`   - ${error}`);
    process.exit(1);
  }
  const { title, tags } = parsed.post;
  const { svg, size, lines, truncated } = eyecatchSvg({ title, tags });
  const outDir = join(PUBLIC_IMAGES, "eyecatch");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${slug}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  const meta = await sharp(out).metadata();
  const imagePath = `/blog-images/eyecatch/${slug}.png`;
  console.log(`✅ ${relative(ROOT, out)}（${meta.width}×${meta.height}・題名 ${size}px ${lines.length}行）`);
  if (truncated) console.log("⚠️ 題名が長く3行に収まらないため、3行目を「…」で切りました");
  const key = ensureImageKey(path, imagePath);
  if (key.changed) {
    console.log(`✅ ${relative(ROOT, path)} の front matter に image: ${imagePath} を書き足しました`);
  } else if (key.value === imagePath) {
    console.log(`ℹ️ front matter の image は設定済み（${key.value}）。画像だけ作り直しました`);
  } else {
    console.log(
      `⚠️ front matter の image は ${key.value} のままです。生成した画像を使うなら image: ${imagePath} に書き換えてください`,
    );
  }
  console.log(`   次: 画像を開いて日本語が □ になっていないか確認 → npm run blog:check -- ${slug}.md`);
}

async function diagram() {
  const [input, output] = args;
  if (!input || !output) fail("使い方: npm run blog:diagram -- <in.svg> <out.png>");
  const inPath = resolve(input);
  if (!existsSync(inPath)) fail(`${input} がありません`);
  if (!/\.svg$/i.test(inPath)) fail(`${input} は .svg ではありません`);
  if (!/\.png$/i.test(output)) fail(`${output} は .png で指定してください`);
  // 出力先は public/blog-images/ 配下に限る。名前だけなら直下、/blog-images/... や
  // public/blog-images/... で始まるならそのまま解釈する。
  const stripped = output.replace(/^\/?blog-images\//, "").replace(/^public\/blog-images\//, "");
  const outPath = resolve(PUBLIC_IMAGES, stripped);
  if (!outPath.startsWith(PUBLIC_IMAGES + sep)) {
    fail(`出力先は public/blog-images/ の中にしてください（指定: ${output}）`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const svg = readFileSync(inPath);
  const source = await sharp(svg).metadata();
  if (!source.width) fail(`${input} の幅が読めません（<svg width="…"> を付ける）`);
  // 文字の下限を機械的に見る（プレビューを開き忘れても止まる・原則3）。font-size 属性の最小値を
  // スマホ幅に換算する。transform で拡大縮小した文字は拾えないので、図では transform を使わない。
  const sizes = [...svg.toString("utf8").matchAll(/font-size="([\d.]+)(?:px)?"/g)].map((m) => Number(m[1]));
  if (sizes.length === 0) fail(`${input} に font-size="…" の文字がありません（図の文字は font-size 属性で指定する）`);
  const minSize = Math.min(...sizes);
  const onPhone = (minSize / source.width) * PHONE_WIDTH;
  if (onPhone < MIN_PHONE_TEXT_PX) {
    const needed = Math.ceil((MIN_PHONE_TEXT_PX / PHONE_WIDTH) * source.width);
    fail(
      `最小の文字 ${minSize}px は、幅 ${source.width} の図だとスマホ（表示 ${PHONE_WIDTH}px）で約 ${onPhone.toFixed(1)}px になり読めません。` +
        `${needed}px 以上にするか、長い説明文を本文へ移して短くしてください`,
    );
  }
  // density 144 = 72dpi の2倍。SVG の width/height をそのまま2倍の画素で描く（Retina で滲まない）。
  // 図は2色＋黒なのでパレット化（256色）すると見た目を変えずに大きく縮む（フルカラーだと1点 300〜500KB になり、
  // スマホにも本文幅の3倍の画素をそのまま送ることになる・2026-09-05 の編集レビュー）。
  await sharp(svg, { density: 144 }).png({ palette: true, compressionLevel: 9 }).toFile(outPath);
  const meta = await sharp(outPath).metadata();
  const urlPath = "/blog-images/" + relative(PUBLIC_IMAGES, outPath).split(sep).join("/");
  // スマホ幅（375px）のプレビュー。記事本文では図がこの幅まで縮むので、読める大きさかをここで確かめる。
  const phonePreview = join(tmpdir(), `${basename(outPath, ".png")}-phone375.png`);
  await sharp(outPath).resize({ width: 375 }).png().toFile(phonePreview);
  console.log(`✅ ${relative(ROOT, outPath)}（${meta.width}×${meta.height}。SVG は ${source.width}×${source.height}）`);
  if ((source.width ?? 0) < 1200) {
    console.log(`⚠️ SVG の幅が ${source.width}px です。図は幅 1200 で描く決まり（最小の文字 40px 以上。スマホでは表示幅 375px＝約0.3倍に縮む）`);
  }
  console.log(`   文字: 最小 ${minSize}px → スマホ（表示 ${PHONE_WIDTH}px）で約 ${onPhone.toFixed(1)}px`);
  console.log(`   本文に貼る: ![図の説明を書く](${urlPath})`);
  console.log(`   次: 画像を開いて日本語が □ になっていないか確認。スマホ幅プレビュー ${phonePreview} も開いて文字が読めるか見る`);
}

if (command === "eyecatch") await eyecatch();
else if (command === "diagram") await diagram();
else fail("使い方: npm run blog:eyecatch -- <slug> ／ npm run blog:diagram -- <in.svg> <out.png>");
