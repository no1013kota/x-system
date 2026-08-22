import { AppError } from "@/lib/observability/errors";

/**
 * 下書きの投稿予約の判定（T-M8-157）。DBもframeworkも触らない純粋層。
 *
 * **押す前に理由が分かること**を優先する（CLAUDE.md 原則2・「押すまで分からない失敗」を作らない）。
 * 画面はこの関数と同じ判定でボタンの可否と理由を出し、Server Actionは受理直前にもう一度通す。
 */

/** 予約を受け付ける下限の余裕。今すぐ過ぎる時刻を受けると、cron到来前に「遅刻」した予約になる。 */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

/**
 * 予約できる上限。無期限に先の予約を許すと、プラン変更・連携解除の後も残った予約が
 * 意図せず投稿される。**運営者が把握できない未来を作らない**（原則1）。
 */
export const MAX_SCHEDULE_AHEAD_DAYS = 90;

export interface DraftScheduleTarget {
  /** 下書きの状態。投稿済み・破棄済みには予約できない。 */
  status: string;
  /** 対象Xアカウントが active か。解除済みアカウントの予約は投稿できない。 */
  xAccountActive: boolean;
}

export type DraftScheduleRejection =
  | "draft_not_editable"
  | "x_account_inactive"
  | "scheduled_at_invalid"
  | "scheduled_at_too_soon"
  | "scheduled_at_too_far";

/** 画面に出す理由（日本語）。**英語のコードを画面へ出さない**（要件06）。 */
export const DRAFT_SCHEDULE_REASONS: Record<DraftScheduleRejection, string> = {
  draft_not_editable: "この下書きは投稿済みまたは破棄済みのため予約できません。",
  x_account_inactive:
    "対象のXアカウントが連携解除されているため予約できません。再連携してください。",
  scheduled_at_invalid: "日時の形式が正しくありません。",
  scheduled_at_too_soon: "1分以上先の日時を指定してください。",
  scheduled_at_too_far: `予約できるのは${MAX_SCHEDULE_AHEAD_DAYS}日先までです。`,
};

export interface DraftScheduleCheck {
  ok: boolean;
  reason?: DraftScheduleRejection;
  /** 受理する場合の保存値（UTCのISO文字列）。 */
  scheduledAt?: string;
}

/**
 * 予約を受け付けられるかを判定する。`nowMs` を引数で受けるのは、画面とサーバーで同じ時刻を
 * 使えるようにするため（境界付近で判定が割れて表示と結果が食い違うのを防ぐ）。
 */
export function checkDraftSchedule(
  target: DraftScheduleTarget,
  scheduledAtInput: string,
  nowMs: number,
): DraftScheduleCheck {
  if (target.status !== "draft") {
    return { ok: false, reason: "draft_not_editable" };
  }
  if (!target.xAccountActive) {
    return { ok: false, reason: "x_account_inactive" };
  }

  /*
   * `datetime-local` の素の値（YYYY-MM-DDTHH:mm）は**日本時間として**解釈する（T-M8-229）。
   * TZ無しの文字列を `new Date` に渡すと実行環境のTZで解釈され、本番サーバ（UTC）では
   * JST利用者の予約が9時間遅れて保存される（stg初デプロイ前のCI調査で発見）。
   * オフセットつきISOはそのまま通す（内部呼び出し・既存データの互換）。
   */
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(scheduledAtInput);
  const at = new Date(
    naive
      ? `${scheduledAtInput}${scheduledAtInput.length === 16 ? ":00" : ""}+09:00`
      : scheduledAtInput,
  );
  const atMs = at.getTime();
  if (Number.isNaN(atMs)) {
    return { ok: false, reason: "scheduled_at_invalid" };
  }
  if (atMs - nowMs < MIN_SCHEDULE_LEAD_MS) {
    return { ok: false, reason: "scheduled_at_too_soon" };
  }
  if (atMs - nowMs > MAX_SCHEDULE_AHEAD_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "scheduled_at_too_far" };
  }

  return { ok: true, scheduledAt: at.toISOString() };
}

/** 判定に落ちたら理由付きで止める。Server Action 側で使う。 */
export function assertDraftSchedulable(
  target: DraftScheduleTarget,
  scheduledAtInput: string,
  nowMs: number,
): string {
  const check = checkDraftSchedule(target, scheduledAtInput, nowMs);
  if (!check.ok || !check.scheduledAt) {
    throw new AppError("validation_error", {
      message: DRAFT_SCHEDULE_REASONS[check.reason ?? "scheduled_at_invalid"],
      details: { reason: check.reason },
    });
  }
  return check.scheduledAt;
}
