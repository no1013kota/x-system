import { describe, expect, it } from "vitest";

import { buildOperatorAlert } from "./operator-alert";
import type { Check } from "./diagnostics";

const ctx = { date: "2026-08-20", environmentLabel: "本番", baseUrl: "https://exosai.net" };

const check = (over: Partial<Check> & Pick<Check, "level">): Check => ({
  name: "ニュースの取得",
  detail: "直近48時間で 0 件取得",
  ...over,
});

describe("buildOperatorAlert", () => {
  /** 正常を毎日送ると本当の異常が埋もれる（T-M7-44）。 */
  it("異常が無い日は作らない（null）", () => {
    expect(
      buildOperatorAlert([check({ level: "ok" }), check({ level: "ok", name: "アプリ" })], ctx),
    ).toBeNull();
    expect(buildOperatorAlert([], ctx)).toBeNull();
  });

  it("error と warn だけを載せ、ok は載せない", () => {
    const alert = buildOperatorAlert(
      [
        check({ level: "ok", name: "アプリ", detail: "応答しています" }),
        check({ level: "warn", name: "ニュースの取得", detail: "0 件取得" }),
        check({ level: "error", name: "Xへの投稿", detail: "dry_run のままです" }),
      ],
      ctx,
    );

    expect(alert).not.toBeNull();
    expect(alert!.body).toContain("ニュースの取得");
    expect(alert!.body).toContain("Xへの投稿");
    expect(alert!.body).not.toContain("応答しています");
    expect(alert!.subject).toContain("対応が必要 1件");
    expect(alert!.subject).toContain("注意 1件");
  });

  /**
   * **次の一手を必ず載せる。** 「何が起きたか」だけでは運営者は動けない。
   * T-M8-163 の分類でクレジット切れは購入場所まで出るので、それがそのまま届く。
   */
  it("nextAction を本文へ載せる（クレジット切れの購入場所が届く）", () => {
    const alert = buildOperatorAlert(
      [
        check({
          level: "warn",
          detail: "取得に失敗したテーマ: ai（AIの利用残高が不足しています）",
          nextAction:
            "AI提供元の管理画面（Anthropic は Plans & Billing）でクレジットを購入してください",
        }),
      ],
      ctx,
    );

    expect(alert!.body).toContain("AIの利用残高が不足しています");
    expect(alert!.body).toContain("クレジットを購入してください");
  });

  /** 本番とstagingの両方から届いても潰し合わないこと。 */
  it("dedupeKey は環境と日付で分かれる", () => {
    const prod = buildOperatorAlert([check({ level: "error" })], ctx);
    const stg = buildOperatorAlert([check({ level: "error" })], {
      ...ctx,
      environmentLabel: "staging",
    });

    expect(prod!.dedupeKey).toBe("operator-alert:本番:2026-08-20");
    expect(stg!.dedupeKey).toBe("operator-alert:staging:2026-08-20");
    expect(prod!.dedupeKey).not.toBe(stg!.dedupeKey);
  });

  it("どの環境の話かが件名と本文で分かる", () => {
    const alert = buildOperatorAlert([check({ level: "error" })], ctx);

    expect(alert!.subject).toContain("本番");
    expect(alert!.body).toContain("本番");
    expect(alert!.body).toContain("https://exosai.net");
  });

  it("nextAction が無い項目でも落ちない", () => {
    const alert = buildOperatorAlert(
      [check({ level: "error", nextAction: undefined })],
      ctx,
    );

    expect(alert!.body).toContain("ニュースの取得");
  });
});
