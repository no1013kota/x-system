#!/usr/bin/env node
/**
 * 本番ビルドを起動して、実ブラウザでCSP違反が出ないか見る（T-M8-170）。
 *
 * `check:csp-nonce` は**ビルド済みHTMLの静的検査**なので、
 * 「ストリーミング中に後から注入されるscriptにnonceが付かない」型は原理的に見えない。
 * 通常のE2Eは `next dev` で動き、devはHMRのscriptがnonce無しで入るため判定に使えない。
 *
 * 使い方: `npm run build` のあとに `npm run check:csp-runtime`。
 * 既にビルド済みの `.next` を使い、空きポートで `next start` してE2Eを1本だけ回す。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

const PORT_FROM = 3230;

async function freePort(from) {
  for (let port = from; port < from + 20; port += 1) {
    const ok = await new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
    if (ok) return port;
  }
  throw new Error("空きポートが見つかりませんでした");
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // 起動待ち
    }
    if (Date.now() > deadline) throw new Error(`起動を待てませんでした: ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!existsSync(".next/BUILD_ID")) {
  console.error("❌ 先に `npm run build` を実行してください（本番ビルドを検査します）。");
  process.exit(1);
}

const port = await freePort(PORT_FROM);
const base = `http://127.0.0.1:${port}`;
console.log(`▶ 本番ビルドを ${base} で起動して検査します`);
const server = spawn("npx", ["next", "start", "--port", String(port)], {
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, PORT: String(port) },
});
let code = 1;
try {
  await waitFor(`${base}/login`, 60_000);
  const test = spawn(
    "npx",
    ["playwright", "test", "e2e/csp-runtime.spec.ts", "--reporter=line"],
    { stdio: "inherit", env: { ...process.env, CSP_RUNTIME: "1", E2E_BASE_URL: base } },
  );
  code = await new Promise((resolve) => test.on("close", resolve));
} finally {
  server.kill();
}
if (code === 0) console.log("✅ 本番ビルドの実ブラウザでCSP違反はありませんでした。");
else console.error("❌ CSP違反が出ました（上の出力に違反したscriptが出ています）。");
process.exit(code ?? 1);
