#!/usr/bin/env node
//
// sharp（画像処理）に依存する全routeが、`next.config.ts` の `outputFileTracingIncludes` で
// **LinuxネイティブバイナリをVercelへ同梱する指定を持つ**ことを確かめる（T-M8-385）。
//
//   npm run build && npm run check:sharp-trace      # release:check に含まれる
//
// なぜ必要か: Vercelは各routeの `.nft.json`（トレース）に載ったファイルしか関数へ同梱しない。
// sharpのLinuxバイナリ（@img/sharp-linux-x64）は**プラットフォーム別のoptional依存**で
// macには入らないため、静的解析のトレースから漏れ、configの明示指定が唯一の同梱経路になる。
// 指定が漏れたrouteは**本番だけ** `libvips-cpp.so が無い` で落ちる——ローカルはmacバイナリで
// 動き、E2Eは next dev なので原理的に見えない。T-M8-230（画像生成が全滅）に続き、
// T-M8-353では /app/posts のServer Action束にsharpが入ったのに指定が漏れ、
// **本番の投稿作成の全ボタンが500**になっていた（2026-08-31発覚・T-M8-385）。
//
// 検査方法: build成果物の `.nft.json` を全routeぶん走査し、`node_modules/sharp/`（JS本体。
// これはどのOSでも入る）へ依存するrouteを機械的に見つける。そのrouteが
// `outputFileTracingIncludes` に `@img/sharp-linux-x64` の指定を持たなければ失敗。
// **routeの手書きリストを持たない**——sharpを使う画面が増えたら自動で検査対象になる。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { glob } from "node:fs/promises";

const ROOT = resolve(".");

// next.config.ts から outputFileTracingIncludes のsharp指定を持つrouteキーを読む。
// TSのimportは避け、素朴にテキストから引く（configの形が変わればここも落ちて気付ける）。
const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
const declaredRoutes = new Set(
  [...config.matchAll(/"(\/[^"]*)":\s*\[[^\]]*sharp-linux-x64[^\]]*\]/gs)].map((m) => m[1]),
);

// .next/server 配下の全route/pageトレースを走査。
const traceFiles = [];
for await (const f of glob(".next/server/app/**/*.nft.json", { cwd: ROOT })) {
  traceFiles.push(f);
}

let failed = false;
let checked = 0;
for (const rel of traceFiles) {
  const files = JSON.parse(readFileSync(join(ROOT, rel), "utf8")).files ?? [];
  const usesSharp = files.some((f) => String(f).includes("node_modules/sharp/"));
  if (!usesSharp) continue;
  checked += 1;
  // ".next/server/app/app/posts/page.js.nft.json" → "/app/posts"
  const routeKey =
    "/" +
    rel
      .replace(/^\.next\/server\/app\//, "")
      .replace(/\/(page|route)\.js\.nft\.json$/, "")
      .replace(/^(page|route)\.js\.nft\.json$/, "");
  const key = routeKey === "/" ? "/" : routeKey;
  if (!declaredRoutes.has(key)) {
    console.log(
      `❌ ${key}: sharpに依存していますが、next.config.ts の outputFileTracingIncludes に ` +
        `@img/sharp-linux-x64 の指定がありません（本番でこのrouteのAction束が500になります）`,
    );
    failed = true;
  } else {
    console.log(`✅ ${key}: sharp依存＋同梱指定あり`);
  }
}

if (checked === 0) {
  console.log("❌ sharpに依存するrouteが1つも見つかりません（検査が空振りしています。buildを先に実行してください）");
  process.exit(1);
}
if (failed) process.exit(1);
console.log(`✅ sharp依存route ${checked} 件すべてに同梱指定があります`);
