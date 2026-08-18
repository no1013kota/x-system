import { beforeEach, describe, expect, it } from "vitest";

import {
  ATTEMPTS_WARN_AT,
  MAX_CODE_ATTEMPTS,
  clearCodeAttempts,
  codeAttemptState,
  recordCodeFailure,
  resetCodeAttemptsForTest,
} from "./code-attempts";

/**
 * T-M8-124。守りたいのは2つで、**どちらも外せない**:
 * 1. 執念深い試行は止まる
 * 2. 打ち間違いをする普通の利用者は困らない（行き止まりにしない）
 */
describe("確認コードの連続失敗", () => {
  beforeEach(() => {
    resetCodeAttemptsForTest();
  });

  const email = "user@example.com";

  it("最初は制限されていない", () => {
    expect(codeAttemptState(email)).toEqual({ blocked: false, remaining: MAX_CODE_ATTEMPTS });
  });

  it("数回の打ち間違いでは止めない（警告を出す手前まで黙っている）", () => {
    for (let i = 0; i < MAX_CODE_ATTEMPTS - ATTEMPTS_WARN_AT - 1; i += 1) {
      const state = recordCodeFailure(email);
      expect(state.blocked, `${i + 1}回目で止めない`).toBe(false);
      expect(state.remaining).toBeGreaterThan(ATTEMPTS_WARN_AT);
    }
  });

  it("上限に達すると止まる", () => {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) recordCodeFailure(email);
    expect(codeAttemptState(email)).toEqual({ blocked: true, remaining: 0 });
  });

  it("再送で数え直す（上限に達しても行き止まりにしない）", () => {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) recordCodeFailure(email);
    expect(codeAttemptState(email).blocked).toBe(true);
    clearCodeAttempts(email);
    expect(codeAttemptState(email)).toEqual({ blocked: false, remaining: MAX_CODE_ATTEMPTS });
  });

  it("アドレスごとに独立している（他人の失敗で巻き添えにしない）", () => {
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) recordCodeFailure(email);
    expect(codeAttemptState("other@example.com").blocked).toBe(false);
  });

  it("大文字小文字・前後の空白は同じアドレスとして数える", () => {
    recordCodeFailure(" User@Example.com ");
    expect(codeAttemptState(email).remaining).toBe(MAX_CODE_ATTEMPTS - 1);
  });

  it("1時間を過ぎた数えは消える（時間が経てば自然に戻る）", () => {
    const start = 1_000_000;
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) recordCodeFailure(email, start);
    expect(codeAttemptState(email, start).blocked).toBe(true);
    const later = start + 60 * 60 * 1000 + 1;
    expect(codeAttemptState(email, later)).toEqual({
      blocked: false,
      remaining: MAX_CODE_ATTEMPTS,
    });
  });
});
