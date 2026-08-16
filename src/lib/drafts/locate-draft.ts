import "server-only";

import type { Queryable } from "../x/token-refresh";

/**
 * 通知から渡された `draftId` が、いま開いているタブに見当たらないときの行き先（T-M8-115）。
 *
 * 通知は「投稿に失敗しました」→ `?tab=drafts&draftId=…`、「投稿しました」→ `?tab=history&draftId=…`
 * のように**特定の下書き**を指す。ところが通知を押すのは数時間〜数日あとで、そのあいだに
 * 下書きは投稿されて履歴へ移るか、破棄されて消えている。
 *
 * 以前はその場合、**ただの一覧が出るだけで何の説明も無かった**。利用者は「押しても何も
 * 起きなかった」と受け取るか、目的の下書きを一覧から探し続けることになる（CLAUDE.md 原則1・2）。
 * どこへ行ったのかを画面で言う。
 */
export type DraftLocation =
  /** 別のタブにある（投稿済みで履歴へ移った・履歴から下書きへ戻った等）。 */
  | { kind: "other-tab"; tab: "drafts" | "history" }
  /** このアカウントに存在しない（破棄された・別のXアカウントのもの）。 */
  | { kind: "gone" };

/**
 * 指定の下書きが**いまどのタブにあるか**を1クエリで調べる。
 *
 * 呼ぶのは「開いているタブの一覧に無かったとき」だけ。所有者の確認を兼ねるため、
 * 必ず `xAccountId` で絞る（他人の下書きの存在を漏らさない）。
 */
export async function locateDraft(
  db: Queryable,
  xAccountId: string,
  draftId: string,
): Promise<DraftLocation> {
  // タブの振り分けは `listDraftsForAccount` と同じ条件を使う（履歴=posted・下書き=draft/failed）。
  // ここがずれると「履歴にあります」と案内した先に無い、という最悪の形になる。
  const { rows } = await db.query<{ status: string }>(
    `select d.status::text as status
       from drafts d
      where d.id = $1 and d.x_account_id = $2`,
    [draftId, xAccountId],
  );
  const status = rows[0]?.status;
  if (!status) return { kind: "gone" };
  if (status === "posted") return { kind: "other-tab", tab: "history" };
  if (status === "draft" || status === "failed") return { kind: "other-tab", tab: "drafts" };
  // どちらの一覧にも出ない状態（生成中など）。存在はするが今は見せられない。
  return { kind: "gone" };
}
