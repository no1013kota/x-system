import { randomBytes, randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptWithKey } from "@/lib/crypto/envelope";
import { closePool, getPool, withTransaction } from "@/lib/db/pool";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal";
import { X_SCOPES } from "@/lib/x/oauth";

/**
 * 主要 Server Action を**本番実装のまま実DBへ通す**（T-M7-27）。
 *
 * これまで action 側のテストは `auth.test.ts` 1本だけで、しかもSupabaseまでモックしていた。
 * 2026-07-26 の `service_role` GRANT漏れは「純粋関数のテストが充実しているほどテスト済みに
 * 見える」型の穴で、同じ構造が actions 側に残っていた（API route 側は `*.db.test.ts` で解消済み）。
 *
 * モックするのは**セッションと Next のリクエストAPIだけ**（テスト環境に無いもの）。
 * DB・Supabaseクライアント・ビジネスロジックはモックしない。
 * 見るのは「happy path が `internal_error` にならないこと」＝配線が通っていること。
 */

// `@/lib/env` は import 時に process.env を検証するため、action を読む前に .env.local を流し込む。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
Object.assign(process.env, loadEnvConfig(process.cwd(), true, console, true).combinedEnv);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: session.getCurrentUser,
  // 一部のactionは requireUser 系の別APIを使うため、同じ実装を返す。
  requireUser: session.getCurrentUser,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  after: (fn: () => void) => void fn,
}));

describe("主要 Server Action（本番実装 × 実DB）", () => {
  let available = false;
  const testKey = randomBytes(32);
  let userId = "";
  let xAccountId = "";

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
    if (!available) return;
    /**
     * **Server Action のモジュールをここで先に読み込む**（T-M8-07）。
     *
     * 各テストは env を流し込んだ後に読む必要があるため `await import()` を使っているが、
     * それをテスト本文で行うと**モジュールのコンパイル時間がそのテストの制限時間に加算される**。
     * 並列実行で負荷が上がると既定の5秒を超え、実際に「Test timed out」で断続的に落ちていた
     * （4〜5回に1回）。ここで一度読めば以降はキャッシュに当たるので、本文側は書き換えずに済む。
     */
    await Promise.all([
      import("./settings"),
      import("./x-accounts"),
      import("./schedule"),
      import("./persona-settings"),
      import("./notifications"),
      import("./drafts"),
      import("./generation-jobs"),
      import("./api-keys"),
      import("@/lib/persona-settings"),
    ]);
  });

  // **テストごとに作った利用者は必ずその場で消す。** 残すと他のテスト（follower_snapshot 等の
  // 全アカウントを対象にする処理）の対象件数や上限を食い、無関係なテストが落ちる。
  afterEach(async () => {
    if (!userId) return;
    const uid = userId;
    userId = "";
    xAccountId = "";
    // FK順に子から消す（子テーブルが x_accounts を参照している）。
    await withTransaction(async (c) => {
      for (const table of [
        "external_api_usage_events",
        "usage_events",
        "improvement_suggestions",
        "follower_snapshots",
        "learning_sources",
        "prompt_templates",
        "generation_jobs",
        "drafts",
        "schedule_slots",
      ]) {
        await c.query(
          `delete from ${table} where x_account_id in (select id from x_accounts where user_id = $1)`,
          [uid],
        );
      }
      for (const table of ["usage_counters", "user_api_keys", "notifications"]) {
        await c.query(`delete from ${table} where user_id = $1`, [uid]);
      }
      await c.query(`update profiles set active_x_account_id = null where id = $1`, [uid]);
      await c.query(`delete from x_accounts where user_id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    }).catch(() => {});
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }
    const seeded = await withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        // 法務同意も入れる（T-M8-73で実行系Actionが現行版の同意を要求するようになった。
        // 入れないと本番実装どおり legal_consent_required で弾かれる）。
        `update profiles set plan = 'premium', subscription_status = 'active',
            current_period_end = now() + interval '30 days',
            terms_version = $2, terms_accepted_at = now(),
            privacy_version = $3, privacy_acknowledged_at = now()
          where id = $1`,
        [uid, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
      );
      const { rows } = await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
         values ($1,$2,$3,'テスト','managed','active',$4,$4,$5, now() + interval '1 hour')
         returning id`,
        [uid, `x-${randomUUID()}`, `h${uid.slice(0, 8)}`, encryptWithKey("t", testKey), X_SCOPES],
      );
      await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, rows[0].id]);
      return { uid, xid: rows[0].id };
    });
    userId = seeded.uid;
    xAccountId = seeded.xid;
    session.getCurrentUser.mockResolvedValue({ id: userId, email: `${userId}@example.com` });
  });

  it("設定: 通知・ニュース設定を保存できる", async () => {
    // 表示名（プロフィール）は T-M8-59 で削除（どこにも使われていなかった）。
    const { updateNotificationConfigAction, updateNewsConfigAction } = await import("./settings");

    const notifications = await updateNotificationConfigAction({
      news: { in_app: true },
      draft_created: { in_app: true },
      posted: { in_app: false },
      error: { in_app: true },
      billing: { in_app: true },
      usage: { in_app: true },
      summary: { in_app: true },
    });
    expect(notifications.status, JSON.stringify(notifications)).toBe("success");

    // 旧max_itemsが混ざっていても保存できる（黙って落とす・T-M8-187）。
    const news = await updateNewsConfigAction({
      categories: ["ai", "web3"],
      impact_filter: ["high"],
      max_items: 10,
    });
    expect(news.status, JSON.stringify(news)).toBe("success");

    const saved = await withTransaction((c) =>
      c.query<{ notification_config: Record<string, unknown> }>(
        `select notification_config from profiles where id = $1`,
        [userId],
      ),
    );
    // ニュースの email は入力に無ければ保存済みの値（既定OFF）を保つ（T-M8-407）。
    expect(saved.rows[0].notification_config.news).toEqual({ in_app: true, email: false });
  });

  it("Xアカウント: 一覧・active切替が本番実装で通る", async () => {
    const { listXAccountsAction, setActiveXAccountAction } = await import("./x-accounts");

    const list = await listXAccountsAction();
    expect(list.status, JSON.stringify(list)).toBe("success");
    expect(list.accounts?.some((a) => a.id === xAccountId)).toBe(true);

    const active = await setActiveXAccountAction({ x_account_id: xAccountId });
    expect(active.status, JSON.stringify(active)).toBe("success");
  });

  it("スケジュール: スロットの作成・停止・再開が本番実装で通る", async () => {
    const { createScheduleSlotAction, disableScheduleSlotAction, enableScheduleSlotAction, listScheduleSlotsAction } =
      await import("./schedule");

  // パターンは `post_patterns.id`（uuid）で指す（T-M8-129 U3）。
    const patternId = (
      await getPool().query<{ id: string }>(
        `select id from post_patterns where x_account_id = $1 and seed_key = 'p2'`,
        [xAccountId],
      )
    ).rows[0].id;
    const created = await createScheduleSlotAction({
      pattern_id: patternId,
      weekdays: [1, 3],
      time_jst: "09:00",
      mode: "draft",
      // 分野は必須（T-M8-29）。"other" は「追加指示に記載」。
      theme: "other",
      image_enabled: false,
    });
    expect(created.status, JSON.stringify(created)).toBe("success");
    const slotId = created.slot?.id ?? "";
    expect(slotId).not.toBe("");

    // 停止・再開は楽観lock（expected_updated_at）を要求する。直前の結果の値をそのまま使う。
    const disabled = await disableScheduleSlotAction({
      slot_id: slotId,
      expected_updated_at: created.slot?.updated_at ?? "",
    });
    expect(disabled.status, JSON.stringify(disabled)).toBe("success");

    const enabled = await enableScheduleSlotAction({
      slot_id: slotId,
      expected_updated_at: disabled.slot?.updated_at ?? "",
    });
    expect(enabled.status, JSON.stringify(enabled)).toBe("success");

    const list = await listScheduleSlotsAction();
    expect(list.status).toBe("success");
    expect(list.slots?.find((s) => s.id === slotId)?.enabled).toBe(true);
  });

  it("AI設定: アカウント設定の保存でアカウント.mdの初版が作られる", async () => {
    const { updatePersonaSettings } = await import("./persona-settings");
    const { DEFAULT_TONE_SETTINGS } = await import("@/lib/persona-settings");
    const res = await updatePersonaSettings({
      x_account_id: xAccountId,
      expected_base_md_version: 0,
      settings: {
        ng: { rules: [], topics: [], words: [] },
        persona: {
          audience: "従業員30名以下の経営者",
          speaker: "中小企業向け業務改善コンサルタント",
          value: "明日の実務で使える効率化",
        },
        themes: { free_text: "個人事業主向け", primary: ["business_ops"], secondary: ["ai"] },
        tone: { ...DEFAULT_TONE_SETTINGS },
      },
    });
    expect(res.status, JSON.stringify(res)).toBe("success");
    const saved = await withTransaction((c) =>
      c.query<{ version: number }>(
        `select base_md_version as version from x_accounts where id = $1`,
        [xAccountId],
      ),
    );
    expect(saved.rows[0].version, "初版が作られる").toBeGreaterThan(0);
  });

  it("お知らせ: 一覧と既読が本番実装で通る", async () => {
    const { listNotificationsAction, markAllNotificationsReadAction } = await import("./notifications");
    await withTransaction((c) =>
      c.query(
        `insert into notifications (user_id, type, title, body, in_app_enabled)
         values ($1,'summary','テスト','本文', true)`,
        [userId],
      ),
    );
    const list = await listNotificationsAction();
    expect(list.status, JSON.stringify(list)).toBe("success");
    const read = await markAllNotificationsReadAction();
    expect(read.status, JSON.stringify(read)).toBe("success");
  });

  it("下書き: 一覧と破棄が本番実装で通る", async () => {
    const { listDraftsAction, discardDraftAction } = await import("./drafts");
    const thread = [
      { local_id: "p1", text: "本文", weighted_length: 4, sources: [], warnings: [] },
    ];
    const [draft] = await withTransaction((c) =>
      c
        .query<{ id: string; updated_at: string }>(
          `insert into drafts (x_account_id, pattern_id, thread, initial_thread, status)
           values ($1, (select id from post_patterns where x_account_id = $1 and seed_key = 'p2'), $2::jsonb, $2::jsonb, 'draft')
           returning id, updated_at::text as updated_at`,
          [xAccountId, JSON.stringify(thread)],
        )
        .then((r) => r.rows),
    );

    const list = await listDraftsAction({});
    expect(list.status, JSON.stringify(list)).toBe("success");
    expect(list.drafts?.some((d) => d.id === draft.id)).toBe(true);

    // 破棄は楽観lock（expected_updated_at）を要求する。
    const discarded = await discardDraftAction({
      draft_id: draft.id,
      expected_updated_at: draft.updated_at,
    });
    expect(discarded.status, JSON.stringify(discarded)).toBe("success");
  });

  it("生成job: 前提が足りないときは内部エラーではなく理由を返す", async () => {
    // アカウント設定（アカウント.md）が無い状態で生成を頼むと、前提不足として案内される必要がある。
    // ここが internal_error になると、利用者は何をすればよいか分からない。
    const { createGenerationJobAction } = await import("./generation-jobs");
    const res = await createGenerationJobAction({
      request_key: randomUUID(),
      pattern: "p2",
      image_requested: false,
    });
    expect(res.status).toBe("error");
    expect(res.code, JSON.stringify(res)).not.toBe("internal_error");
    expect(res.code, "前提不足として返る").toMatch(/persona|prereq|required|validation/);
  });

  it("APIキー: premium は自前キーを保存できない（内部エラーにせず権限エラーを返す）", async () => {
    // premium は運営のDeveloper Appを使うためBYOKキーを持たない（要件03）。
    const { saveXApiKey } = await import("./api-keys");
    const res = await saveXApiKey({
      client_id: "test-client-id",
      client_secret: "test-client-secret-value",
      client_type: "confidential",
    });
    expect(res.status).toBe("error");
    expect(res.code).toBe("forbidden");
  });

  it("APIキー: BYOKプラン（md）は保存でき、暗号化して保存される", async () => {
    await withTransaction((c) =>
      c.query(`update profiles set plan = 'standard' where id = $1`, [userId]),
    );
    const { saveXApiKey } = await import("./api-keys");
    const res = await saveXApiKey({
      client_id: "test-client-id",
      client_secret: "test-client-secret-value",
      client_type: "confidential",
    });
    expect(res.status, JSON.stringify(res)).toBe("success");
    const saved = await withTransaction((c) =>
      c.query<{ provider: string; cipher: string; hint: string | null }>(
        `select provider::text as provider, credentials_ciphertext as cipher, display_hint as hint
           from user_api_keys where user_id = $1`,
        [userId],
      ),
    );
    expect(saved.rows.length, "行が作られる").toBeGreaterThan(0);
    expect(saved.rows[0].cipher, "平文で保存していない").not.toContain("test-client-secret-value");
    expect(saved.rows[0].cipher, "暗号化されている").not.toContain("test-client-id");
  });

  it("APIキー: AIキーの保存→検証（X）→削除が本番実装で通る（T-M8-59）", async () => {
    // saveAiApiKey / verifyApiKey / deleteApiKey はどのテストからも呼ばれていなかった
    // （store層のdbテストはあるが、Action層の配線は未検証だった）。外部APIは呼ばない。
    await withTransaction((c) =>
      c.query(`update profiles set plan = 'standard' where id = $1`, [userId]),
    );
    const { deleteApiKey, saveAiApiKey, verifyApiKey } = await import("./api-keys");

    const saved = await saveAiApiKey({
      provider: "anthropic",
      api_key: "sk-ant-test-0123456789abcdef",
    });
    expect(saved.status, JSON.stringify(saved)).toBe("success");
    const row = await withTransaction((c) =>
      c.query<{ cipher: string }>(
        `select credentials_ciphertext as cipher from user_api_keys
          where user_id = $1 and provider = 'anthropic'`,
        [userId],
      ),
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].cipher, "平文で保存していない").not.toContain("sk-ant-test");

    // Xキーの「検証」は外部を呼ばず unchecked を返す（検証はOAuth連携が担う・要件05 §5）
    const { saveXApiKey } = await import("./api-keys");
    const savedX = await saveXApiKey({
      client_id: "verify-check-client",
      client_secret: null,
      client_type: "public",
    });
    expect(savedX.status, JSON.stringify(savedX)).toBe("success");
    const verified = await verifyApiKey({ provider: "x" });
    expect(verified.status).toBe("success");
    expect(verified.keyStatus).toBe("unchecked");

    // AIキーの削除は行が消える（AI providerは revoke 呼び出しなし）
    const removed = await deleteApiKey({ provider: "anthropic" });
    expect(removed.status, JSON.stringify(removed)).toBe("success");
    const after = await withTransaction((c) =>
      c.query(`select 1 from user_api_keys where user_id = $1 and provider = 'anthropic'`, [userId]),
    );
    expect(after.rows).toHaveLength(0);
  });

  /**
   * 振込先口座の登録（T-M8-301）。**入力の検証だけがテストされていなかった**——
   * happy path はE2Eが通しているが、弾くべき入力を弾けているかはどこも見ていなかった。
   * ここは**運営者がターミナルへ表示して振込に使う値**なので、
   * 制御文字（ANSIエスケープ）が混ざると表示上の金額や名義を偽装され得る。
   */
  describe("振込先口座の入力検証（T-M8-301）", () => {
    const valid = {
      account_holder_name: "テスト タロウ",
      account_number: "1234567",
      account_type: "ordinary" as const,
      bank_name: "テスト銀行",
      branch_name: "本店",
    };

    it("正しい入力は保存でき、口座番号は末尾4桁しか残らない", async (ctx) => {
      if (!available) return ctx.skip();
      const { saveAffiliatePayoutAccount } = await import("./affiliate");
      const res = await saveAffiliatePayoutAccount(valid);
      expect(res.status, JSON.stringify(res)).toBe("success");

      const { rows } = await withTransaction((c) =>
        c.query<{ last4: string; cipher: string }>(
          `select p.bank_account_last4 as last4, p.account_number_ciphertext as cipher
             from affiliate_payout_accounts p
             join affiliate_accounts a on a.id = p.affiliate_account_id
            where a.user_id = $1`,
          [userId],
        ),
      );
      expect(rows[0]?.last4).toBe("4567");
      expect(rows[0]?.cipher, "口座番号を平文で持たない").not.toContain("1234567");
    });

    it("桁数・文字種の違う口座番号は弾く", async (ctx) => {
      if (!available) return ctx.skip();
      const { saveAffiliatePayoutAccount } = await import("./affiliate");
      for (const account_number of ["123", "123456789", "12a4567", "", "１２３４５６７"]) {
        const res = await saveAffiliatePayoutAccount({ ...valid, account_number });
        expect(res.status, `${account_number} を受け付けてしまった`).toBe("error");
        expect(res.code).toBe("validation_error");
      }
    });

    it("制御文字を含む名義・銀行名は弾く（運営者の画面で表示を偽装させない）", async (ctx) => {
      if (!available) return ctx.skip();
      const { saveAffiliatePayoutAccount } = await import("./affiliate");
      const spoof = "テスト\u001b[2K\r振込済み";
      for (const field of ["account_holder_name", "bank_name", "branch_name"] as const) {
        const res = await saveAffiliatePayoutAccount({ ...valid, [field]: spoof });
        expect(res.status, `${field} に制御文字が通ってしまった`).toBe("error");
        expect(res.code).toBe("validation_error");
      }
    });

    it("空欄・長すぎる値・知らない口座種別は弾く", async (ctx) => {
      if (!available) return ctx.skip();
      const { saveAffiliatePayoutAccount } = await import("./affiliate");
      expect((await saveAffiliatePayoutAccount({ ...valid, bank_name: "   " })).code).toBe(
        "validation_error",
      );
      expect(
        (await saveAffiliatePayoutAccount({ ...valid, branch_name: "あ".repeat(101) })).code,
      ).toBe("validation_error");
      expect((await saveAffiliatePayoutAccount({ ...valid, account_type: "savings" })).code).toBe(
        "validation_error",
      );
    });

    it("登録し直すと1件のまま更新される（口座は1人1つ）", async (ctx) => {
      if (!available) return ctx.skip();
      const { saveAffiliatePayoutAccount } = await import("./affiliate");
      await saveAffiliatePayoutAccount({ ...valid, account_number: "1111111" });
      await saveAffiliatePayoutAccount({ ...valid, account_number: "2222222" });
      const { rows } = await withTransaction((c) =>
        c.query<{ last4: string; n: string }>(
          `select p.bank_account_last4 as last4, count(*) over ()::text as n
             from affiliate_payout_accounts p
             join affiliate_accounts a on a.id = p.affiliate_account_id
            where a.user_id = $1`,
          [userId],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.last4, "最後に登録した口座になる").toBe("2222");
    });
  });

  it("認証されていなければ内部エラーではなく認可エラーを返す", async () => {
    session.getCurrentUser.mockResolvedValue(null);
    const { listXAccountsAction } = await import("./x-accounts");
    const res = await listXAccountsAction();
    expect(res.status).toBe("error");
    expect(res.code, "internal_error にせず原因が分かるコードを返す").not.toBe("internal_error");
  });
});
