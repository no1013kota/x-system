import { describe, expect, it } from "vitest";

import { parseAppliedRemote } from "./release-gate";

/**
 * `supabase migration list --linked` の出力解釈（T-M7-35の回帰）。
 *
 * 2026-08-01、実際のstagingで**適用済みなのに「未適用11件」と誤判定**して先へ進めなくなった。
 * 原因は表形式（`Local | Remote | 時刻`）だけを想定していたが、CLI v2系がJSONを返すこと。
 * 誤読の方向が「未適用」側だったため事故にはならなかったが、**リリースが永久に完了しない**状態だった。
 */
describe("parseAppliedRemote", () => {
  it("JSON形式（CLI v2系）から適用済みを読む", () => {
    const raw = `Initialising login role...
Connecting to remote database...
{"migrations":[{"local":"20260720000001","remote":"20260720000001","time":"2026-07-20 00:00:01"},{"local":"20260801000002","remote":"20260801000002","time":"2026-08-01 00:00:02"}],"message":"Migrations listed"}`;
    const applied = parseAppliedRemote(raw);
    expect(applied).not.toBeNull();
    expect(applied?.has("20260720000001")).toBe(true);
    expect(applied?.has("20260801000002")).toBe(true);
    expect(applied?.size).toBe(2);
  });

  it("JSON形式で remote が空なら未適用として扱う", () => {
    const raw = `{"migrations":[{"local":"20260720000001","remote":"","time":"x"}],"message":""}`;
    const applied = parseAppliedRemote(raw);
    expect(applied?.size, "remoteが空のものは適用済みに数えない").toBe(0);
  });

  it("表形式（旧CLI）からも読む", () => {
    const raw = `
        Local          |     Remote     |     Time (UTC)
  ---------------------|----------------|---------------------
   20260720000001      | 20260720000001 | 2026-07-20 00:00:01
   20260801000002      |                | 2026-08-01 00:00:02
`;
    const applied = parseAppliedRemote(raw);
    expect(applied?.has("20260720000001")).toBe(true);
    expect(applied?.has("20260801000002"), "Remote列が空なら未適用").toBe(false);
  });

  it("解釈できない出力では null を返す（適用済みと決めつけない）", () => {
    // 安全側＝未適用として止める。誤って「適用済み」と読むと、DBが古いまま本番へ反映される。
    expect(parseAppliedRemote("Cannot connect to the database")).toBeNull();
    expect(parseAppliedRemote('{"migrations": "こわれている"}')).toBeNull();
    expect(parseAppliedRemote('{"migrations":[{"local":"x"')).toBeNull();
  });
});
