import { expect, signIn, test } from "./fixtures/test";

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
