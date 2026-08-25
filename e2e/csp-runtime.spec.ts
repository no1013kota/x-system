import { expect, test } from "@playwright/test";

import { signIn } from "./fixtures/test";

/**
 * **本番ビルドの実ブラウザでCSP違反が出ないこと**（T-M8-170）。
 *
 * `check:csp-nonce` は**ビルド済みHTMLの静的検査**なので、
 * 「ストリーミング中に後から注入されるscriptにnonceが付かない」型は原理的に見えない。
 * 通常のE2Eは `next dev` で動き、devはHMRのscriptがnonce無しで入るため判定に使えない。
 * そこで**本番ビルドを起動して**開くこの1本を分けて持つ（`npm run check:csp-runtime`）。
 *
 * 2026-08-23、`/plans` で `useMergedRef`（next/linkの内部chunk）が nonce 無しの
 * `<script src>` として注入され、strict-dynamic に弾かれていた（機能は壊れないが
 * コンソールにエラーが出続け、本物の異常が埋もれる・原則1）。
 */
const RUN = process.env.CSP_RUNTIME === "1";

test.describe(RUN ? "本番ビルドのCSP（実ブラウザ）" : "本番ビルドのCSP（実ブラウザ・skip）", () => {
  test.skip(!RUN, "npm run check:csp-runtime から実行する（本番ビルドが必要）");

  // 本番ビルドの起動直後は各routeの初回応答が遅い。networkidle は Turnstile 等の
  // ポーリングで到達しないことがあるので load で待ち、描画後に少しだけ落ち着かせる。
  test("公開ページと契約ページでCSP違反が出ない", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/violates the following Content Security Policy|Refused to (load|execute)/i.test(text)) {
        violations.push(`${page.url()} :: ${text.slice(0, 200)}`);
      }
    });

    for (const path of ["/", "/login", "/signup", "/terms", "/privacy", "/legal/commercial-transactions", "/blog"]) {
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(1_500);
    }
    expect(violations, "公開ページでCSP違反").toEqual([]);

    // ログインが要る画面（/plans はストリーミング境界を持つ・上のコメント参照）。
    const { createTestAccount, destroyTestAccount, query } = await import("./fixtures/account");
    const account = await createTestAccount("csp-runtime");
    try {
      await query(`update profiles set plan = null, subscription_status = 'incomplete' where id = $1`, [
        account.userId,
      ]);
      await signIn(page, account);
      for (const path of ["/plans", "/app", "/app/settings?tab=billing"]) {
        await page.goto(path, { waitUntil: "load" });
        await page.waitForTimeout(1_500);
      }
      expect(violations, "ログイン後の画面でCSP違反").toEqual([]);
    } finally {
      await destroyTestAccount(account);
      await browser.contexts()[0]?.clearCookies();
    }
  });
});
