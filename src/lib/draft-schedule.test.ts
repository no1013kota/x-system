import { describe, expect, it } from "vitest";

import {
  DRAFT_SCHEDULE_REASONS,
  MAX_SCHEDULE_AHEAD_DAYS,
  assertDraftSchedulable,
  checkDraftSchedule,
} from "./draft-schedule";

const NOW = Date.parse("2026-08-20T00:00:00.000Z");
const OK_TARGET = { status: "draft", xAccountActive: true };
const inMinutes = (n: number) => new Date(NOW + n * 60_000).toISOString();

describe("checkDraftSchedule", () => {
  it("十分先の日時は受理し、保存値をUTCへ正規化する", () => {
    const result = checkDraftSchedule(OK_TARGET, "2026-08-21T09:00:00+09:00", NOW);

    expect(result.ok).toBe(true);
    expect(result.scheduledAt).toBe("2026-08-21T00:00:00.000Z");
  });

  it("TZ無しの値（datetime-local）は実行環境に依らず日本時間として解釈する（T-M8-229）", () => {
    // 本番サーバはUTC。素の文字列を環境TZ任せにすると、JST利用者の予約が9時間ずれる。
    const result = checkDraftSchedule(OK_TARGET, "2026-08-21T09:00", NOW);
    expect(result.ok).toBe(true);
    expect(result.scheduledAt).toBe("2026-08-21T00:00:00.000Z");
    // 秒つきの素の値も同じ扱い。
    expect(checkDraftSchedule(OK_TARGET, "2026-08-21T09:00:30", NOW).scheduledAt).toBe(
      "2026-08-21T00:00:30.000Z",
    );
  });

  it("投稿済み・破棄済みの下書きには予約できない", () => {
    for (const status of ["posted", "discarded", "posting", "failed"]) {
      const result = checkDraftSchedule({ ...OK_TARGET, status }, inMinutes(60), NOW);
      expect(result, status).toMatchObject({ ok: false, reason: "draft_not_editable" });
    }
  });

  it("連携解除されたXアカウントには予約できない", () => {
    const result = checkDraftSchedule(
      { ...OK_TARGET, xAccountActive: false },
      inMinutes(60),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, reason: "x_account_inactive" });
  });

  /**
   * **過去・直近すぎる日時を弾く。** cron は5分間隔なので、到来済みの時刻を受けると
   * 「予約した瞬間に遅刻している」状態になり、利用者には理由が見えない。
   */
  it("過去と1分未満の日時は弾く", () => {
    expect(checkDraftSchedule(OK_TARGET, inMinutes(-1), NOW)).toMatchObject({
      ok: false,
      reason: "scheduled_at_too_soon",
    });
    expect(checkDraftSchedule(OK_TARGET, inMinutes(0), NOW)).toMatchObject({
      ok: false,
      reason: "scheduled_at_too_soon",
    });
  });

  it(`${MAX_SCHEDULE_AHEAD_DAYS}日より先は弾く`, () => {
    const tooFar = new Date(
      NOW + (MAX_SCHEDULE_AHEAD_DAYS * 24 * 60 + 1) * 60_000,
    ).toISOString();

    expect(checkDraftSchedule(OK_TARGET, tooFar, NOW)).toMatchObject({
      ok: false,
      reason: "scheduled_at_too_far",
    });
  });

  it("日時として読めない入力を弾く", () => {
    expect(checkDraftSchedule(OK_TARGET, "2026-13-45T99:99", NOW)).toMatchObject({
      ok: false,
      reason: "scheduled_at_invalid",
    });
  });

  /** 画面に出す理由は日本語で、英語のコードを漏らさない（要件06）。 */
  it("すべての却下理由に日本語の説明がある", () => {
    for (const [reason, text] of Object.entries(DRAFT_SCHEDULE_REASONS)) {
      expect(text, reason).not.toMatch(/[a-z]_[a-z]/);
      expect(text.length, reason).toBeGreaterThan(5);
    }
  });
});

describe("assertDraftSchedulable", () => {
  it("受理時は保存値を返す", () => {
    expect(assertDraftSchedulable(OK_TARGET, inMinutes(120), NOW)).toBe(inMinutes(120));
  });

  it("却下時は日本語の理由付きで止める", () => {
    expect(() => assertDraftSchedulable(OK_TARGET, inMinutes(-5), NOW)).toThrow(
      DRAFT_SCHEDULE_REASONS.scheduled_at_too_soon,
    );
  });
});
