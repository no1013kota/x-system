"use client";

import { useToast } from "@/components/ui/toast";
import { inviteShareText } from "@/lib/invite/share-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/**
 * 招待リンクのコピーとXシェア（T-M8-174・invite_cp.md §2①）。
 * コピー完了はトーストで伝える（要件06 §2.1）。
 */
export function InviteLinkActions({ inviteUrl }: { inviteUrl: string }) {
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.show({ tone: "success", title: "招待リンクをコピーしました" });
    } catch {
      toast.show({
        tone: "error",
        title: "コピーできませんでした",
        description: "リンクを選択して手動でコピーしてください。",
      });
    }
  }

  // 文面の正本は `lib/invite/share-text.ts`（長さと表現を単体テストで固定する・T-M8-276）。
  const shareUrl = `https://x.com/intent/post?text=${encodeURIComponent(inviteShareText(inviteUrl))}`;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button className="h-10 px-4 font-bold" onClick={copy} type="button" variant="brand">
        <Icon aria-hidden="true" name="content_copy" size={16} />
        リンクをコピー
      </Button>
      <a
        className="inline-flex h-10 items-center gap-1.5 rounded-card border border-hairline bg-surface px-4 text-sm font-medium text-ink hover:bg-black/[0.03]"
        href={shareUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        <Icon aria-hidden="true" name="open_in_new" size={15} />
        Xでシェア
      </a>
    </div>
  );
}
