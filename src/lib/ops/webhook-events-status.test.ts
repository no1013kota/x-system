import { describe, expect, it } from "vitest";

import { STRIPE_WEBHOOK_EVENT_TYPES } from "@/lib/stripe/webhook";

import { judgeWebhookEvents, probeWebhookEvents } from "./webhook-events-status";

/**
 * webhookの購読イベントはStripeダッシュボード側の設定で、コードには現れない（T-M8-238）。
 * 2026-08-23、本番・stagingとも `charge.refunded` が抜けており、**返金しても招待報酬が
 * 取り消されない**状態だった。届かないイベントは例外にならないので、この検査でだけ分かる。
 */
const ALL = [...STRIPE_WEBHOOK_EVENT_TYPES];
const URL_ = "https://exosai.net/api/stripe/webhook";

function gateway(data: { id: string; url: string; status: string; enabled_events: string[] }[]) {
  return { webhookEndpoints: { list: async () => ({ data }) } };
}

describe("probeWebhookEvents", () => {
  it("URLが一致する受け口を拾う（末尾スラッシュの差は同じものとして扱う）", async () => {
    const snapshot = await probeWebhookEvents({
      stripe: gateway([{ id: "we_1", url: `${URL_}/`, status: "enabled", enabled_events: ALL }]),
      webhookUrl: URL_,
    });
    expect(snapshot).toMatchObject({ found: true, status: "enabled" });
  });

  it("鍵もURLも無ければ判定しない（unavailable）", async () => {
    expect(await probeWebhookEvents({})).toEqual({ unavailable: true });
  });

  it("Stripeへ問い合わせできなければ unavailable（doctor全体を落とさない）", async () => {
    const snapshot = await probeWebhookEvents({
      stripe: {
        webhookEndpoints: {
          list: async () => {
            throw new Error("network");
          },
        },
      },
      webhookUrl: URL_,
    });
    expect(snapshot).toEqual({ unavailable: true });
  });
});

describe("judgeWebhookEvents", () => {
  it("必要なイベントが全部あれば ok", () => {
    expect(
      judgeWebhookEvents({ found: true, status: "enabled", enabledEvents: ALL }),
    ).toMatchObject({ level: "ok" });
  });

  /** 実際に起きていた状態: charge.refunded だけが無い。 */
  it("charge.refunded が無ければ error で「返金しても報酬が取り消されない」と言う", () => {
    const check = judgeWebhookEvents({
      enabledEvents: ALL.filter((t) => t !== "charge.refunded"),
      found: true,
      status: "enabled",
    });
    expect(check.level).toBe("error");
    expect(check.detail).toContain("charge.refunded");
    expect(check.detail).toContain("招待報酬");
    expect(check.nextAction).toContain("Webhooks");
  });

  it("受け口が無い・無効なら error", () => {
    expect(judgeWebhookEvents({ found: false }).level).toBe("error");
    expect(
      judgeWebhookEvents({ found: true, status: "disabled", enabledEvents: ALL }).level,
    ).toBe("error");
  });

  it("すべてのイベントを購読（*）していれば不足なし", () => {
    expect(
      judgeWebhookEvents({ found: true, status: "enabled", enabledEvents: ["*"] }).level,
    ).toBe("ok");
  });

  it("問い合わせできないときは warn（次の一手つき）", () => {
    const check = judgeWebhookEvents({ unavailable: true });
    expect(check.level).toBe("warn");
    expect(check.nextAction).toBeTruthy();
  });
});
