import { describe, expect, it } from "vitest";

import {
  followerKpi,
  pendingDraftsKpi,
  postsThisWeekKpi,
  startOfWeekJstIso,
} from "./kpi";

describe("followerKpi", () => {
  it("記録が無いときは0ではなく「無い」として返す", () => {
    // 0人と「まだ測っていない」を同じ表示にすると、運営者が状況を誤解する。
    const kpi = followerKpi([]);
    expect(kpi.value).toBeNull();
    expect(kpi.delta).toBeUndefined();
  });

  it("1点しか無いときは増減を出さない", () => {
    const kpi = followerKpi([{ date: "2026-08-01", count: 1200 }]);
    expect(kpi.value).toBe(1200);
    expect(kpi.delta).toBeUndefined();
  });

  it("最初と最後の差で増減を出す（欠損日があっても破綻しない）", () => {
    const kpi = followerKpi([
      { date: "2026-07-26", count: 1200 },
      // 7/27〜7/30 は記録なし
      { date: "2026-08-01", count: 1284 },
    ]);
    expect(kpi.value).toBe(1284);
    expect(kpi.delta).toEqual({ text: "+84 今週", tone: "up" });
  });

  it("減っていれば down、変わらなければ flat", () => {
    expect(
      followerKpi([
        { date: "a", count: 100 },
        { date: "b", count: 90 },
      ]).delta,
    ).toEqual({ text: "-10 今週", tone: "down" });
    expect(
      followerKpi([
        { date: "a", count: 100 },
        { date: "b", count: 100 },
      ]).delta,
    ).toEqual({ text: "0 今週", tone: "flat" });
  });
});

describe("startOfWeekJstIso", () => {
  it("JSTの月曜0:00を返す", () => {
    // 2026-08-01 は土曜。週の始まりは 7/27(月) 0:00 JST = 7/26 15:00 UTC。
    expect(startOfWeekJstIso(new Date("2026-08-01T12:00:00Z"))).toBe("2026-07-26T15:00:00.000Z");
  });

  it("日曜は「その週の月曜」（6日前）になる", () => {
    // 2026-08-02 は日曜。週の始まりは 7/27(月)。
    expect(startOfWeekJstIso(new Date("2026-08-02T12:00:00Z"))).toBe("2026-07-26T15:00:00.000Z");
  });

  it("月曜そのものは当日0:00になる", () => {
    // 2026-08-03(月) 09:00 JST = 08-03T00:00Z。週の始まりは 8/3 0:00 JST = 8/2 15:00 UTC。
    expect(startOfWeekJstIso(new Date("2026-08-03T00:00:00Z"))).toBe("2026-08-02T15:00:00.000Z");
  });

  it("JSTの日付境界をまたぐ時刻でも当日扱いになる", () => {
    // 08-02T16:00Z = 08-03(月) 01:00 JST。週の始まりは 8/3。
    expect(startOfWeekJstIso(new Date("2026-08-02T16:00:00Z"))).toBe("2026-08-02T15:00:00.000Z");
  });
});

describe("postsThisWeekKpi / pendingDraftsKpi", () => {
  it("0件は「無い」ことが分かる説明を添える", () => {
    expect(postsThisWeekKpi({ total: 0, auto: 0 }).note).toContain("まだ投稿がありません");
    expect(pendingDraftsKpi(0).note).toContain("確認待ちはありません");
  });

  it("件数があれば内訳を出す", () => {
    expect(postsThisWeekKpi({ total: 9, auto: 6 })).toMatchObject({
      value: 9,
      unit: "件",
      note: "うち自動 6件",
    });
    expect(pendingDraftsKpi(3).value).toBe(3);
  });
});
