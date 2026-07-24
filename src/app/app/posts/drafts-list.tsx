"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { discardDraftAction } from "@/app/actions/drafts";
import { regenerateDraftAction } from "@/app/actions/generation-jobs";
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
  const [regenerating, setRegenerating] = useState(false);

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
          {!editing ? (
            <Button
              onClick={() => setRegenerating((v) => !v)}
              size="sm"
              type="button"
              variant="outline"
            >
              再生成
            </Button>
          ) : null}
          <DiscardButton disabled={pending} onConfirm={discard} />
        </div>
      </div>

      {regenerating ? (
        <RegenerateBox draftId={draft.id} onDone={() => setRegenerating(false)} />
      ) : null}

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

function RegenerateBox({ draftId, onDone }: { draftId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [instructions, setInstructions] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  function run() {
    setNotice(null);
    startTransition(async () => {
      const res = await regenerateDraftAction({
        request_key: crypto.randomUUID(),
        draft_id: draftId,
        additional_instructions: instructions.trim() || undefined,
      });
      setNotice({
        message:
          res.status === "success"
            ? "再生成を開始しました。完了後、派生下書きがこの一覧に表示されます。"
            : res.message,
        tone: res.status,
      });
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
      <label className="block text-xs font-medium" htmlFor={`regen-${draftId}`}>
        追加指示（任意）
      </label>
      <textarea
        className="w-full rounded-md border px-3 py-2 text-sm"
        id={`regen-${draftId}`}
        maxLength={2000}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="例: もっと具体例を増やして、結論を先頭に"
        rows={2}
        value={instructions}
      />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={run} size="sm" type="button">
          {pending ? "開始中…" : "再生成する"}
        </Button>
        <Button disabled={pending} onClick={onDone} size="sm" type="button" variant="ghost">
          閉じる
        </Button>
      </div>
      {notice ? (
        <p
          className={`text-xs ${notice.tone === "success" ? "text-emerald-700" : "text-destructive"}`}
          role={notice.tone === "success" ? "status" : "alert"}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
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
