import type { DraftView } from "@/lib/drafts";

/**
 * 失敗した下書きで「何が押せるか」の判定（要件06 §7・T-M8-41）。
 *
 * **なぜ `.tsx` から出したか。** この判定は「Xに残ったポストをどう扱うか」という
 * 取り返しのつかない領域のルールだが、以前は `drafts-list.tsx` の `DraftCard` 本体に
 * 派生boolean 8個として書かれていた。このリポジトリの単体テストは `environment: node` かつ
 * `include: src/**\/*.test.ts` なので、**`.tsx` は1件も単体テストの網に入らない**
 * （`.test.tsx` はリポジトリ内に0件、RTL・jsdom も未導入）。ルールを壊しても、
 * E2Eで踏んだ経路以外は緑のまま通る。
 *
 * **サーバー側にも同じ判定がある**（`drafts-clone.ts` / `drafts.ts` / `generation-jobs.ts` /
 * `post-publish.ts`）ので、ここが壊れても投稿がXへ誤爆することはない。ここは
 * 「押せてしまってサーバーに弾かれる」を防ぐための、画面側の一次ゲートである。
 *
 * 移動時に条件は一切変えていない。
 */

export interface DraftActionState {
  /** 警告バッジを出すか（本文の警告 or 画像生成の失敗）。 */
  hasWarnings: boolean;
  /** 画像生成が失敗している。 */
  imageFailed: boolean;
  /** 編集できる状態か（`draft` のみ）。 */
  editable: boolean;
  /** X上に作成済みのポストがある失敗（直接の再投稿・破棄を禁じる）。 */
  hasCreationHistory: boolean;
  /** 残存・曖昧が残っている失敗（reconcileが必要）。 */
  unresolvedPosting: boolean;
  /** 全削除を確認できた失敗（＝複製してやり直せる）。 */
  cloneEligible: boolean;
  /** P-5 が機能フラグOFFで閲覧のみ。 */
  quoteDisabled: boolean;
  /** 加重280超過があり、編集するまで投稿させない。 */
  lengthExceeded: boolean;
  /** 投稿処理中（リロードしても復元できるよう `status` を見る）。 */
  posting: boolean;
}

export function draftActionState(
  draft: DraftView,
  options: { quotePostEnabled: boolean },
): DraftActionState {
  const imageFailed = draft.images.some((img) => img.status === "failed");
  // failed の投稿状態（要件06 §7）: 作成履歴あり=直接再投稿/破棄不可（cloneで再開）。
  // 残存/曖昧=未解決（reconcile必要）。全削除確認済み（履歴あり・未解決なし）=clone可能。
  const lastPostError = draft.last_post_error;
  const hasCreationHistory = draft.status === "failed" && draft.tweet_ids.length > 0;
  const unresolvedPosting =
    draft.status === "failed" &&
    ((lastPostError?.remaining_tweet_ids?.length ?? 0) > 0 ||
      (lastPostError?.ambiguous_create_indices?.length ?? 0) > 0 ||
      (lastPostError?.ambiguous_delete_tweet_ids?.length ?? 0) > 0);

  return {
    imageFailed,
    hasWarnings: draft.thread.some((p) => p.warnings.length > 0) || imageFailed,
    editable: draft.status === "draft",
    hasCreationHistory,
    unresolvedPosting,
    cloneEligible: hasCreationHistory && !unresolvedPosting,
    // P-5 は flag OFF の間、閲覧のみ（編集・再生成・画像再生成・投稿を無効化, 要件06 §4.1）。
    quoteDisabled: draft.pattern === "p5" && !options.quotePostEnabled,
    // 文字数超過はXが受け付けないため、編集するまで投稿させない（投稿前の再検証と同じ判定）。
    lengthExceeded: draft.thread.some((p) => p.warnings.includes("length_exceeded")),
    posting: draft.status === "posting",
  };
}
