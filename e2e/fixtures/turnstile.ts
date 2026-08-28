import type { Page } from "@playwright/test";

/**
 * E2Eの人間確認（Turnstile）を手元で完結させる（T-M8-358）。
 *
 * ## なぜ必要か
 *
 * E2Eは125件あり、**そのほぼ全部がログインから始まる**。ウィジェット本体は
 * `challenges.cloudflare.com` から読み込むため、通しの実行1回で100回以上、
 * 外部サービスへチャレンジを要求していた。短時間に繰り返すと途中からトークンが返らなくなり、
 * **通しでだけ・毎回違うテストが・ログイン直後に落ちる**という形になる
 * （2026-08-28に観測: 1回目1件→2回目8件→3回目21件。単独実行では必ず通る）。
 * 待ち時間を伸ばす対処では、失敗が「トークンが来ない」から「ログインだけで時間を使い切る」へ
 * ずれるだけだった。**落ちる条件は「外部サービスに毎回依存していること」そのもの**なので、
 * そこを断つ。
 *
 * ## 何を差し替えるか
 *
 * スクリプトの配信だけを差し替え、**アプリのコードには一切触れない**。
 * `window.turnstile` の契約（`render` / `reset` / `remove`）は本物と同じにして、
 * 呼ばれたらすぐ `callback` へダミートークンを渡す。
 *
 * **サーバー側の検証は本物のまま通る。** ローカルのsecretはCloudflare公式の
 * 「常に成功する」テストキー（`1x0000000000000000000000000000000AA`）なので、
 * siteverify はどんなトークンでも成功を返す。アプリのServer ActionもSupabase(GoTrue)も
 * 実際に検証を行い、**トークンが空なら今までどおり失敗する**——「検証を素通しにした」のではなく
 * 「ブラウザ側のウィジェットを手元に置いた」だけ。
 *
 * ## 何が見えなくなるか（承知のうえ）
 *
 * 本物のウィジェットが描画できるか（許可ドメイン・sitekey・CSP）は**この差し替えでは見えない**。
 * そこは `npm run check:turnstile -- --base <URL>` の担当で、CLAUDE.mdの
 * 「外部サービスの設定に依存する画面」の行でも必須の検証として決まっている。
 * 加えて **`password-reset.spec.ts` の1件だけは本物を使う**（`test.use({ realTurnstile: true })`）
 * ——スクリプトの読み込みとウィジェット描画の回帰（T-M7-26）を、実物で押さえ続けるため。
 */

/**
 * ダミートークンの接頭辞。**中身は問わない**（テストsecretのsiteverifyは常に成功する）が、
 * **毎回違う値にする**——同じ文字列を短時間に何百回も検証させると、相手側で
 * 使い回しとして扱われる余地が残る。手元で完結させる目的からも、値を固定する理由が無い。
 */
export const STUB_TURNSTILE_TOKEN_PREFIX = "e2e-stub-turnstile-token";

/**
 * `window.turnstile` の最小実装。本物と同じく `render=explicit` を前提にする。
 *
 * `callback` は**次のtickで**呼ぶ（同期で呼ぶとReactのrender中にsetStateが走る）。
 * `reset` はトークンを出し直す——アプリは送信後などにresetして再取得する作りなので、
 * ここで何もしないと2回目の送信が空トークンになる。
 */
const STUB_SCRIPT = `(() => {
  let seq = 0;
  const widgets = new Map();
  const fire = (id) => {
    const w = widgets.get(id);
    if (!w) return;
    setTimeout(() => {
      if (widgets.has(id))
        w.options.callback(
          "${STUB_TURNSTILE_TOKEN_PREFIX}-" + Math.random().toString(36).slice(2) + "-" + Date.now(),
        );
    }, 0);
  };
  window.turnstile = {
    render(container, options) {
      const id = "stub-" + ++seq;
      widgets.set(id, { container, options });
      // 本物は iframe を挿す。レイアウト（高さ）を実物へ寄せておく。
      if (container) {
        container.innerHTML =
          '<div data-testid="turnstile-stub" style="height:65px;display:flex;align-items:center;color:#666;font:12px sans-serif">人間確認（E2Eスタブ）</div>';
      }
      fire(id);
      return id;
    },
    reset(id) {
      fire(id);
    },
    remove(id) {
      widgets.delete(id);
    },
  };
})();`;

/**
 * Cloudflareのスクリプト配信をスタブへ差し替える。**ページを開く前に呼ぶ。**
 * 差し替えるのは `challenges.cloudflare.com` へのリクエストだけで、他は素通し。
 */
export async function stubTurnstile(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      // CSPの `script-src` は self と challenges.cloudflare.com を許すので、
      // このURLのまま返せばブラウザは本物と同じ扱いで実行する。
      body: STUB_SCRIPT,
    }),
  );
}
