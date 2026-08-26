import { query } from "./fixtures/account";
import { expect, horizontalOverflow, signIn, test } from "./fixtures/test";

/**
 * SC-04 プラン選択とSC-11 課金タブの表示（PRD §プラン、要件03 §2、T-M7-26）。
 *
 * **決済ボタンは押さない。** 押すとStripeへ実際にセッションを作りに行き、CIではダミーキーの
 * ため必ず失敗する。ボタンの先の配線（checkout/portal）は `route.db.test.ts` 7本43件が
 * Stripe SDKをモックして検証しているので、ここは**画面の表示と権限**だけを見る。
 *
 * 契約状態によって見えるものが変わる部分（要件03 §2の閲覧ゲート）が主眼。
 */

/**
 * プラン選択のキャンペーン表示（T-M8-118/122）。LPと共通部品なので文言の決まりは1か所だが、
 * プラン選択画面に実際に出ていることは別で見る（部品を使い忘れても型では落ちない）。
 */
test("プラン選択に半額バッジと終了後価格が出て、「通常価格」とは書かない（T-M8-122）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-campaign");
  // **先にログインしてから申込前へ落とす。** `signIn` は `/app` への着地を待つので、
  // 未契約のままログインすると `/plans` へ送られて待ち続けてしまう。
  await signIn(page, account);
  await query(
    `update profiles set plan = null, subscription_status = 'incomplete',
        current_period_end = null, trial_ends_at = null where id = $1`,
    [account.userId],
  );
  await page.goto("/plans");

  // 3プランぶん出る（件数を固定しない——プラン数が変わったらここも直す前提にしない）。
  const badges = page.getByText("リリース記念 半額");
  await expect(badges.first()).toBeVisible();
  expect(await badges.count(), "全プランにバッジが出る").toBeGreaterThanOrEqual(3);

  await expect(page.getByText("キャンペーン終了後", { exact: false }).first()).toBeVisible();
  // 終了後価格が取り消し線で出る（プレミアムの 7,960 で代表して確かめる）。
  await expect(page.locator(".line-through").filter({ hasText: "7,960" }).first()).toBeVisible();

  // 景表法: 「通常価格」の語を使わない。
  await expect(page.getByText("通常価格")).toHaveCount(0);
});

test("未契約の利用者にはプラン選択が出て、申込前の確認事項が隠れていない", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-none");
  // 申込前の状態にする。未契約は plan = NULL（T-M8-168）。
  await query(
    `update profiles set plan = null, subscription_status = 'incomplete',
        current_period_end = null, trial_ends_at = null where id = $1`,
    [account.userId],
  );

  // 未契約でもアプリ本体は見られる（T-M8-268）。プラン選択は自分で開く。
  await signIn(page, account);
  await page.goto("/plans");

  // 3プランがカードとして並ぶ（T-M8-169でカード型へ。名前はPRDと同じ日本語表記・T-M8-21）。
  for (const name of ["スタンダードプラン", "プレミアムプラン", "エキスパートプラン"]) {
    await expect(page.getByRole("article", { name: new RegExp(name) })).toBeVisible();
  }
  // 推奨（プレミアム）にだけ「おすすめ」バッジが付く。
  const premiumCard = page.getByRole("article", { name: /プレミアムプラン/ });
  await expect(premiumCard.getByText("おすすめ")).toBeVisible();
  // 機能リストは表と同じデータ源（plan-comparison.ts）から出る。
  await expect(
    page.getByText("アカウント.md・プロンプトの直接編集").first(),
  ).toBeVisible();
  // 各カードにXアカウント数のバンドが出る。
  await expect(page.getByText(/Xアカウント 3件までを連携/)).toBeVisible();
  // エキスパートは「無制限」とだけ出て、内部ガードの数値（5000等）は出ない（T-M8-168）。
  const expertCard = page.getByRole("article", { name: /エキスパートプラン/ });
  await expect(expertCard.getByText("無制限")).toBeVisible();
  await expect(page.getByText(/5,?000/)).toHaveCount(0);
  // BYOKの追加費用はスタンダードカードの「APIキーの用意」行が常時表示する（T-M8-171）
  await expect(page.getByText(/ご自身のAPI課金/).first()).toBeVisible();

  /**
   * 申込前の開示（T-M8-171・運営者の決定 2026-08-21）。
   *
   * 定型文はプロモ帯（CampaignCallout）へ畳んだ。**「カード登録が必要」は
   * 帯の中に残る**（景表法の有利誤認回避・無料の条件）。自動更新・解約の法定事項の全文は
   * フッタから辿れる特定商取引法ページが担う。
   */
  await expect(page.getByText("7日間の無料トライアル", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("カード登録が必要", { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "特定商取引法に基づく表記" }).first(),
  ).toBeVisible();

  // 申込ボタンは各プランにあるが、押さない（Stripeへ実際に作りに行くため）
  await expect(page.getByRole("button", { name: /7日間無料で利用/ }).first()).toBeVisible();

  // スマホ幅でも読める（表はページを横に伸ばさず、自分の中でスクロールする）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await horizontalOverflow(page), "ページ全体が横に伸びないこと").toBeLessThanOrEqual(0);
});

test("契約中の利用者はプラン選択に留まらず、契約状態が設定画面で読める", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-active");
  // **Stripeの顧客が紐づいていることが「契約中」の条件**（T-M8-54）。
  // 顧客が無いまま送り返すと、設定＞課金の「プランを選ぶ」を押してもホームへ戻るだけで
  // 何もできない行き止まりになるため、`/plans` は顧客がある契約者だけを送り返す。
  await query(`update profiles set stripe_customer_id = 'cus_e2e_plans_active' where id = $1`, [
    account.userId,
  ]);
  await signIn(page, account);

  // 契約が有効ならアプリ本体に入れる（/plans へは行かない）
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // /plans を直接開いてもアプリへ戻される（決済後に行き止まりにならない）
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // 設定画面で契約状態が読める
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();
  await expect(page.getByText("プラン", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("プレミアムプラン", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("契約状態", { exact: false }).first()).toBeVisible();
  // プラン選択でもキャンペーン表示が出て、「通常価格」の語を使わない（T-M8-118/122）。
  // LPと同じ部品なので、片方だけ壊れることは無い形にしてある。
  await page.goto("/plans");
  await expect(page).toHaveURL(/\/app(\/|$|\?)/); // 契約者は送り返される
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();

  // いま実際にいくら払っているかがプラン名の真横で読める（T-M8-118→運営者の指示 2026-08-22で
  // 「キャンペーン終了後」の併記は廃止。終了後価格の表示はプランカード側だけが担う）。
  await expect(page.getByText("月額 ¥3,980（税込）", { exact: false })).toBeVisible();
  await expect(page.getByText("キャンペーン終了後", { exact: false })).toHaveCount(0);

  // キー登録不要のプランでも、APIキータブが行き止まりにならない（何が付くかが読める・T-M8-25）
  await page.goto("/app/settings?tab=api-keys");
  await expect(page.getByRole("heading", { name: /キー登録不要/ })).toBeVisible();
  await expect(page.getByText("AIクレジット").first()).toBeVisible(); // 金額制AIクレジット（T-M8-109）
  await page.goto("/app/settings?tab=billing");
  // `goto` の直後に `count()` を取ると描画前を見てしまうので、先に見出しを待つ。
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();

  // プラン管理の導線は**必ずどこかへ着く**（T-M8-29）。Stripeの顧客があれば「プランを変更」
  // 「解約する」の2つ（T-M8-31 でやりたいことを先に選ばせる形にした）、顧客が無ければ
  // 料金プランへのリンクに切り替える（T-M8-54）。
  const update = page.getByRole("button", { name: "プランを変更" });
  const cancel = page.getByRole("button", { name: "解約する" });
  const choose = page.getByRole("link", { name: "プランを選ぶ" });
  const routes = (await update.count()) + (await cancel.count()) + (await choose.count());
  expect(routes, "プラン管理の導線がある").toBeGreaterThan(0);
  if (await choose.count()) await expect(choose).toHaveAttribute("href", "/plans");
  // 顧客がある契約者なら、変更と解約の両方が出る
  if (!(await choose.count())) {
    await expect(update).toBeVisible();
    await expect(cancel).toBeVisible();
  }
});

test("契約が切れると機能画面はロックされ、友達招待と課金・プランだけ使える（T-M8-269）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("plans-canceled");
  await query(
    // トライアル期間も終えた「有料契約が切れた」状態にする（残りトライアルがあると
    // 再開ボタンが「無料トライアルを再開」になる・T-M8-278）。
    `update profiles set subscription_status = 'canceled', stripe_customer_id = 'cus_e2e_plans_c',
            current_period_end = now() - interval '1 day',
            trial_ends_at = now() - interval '30 days'
      where id = $1`,
    [account.userId],
  );

  // ログイン直後はアプリ本体（/plansへは飛ばさず、その場でロックの理由を出す）。
  await signIn(page, account);
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);

  // 契約のお知らせが出て、再開への導線が読める。
  const banner = page.getByRole("complementary", { name: "ご契約のお知らせ" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "プランを選択" })).toBeVisible();

  // 機能画面はロックされ、リダイレクトではなくその場で理由と導線が出る（T-M8-269）。
  for (const path of ["/app", "/app/posts?tab=drafts", "/app/analytics", "/app/settings?tab=general"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.split("?")[0].replace(/\//g, "\\/")));
    await expect(
      page.getByRole("heading", { name: "先にプランを登録してください" }),
      `${path} がロックされていない`,
    ).toBeVisible();
  }

  // 友達招待は契約なしでも参加できる（招待リンクが出る）。
  await page.goto("/app/invite");
  await expect(page.getByRole("heading", { name: "友達招待" })).toBeVisible();

  // 課金タブからは再開できる（ロック中もここへは辿り着ける）。
  await page.goto("/app/settings?tab=billing");
  await expect(page.getByRole("heading", { name: "現在のご契約" })).toBeVisible();
  await expect(page.getByRole("button", { name: "プランを再開" })).toBeVisible();
});

/**
 * プラン変更・解約の結果を**押す前に**読めること（T-M8-55）。
 *
 * 利用者からの質問「プラン変更を完了したらいつからプラン変更になりますか？支払いはどう変わりますか？」
 * が画面から読めなかった。金額と時期が変わる操作なので、Stripeへ移動する前に示す。
 * 文言はStripe側の設定（`setup-stripe-portal.mjs`）と1対1で対応する。
 */
test("プラン変更で何が起きるかを押す前に読める（T-M8-55）", async ({ accounts, page }) => {
  const account = await accounts.create("plan-effects");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_effects',
        current_period_end = '2026-08-12T00:00:00Z' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await expect(page.getByRole("button", { name: "プランを変更" })).toBeVisible();
  // 上位＝即時、下位＝期間末（日付つき）、解約＝トライアル中は押した時点で終了（T-M8-278）
  await expect(page.getByText("すぐに切り替わり", { exact: false })).toBeVisible();
  await expect(page.getByText("2026年8月12日に切り替わります")).toBeVisible();
  await expect(
    page.getByText("押した時点で終了します（2026年8月12日までなら残りの期間で再開できます）"),
  ).toBeVisible();
  /*
    トライアル中は**日割りの話をしない**（T-M8-243）。Portal設定は `continue_trial` なので、
    変更しても無料期間は変わらず、終了後に新しい料金で請求が始まる。以前は
    「差額は日割りで次回請求に加算」と「終了日まで請求は発生しない」が同時に出ていた。
  */
  await expect(
    page.getByText("トライアルの終了日（2026年8月12日）までは料金が発生しません"),
  ).toBeVisible();
  await expect(page.getByText("日割り"), "トライアル中に日割りを出さない").toHaveCount(0);

  // **Markdownの記号が画面に出ていない**（強調は要素で表す・実際に `**` が出た）
  await expect(page.getByText("**", { exact: false })).toHaveCount(0);

  // 解約予約済みなら、説明とボタンの両方が切り替わる（T-M8-57）。
  // 予約済みなのに「解約する」を出し続けると同じ操作を促すことになるため、
  // 取り消し（StripeのPortalトップにある「プランを続ける」）へ導線を替える。
  await query(`update profiles set cancel_at_period_end = true where id = $1`, [account.userId]);
  await page.reload();
  // 「この先の予定」の行と、押す前の効果説明（解約: …）の2か所に出る。
  await expect(page.getByText("2026年8月12日に解約されます")).toHaveCount(2);
  await expect(page.getByText("押した時点で終了します", { exact: false })).toHaveCount(0);
  // 課金カードとヘッダー直下のバナー（T-M8-253）の両方が「解約する」を出さない。
  // バナー側は以前 `cancelAtPeriodEnd` を受けておらず「◯日に解約されます」の横に「解約する」が並んでいた。
  await expect(page.getByRole("button", { name: "解約する" })).toHaveCount(0);
  // 契約バナー（App Shell）とカードの両方に出る（バナー側の出し分け漏れはT-M8-266で修正）。
  // **その場で取り消す**ボタン（Stripeへは遷移しない・T-M8-271）。
  await expect(page.getByRole("button", { name: "解約予定を取り消す" })).toHaveCount(2);
  // 解約・下位変更の予定は「プラン」の下・「現在の期間終了日」の上に出す（運営者の指示 2026-08-23）。
  await expect(page.getByText("この先の予定")).toBeVisible();
  await expect(
    page.getByText("2026年8月12日に解約されます（それまでは今までどおりご利用いただけます）"),
  ).toBeVisible();
});

/**
 * 予約済みの下位プラン変更（T-M8-260）。Portalで値下げを選ぶと期間末の予約になり、
 * 予約が付いた契約はPortalで再変更できない。予約の存在と取り消しの場所を画面に出す。
 * Stripe本体の解除は実DBテスト（subscription-sync.db.test）が担い、ここは表示と導線を見る。
 */
test("下位プランへの予約が課金タブとバナーに出て、取り消しへ辿れる（T-M8-260）", async ({ accounts, page }) => {
  const account = await accounts.create("plan-scheduled");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_sched', subscription_status = 'active',
        current_period_end = '2026-09-30T15:00:00Z',
        scheduled_plan = 'standard', scheduled_plan_at = '2026-09-30T15:00:00Z' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app");
  // App Shell バナー（JSTで10月1日）に取り消しの場所へのリンク
  const banner = page.getByRole("complementary", { name: "ご契約のお知らせ" });
  await expect(banner).toContainText("2026年10月1日にスタンダードプランへ切り替わる予約があります");
  await banner.getByRole("link", { name: "課金・プランを確認" }).click();
  await expect(page).toHaveURL(/settings\?tab=billing/);

  // 課金タブ: **プラン名と同じ場所**に予約を出し（運営者の指示 2026-08-23）、
  // 「プランを変更」の隣に取り消しボタンを置く
  // （Portal は予約付きでも別プランへ変更できるので「プランを変更」は残す・実測 2026-08-23）
  await expect(page.getByText("2026年10月1日にスタンダードプランへ切り替わります")).toBeVisible();
  // バナーは「予約があります」の文（同じ正本 `scheduled-plan-change.ts`）
  await expect(page.getByText("2026年10月1日にスタンダードプランへ切り替わる予約があります")).toBeVisible();
  await expect(page.getByRole("button", { name: "プランを変更", exact: true })).toBeVisible();
  const cancel = page.getByRole("button", { name: "プラン変更の予約を取り消す" });
  await expect(cancel).toBeVisible();

  // 確認ダイアログで「キャンセル」なら何も変わらない
  page.once("dialog", (dialog) => void dialog.dismiss());
  await cancel.click();
  await expect(cancel).toBeEnabled();
  const row = await query<{ scheduled_plan: string | null }>(
    "select scheduled_plan from profiles where id = $1",
    [account.userId],
  );
  expect(row[0]?.scheduled_plan).toBe("standard");
});

/**
 * 利用枠は契約期間ごと（T-M8-258）。画面のリセット日は翌月1日ではなく契約の次回更新日（JST）で、
 * 残量は期間キー（期間開始日の JST 日付）の行から読む。
 */
test("利用枠のリセット日が次回更新日になり、残量は契約期間の行から読む（T-M8-258）", async ({ accounts, page }) => {
  const account = await accounts.create("usage-period");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_period', subscription_status = 'active',
        current_period_start = '2026-08-14T15:00:00Z', -- 8/15 00:00 JST
        current_period_end = '2026-09-14T15:00:00Z'   -- 9/15 00:00 JST
      where id = $1`,
    [account.userId],
  );
  await query(
    `insert into usage_counters (user_id, month, normal_posts_count, url_posts_count, ai_credits_used)
     values ($1, to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM'), 150, 15, 900),
            ($1, '2026-08-15', 7, 2, 120)`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");
  const card = page.getByRole("region", { name: "利用枠" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("2026年9月15日にリセット");
  // 暦月の行（150/15/900）ではなく期間の行（7/2/120）
  // クレジットは100倍の粒度（T-M8-325）。表示は桁区切りつき。
  await expect(card).toContainText("残り 99,880 / 100,000");
  await expect(card).toContainText("残り 193 / 200");
  await expect(card).toContainText("残り 18 / 20");
});

/**
 * 解約の導線（T-M8-277・運営者の指示 2026-08-23）。押したら即Stripeへ、にしない。
 * 1. 何が止まり何が残るかの確認 → 2. 理由のアンケート（選択必須・記述は任意）→ 3. Stripeの解約画面。
 */
test("解約は確認とアンケートを挟んでからStripeへ進む（T-M8-277）", async ({ accounts, page }) => {
  const account = await accounts.create("cancel-flow");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_cancel_flow', subscription_status = 'active',
        current_period_end = '2026-09-15T00:00:00Z' where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await page.getByRole("button", { name: "解約する" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("本当に解約しますか？")).toBeVisible();
  // 止まることと残ること（不安だけ煽らない）。
  await expect(dialog.getByText("予約した自動投稿・下書きの自動作成が止まります")).toBeVisible();
  await expect(dialog.getByText(/下書き・投稿履歴・分析結果は消えません/)).toBeVisible();
  /*
    **「閲覧できます」とは書かない**（運営者の指摘 2026-08-24）。データが消えないのは本当だが、
    解約後は課金・プラン以外がロックされる（T-M8-269）ので、開いて見ることはできない。
  */
  await expect(dialog.getByText(/閲覧できます/)).toHaveCount(0);

  // 「やめておく」で閉じる（既定の逃げ道が押しやすい側にある）。
  await dialog.getByRole("button", { name: "やめておく" }).click();
  await expect(dialog).toHaveCount(0);

  // もう一度開いてアンケートへ。理由を選ぶまでは進めない。
  await page.getByRole("button", { name: "解約する" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "解約に進む" }).click();
  const survey = page.getByRole("alertdialog");
  await expect(survey.getByText("解約の理由（あてはまるものをすべて選んでください）")).toBeVisible();
  await expect(survey.getByRole("button", { name: "解約手続きへ進む" })).toBeDisabled();
  // **複数選べる**（T-M8-294）。理由は1つに絞れないことが多く、絞らせると集計が歪む。
  await survey.getByRole("checkbox", { name: "料金が高い" }).check();
  await survey.getByRole("checkbox", { name: "あまり使わなかった" }).check();
  await expect(survey.getByRole("button", { name: "解約手続きへ進む" })).toBeEnabled();

  // 回答はDBへ残る（運営者が何を直すべきか読めるように）。
  await survey.getByRole("button", { name: "解約手続きへ進む" }).click();
  await expect
    .poll(async () => {
      const rows = await query<{ reasons: string[]; proceeded: boolean }>(
        `select reasons, proceeded from cancellation_surveys where user_id = $1`,
        [account.userId],
      );
      return rows[0]?.reasons?.join(",") ?? null;
    })
    // 選んだ2つが両方残る（片方だけになっていたら複数選択が保存できていない）。
    .toBe("price,not_used");
});


/**
 * トライアル中の解約確認（T-M8-278・文言の修正は運営者の指摘 2026-08-24）。
 *
 * 有料の解約と**別の画面文言**になる（その場で終了する・残り期間で再開できる）ので別に守る。
 * 特に「データは消えないが、解約中は開けない」の言い分けを固定する——ここを
 * 「閲覧できます」に戻すと、解約してから食い違いに気付くことになる（解約中は課金・プラン以外が
 * ロックされる・T-M8-269）。**最後まで押さない**（押すと実Stripeへ向かうため）。
 */
test("トライアル中の解約確認は「その場で終了」と、データの扱いを正しく伝える（T-M8-278）", async ({
  accounts,
  page,
}) => {
  const account = await accounts.create("cancel-trial-copy");
  await query(
    `update profiles set stripe_customer_id = 'cus_e2e_cancel_trial', subscription_status = 'trialing',
        trial_ends_at = now() + interval '5 days', current_period_end = now() + interval '5 days'
      where id = $1`,
    [account.userId],
  );
  await signIn(page, account);
  await page.goto("/app/settings?tab=billing");

  await page.getByRole("button", { name: "解約する" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("本当に解約しますか？")).toBeVisible();
  // 有料と違い「終了日まで使える」ではない。押した時点で終わることを先に言う。
  await expect(dialog.getByText(/その場で終了します/)).toBeVisible();
  await expect(dialog.getByText(/繰り越せません/)).toBeVisible();
  // データは消えないが、解約中は開けない。両方を1行で言い切る。
  await expect(dialog.getByText(/下書き・投稿履歴・分析結果は消えません/)).toBeVisible();
  await expect(dialog.getByText(/解約中は開けませんが、再開すればそのまま使えます/)).toBeVisible();
  await expect(dialog.getByText(/閲覧できます/)).toHaveCount(0);
  // 残り期間で戻れることも、押す前に読める。
  await expect(dialog.getByText(/残りの期間で無料トライアルを再開できます/)).toBeVisible();

  // トライアルはStripeの解約画面へ送らず、その場で終わらせる（ボタンの言葉が違う）。
  await dialog.getByRole("button", { name: "解約に進む" }).click();
  const survey = page.getByRole("alertdialog");
  await survey.getByRole("checkbox", { name: "料金が高い" }).check();
  await expect(survey.getByRole("button", { name: "今すぐ解約する" })).toBeEnabled();
  await expect(survey.getByRole("button", { name: "解約手続きへ進む" })).toHaveCount(0);
});
