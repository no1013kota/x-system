#!/usr/bin/env node
/**
 * ロゴ画像の生成（T-M8-111）。元画像1枚から、アプリが使う4ファイルを作る。
 *
 *   npm run logo -- <元画像のパス>
 *
 * 作るもの:
 *   public/logo.png              画面表示用（余白を切り落とした透過PNG・高さ120px）
 *   src/app/icon.png             favicon（正方形512px）
 *   src/app/apple-icon.png       iPhoneのホーム画面用（180px）
 *   src/app/opengraph-image.png  SNSシェア画像（1200×630・白地に中央配置）
 *
 * **元画像は白背景でも透過でも構わない**。白い部分は自動で透明にし、周囲の余白も自動で切る。
 * 手作業（トリミング・背景抜き・書き出し）を覚えておかなくて済むようにするための道具
 * （CLAUDE.md 原則3）。生成後は `npm run dev` で見た目を確認してからコミットする。
 */
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

const OUT = {
  display: "public/logo.png",
  icon: "src/app/icon.png",
  apple: "src/app/apple-icon.png",
  ogp: "src/app/opengraph-image.png",
};

/** 白背景を透明にする（白に合成された絵の逆算）。完全な白＝透明、濃い色ほど不透明。 */
function unmultiplyWhite(data) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const a = 255 - Math.min(r, g, b);
    if (a === 0) continue; // 透明（Bufferは0で初期化済み）
    const un = (c) => Math.max(0, Math.min(255, Math.round(((c - (255 - a)) * 255) / a)));
    out[i] = un(r);
    out[i + 1] = un(g);
    out[i + 2] = un(b);
    out[i + 3] = a;
  }
  return out;
}

/** 絵柄が実際に存在する範囲（アルファ>閾値）を測る。sharpのtrim()は元画像によって効かないため自前で測る。 */
function boundingBox(rgba, width, height, threshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("画像が空です（すべて透明・または真っ白）。元画像を確認してください。");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("使い方: npm run logo -- <元画像のパス>");
    process.exit(1);
  }
  const src = resolve(input);
  statSync(src); // 無ければここで落ちる

  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = unmultiplyWhite(data);
  const box = boundingBox(rgba, info.width, info.height);
  const mark = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .png()
    .toBuffer();

  // 画面表示用は余白なしの横長のまま（表示側が高さ基準で置く）。
  // 高さ120px＝画面での最大表示40pxの3倍。`unoptimized` で素のまま配信するため、
  // ここで必要十分な大きさまで落としておく（Retinaで潰れず、かつ数十KBに収まる）。
  for (const path of Object.values(OUT)) mkdirSync(dirname(path), { recursive: true });
  await sharp(mark).resize({ height: 120 }).png({ compressionLevel: 9 }).toFile(OUT.display);

  // アイコン類は正方形。マークの周囲に12%の余白を入れて中央へ置く。
  const side = Math.round(Math.max(box.width, box.height) * 1.12);
  const square = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: mark,
        left: Math.round((side - box.width) / 2),
        top: Math.round((side - box.height) / 2),
      },
    ])
    .png()
    .toBuffer();
  await sharp(square).resize(512, 512).png({ compressionLevel: 9 }).toFile(OUT.icon);
  await sharp(square).resize(180, 180).png({ compressionLevel: 9 }).toFile(OUT.apple);

  // OGPは1200×630の白地（SNS側が透過を黒で塗ることがあるため白を敷く）。
  const ogLogo = await sharp(square).resize(420, 420).png().toBuffer();
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: ogLogo, left: 390, top: 105 }])
    .png({ compressionLevel: 9 })
    .toFile(OUT.ogp);

  console.log(`元画像: ${info.width}×${info.height} → 絵柄の範囲 ${box.width}×${box.height}`);
  for (const [name, path] of Object.entries(OUT)) {
    const meta = await sharp(path).metadata();
    console.log(
      `  ${path.padEnd(28)} ${meta.width}×${meta.height}  ${(statSync(path).size / 1024).toFixed(1)}KB`,
    );
  }
  console.log("\n`npm run dev` で見た目を確認してからコミットしてください。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
