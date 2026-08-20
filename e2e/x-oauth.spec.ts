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
  // fixtureが1件連携済みで、premiumの上限は1（2026-08-20）。追加ボタンを出すため上限3のexpertにする。
  await query(`update profiles set plan = 'expert' where id = $1`, [account.userId]);
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

/**
 * 保存ボタンが**理由なく薄い**状態にしない（T-M8-46）。
 *
 * `disabled` に `clientId.length < 5` が直書きされており、**何文字必要かが画面のどこにも
 * 書かれていなかった**。押せないボタンだけが出ている状態は、壊れているのと利用者から
 * 区別できない。「Client種別」セレクタが無いこと（T-M8-62。現在のConsoleに
 * Public/Confidential の選択は無い）と、Client Secret 欄があること（T-M8-63。
 * 「Web App, Automated App or Bot」のAppはSecret必須）もここで守る。
 */
test("Xキーの保存が押せないときは理由が画面に出る（T-M8-46）", async ({ accounts, page }) => {
  const account = await accounts.create("api-key-hint", { personaReady: true });
  await query(`update profiles set plan = 'standard' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=api-keys");

  const save = page.getByRole("button", { name: "Xキーを保存" });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Client IDを入力すると保存できます。")).toBeVisible();

  // 短いあいだは必要な文字数と現在の文字数が出る
  await page.getByLabel("Client ID").fill("abc");
  await expect(save).toBeDisabled();
  await expect(page.getByText("Client IDは5文字以上です（いま3文字）。")).toBeVisible();

  /*
    使えない文字は押す前に止める（T-M8-84）。以前は画面が長さしか見ておらず、
    `bad id` のような値でも押せてサーバーに弾かれていた。
  */
  await page.getByLabel("Client ID").fill("bad id");
  await expect(save).toBeDisabled();
  await expect(
    page.getByText("Client IDは英数字・ハイフン・アンダースコアで入力してください。"),
  ).toBeVisible();

  // Client ID だけでも保存できる（Native App 等の public client）
  await page.getByLabel("Client ID").fill("abcdef-123456");
  await expect(save).toBeEnabled();

  /*
    保存できても Secret が空なら**連携時に拒否される**ことを、押す前に伝える（F3・T-M8-63）。
    手順ガイドが指示する App 種別は confidential client で、Secret 無しの token 交換は
    401 になる。以前は Client ID を入れた時点で押せない理由ごと消え、Secret を空でよいのか
    駄目なのかを言う文が画面のどこにも無かった。
  */
  const secretNote = page.getByText("空のまま保存すると、Xアカウントの連携時にXから拒否されます", {
    exact: false,
  });
  await expect(secretNote).toBeVisible();

  // Secret を入れかけのあいだは、その理由が出る
  await page.getByLabel("Client Secret").fill("short");
  await expect(save).toBeDisabled();
  await expect(page.getByText("Client Secretは8文字以上です（いま5文字）。")).toBeVisible();
  await page.getByLabel("Client Secret").fill("secret-value-1234");
  await expect(save).toBeEnabled();
  // 入れたら注記は消える（正常な操作を妨げない）
  await expect(secretNote).toHaveCount(0);

  // 「Client種別」という利用者が答えられない質問を戻さない（T-M8-62）
  await expect(page.getByLabel("Client種別")).toHaveCount(0);
});

/** AI APIキーの最小長を画面に出す（T-M8-46）。 */
test("AI APIキーが短いあいだは必要な文字数が画面に出る（T-M8-46）", async ({ accounts, page }) => {
  const account = await accounts.create("ai-key-hint", { personaReady: true });
  await query(`update profiles set plan = 'standard' where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=api-keys");

  const card = page.locator("article", { hasText: "Anthropic (Claude)" });
  await card.getByLabel("APIキー").fill("short");
  await expect(card.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(card.getByText("APIキーは16文字以上です（いま5文字）。")).toBeVisible();

  await card.getByLabel("APIキー").fill("sk-ant-0123456789abcdef");
  await expect(card.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

/**
 * 表示件数の欄が**打ち直せる**こと（T-M8-51）。
 *
 * T-M8-37 で打鍵ごとに `clampNewsMaxItems` を掛けたため、欄を空にできず（0が即1へ丸められる）
 * 「100」を消して打ち直すこともできなくなっていた。丸めるのは確定時（blur・保存）だけにする。
 * 「押す前に止める」は維持し、範囲外のあいだは保存させない。
 */
test("ニュースの表示件数は入力中に丸められず、範囲外では保存できない（T-M8-51）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("news-max-items", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/settings?tab=notifications");

  const field = page.getByLabel("表示件数", { exact: false });
  await expect(field).toBeVisible();
  const save = page.locator("section", { hasText: "ニュース通知" }).getByRole("button", {
    name: "保存",
    exact: true,
  });

  // 空にできる（打ち直せる）
  await field.fill("");
  await expect(field).toHaveValue("");
  await expect(save).toBeDisabled();
  await expect(page.getByText("表示件数は1〜100で指定してください。")).toBeVisible();

  // 範囲外も入力自体は許し、保存だけ止める
  await field.fill("101");
  await expect(field).toHaveValue("101");
  await expect(save).toBeDisabled();

  // 範囲内へ直すと保存できるようになり、理由の文字も消える
  await field.fill("30");
  await expect(save).toBeEnabled();
  await expect(page.getByText("表示件数は1〜100で指定してください。")).toHaveCount(0);

  // 確定（blur）で丸められる
  await field.fill("999");
  await field.blur();
  await expect(field).toHaveValue("100");
});

/**
 * 「再連携」は対象を指定する（T-M8-53）。
 *
 * 以前は「Xアカウントを追加」と**同じURL**へ飛んでいたため、再連携を押したのに別のXアカウントで
 * 認可すると**新しい行が増え、壊れた行はそのまま残った**（押した本人は直ったつもりになる）。
 * 対象は封緘したstateへ載せ、callbackで一致を確かめる（一致しなければ保存しない）。
 */
test("再連携リンクが対象アカウントを指定している（T-M8-53）", async ({ accounts, page }) => {
  const account = await accounts.create("verify-reconnect", { personaReady: true });
  await query(`update x_accounts set status = 'expired' where id = $1`, [account.xAccountId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");
  await expect(page.getByRole("heading", { name: "Xアカウント" })).toBeVisible();
  const row = page.locator("li", { hasText: `@${account.handle}` });
  const href = await row.locator('a[href*="oauth/start"]').first().getAttribute("href");
  expect(href).toContain(`account=${account.xAccountId}`);
  const add = await page
    .locator('a[href*="oauth/start"]')
    .filter({ hasText: "Xアカウントを追加" })
    .first()
    .getAttribute("href");
  expect(add).not.toContain("account=");
});

test("契約は有効だが顧客未紐づけでも、必ず進める行き先がある（T-M8-54）", async ({
  accounts,
  page,
}) => {
  // 最初の修正（T-M8-53）で「プランを選ぶ」を消したところ、**押せるものが何も無い行き止まり**に
  // なった（同期が来なければ永久に「再読み込みしてください」のまま）。状況は伝えるが行き先は残す。
  const account = await accounts.create("verify-plans", { personaReady: true });
  await query(`update profiles set stripe_customer_id = null where id = $1`, [account.userId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();

  // 進める行き先がある。常時表示の反映待ち説明は**どちらも置かない**（T-M8-66。
  // 反映待ちの説明はStripeから戻った瞬間のNoticeだけが出す。常時出る注意書きは読み飛ばされる）。
  await expect(
    page.getByText("ご契約の情報を取得しています", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("変更内容は", { exact: false }),
  ).toHaveCount(0);
  const choose = page.getByRole("link", { name: "プランを選ぶ" });
  await expect(choose).toBeVisible();

  // 押すと /plans に**留まる**（以前はホームへ弾き返されて何も起きなかった）
  await choose.click();
  await expect(page).toHaveURL(/\/plans/);
  // プラン名は比較表の列見出しへ移った（T-M8-125 でカード見出しから表になった）。
  // **文言そのものではなく「プラン選択の中身が出ている」ことを見る**——文言はキャンペーンで変わる。
  await expect(page.getByRole("heading", { name: /プラン/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /スタンダードプラン/ }).first()).toBeVisible();

  // 顧客が紐づいたら通常どおり /app へ送り返す（決済直後に行き止まらないための既存の挙動）
  await query(`update profiles set stripe_customer_id = 'cus_review_check' where id = $1`, [
    account.userId,
  ]);
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/app/);
});

/**
 * 停止中（`disabled`）のアカウントは一覧から畳む（T-M8-54）。
 *
 * 使っていないアカウントが並び続けると、いま動いているものが埋もれる（ローカルで実際に
 * 3件のうち2件が不要なまま並んだ）。**行は消せない**（下書き・履歴・実績が参照している）ので、
 * `<details>` で辿れる場所へ移す。**`expired`／`error` は畳まない**——再連携という
 * やることが残っているので、隠すと気付けない。
 */
test("連携を解除すると一覧から消え、畳んだ場所から辿れる（T-M8-54）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("unlink", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");

  const list = page.locator("ul").first();
  await expect(list.locator("li", { hasText: `@${account.handle}` })).toBeVisible();
  await expect(page.getByText("停止中のアカウント", { exact: false })).toHaveCount(0);

  // 解除する（確認ダイアログを挟む）
  await page.getByRole("button", { name: "連携を解除" }).click();
  await page.getByRole("button", { name: "解除する" }).click();
  await expect(toastIn(page)).toContainText("連携を解除しました");

  // 一覧から消え、畳んだ見出しへ移る
  await expect(page.getByText("停止中のアカウント 1 件", { exact: false })).toBeVisible();
  await expect(
    page.getByText("まだXアカウントを連携していません", { exact: false }).or(
      page.getByText("連携中のXアカウントはありません", { exact: false }),
    ),
  ).toBeVisible();

  // 畳んだ中には残っている（履歴へ辿れる・行き止まりにしない）
  await page.getByText("停止中のアカウント 1 件", { exact: false }).click();
  await expect(page.locator("details").getByText(`@${account.handle}`)).toBeVisible();
});

/**
 * **要再連携は畳まない**（T-M8-54）。再連携というやることが残っているので、
 * 隠すと気付けない（CLAUDE.md 原則1）。畳むのは `disabled` だけ。
 */
test("要再連携のアカウントは畳まず一覧に残す", async ({ accounts, page }) => {
  const account = await accounts.create("expired-visible", { personaReady: true });
  await query(`update x_accounts set status = 'expired' where id = $1`, [account.xAccountId]);
  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");

  await expect(
    page.locator("ul").first().locator("li", { hasText: `@${account.handle}` }),
  ).toBeVisible();
  await expect(page.getByText("停止中のアカウント", { exact: false })).toHaveCount(0);
});

/**
 * 「接続を確認」は結果まで伝える（T-M8-56）。
 *
 * 以前のラベルは「状態を更新」で、**何の状態をどう更新するのか読めなかった**（利用者指摘）。
 * 実体は「Xに問い合わせて、この連携がまだ使えるかを確かめる」操作なので、そのとおりに書き、
 * 押した結果（有効／要再連携…）をトーストで返す。
 */
test("「接続を確認」を押すと結果の状態がトーストで分かる（T-M8-56）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("check-conn", { personaReady: true });
  await signIn(page, account);
  await page.goto("/app/settings?tab=x-accounts");

  await expect(page.getByRole("button", { name: "状態を更新" })).toHaveCount(0);
  await page.getByRole("button", { name: "接続を確認" }).click();
  // dry_run 環境では偽トークンのため /2/users/me は失敗し「エラー（要確認）」へ落ちる。
  // ここで見たいのは**結果の状態が文言に含まれる**こと（無言で終わらない・原則1）。
  await expect(toastIn(page)).toContainText(/Xとの接続を確認しました（.+）/);
});
