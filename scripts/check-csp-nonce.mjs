#!/usr/bin/env node
//
// 「静的プリレンダされたHTMLがCSPのnonceを持てず、scriptが1本も動かない」ことの検査（T-M8-87）。
//
//   npm run check:csp-nonce      # 要 `npm run build`（release:check では build の直後に走る）
//
// 2026-08-14、本番（exosai.net）の `/signup` と `/reset-password` がこの状態だった。
// scriptタグ16本すべてがCSPで拒否され、会員登録とパスワード再設定ができなかった。
// **HTTPは200・本文も表示される**ので、単体テスト1,300件・E2E・CI はすべて緑のままだった。
//
// 見えなかった理由:
//   - `security-headers.test.ts` はヘッダの文字列だけを見る（HTML側は見ない）
//   - E2Eは `next dev` で動く。dev modeはプリレンダしないので**原理的に再現しない**
// したがってこの検査は**ビルド成果物**を読む以外に成立しない。
//
// 判定は `src/lib/ops/prerender-nonce.ts`（純粋関数・fixture付きの単体テストあり）。
// ここはファイルの読み出しと日本語の表示だけを担う。
//
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP_DIR = join(".next", "server", "app");

const { describeVerdicts, NONCE_EXEMPT, scanPrerendered } = await import(
  "../src/lib/ops/prerender-nonce.ts"
).catch(() => {
  console.error(
    "check:csp-nonce: 判定モジュールを読み込めませんでした。`npx tsx scripts/check-csp-nonce.mjs` で実行してください。",
  );
  process.exit(2);
});

// --- ビルド成果物を確かめる（**無いのに緑で通さない**） ---

if (!existsSync(APP_DIR)) {
  console.error("\n❌ ビルド結果が見つかりません: " + APP_DIR);
  console.error("    → `npm run build` を実行してから、もう一度このコマンドを実行してください。");
  console.error("    （この検査はビルド成果物を読みます。ビルド無しでは何も確認できません）");
  process.exit(2);
}

/** `.next/server/app` 配下のプリレンダ済みHTMLを集める。 */
function prerenderedPages(dir) {
  const pages = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      pages.push(...prerenderedPages(path));
      continue;
    }
    if (!name.endsWith(".html")) continue;
    // `.next/server/app/signup.html` → `/signup`
    const route = "/" + relative(APP_DIR, path).replace(/\.html$/, "").split(sep).join("/");
    pages.push({ route, html: readFileSync(path, "utf8") });
  }
  return pages;
}

const pages = prerenderedPages(APP_DIR);
const { dead, exempt, staleExemptions } = scanPrerendered(pages);

// --- 表示 ---

console.log("\n■ 静的プリレンダとCSP nonce の整合（" + APP_DIR + "）\n");
console.log(`  プリレンダされたHTML: ${pages.length} 件`);
for (const p of pages) console.log(`    ・${p.route}`);

for (const v of exempt) {
  console.log(`\n➖ ${v.route}: script ${v.scripts} 本にnonceが無いが、例外として許しています`);
  console.log(`    理由: ${NONCE_EXEMPT[v.route]}`);
}

if (staleExemptions.length > 0) {
  console.error("\n❌ 実態と合っていない例外があります: " + staleExemptions.join(", "));
  console.error(
    "    このルートはもうプリレンダされていません。`NONCE_EXEMPT` から消してください",
  );
  console.error("    （残したままだと、同じ名前で別のものが出てきたとき黙って通します）。");
  process.exit(1);
}

if (dead.length === 0) {
  console.log("\n✅ nonce付きCSPの下で動かないページはありません。");
  process.exit(0);
}

console.error("\n" + describeVerdicts(dead));
process.exit(1);
