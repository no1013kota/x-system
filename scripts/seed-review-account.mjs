/**
 * ローカルで画面を見るための確認用アカウントを作る（T-M8-27）。
 *
 * 何度でも実行できる。同じメールアドレスのアカウントがあれば**中身を作り直す**（消してから入れ直す）。
 * X APIは呼ばない（`X_POSTING_MODE=dry_run` 前提。トークンは封緘した偽の値）。
 *
 * 使い方:
 *   npm run seed:review
 *
 * ニュースは既にDBにある分を使う（このスクリプトは作らない）。
 */
import { randomUUID } from "node:crypto";/**
 * 同意済みとして書き込む法務文書のversion（T-M8-72）。
 * `.mjs` からは `src/lib/legal.ts` を import できないため値を持つが、
 * `legal-pages.test.ts` が `CURRENT_TERMS_VERSION` との一致を検査する
 * （古い値のままだと、配線済みの再同意ガードでレビュー用アカウントが弾かれる）。
 */
export const LEGAL_VERSION = "2026-08-20";
export const AUTOMATION_CONSENT_VERSION = "2026-08-08";



import { Client } from "pg";
import Stripe from "stripe";

const EMAIL = "review@example.com";
const PASSWORD = "Review-Local-Pw1";
const HANDLE = "exos_ai_review";

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** ローカル以外を触らないための歯止め（本番DBへ確認用アカウントを作らない）。 */
function assertLocal() {
  const local = /(127\.0\.0\.1|localhost)/;
  if (!local.test(DB_URL) || !local.test(SUPABASE_URL)) {
    console.error("❌ ローカル以外には作りません（DATABASE_URL / SUPABASE_URL が 127.0.0.1 ではありません）");
    process.exit(1);
  }
  if (!SERVICE_ROLE) {
    console.error("❌ SUPABASE_SERVICE_ROLE_KEY がありません。`supabase start` を実行してください");
    process.exit(1);
  }
}

/**
 * 既存の確認用アカウントをSQLで消す（FK順に子→親）。
 *
 * **Admin API の利用者一覧（`GET /admin/users`）は使わない。** ローカルの GoTrue は
 * 蓄積したテスト利用者で 500（`Database error finding users`）を返すことがあり、
 * 「消してから作り直す」がそこで止まる。メールアドレスで直接引く方が確実。
 */
async function removeExisting(client) {
  const { rows } = await client.query(`select id from auth.users where email = $1`, [EMAIL]);
  if (rows.length === 0) return;
  const userId = rows[0].id;
  const { rows: accounts } = await client.query(
    `select id from x_accounts where user_id = $1`,
    [userId],
  );
  await client.query(`update profiles set active_x_account_id = null where id = $1`, [userId]);
  // x_accounts / profiles を参照する表を先に消す（FK順。参照元が増えたらここへ足す）。
  for (const account of accounts) {
    for (const table of [
      "external_api_usage_events",
      "usage_events",
      "improvement_suggestions",
      "follower_snapshots",
      "learning_sources",
      "prompt_templates",
      "base_md_versions",
      "generation_jobs",
      "drafts",
      "schedule_slots",
    ]) {
      await client.query(`delete from ${table} where x_account_id = $1`, [account.id]);
    }
  }
  for (const table of [
    "external_api_usage_events",
    "usage_events",
    "usage_counters",
    "user_api_keys",
    "notifications",
  ]) {
    await client.query(`delete from ${table} where user_id = $1`, [userId]);
  }
  await client.query(`delete from x_accounts where user_id = $1`, [userId]);
  await client.query(`delete from auth.users where id = $1`, [userId]);
}

/** 確認済み（メール確認済み）の利用者を作る。 */
async function createAuthUser() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      authorization: `Bearer ${SERVICE_ROLE}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  if (!res.ok) {
    throw new Error(`利用者を作成できませんでした（status=${res.status}）`);
  }
  const body = await res.json();
  return body.id;
}

const BASE_MD = `# 発信定義書（ベースmd）

## 1. ペルソナ
中小企業向けの業務改善コンサルタント。従業員30名以下の経営者に向けて発信する。

## 2. 発信テーマ
主テーマ: 業務改善、AI。副テーマ: SNS運用。

## 3. トーン&マナー
です・ます調。一人称は「私」。絵文字は1ポストに1つまで。

## 4. やらないこと
断定的な投資助言はしない。他社の批判はしない。

## 5. 文体の特徴
1ポスト目で結論を出し、2ポスト目以降で理由を1つずつ足す。

## 6. 型
「よくある失敗 → なぜ起きるか → 明日できること」の順で書く。
`;

function post(text) {
  return {
    local_id: `p${Math.random().toString(36).slice(2, 7)}`,
    text,
    weighted_length: text.length * 2,
    sources: [],
    warnings: [],
  };
}

/**
 * Stripeのテスト用契約を用意する（T-M8-56）。
 *
 * これが無いと設定＞課金の「プランを変更」「解約する」が**必ず失敗する**——flow_data は
 * 実在する subscription を要求し、無ければ「現在のご契約状態ではこの操作を実行できません」で
 * 止まる（黙ってPortalのトップを開くよりは正直だが、ローカルで動作確認ができない）。
 * テストモード（`sk_test_`）ではトライアル付きの subscription を支払い方法なしで作れる。
 *
 * 鍵が無い・テスト鍵でない場合は**作らずにその旨を出力する**（実課金の可能性を残さない）。
 */
async function ensureStripeTestSubscription() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const price = process.env.STRIPE_PRICE_PREMIUM_MONTHLY?.trim();
  if (!key || !price) {
    return { note: "STRIPE_SECRET_KEY / STRIPE_PRICE_PREMIUM_MONTHLY が未設定のため、プラン変更・解約の動作確認はできません" };
  }
  if (!key.startsWith("sk_test_")) {
    return { note: "STRIPE_SECRET_KEY がテスト鍵（sk_test_）でないため、Stripeには何も作りません" };
  }
  const stripe = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });

  // 何度実行しても同じ状態へ（メールで顧客を特定して再利用する）。
  const existing = await stripe.customers.list({ email: EMAIL, limit: 1 });
  const customer =
    existing.data[0] ??
    (await stripe.customers.create({ email: EMAIL, name: "動作確認用アカウント" }));

  const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
  const reusable = subs.data.find((sub) => ["active", "trialing"].includes(sub.status));
  const subscription =
    reusable ??
    (await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price }],
      trial_period_days: 7,
      // 支払い方法が無いままトライアルが終わったら課金を試みず終了させる（テスト残骸を残さない）。
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    }));
  const periodEndEpoch =
    subscription.items?.data?.[0]?.current_period_end ?? subscription.trial_end ?? null;
  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    periodEnd: periodEndEpoch ? new Date(periodEndEpoch * 1000).toISOString() : null,
  };
}

async function main() {
  assertLocal();
  const client = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await removeExisting(client);
    const userId = await createAuthUser();
    // --- 契約（プレミアム・トライアル中）---
    // Stripeテスト鍵があれば**本物のテスト契約**を作って紐づける。これが無いと
    // 「プランを変更」「解約する」がローカルで動作確認できない（T-M8-56）。
    const stripeState = await ensureStripeTestSubscription();
    await client.query(
      `update profiles
          set plan = 'premium', subscription_status = 'trialing',
              current_period_end = coalesce($2::timestamptz, now() + interval '7 days'),
              trial_ends_at = coalesce($2::timestamptz, now() + interval '7 days'),
              stripe_customer_id = $3,
              stripe_subscription_id = $4,
              terms_version = $5, terms_accepted_at = now(),
              privacy_version = $5, privacy_acknowledged_at = now()
        where id = $1`,
      [
        userId,
        stripeState.periodEnd ?? null,
        stripeState.customerId ?? null,
        stripeState.subscriptionId ?? null,
        LEGAL_VERSION,
      ],
    );

    // --- Xアカウント（連携済み・発信設定まで完了・自動投稿に同意済み）---
    // トークンは偽の値。実投稿は X_POSTING_MODE=dry_run で行われない。
    const { rows: accountRows } = await client.query(
      `insert into x_accounts
         (user_id, x_user_id, handle, name, auth_type, status,
          access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
          token_expires_at, base_md, base_md_version,
          automation_consent_version, automation_consented_at)
       values ($1, $2, $3, '動作確認用アカウント', 'managed', 'active',
               'review-fake-token', 'review-fake-token',
               array['tweet.read','tweet.write','users.read','offline.access'],
               now() + interval '30 days', $4, 3, $5, now())
       returning id`,
      [
        userId,
        `x-review-${randomUUID().slice(0, 8)}`,
        HANDLE,
        BASE_MD,
        AUTOMATION_CONSENT_VERSION,
      ],
    );
    const xAccountId = accountRows[0].id;
    await client.query(`update profiles set active_x_account_id = $2 where id = $1`, [
      userId,
      xAccountId,
    ]);

    const { rows: patternRows } = await client.query(
      `select id, seed_key from post_patterns
        where x_account_id = $1 and seed_key = any($2::text[])`,
      [xAccountId, ["p1", "p2", "p3", "p6"]],
    );
    const patternIds = new Map(patternRows.map((row) => [row.seed_key, row.id]));
    for (const seedKey of ["p1", "p2", "p3", "p6"]) {
      if (!patternIds.has(seedKey)) {
        throw new Error(`既定の投稿パターン ${seedKey} を作成できませんでした`);
      }
    }

    // --- ベースmdの変更履歴（ロールバックを試せるように）---
    for (const version of [1, 2]) {
      await client.query(
        `insert into base_md_versions (x_account_id, version, content, change_source, summary)
         values ($1, $2, $3, 'manual', $4)`,
        [
          xAccountId,
          version,
          `${BASE_MD}\n<!-- version ${version} -->`,
          version === 1 ? "発信設定の保存で作成" : "手動編集",
        ],
      );
    }

    // --- スケジュール（有効2件・停止中1件）---
    // 分野は必須（T-M8-29）。曜日ごとに分野を変えた状態を見られるようにする。
    const slots = [
      { pattern: "p1", weekdays: "{1,3,5}", time: "09:30", mode: "draft", theme: "ai", enabled: true },
      { pattern: "p3", weekdays: "{2,4}", time: "19:00", mode: "auto", theme: "business_ops", enabled: true },
      { pattern: "p6", weekdays: "{0}", time: "21:00", mode: "draft", theme: "other", enabled: false },
    ];
    for (const slot of slots) {
      await client.query(
        `insert into schedule_slots
           (x_account_id, pattern_id, weekdays, time_jst, mode, theme, image_enabled, enabled)
         values ($1, $2, $3, $4, $5::schedule_mode, $6, false, $7)`,
        [
          xAccountId,
          patternIds.get(slot.pattern),
          slot.weekdays,
          slot.time,
          slot.mode,
          slot.theme,
          slot.enabled,
        ],
      );
    }

    // --- 下書き（確認待ち2件・警告あり1件）---
    const drafts = [
      {
        pattern: "p1",
        thread: [
          post("生産性を上げる前に、まず「やめること」を決める。人を増やす前にできる整理が3つあります。"),
          post("1つ目は会議です。議題の無い定例は、参加者の人数×時間だけ確実に失われます。"),
          post("2つ目は承認の段数。3段を2段にするだけで、差し戻しの往復が目に見えて減ります。"),
        ],
      },
      {
        pattern: "p3",
        thread: [
          post("請求書の処理に毎月10時間かけていた会社が、2時間まで縮めた手順を共有します。"),
          post("まず紙の受け取りをやめる。次に入力を1か所へ集める。最後に確認を月2回へまとめる。"),
        ],
      },
    ];
    for (const draft of drafts) {
      await client.query(
        `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
         values ($1, $2, $3::jsonb, $3::jsonb, 'draft')`,
        [xAccountId, patternIds.get(draft.pattern), JSON.stringify(draft.thread)],
      );
    }
    // 警告つき（自動投稿が止まる状態を画面で見るため）
    const warned = [post("この下書きにはNGワードが含まれています。自動投稿は停止します。")];
    warned[0].warnings = ["ng_word"];
    await client.query(
      `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
       values ($1, $2, $3::jsonb, $3::jsonb, 'draft')`,
      [xAccountId, patternIds.get("p2"), JSON.stringify(warned)],
    );

    // --- 投稿履歴と実績（分析画面を空にしない）---
    const posted = [
      { days: 2, text: "小さな改善を続けるコツは、記録を残すことだけです。", impressions: 4120, likes: 38 },
      { days: 9, text: "AIに任せる前に、手順を1枚の紙に書き出すと失敗が減ります。", impressions: 8830, likes: 96 },
      { days: 20, text: "「忙しい」の正体は、たいてい待ち時間です。", impressions: 2410, likes: 17 },
    ];
    for (const [index, item] of posted.entries()) {
      const tweetId = `review-${Date.now()}-${index}`;
      await client.query(
        `insert into drafts
           (x_account_id, pattern_id, thread, initial_thread, status, posted_mode, posted_at,
            root_tweet_id, tweet_ids, tweet_metrics, metrics_completed_at)
         values ($1, $2, $3::jsonb, $3::jsonb, 'posted', 'manual',
                 now() - ($4::text || ' days')::interval, $5, $6::jsonb, $7::jsonb,
                 now() - ($4::text || ' days')::interval + interval '30 days')`,
        [
          xAccountId,
          patternIds.get("p2"),
          JSON.stringify([post(item.text)]),
          String(item.days),
          tweetId,
          JSON.stringify([tweetId]),
          // 形は `TweetMetricEntry`（`checkpoints` の下に日数キー）。ここを間違えると
          // 画面は「未取得」と出るだけで、値が入っていないことに気付きにくい。
          JSON.stringify({
            [tweetId]: {
              latest_checkpoint_days: 7,
              checkpoints: {
                1: {
                  impressions: item.impressions,
                  likes: item.likes,
                  reposts: 3,
                  profile_clicks: 12,
                  collected_at: new Date().toISOString(),
                },
                7: {
                  impressions: Math.round(item.impressions * 1.4),
                  likes: item.likes + 9,
                  reposts: 5,
                  profile_clicks: 21,
                  collected_at: new Date().toISOString(),
                },
              },
            },
          }),
        ],
      );
    }

    // --- フォロワー数の推移（グラフを空にしない）---
    for (let day = 30; day >= 0; day -= 1) {
      await client.query(
        `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
         values ($1, (now() at time zone 'Asia/Tokyo')::date - ($2::text || ' days')::interval, $3)
         on conflict do nothing`,
        [xAccountId, day, 1200 + (30 - day) * 7],
      );
    }

    // --- 通知（未読2件。ベルの中身を見るため）---
    await client.query(
      `insert into notifications (user_id, type, title, body, link, in_app_enabled)
       values ($1, 'draft_created', '下書きを作成しました', '「ニュース解説」の下書きが1件できました。確認してから投稿できます。', '/app/posts?tab=drafts', true),
              ($1, 'error', '画像の生成に失敗しました', '文章は作成できています。画像だけ後から作り直せます。', '/app/posts?tab=drafts', true)`,
      [userId],
    );

    console.log(`
■ 確認用アカウントを作りました（ローカルのみ）

  URL       http://127.0.0.1:3000/login
  メール     ${EMAIL}
  パスワード  ${PASSWORD}

  入っているもの: プレミアム（トライアル中）・X連携済み・発信設定とベースmd（version 3・履歴2件）
                 スケジュール3件（有効2・停止1）・下書き3件（うち警告あり1）・投稿履歴3件と実績
                 フォロワー数31日分・未読通知2件・ニュース（DBにある分をそのまま表示）
  Stripe:       ${
    stripeState.subscriptionId
      ? `テスト契約を紐づけました（${stripeState.status}）。「プランを変更」「解約する」を実際に試せます`
      : `未接続（${stripeState.note}）`
  }

  もう一度実行すると同じ状態に作り直します（npm run seed:review）。
`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ 作成に失敗しました:", err.message);
  process.exit(1);
});
