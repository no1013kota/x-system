import { describe, expect, it } from "vitest";

import {
  createFailedNotification,
  DEFAULT_FAILED_NOTICE,
  FAILED_NOTICE,
  persistJobFailure,
  resolveFailedNotice,
} from "./notifications";

/**
 * job失敗通知の文言（R21）。
 *
 * 同じ失敗が **worker が自分で確定する経路**（各handlerの `persistFailure`）と
 * **stale経路**（`terminal.finalizeFailedJob`）の2つで通知される。以前は前者がSQLリテラル、
 * 後者が `FAILED_NOTICE` テーブルと**別々に文言を持っていた**ため、片方だけ直すと
 * 同じ失敗が経路によって違う文面で届いた。
 *
 * ここでは「文言がこの表だけに在ること」と「link の解決規則」を固定する。
 */

describe("resolveFailedNotice", () => {
  it("kindごとの文言を返す（worker経路とstale経路が同じ表を引く）", () => {
    expect(resolveFailedNotice("post_generation", { draft_id: null })).toEqual({
      title: "投稿の生成に失敗しました",
      body: "時間をおいて再度お試しください。設定や入力もご確認ください。",
      link: "/app/posts",
    });
    expect(resolveFailedNotice("learning_analysis", { draft_id: null })).toEqual({
      title: "学習ソースの分析に失敗しました",
      body: "時間をおいて再度お試しください。対象アカウント・投稿が非公開/削除されていないかもご確認ください。",
      link: "/app/ai-settings?tab=persona",
    });
    expect(resolveFailedNotice("suggestion", { draft_id: null })).toEqual({
      title: "投稿分析に失敗しました",
      body: "明日の朝に自動で再実行されます。Xアカウントの連携状態もご確認ください。",
      link: "/app/analytics",
    });
  });

  it("post_publish の link は draft_id から解決する", () => {
    expect(resolveFailedNotice("post_publish", { draft_id: "d1" }).link).toBe(
      "/app/posts?tab=drafts&draftId=d1",
    );
    // draft が特定できない場合も導線を失わない。
    expect(resolveFailedNotice("post_publish", { draft_id: null }).link).toBe("/app/posts");
  });

  it("表に無いkindは既定文言へ落ちる（通知が消えるより既定を出す）", () => {
    // `image_generation` は本文が使えるため error 通知を出さない＝表に載せない。
    expect(FAILED_NOTICE.image_generation).toBeUndefined();
    expect(resolveFailedNotice("image_generation", { draft_id: null })).toEqual({
      ...DEFAULT_FAILED_NOTICE,
      link: "/app",
    });
  });
});

describe("createFailedNotification", () => {
  it("dedupe_key は job:{id}:failed（同じjobの二重通知を防ぐ）", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        return { rows: [], rowCount: 0 };
      },
    };
    await createFailedNotification(db, {
      userId: "u1",
      jobId: "j1",
      title: "T",
      body: "B",
      link: "/app/posts",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["u1", "job:j1:failed", "j1", "T", "B", "/app/posts"]);
    // 通知設定が両方OFFなら行を作らない（select ... where で絞る形）。
    expect(calls[0].sql).toContain("notification_config->'error'->>'in_app'");
    expect(calls[0].sql).toContain("on conflict (user_id, dedupe_key)");
  });
});

describe("persistJobFailure", () => {
  function recorder() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      db: {
        async query(sql: string, params?: unknown[]) {
          calls.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 0 };
        },
      },
    };
  }

  const usage = {
    calls: [
      {
        provider: "anthropic" as const,
        model: "m",
        operation: "text_generation",
        request_id: "req-1",
        status: "failed" as const,
        stop_reason: null,
        latency_ms: 120,
        input_tokens: 10,
        output_tokens: 0,
        web_search_count: 0,
        cache_hit: false,
        citations: [],
        error_code: "overloaded",
        estimated_cost_usd: 0.001,
      },
    ],
    estimated_cost_usd_total: 0.001,
  };

  /**
   * 失敗時の原価記録は**落としても全テストが緑のまま通り、AI費用が過少計上される**
   * 種類の抜けだった（3handlerに同じ手順が反復していたため）。3手順を1つにまとめた以上、
   * 「原価記録が必ず走ること」をここで固定する（CLAUDE.md 原則4）。
   */
  it("error/usage保存のあとに原価台帳へ記録する（失敗時の費用が消えない）", async () => {
    const { calls, db } = recorder();
    await persistJobFailure(db, {
      jobId: "j1",
      userId: "u1",
      xAccountId: "x1",
      keyPrefix: "gen:j1",
      error: { code: "c", message: "m", stage: "writing", providerRawError: "raw" },
      usage,
      notifyKind: "post_generation",
    });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toContain("update generation_jobs set error");
    expect(
      sqls.some((s) => s.includes("external_api_usage_events")),
      "provider callが原価台帳へ記録される",
    ).toBe(true);
    expect(sqls.at(-1)).toContain("insert into notifications");
  });

  it("providerRawError を渡すとキーが出る／渡さないとキー自体を作らない", async () => {
    const withRaw = recorder();
    await persistJobFailure(withRaw.db, {
      jobId: "j1",
      userId: "u1",
      xAccountId: "x1",
      keyPrefix: "gen:j1",
      error: { code: "c", message: "m", stage: "writing", providerRawError: null },
      usage: { calls: [], estimated_cost_usd_total: 0 },
    });
    expect(Object.keys(JSON.parse(String(withRaw.calls[0].params[1]))).sort()).toEqual([
      "code",
      "message",
      "provider_raw_error",
      "retryable",
      "stage",
    ]);

    // suggestion はこちら。`provider_raw_error: null` を足すと保存JSONが変わる＝振る舞い変更。
    const without = recorder();
    await persistJobFailure(without.db, {
      jobId: "j2",
      userId: "u1",
      xAccountId: "x1",
      keyPrefix: "sug:j2",
      error: { code: "c", message: "m", stage: "writing" },
      usage: { calls: [], estimated_cost_usd_total: 0 },
    });
    expect(Object.keys(JSON.parse(String(without.calls[0].params[1]))).sort()).toEqual([
      "code",
      "message",
      "retryable",
      "stage",
    ]);
  });

  it("notifyKind を渡さなければ通知を出さない（呼び出し側が別の通知を出す場合）", async () => {
    const { calls, db } = recorder();
    await persistJobFailure(db, {
      jobId: "j1",
      userId: "u1",
      xAccountId: "x1",
      keyPrefix: "img:j1",
      error: { code: "c", message: "m", stage: null },
      usage: { calls: [], estimated_cost_usd_total: 0 },
    });
    expect(calls.some((c) => c.sql.includes("insert into notifications"))).toBe(false);
  });
});
