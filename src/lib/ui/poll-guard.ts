/**
 * 進捗pollの見張り（T-M8-51）。**永遠に回り続けて何も言わない**状態を作らない。
 *
 * 画面のpollは3箇所（投稿・画像再生成・生成）とも、取得に失敗したら黙って `return` して
 * 次のtickを待つ形だった。上限も無いので、通信やサーバーが継続的に失敗すると
 * **「投稿中…」が永遠に出たままトーストが1つも出ない**。利用者からは進んでいるのか
 * 壊れているのか区別できない（CLAUDE.md 原則1）。
 *
 * ロジックを `.ts` に置くのは意図的。このリポジトリの単体テストは `environment: node` かつ
 * `include: src/**\/*.test.ts` で、**`.tsx` は1件も網に入らない**（`draft-actions.ts` と同じ理由）。
 */

/** pollの間隔（ms）。3箇所で同じ値を使う。 */
export const POLL_INTERVAL_MS = 2500;

/**
 * 打ち切りまでの総tick数。`POLL_INTERVAL_MS` × これ = 待つ上限。
 *
 * job のFunction deadlineは180秒で、retryを含めても数分で終端へ落ちる（要件04 §5）。
 * 10分待って終端にならないなら、pollしていても分からない何かが起きている。
 */
export const POLL_MAX_TICKS = 240;

/** 連続でこの回数失敗したら打ち切る（1回の失敗は通信の揺れとして流す）。 */
export const POLL_MAX_CONSECUTIVE_FAILURES = 5;

export type PollDecision = "continue" | "give-up";

export interface PollGuard {
  /** 1tick分の結果を渡す。`ok=false` は「状態を取得できなかった」。 */
  tick(ok: boolean): PollDecision;
  /** 打ち切りの理由（`give-up` を返した後に読む）。 */
  reason(): "timeout" | "unreachable" | null;
}

export function createPollGuard(
  options: { maxTicks?: number; maxConsecutiveFailures?: number } = {},
): PollGuard {
  const maxTicks = options.maxTicks ?? POLL_MAX_TICKS;
  const maxFailures = options.maxConsecutiveFailures ?? POLL_MAX_CONSECUTIVE_FAILURES;
  let ticks = 0;
  let consecutiveFailures = 0;
  let reason: "timeout" | "unreachable" | null = null;

  return {
    tick(ok) {
      if (reason) return "give-up";
      ticks += 1;
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= maxFailures) {
        reason = "unreachable";
        return "give-up";
      }
      if (ticks >= maxTicks) {
        reason = "timeout";
        return "give-up";
      }
      return "continue";
    },
    reason() {
      return reason;
    },
  };
}

/** 打ち切りをそのまま利用者へ出す文言（原因ごとに次の一手を変える）。 */
export function pollGiveUpMessage(reason: "timeout" | "unreachable" | null): {
  title: string;
  description: string;
} {
  if (reason === "unreachable") {
    return {
      title: "状況を確認できませんでした",
      description:
        "通信が不安定なようです。処理自体は続いている可能性があるので、画面を再読み込みして状態をご確認ください。",
    };
  }
  return {
    title: "時間がかかっています",
    description:
      "想定より長くかかっています。処理は続いている可能性があるので、画面を再読み込みして状態をご確認ください。",
  };
}
