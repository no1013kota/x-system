import { describe, expect, it } from "vitest";

import {
  describeEmptyCategories,
  judgeCost,
  judgeJobs,
  judgeNews,
  judgeQueuedEmails,
  judgeStuckJobs,
  judgeXAccounts,
  summarize,
  worstLevel,
  type Check,
} from "./diagnostics";

/**
 * 運営者向け診断の判定（T-M7-34）。**運営者がログを読まずに次の一手へ進めること**を守る。
 * 文言そのものではなく「レベルの判定」と「異常時に次の一手が付いていること」を固定する。
 */

const check = (over: Partial<Check> = {}): Check => ({ name: "x", level: "ok", detail: "d", ...over });

describe("worstLevel / summarize", () => {
  it("最も重いレベルを返す", () => {
    expect(worstLevel(["ok", "warn", "error"])).toBe("error");
    expect(worstLevel(["ok", "warn"])).toBe("warn");
    expect(worstLevel(["ok", "ok"])).toBe("ok");
    expect(worstLevel([])).toBe("ok");
  });

  it("まとめには必ず件数が入る（「問題なし」だけで終わらせない）", () => {
    expect(summarize([check(), check()])).toContain("2");
    expect(summarize([check({ level: "warn" })])).toContain("1");
    expect(summarize([check({ level: "error" }), check({ level: "warn" })])).toContain("1");
  });
});

describe("judgeJobs", () => {
  it("実行が無ければ正常", () => {
    expect(judgeJobs({ succeeded: 0, failed: 0 }).level).toBe("ok");
  });

  it("全部成功なら正常", () => {
    expect(judgeJobs({ succeeded: 5, failed: 0 }).level).toBe("ok");
  });

  it("1件でも失敗していれば注意し、次の一手を出す（黙って流さない）", () => {
    const r = judgeJobs({ succeeded: 5, failed: 1 });
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
    expect(r.detail).toContain("1");
  });

  it("失敗が成功より多ければ異常", () => {
    expect(judgeJobs({ succeeded: 1, failed: 3 }).level).toBe("error");
  });
});

describe("judgeNews（定時実行が動かない環境で赤くしない）", () => {
  it("本番以外では止まっていても正常扱い（常に赤い表示は読まれなくなる）", () => {
    const r = judgeNews({ itemsLast48h: 0, hoursSinceLastRun: 73, schedulerExpected: false });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("自動で動きません");
  });

  it("本番で6時間以上止まっていれば異常", () => {
    const r = judgeNews({ itemsLast48h: 10, hoursSinceLastRun: 7, schedulerExpected: true });
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });

  it("本番で動いているが0件なら注意（T-M7-24 の再発検知）", () => {
    const r = judgeNews({ itemsLast48h: 0, hoursSinceLastRun: 1, schedulerExpected: true });
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
  });

  it("本番で動いて取得できていれば正常", () => {
    expect(judgeNews({ itemsLast48h: 12, hoursSinceLastRun: 1, schedulerExpected: true }).level).toBe("ok");
  });

  it("本番で一度も実行されていなければ異常", () => {
    expect(judgeNews({ itemsLast48h: 0, hoursSinceLastRun: null, schedulerExpected: true }).level).toBe("error");
  });
});

describe("分野ごとの0件の意味を運営者へ出す（T-M7-40）", () => {
  const ok = (category: string, fetched: number) => ({
    category,
    ok: true,
    fetched,
    dropped: 0,
    dropReasons: {},
  });
  const allDropped = (category: string, n: number) => ({
    category,
    ok: true,
    fetched: 0,
    dropped: n,
    dropReasons: { "title:too_big": n },
  });

  it("該当なしと全件破棄と失敗を分けて返す", () => {
    const r = describeEmptyCategories([
      ok("ai", 3),
      ok("web3", 0),
      allDropped("sns", 4),
      { category: "business", ok: false, fetched: 0, dropped: 0, dropReasons: {} },
    ]);
    expect(r.noMatch).toEqual(["web3"]);
    expect(r.allDropped).toEqual([{ category: "sns", reasons: "title:too_big×4" }]);
    expect(r.failed).toEqual(["business"]);
  });

  it("全件破棄は取得件数があっても注意として上げる（分野が永久に0件になるのを見逃さない）", () => {
    const r = judgeNews({
      itemsLast48h: 10,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [ok("ai", 3), allDropped("web3", 4)],
    });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("全件破棄された分野: web3");
    expect(r.detail).toContain("title:too_big×4");
    expect(r.nextAction).toContain("除外理由");
  });

  it("全件破棄で総取得も0件なら異常", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [allDropped("web3", 4)],
    });
    expect(r.level).toBe("error");
  });

  it("該当なしだけなら正常のまま、どの分野かは伝える", () => {
    const r = judgeNews({
      itemsLast48h: 10,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [ok("ai", 3), ok("web3", 0)],
    });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("該当ニュースが無かった分野: web3");
  });

  it("定時実行が動かない環境でも全件破棄は注意として上げる", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 2,
      schedulerExpected: false,
      outcomes: [allDropped("web3", 4)],
    });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("全件破棄された分野: web3");
  });
});

describe("judgeQueuedEmails", () => {
  it("溜まっていなければ正常", () => {
    expect(judgeQueuedEmails({ queued: 0, oldestHours: null }).level).toBe("ok");
  });

  it("24時間より古い滞留は注意（本番で一斉送信される・D-9）", () => {
    const r = judgeQueuedEmails({ queued: 53, oldestHours: 128 });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("53");
    expect(r.nextAction).toBeTruthy();
  });

  it("直近の滞留は送信待ちとして正常", () => {
    expect(judgeQueuedEmails({ queued: 2, oldestHours: 1 }).level).toBe("ok");
  });
});

describe("judgeXAccounts", () => {
  it("連携が無ければ注意して次の一手を出す", () => {
    const r = judgeXAccounts([]);
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
  });

  it("active でないアカウントがあれば異常（再連携が必要）", () => {
    const r = judgeXAccounts([{ handle: "a", status: "error", expiresInHours: 5 }]);
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });

  it("期限切れは注意どまり（次の操作で自動更新される）", () => {
    const r = judgeXAccounts([{ handle: "a", status: "active", expiresInHours: -22 }]);
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("@a");
  });

  it("有効で期限内なら正常", () => {
    expect(judgeXAccounts([{ handle: "a", status: "active", expiresInHours: 3 }]).level).toBe("ok");
  });
});

describe("judgeStuckJobs", () => {
  it("無ければ正常、あれば異常で次の一手を出す", () => {
    expect(judgeStuckJobs({ stuck: 0 }).level).toBe("ok");
    const r = judgeStuckJobs({ stuck: 2 });
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });
});

describe("judgeCost（原則4: 費用が見える）", () => {
  it("金額を円換算つきで必ず出す", () => {
    const r = judgeCost({ monthUsd: 14.34, byProvider: [{ provider: "anthropic", usd: 13.15 }] });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("$14.34");
    expect(r.detail).toContain("円");
    expect(r.detail).toContain("anthropic");
  });

  it("0円でも数字を出す（見えないことが問題なので黙らせない）", () => {
    expect(judgeCost({ monthUsd: 0, byProvider: [] }).detail).toContain("$0.00");
  });
});
