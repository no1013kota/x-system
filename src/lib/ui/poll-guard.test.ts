import { describe, expect, it } from "vitest";

import {
  createPollGuard,
  POLL_MAX_CONSECUTIVE_FAILURES,
  POLL_MAX_TICKS,
  pollGiveUpMessage,
} from "./poll-guard";

/**
 * 進捗pollの見張り（T-M8-51）。**永遠に回り続けて何も言わない**状態を作らないための判定。
 * 3箇所のpoll（投稿・画像再生成・生成）が共有する。
 */
describe("createPollGuard", () => {
  it("成功が続くあいだは回り続ける", () => {
    const guard = createPollGuard();
    for (let i = 0; i < 100; i += 1) expect(guard.tick(true)).toBe("continue");
    expect(guard.reason()).toBeNull();
  });

  it("連続失敗が上限に達したら打ち切る（理由は unreachable）", () => {
    const guard = createPollGuard({ maxConsecutiveFailures: 3 });
    expect(guard.tick(false)).toBe("continue");
    expect(guard.tick(false)).toBe("continue");
    expect(guard.tick(false)).toBe("give-up");
    expect(guard.reason()).toBe("unreachable");
  });

  // 1回の失敗で諦めると、通信の揺れでいちいちエラーを出すことになる。
  it("途中で成功したら連続失敗の数は戻る", () => {
    const guard = createPollGuard({ maxConsecutiveFailures: 3 });
    guard.tick(false);
    guard.tick(false);
    expect(guard.tick(true)).toBe("continue");
    expect(guard.tick(false)).toBe("continue");
    expect(guard.tick(false)).toBe("continue");
    expect(guard.reason()).toBeNull();
  });

  it("総回数の上限に達したら打ち切る（理由は timeout）", () => {
    const guard = createPollGuard({ maxTicks: 4 });
    expect(guard.tick(true)).toBe("continue");
    expect(guard.tick(true)).toBe("continue");
    expect(guard.tick(true)).toBe("continue");
    expect(guard.tick(true)).toBe("give-up");
    expect(guard.reason()).toBe("timeout");
  });

  it("一度打ち切ったら以後も give-up を返す（後続tickで復活しない）", () => {
    const guard = createPollGuard({ maxTicks: 1 });
    expect(guard.tick(true)).toBe("give-up");
    expect(guard.tick(true)).toBe("give-up");
    expect(guard.reason()).toBe("timeout");
  });

  it("既定値は実運用に耐える長さ（jobのdeadlineより十分長い）", () => {
    // POLL_INTERVAL_MS 2500ms × 240 = 10分。job のdeadlineは180秒（要件04 §5）。
    expect(POLL_MAX_TICKS).toBeGreaterThanOrEqual(120);
    expect(POLL_MAX_CONSECUTIVE_FAILURES).toBeGreaterThan(1);
  });
});

describe("pollGiveUpMessage", () => {
  it("原因ごとに次の一手を変える", () => {
    expect(pollGiveUpMessage("unreachable").description).toContain("通信");
    expect(pollGiveUpMessage("timeout").title).toContain("時間");
  });

  // どちらも「処理は続いている可能性がある」ことを必ず伝える。
  // 「失敗しました」と言い切ると、実際には投稿できているのに二重投稿を試みさせてしまう。
  it("どちらも再読み込みへ導き、失敗と断定しない", () => {
    for (const reason of ["unreachable", "timeout", null] as const) {
      const message = pollGiveUpMessage(reason);
      expect(message.description).toContain("再読み込み");
      expect(message.description).toContain("続いている可能性");
    }
  });
});
