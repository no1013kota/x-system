import { describe, expect, it } from "vitest";

import {
  createFailedNotification,
  DEFAULT_FAILED_NOTICE,
  FAILED_NOTICE,
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
      link: "/app/ai-settings?tab=learning",
    });
    expect(resolveFailedNotice("suggestion", { draft_id: null })).toEqual({
      title: "改善提案の生成に失敗しました",
      body: "時間をおいて分析画面から再度お試しください。",
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
