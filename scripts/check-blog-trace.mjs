#!/usr/bin/env node
//
// ブログ記事（blog/*.md）が**ビルド成果物に同梱されている**ことを確かめる（T-M8-184）。
//
//   npm run build && npm run check:blog-trace      # release:check に含まれる
//
// なぜ必要か: 記事はリクエスト時にファイルシステムから読む。Vercel は各 route の
// `.nft.json`（トレース）に載ったファイルしか関数へ同梱しないため、`next.config.ts` の
// `outputFileTracingIncludes` が欠けると**本番だけ記事0件（「準備中」）**になる。
// ローカルと dev は cwd から直接読めるので、テスト・E2E・実ブラウザでは原理的に見えない。
// デプロイ先では `doctor` の「ブログ記事の同梱」が同じ事故を報告するが、ここで出荷前に止める。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const { isBlogArticleFile } = await import("../src/lib/blog/blog-content.ts");

const ROOT = resolve(".");
// 同梱が要るのは**公開記事**だけ（画面は blog/published/ しか読まない・T-M8-193）。
const BLOG_DIR = join(ROOT, "blog", "published");
const ROUTES = ["app/blog/page.js", "app/blog/[slug]/page.js", "app/api/cron/doctor/route.js"];

const articles = existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter(isBlogArticleFile).sort() : [];
if (articles.length === 0) {
  console.log("ℹ️ blog/ に記事が無いので同梱の検査は対象なし（記事を置いたら自動で検査されます）");
  process.exit(0);
}

let failed = false;
for (const route of ROUTES) {
  const traceFile = join(ROOT, ".next", "server", `${route}.nft.json`);
  if (!existsSync(traceFile)) {
    console.log(`❌ ${route}: トレース ${traceFile} がありません（npm run build を先に実行してください）`);
    failed = true;
    continue;
  }
  const files = JSON.parse(readFileSync(traceFile, "utf8")).files ?? [];
  const traced = new Set(files.map((f) => f.replace(/\\/g, "/").split("/blog/published/").pop()));
  const missing = articles.filter((name) => !traced.has(name));
  if (missing.length > 0) {
    console.log(`❌ ${route}: 同梱されていない記事 ${missing.length} 件（${missing.join(", ")}）`);
    failed = true;
  } else {
    console.log(`✅ ${route}: 記事 ${articles.length} 件がトレースに含まれています`);
  }
}

if (failed) {
  console.log("");
  console.log(
    "❌ 本番で記事が表示されません。next.config.ts の outputFileTracingIncludes（\"/blog\" と \"/api/cron/doctor\" に ./blog/**/*.md）を確認してください",
  );
  process.exit(1);
}
console.log("");
console.log("✅ ブログ記事はすべてのrouteに同梱されています");
