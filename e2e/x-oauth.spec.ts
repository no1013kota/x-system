import { query } from "./fixtures/account";
import { expect, signIn, test, toastIn } from "./fixtures/test";

/**
 * SC-11 Xアカウント連携の入口（要件06 §1.2.1・要件05 §3）。
 *
 * これまでのE2E・手動検証はいずれも x_accounts を fixture で直接insertしており、**連携そのものの
 * 入口を一度も通っていなかった**。そのため service_role の GRANT 漏れで
 * `GET /api/x/oauth/start` が internal_error になっていたことに気付けなかった。
 *
 * X本体へは遷移せず、リダイレクト先（Location）だけを検証する（外部サービスを呼ばない）。
 */

test("設定画面の「Xアカウントを追加」からX認可URLへリダイレクトされる", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("xoauth");
  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");

  // UI側の入口: 連携開始エンドポイントへのリンクがある（リンクをボタン風に描画している）。
  const start = page.locator('a[href^="/api/x/oauth/start"]').first();
  await expect(start).toBeVisible();
  const href = await start.getAttribute("href");
  expect(href).toContain("return=");

  // 実際にエンドポイントを叩く。X へは行かず Location だけを見る。
  const res = await page.request.get(href as string, { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());

  const location = res.headers()["location"] ?? "";
  expect(location, `連携開始が失敗している: ${location}`).toContain(
    "https://x.com/i/oauth2/authorize",
  );
  expect(location).toContain("response_type=code");
  expect(location).toContain("code_challenge_method=S256");
  // 5 scope（要件05 §3）と callback が含まれること。
  expect(decodeURIComponent(location)).toContain("offline.access");
  expect(decodeURIComponent(location)).toContain("/api/x/oauth/callback");

  // PKCE/state は HttpOnly cookie で渡る（URLに秘密を載せない）。
  expect(res.headers()["set-cookie"] ?? "").toContain("HttpOnly");
});

/**
 * callback URL のコピーが**失敗したときに気付ける**こと（T-M8-38）。
 *
 * この文字列は X Developer Console へ**完全一致で登録**する値。コピーできたつもりで古い
 * クリップボード内容を貼ると、X側の設定が食い違ってログイン・連携が失敗する。相手側の設定ミスは
 * コードに現れず、モックしたテストでは原理的に見えない（2026-08-01、stagingでログイン・新規登録が
 * 両方不可だったのと同型）。以前は try/catch が無く、失敗すると unhandled rejection になって
 * ボタンは「コピー」のまま**何も起きなかった**。
 */
test("callback URLのコピーが失敗したら理由が出る（黙って捨てない）", async ({ accounts, page }) => {
  const account = await accounts.create("copy-callback", { personaReady: true });
  // 手順（callback URLの登録）はBYOKプランの画面にある。fixtureの既定は premium なので落とす。
  await query(`update profiles set plan = 'standard' where id = $1`, [account.userId]);
  await signIn(page, account);

  // クリップボードを必ず失敗させる（権限拒否・非セキュアコンテキストと同じ状態を作る）。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("denied")),
      },
    });
  });
  await page.goto("/app/settings?tab=api-keys");

  const copy = page.getByRole("button", { name: "callback URLをコピー" });
  await expect(copy).toBeVisible();
  await copy.click();

  await expect(toastIn(page)).toContainText("コピーできませんでした");
  // 失敗したのに成功の見た目にならない
  await expect(page.getByRole("button", { name: "コピー済み" })).toHaveCount(0);
});
