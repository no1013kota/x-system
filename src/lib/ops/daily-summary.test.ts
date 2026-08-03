import { describe, expect, it } from "vitest";

import {
  buildDailySummary,
  jstDateOf,
  zeroStreakByCategory,
  ZERO_STREAK_ALERT_DAYS,
  type DailySummaryData,
} from "./daily-summary";

/**
 * 日次サマリ（T-M7-29）。静かな劣化＝「成功として記録される失敗」を運営者へ届けるための判定。
 * 2026-07-28、web3は `ok:true fetched:0` を返し続け、誰も気付かなかった。
 */

const base: DailySummaryData = {
  date: "2026-08-01",
  jobs: { succeeded: 3, failed: 0 },
  zeroStreaks: {},
  allDropped: [],
  stuckJobs: 0,
  queuedEmails: 0,
  monthUsd: 18.35,
  dbBytes: 26 * 1024 * 1024,
  dbLimitBytes: 500 * 1024 * 1024,
};

describe("jstDateOf", () => {
  it("UTCからJSTの日付へ寄せる（日付をまたぐ時刻）", () => {
    expect(jstDateOf("2026-08-01T15:30:00Z")).toBe("2026-08-02"); // JST 翌日0:30
    expect(jstDateOf("2026-08-01T14:59:00Z")).toBe("2026-08-01"); // JST 23:59
  });
});

describe("zeroStreakByCategory", () => {
  it("直近から連続して0件だった日数を数える", () => {
    const rows = [
      { date: "2026-08-01", category: "web3", saved: 0, dropped: 0 },
      { date: "2026-07-31", category: "web3", saved: 0, dropped: 0 },
      { date: "2026-07-30", category: "web3", saved: 0, dropped: 2 },
      { date: "2026-07-29", category: "web3", saved: 3, dropped: 0 },
    ];
    expect(zeroStreakByCategory(rows).web3).toBe(3);
  });

  it("1件でも取れた日で止まる", () => {
    const rows = [
      { date: "2026-08-01", category: "ai", saved: 2, dropped: 0 },
      { date: "2026-07-31", category: "ai", saved: 0, dropped: 0 },
    ];
    expect(zeroStreakByCategory(rows).ai).toBe(0);
  });

  it("同じ日に複数回実行していれば合算する（1回0件でも他で取れていれば0件日ではない）", () => {
    const rows = [
      { date: "2026-08-01", category: "ai", saved: 0, dropped: 0 },
      { date: "2026-08-01", category: "ai", saved: 1, dropped: 0 },
    ];
    expect(zeroStreakByCategory(rows).ai).toBe(0);
  });

  it("実行のなかった日は数えない（定時実行が動かない環境で全テーマが警告にならない）", () => {
    // 8/1 と 7/25 しか行がない場合、間の日は「0件」ではなく「実行なし」として扱う。
    const rows = [
      { date: "2026-08-01", category: "ai", saved: 0, dropped: 0 },
      { date: "2026-07-25", category: "ai", saved: 5, dropped: 0 },
    ];
    expect(zeroStreakByCategory(rows).ai).toBe(1);
  });

  it("テーマごとに独立して数える", () => {
    const rows = [
      { date: "2026-08-01", category: "web3", saved: 0, dropped: 0 },
      { date: "2026-08-01", category: "ai", saved: 4, dropped: 0 },
    ];
    const out = zeroStreakByCategory(rows);
    expect(out.web3).toBe(1);
    expect(out.ai).toBe(0);
  });
});

describe("buildDailySummary", () => {
  it("問題が無い日も数字を必ず出す（「問題なし」だけだと止まっていても同じに見える）", () => {
    const s = buildDailySummary(base);
    expect(s.needsAttention).toBe(false);
    expect(s.title).toContain("問題はありません");
    expect(s.body).toContain("成功 3 件");
    expect(s.body).toContain("$18.35");
    expect(s.body).toContain("約2753円");
    expect(s.body, "容量も毎日出す（止まってから気付かないため）").toContain("26 MB / 500 MB");
  });

  it("容量が上限に近づいたら気になる点として上げる", () => {
    const s = buildDailySummary({ ...base, dbBytes: 450 * 1024 * 1024 });
    expect(s.needsAttention).toBe(true);
    expect(s.body).toContain("データベースの使用量が 450 MB / 500 MB（90%）");
  });

  it("3日連続で取れていないテーマを強調する（T-M7-24の再発検知）", () => {
    const s = buildDailySummary({ ...base, zeroStreaks: { web3: ZERO_STREAK_ALERT_DAYS, ai: 1 } });
    expect(s.needsAttention).toBe(true);
    expect(s.body).toContain("web3（3日連続）");
    expect(s.body, "1日だけの0件は普通に起きるので出さない").not.toContain("ai（1日連続）");
    expect(s.body).toContain("対応が必要かもしれない点");
  });

  it("全件破棄されたテーマと理由を出す", () => {
    const s = buildDailySummary({
      ...base,
      allDropped: [{ category: "ai", reasons: "title:too_big×2" }],
    });
    expect(s.needsAttention).toBe(true);
    expect(s.body).toContain("ai（title:too_big×2）");
  });

  it("失敗した生成・止まっている処理を出す", () => {
    const s = buildDailySummary({ ...base, jobs: { succeeded: 1, failed: 2 }, stuckJobs: 1 });
    expect(s.body).toContain("失敗 2 件");
    expect(s.body).toContain("止まっている処理: 1 件");
    expect(s.title).toContain("気になる点が 2 件");
  });

  it("実行が無かった日も「実行なし」と分かる（0件と混同しない）", () => {
    const s = buildDailySummary({ ...base, jobs: { succeeded: 0, failed: 0 } });
    expect(s.body).toContain("実行はありませんでした");
    expect(s.needsAttention).toBe(false);
  });
});
