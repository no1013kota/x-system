import { describe, expect, it } from "vitest";

import type { DraftView } from "@/lib/drafts";

import { draftActionState } from "./draft-actions";

/**
 * 失敗した下書きの可否ルール（要件06 §7・T-M8-41）。
 *
 * 以前この判定は `drafts-list.tsx` の中にあり、**単体テストが1件も届いていなかった**
 * （`vitest.config.ts` の `include` は `src/**\/*.test.ts` で `.tsx` は対象外、RTLも未導入）。
 * Xに残ったポストの扱いという取り返しのつかない領域なので、表で固定する。
 */

function draft(over: Partial<DraftView> = {}): DraftView {
  return {
    id: "d1",
    pattern: "p1",
    status: "draft",
    thread: [{ local_id: "p1", text: "本文", weighted_length: 6, sources: [], warnings: [] }],
    images: [],
    parent_draft_id: null,
    root_tweet_id: null,
    tweet_ids: [],
    posted_mode: null,
    last_post_error: null,
    posted_at: null,
    created_at: "2026-08-04T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
    ...over,
  };
}

const enabled = { quotePostEnabled: true };

describe("draftActionState", () => {
  it("通常の下書きは編集でき、複製・reconcileは不要", () => {
    const s = draftActionState(draft(), enabled);
    expect(s).toMatchObject({
      editable: true,
      hasWarnings: false,
      hasCreationHistory: false,
      unresolvedPosting: false,
      cloneEligible: false,
      quoteDisabled: false,
      lengthExceeded: false,
      posting: false,
    });
  });

  it("投稿中は posting になる（リロードしても復元できるよう status から決める）", () => {
    expect(draftActionState(draft({ status: "posting" }), enabled).posting).toBe(true);
    // `posting` は編集可否とは別物（editable は draft のみ）
    expect(draftActionState(draft({ status: "posting" }), enabled).editable).toBe(false);
  });

  describe("失敗した下書き（要件06 §7）", () => {
    it("作成履歴あり・未解決なし → 複製でやり直せる", () => {
      const s = draftActionState(
        draft({ status: "failed", tweet_ids: ["t1", "t2"], last_post_error: { code: "x" } }),
        enabled,
      );
      expect(s.hasCreationHistory).toBe(true);
      expect(s.unresolvedPosting).toBe(false);
      expect(s.cloneEligible).toBe(true);
    });

    it("残存ポストがある → 未解決（reconcileが必要・複製させない）", () => {
      const s = draftActionState(
        draft({
          status: "failed",
          tweet_ids: ["t1"],
          last_post_error: { remaining_tweet_ids: ["t1"] },
        }),
        enabled,
      );
      expect(s.unresolvedPosting).toBe(true);
      expect(s.cloneEligible).toBe(false);
    });

    it("作成が曖昧 → 未解決", () => {
      const s = draftActionState(
        draft({
          status: "failed",
          tweet_ids: ["t1"],
          last_post_error: { ambiguous_create_indices: [1] },
        }),
        enabled,
      );
      expect(s.unresolvedPosting).toBe(true);
    });

    it("削除が曖昧 → 未解決", () => {
      const s = draftActionState(
        draft({
          status: "failed",
          tweet_ids: ["t1"],
          last_post_error: { ambiguous_delete_tweet_ids: ["t1"] },
        }),
        enabled,
      );
      expect(s.unresolvedPosting).toBe(true);
    });

    it("作成履歴が無い失敗は複製の対象にしない（やり直しは再生成で足りる）", () => {
      const s = draftActionState(
        draft({ status: "failed", tweet_ids: [], last_post_error: { code: "x_token_invalid" } }),
        enabled,
      );
      expect(s.hasCreationHistory).toBe(false);
      expect(s.cloneEligible).toBe(false);
    });

    // 空配列を「あり」と数えると、失敗のたびに reconcile を求めることになる。
    it("空配列は未解決にしない", () => {
      const s = draftActionState(
        draft({
          status: "failed",
          tweet_ids: ["t1"],
          last_post_error: {
            remaining_tweet_ids: [],
            ambiguous_create_indices: [],
            ambiguous_delete_tweet_ids: [],
          },
        }),
        enabled,
      );
      expect(s.unresolvedPosting).toBe(false);
      expect(s.cloneEligible).toBe(true);
    });

    // status が failed でなければ、残骸が残っていても未解決とは扱わない（履歴側の表示に使う）。
    it("failed 以外では last_post_error があっても未解決にしない", () => {
      const s = draftActionState(
        draft({ status: "posted", tweet_ids: ["t1"], last_post_error: { remaining_tweet_ids: ["t1"] } }),
        enabled,
      );
      expect(s.unresolvedPosting).toBe(false);
      expect(s.hasCreationHistory).toBe(false);
    });
  });

  describe("警告", () => {
    it("本文の警告を拾う", () => {
      const s = draftActionState(
        draft({
          thread: [
            { local_id: "p1", text: "a", weighted_length: 1, sources: [], warnings: ["ng_word"] },
          ],
        }),
        enabled,
      );
      expect(s.hasWarnings).toBe(true);
      expect(s.lengthExceeded).toBe(false);
    });

    it("画像生成の失敗も警告として扱う（本文に警告が無くても知らせる）", () => {
      const s = draftActionState(
        draft({ images: [{ status: "failed" } as DraftView["images"][number]] }),
        enabled,
      );
      expect(s.imageFailed).toBe(true);
      expect(s.hasWarnings).toBe(true);
    });

    it("文字数超過は投稿を止める（Xが受け付けないため）", () => {
      const s = draftActionState(
        draft({
          thread: [
            { local_id: "p1", text: "a", weighted_length: 300, sources: [], warnings: ["length_exceeded"] },
            { local_id: "p2", text: "b", weighted_length: 2, sources: [], warnings: [] },
          ],
        }),
        enabled,
      );
      expect(s.lengthExceeded).toBe(true);
    });
  });

  describe("P-5（引用ポスト）の機能フラグ", () => {
    it("OFFのあいだ P-5 は閲覧のみ", () => {
      expect(
        draftActionState(draft({ pattern: "p5" }), { quotePostEnabled: false }).quoteDisabled,
      ).toBe(true);
    });

    it("ONなら通常どおり操作できる", () => {
      expect(draftActionState(draft({ pattern: "p5" }), enabled).quoteDisabled).toBe(false);
    });

    it("他パターンはフラグの影響を受けない", () => {
      expect(
        draftActionState(draft({ pattern: "p1" }), { quotePostEnabled: false }).quoteDisabled,
      ).toBe(false);
    });
  });
});
