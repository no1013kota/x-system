"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { discardDraftAction } from "@/app/actions/drafts";
import { Button } from "@/components/ui/button";
import type { DraftView } from "@/lib/drafts";

import { DraftEditor } from "./draft-editor";

const PATTERN_LABEL: Record<string, string> = {
  p1: "ニュース解説",
  p2: "自分の考え",
  p3: "ノウハウ",
  p4: "トレンド便乗",
  p5: "引用ポスト",
  p6: "週次まとめ",
};

const WARNING_LABEL: Record<string, string> = {
  length_exceeded: "文字数超過",
  cashtag_multiple: "cashtag2件以上",
  ng_word: "NGワード",
  source_missing: "出典不足",
  injection_suspected: "要確認",
};

function WarningBadge({ code }: { code: string }) {
  return (
    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
      {WARNING_LABEL[code] ?? code}
    </span>
  );
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export function DraftsList({
  drafts,
  selectedDraftId,
}: {
  drafts: DraftView[];
  selectedDraftId?: string;
}) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
        未投稿の下書きはありません。「作成」タブから生成できます。
      </div>
    );
  }
  return (
    <ul className="space-y-4">
      {drafts.map((draft) => (
        <DraftCard draft={draft} highlighted={draft.id === selectedDraftId} key={draft.id} />
      ))}
    </ul>
  );
}

function DraftCard({ draft, highlighted }: { draft: DraftView; highlighted: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  const imageFailed = draft.images.some((img) => img.status === "failed");
  const hasWarnings = draft.thread.some((p) => p.warnings.length > 0) || imageFailed;
  const editable = draft.status === "draft";

  function discard() {
    startTransition(async () => {
      const res = await discardDraftAction({
        draft_id: draft.id,
        expected_updated_at: draft.updated_at,
      });
      if (res.status === "success") router.refresh();
    });
  }

  return (
    <li
      className={`scroll-mt-24 rounded-2xl border bg-card p-5 shadow-sm ${
        highlighted ? "ring-2 ring-ring" : ""
      }`}
      id={`draft-${draft.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{PATTERN_LABEL[draft.pattern] ?? draft.pattern}</span>
          {draft.status === "failed" ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-800">
              失敗
            </span>
          ) : null}
          {hasWarnings ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              自動投稿は手動確認が必要
            </span>
          ) : null}
          {imageFailed ? <WarningBadge code="image_failed" /> : null}
          <span className="text-xs text-muted-foreground">{timeLabel(draft.updated_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          {editable && !editing ? (
            <Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
              編集
            </Button>
          ) : null}
          <DiscardButton disabled={pending} onConfirm={discard} />
        </div>
      </div>

      {draft.parent_draft_id ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <a className="underline" href={`/app/posts?tab=drafts&draftId=${draft.parent_draft_id}`}>
            派生元の下書きを見る
          </a>
        </p>
      ) : null}

      {editing ? (
        <DraftEditor draft={draft} onDone={() => setEditing(false)} />
      ) : (
        <ol className="mt-3 space-y-2">
          {draft.thread.map((post) => (
            <li className="rounded-lg border bg-background p-3" key={post.local_id}>
              <p className="text-sm whitespace-pre-wrap">{post.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{post.weighted_length} / 280</span>
                {post.warnings.map((w) => (
                  <WarningBadge code={w} key={w} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function DiscardButton({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        render={<Button disabled={disabled} size="sm" type="button" variant="destructive" />}
      >
        破棄
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
          <AlertDialog.Title className="text-lg font-semibold">
            下書きを破棄しますか？
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            破棄すると下書き一覧から外れます。生成した画像は削除されます。この操作は取り消せません。
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close
              onClick={onConfirm}
              render={<Button size="lg" type="button" variant="destructive" />}
            >
              破棄する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
