#!/usr/bin/env node
//
// 人間確認（Turnstile）が**その環境で実際に動くか**を確かめる（T-M7-48）。
//
//   npm run check:turnstile                                # ローカル
//   npm run check:turnstile -- --base https://<staging>     # デプロイ先
//
// なぜ必要か: サイトキーは Cloudflare 側で「許可ドメイン」を持つ。登録し忘れると
// `error-callback` コード 110200 になり、**ログインと新規登録が両方できなくなる**。
// これは外部境界（Cloudflare の設定）が原因なので、モックした単体テスト・E2Eでは原理的に出ない。
// 2026-08-01、staging で実際にこの状態のまま気付けなかった（CLAUDE.md 原則1・3）。
//
// 判定の文言は src/lib/auth/turnstile-errors.ts（単体テストあり）。ここはブラウザ操作だけを担う。
import { chromium } from "playwright";

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = (argOf("base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const { classifyTurnstileError } = await import("../src/lib/auth/turnstile-errors.ts");

/** ブラウザ内で `turnstile.render` を1回だけ試し、結果を返す。 */
async function probe(page, sitekey) {
  return await page.evaluate(async (key) => {
    const div = document.createElement("div");
    div.style.position = "fixed";
    div.style.bottom = "0";
    document.body.appendChild(div);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ result: "timeout" }), 30_000);
      try {
        window.turnstile.render(div, {
          sitekey: key,
          callback: () => {
            clearTimeout(timer);
            resolve({ result: "ok" });
          },
          "error-callback": (code) => {
            clearTimeout(timer);
            resolve({ result: "error", code: String(code ?? "") });
          },
        });
      } catch (error) {
        clearTimeout(timer);
        resolve({ result: "throw", code: String(error?.message ?? "") });
      }
    });
  }, sitekey);
}

console.log(`\n■ 人間確認（Turnstile）の確認（${base}）\n`);

const browser = await chromium.launch();
let exitCode = 0;
try {
  const page = await browser.newPage();
  // `networkidle` は使わない。Turnstile が常時通信するため終わらない（2026-08-01に60秒で失敗）。
  const res = await page
    .goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 })
    .catch((error) => ({ ok: () => false, status: () => String(error.message).slice(0, 60) }));
  if (!res?.ok()) {
    console.log(`❌ ログイン画面を開けません（${res?.status() ?? "応答なし"}）`);
    console.log("    → デプロイが完了しているか、URLが正しいか確認してください");
    process.exit(1);
  }

  // サイトキーは NEXT_PUBLIC_ なのでクライアントのバンドルへ焼き込まれる。
  // **ビルド時に埋まる**ため、Vercel で設定しただけで再デプロイしていないと古い値が残る。
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")].map((s) => s.src).filter((s) => s.includes("/_next/")),
  );
  let sitekey = null;
  for (const src of sources) {
    const text = await page.evaluate(async (url) => (await fetch(url)).text(), src);
    const found = text.match(/["'](0x[A-Za-z0-9_-]{20,}|1x0{20}AA)["']/);
    if (found) {
      sitekey = found[1];
      break;
    }
  }

  if (!sitekey) {
    console.log("❌ サイトキーが画面に埋め込まれていません");
    console.log(
      "    → NEXT_PUBLIC_TURNSTILE_SITE_KEY を設定したうえで**再デプロイ**してください（この値はビルド時に埋め込まれます）",
    );
    process.exit(1);
  }

  const isTestKey = sitekey.startsWith("1x00000000");
  console.log(`✅ サイトキー: ${sitekey.slice(0, 12)}…${isTestKey ? "（Cloudflareのテストキー）" : ""}`);
  if (isTestKey && !base.includes("127.0.0.1") && !base.includes("localhost")) {
    console.log("⚠️  デプロイ先にテストキーが入っています（誰でも通過できます）");
    console.log("    → 本番用のサイトキーへ差し替えて再デプロイしてください");
    exitCode = 1;
  }

  await page.waitForFunction(() => Boolean(window.turnstile), null, { timeout: 20_000 }).catch(() => {});
  if (!(await page.evaluate(() => Boolean(window.turnstile)))) {
    console.log("❌ Turnstileのスクリプトを読み込めません");
    console.log("    → CSPで challenges.cloudflare.com を許可しているか確認してください");
    process.exit(1);
  }
  console.log("✅ スクリプト: 読み込めています");

  const { result, code } = await probe(page, sitekey);
  if (result === "ok") {
    console.log("✅ 動作: トークンを取得できました（この環境で人間確認は機能します）");
  } else if (result === "error") {
    const failure = classifyTurnstileError(code);
    if (failure.kind === "setting") {
      console.log(`❌ 動作: 設定が原因で使えません（コード ${code}）`);
      console.log(`    → ${failure.operatorHint}`);
      console.log("    ※ この状態では利用者はログインも新規登録もできません");
      exitCode = 1;
    } else {
      // headless のブラウザは「人間らしさ」の判定を通れないことがある。この場合でも
      // **チャレンジまで到達している＝サイトキーとドメインは正しい**ことが分かる。
      console.log(`⚠️  動作: チャレンジを完了できませんでした（コード ${code}）`);
      console.log("    サイトキーとドメインの設定は正しいと判断できます（自動操作のブラウザでは通常こうなります）");
      console.log("    → 実際のブラウザでログイン画面を開いて確認してください");
    }
  } else if (result === "timeout") {
    // エラーコードが返らないまま時間切れ＝サイトキーとドメインの検証は通っている
    // （不正なら 110100 / 110200 が即座に返る）。自動操作のブラウザでは通常こうなる。
    console.log("⚠️  動作: チャレンジが時間内に完了しませんでした（コードなし）");
    console.log("    サイトキーとドメインの設定は正しいと判断できます（自動操作のブラウザでは通常こうなります）");
    console.log("    → 実際のブラウザでログイン画面を開いて確認してください");
  } else {
    console.log(`⚠️  動作: 判定できませんでした（${result}${code ? `: ${code}` : ""}）`);
    console.log("    → 実際のブラウザでログイン画面を開いて確認してください");
  }
} catch (error) {
  // 運営者にスタックトレースを読ませない（CLAUDE.md 原則2）。
  console.log(`❌ 確認中に想定外の問題が起きました（${String(error?.message ?? error).slice(0, 120)}）`);
  console.log("    → Claude に「人間確認の確認コマンドが失敗する」と伝えてください");
  exitCode = 1;
} finally {
  await browser.close();
}

console.log(
  exitCode === 0 ? "\n人間確認は利用できる状態です。\n" : "\n対応が必要な問題があります。\n",
);
process.exit(exitCode);
