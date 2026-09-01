import { describe, expect, it, vi } from "vitest";

import type { NewsDigestEmailTarget } from "./news-digest";
import { buildNewsDigestMail, sendNewsDigestMailsWith } from "./news-digest-mail";

/**
 * ニュースダイジェストのメール（T-M8-407）。本文の組み立てと、1人の失敗で他の人へ
 * 送るのをやめないことを守る。
 */
function target(over: Partial<NewsDigestEmailTarget> = {}): NewsDigestEmailTarget {
  return {
    notificationId: "n1",
    userId: "u1",
    to: "u1@example.com",
    title: "ニュースダイジェスト 3件",
    body: "・a\n・b\n・c",
    link: "/app/news?from=2026-09-01T00%3A00%3A00Z&to=2026-09-01T01%3A00%3A00Z",
    totalCount: 3,
    ...over,
  };
}

describe("buildNewsDigestMail", () => {
  it("件名にアプリ名、本文に件数・見出し・絶対URLの一覧リンク・止め方が入る", () => {
    const mail = buildNewsDigestMail(target(), "https://exosai.net/");
    expect(mail.to).toBe("u1@example.com");
    expect(mail.subject).toBe("【Exos AI】ニュースダイジェスト 3件");
    expect(mail.text).toContain("3件");
    expect(mail.text).toContain("・a\n・b\n・c");
    expect(mail.text).toContain(
      "https://exosai.net/app/news?from=2026-09-01T00%3A00%3A00Z&to=2026-09-01T01%3A00%3A00Z",
    );
    expect(mail.text).toContain("設定＞通知");
  });
});

describe("sendNewsDigestMailsWith", () => {
  it("宛先ごとに送り、送った・送らなかった（設定/環境）・失敗を数える", async () => {
    const send = vi
      .fn<(m: { to: string }) => Promise<"sent" | "skipped_env_guard">>()
      .mockResolvedValueOnce("sent")
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce("skipped_env_guard");
    const onError = vi.fn();
    const res = await sendNewsDigestMailsWith(
      [target({ userId: "u1" }), target({ userId: "u2", to: "u2@example.com" }), target({ userId: "u3", to: "u3@example.com" })],
      { baseUrl: "https://exosai.net", send, onError },
    );
    expect(res).toEqual({ targets: 3, sent: 1, skipped: 1, failed: 1 });
    // 2人目の失敗で3人目を諦めない（原則1: 失敗は記録して続ける）。
    expect(send).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].userId).toBe("u2");
  });

  it("宛先が無ければ何も送らない", async () => {
    const send = vi.fn();
    const res = await sendNewsDigestMailsWith([], { baseUrl: "https://exosai.net", send, onError: vi.fn() });
    expect(res).toEqual({ targets: 0, sent: 0, skipped: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
