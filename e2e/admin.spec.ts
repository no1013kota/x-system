import { query } from "./fixtures/account";
import { expect, signIn, test } from "./fixtures/test";

/**
 * 運営ダッシュボード /admin（T-M8-373）。
 *
 * 守るのは2つ。
 * 1. **運営者以外には存在ごと隠れる**（404）。「権限がありません」を出すと
 *    管理画面のURLが当たりだと教えることになる。ここが崩れると全利用者の
 *    メール・原価・解約理由が見える——このスイートで最も落ちてはいけない検査。
 * 2. **運営者には数字が出る**。ゲートの向き（===）を逆に壊しても(1)は緑のままなので、
 *    通れる側も検査しないと「誰も見られない管理画面」に気付けない。
 */

test("運営者以外がログインして開いても404（存在を教えない）", async ({ accounts, page }) => {
  const account = await accounts.create("admin-outsider");
  await signIn(page, account);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("運営ダッシュボード")).toHaveCount(0);
});

test("未ログインはログイン画面へ送られる", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("公開ページを開くと閲覧が記録される（bot・先読み除外つき・T-M8-378)", async ({ page }) => {
  // 未ログインでLPを開くだけで page_views に行が増える（記録は応答後のafter()なのでpollで待つ）。
  // 流入元（T-M8-423）: 登録済みの `?src=` は source 付きで数え、LPの /signup へのCTAに引き継がれる。
  const slug = `e2e-src-${Date.now().toString(36)}`;
  await query(`insert into traffic_sources (slug, label) values ($1, 'E2E') on conflict do nothing`, [slug]);
  await page.goto(`/?src=${slug}`);
  await expect(page.getByRole("banner").getByRole("link", { name: "無料で始める" })).toHaveAttribute(
    "href",
    `/signup?src=${slug}`,
  );
  await expect
    .poll(
      async () =>
        Number(
          (
            await query<{ n: string }>(
              `select coalesce(sum(views), 0)::text as n from page_views
                where path = '/' and source = $1 and view_date = (now() at time zone 'Asia/Tokyo')::date`,
              [slug],
            )
          )[0]?.n ?? 0,
        ),
      { timeout: 15_000, message: "流入元付きの閲覧が記録されること" },
    )
    .toBeGreaterThanOrEqual(1);
  await query(`delete from page_views where source = $1`, [slug]);
  await query(`delete from traffic_sources where slug = $1`, [slug]);
  await page.goto("/");
  await expect
    .poll(
      async () =>
        Number(
          (
            await query<{ n: string }>(
              `select coalesce(sum(views), 0)::text as n from page_views
                where path = '/' and view_date = (now() at time zone 'Asia/Tokyo')::date`,
            )
          )[0]?.n ?? 0,
        ),
      { timeout: 15_000, message: "LPの閲覧が記録されること" },
    )
    .toBeGreaterThanOrEqual(1);
});

test("運営者（SUPPORT_EMAILの利用者）にはKPIが表示される", async ({ accounts, page }) => {
  const operatorEmail = process.env.SUPPORT_EMAIL;
  expect(operatorEmail, "SUPPORT_EMAIL が .env に必要です（devサーバの起動条件でもある）").toBeTruthy();

  /*
    運営者メールの残骸が居ると auth.users unique で作成に失敗するため先に消す。
    ローカル・CIのテストDB専用の操作（本番の運営者を消す経路はここには無い——
    E2EのDB接続はローカルのSupabaseに固定されている）。
    `usage_events`／`usage_counters` は profiles を on delete **restrict** で参照する台帳なので
    先に消す（follower_snapshots のFKと同型・T-M8-364で踏んだ）。
  */
  await query(
    `delete from usage_events where user_id in (select id from auth.users where email = $1)`,
    [operatorEmail],
  );
  await query(
    `delete from usage_counters where user_id in (select id from auth.users where email = $1)`,
    [operatorEmail],
  );
  await query(`delete from auth.users where email = $1`, [operatorEmail]);
  const account = await accounts.create("admin-operator", { email: operatorEmail });
  await signIn(page, account);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "運営ダッシュボード" })).toBeVisible();
  // いまどの環境のデータかが出る（E2Eは常に development＝ローカル・T-M8-374）。
  const envNav = page.getByRole("navigation", { name: "環境の切替" });
  await expect(envNav.getByText("ローカル")).toBeVisible();
  // 他環境へは移動リンク（DBが分離されているため横断表示はしない）。
  await expect(envNav.getByRole("link", { name: "本番" })).toHaveAttribute(
    "href",
    "https://exosai.net/admin",
  );
  // サマリカード（MRR・原価・粗利）とファネルが出る。
  await expect(page.getByText("MRR（月間経常収益）")).toBeVisible();
  await expect(page.getByText("今月の粗利（月末見込み）")).toBeVisible();
  // 粗利の主値は月末見込みで、注記は「MRR − 原価の月末見込み（根拠）。これまでの粗利」の順に
  // 金額の前に何の額かを書く（D-55(2)・T-M8-427）。負値は「−¥」（通貨記号の前に負号）。
  await expect(
    page.getByText(/MRR ¥[\d,]+ − 原価の月末見込み ¥[\d,]+（.+）。これまでの粗利 −?¥[\d,]+/),
  ).toBeVisible();
  // 実解約の推移（解約済みの契約者数の状態指標）が時系列に出る（T-M8-427）。
  await expect(page.getByRole("heading", { name: /解約済みの契約者数/ })).toBeVisible();
  // 解約手続きへ進んだ人のいまの状態（cancel_intents と実解約の差）が解約アンケート節に出る。
  await expect(page.getByText(/直近30日に解約手続きへ進んだ/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ファネル（いまいる利用者の到達段階）" }),
  ).toBeVisible();
  // 入口ファネル（未ログイン含む・T-M8-378）も出る。
  await expect(
    page.getByRole("heading", { name: /入口ファネル/ }),
  ).toBeVisible();
  await expect(page.getByText("ホーム（LP）")).toBeVisible();
  // 来訪者推移のグラフ（T-M8-379）。
  await expect(page.getByRole("heading", { name: /ホーム来訪者／日/ })).toBeVisible();
  // ファネルには少なくとも自分（登録1人以上）が入る。
  const registered = page.getByRole("row").filter({ hasText: "登録" }).first();
  await expect(registered).toBeVisible();

  // 利用者一覧に自分（運営者）の行が代表データ付きで出る（T-M8-374）。
  await expect(
    page.getByRole("heading", { name: /利用者一覧/ }),
  ).toBeVisible();
  const myRow = page.getByRole("row").filter({ hasText: operatorEmail! });
  await expect(myRow.first()).toBeVisible();
  // 「投稿」は投稿済みの下書き件数、「生成」は直近90日、「最終操作」は利用者自身の操作だけ——
  // 列名でそう読めるようにする（D-55(4)・T-M8-427。cron が進める updated_at を「最終利用」と呼ばない）。
  await expect(page.getByRole("columnheader", { name: "投稿（済み）" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "生成（成功・90日）" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "最終操作" })).toBeVisible();

  // 流入元の登録（T-M8-423）: フォームから登録すると追跡URLが行に出る。
  const slug = `e2e-admin-${Date.now().toString(36)}`;
  await page.getByLabel("表示名（例: Xのプロフィール）").fill("E2Eの流入元");
  await page.getByLabel("URLに入る名前（小文字英数字・_・-）").fill(slug);
  await page.getByRole("button", { name: "追跡URLを発行" }).click();
  await expect(page.getByRole("status")).toContainText("登録しました");
  await expect(page.getByLabel("E2Eの流入元の追跡URL")).toHaveValue(new RegExp(`/\\?src=${slug}$`));
  await query(`delete from traffic_sources where slug = $1`, [slug]);

  // ページがスマホ幅で横に溢れない（管理画面も外で見ることがある）。
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "横スクロールが出ないこと").toBeLessThanOrEqual(0);
});
