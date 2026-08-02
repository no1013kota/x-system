"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateDraftAction } from "@/app/actions/drafts";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { DraftView } from "@/lib/drafts";
import { weightedLength } from "@/lib/text/weighted-length";

const PATTERN_MAX: Record<string, number> = { p1: 6, p2: 1, p3: 7, p4: 5, p5: 3, p6: 7 };
const MAX_WEIGHTED = 280;

interface EditablePost {
  localId: string;
  text: string;
}

let localSeq = 0;

export function DraftEditor({
  draft,
  onDone,
}: {
  draft: DraftView;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [posts, setPosts] = useState<EditablePost[]>(() =>
    draft.thread.map((p, i) => ({ localId: p.local_id || `p${i + 1}`, text: p.text })),
  );
  const toast = useToast();

  const max = PATTERN_MAX[draft.pattern] ?? 1;
  const hasEmpty = posts.some((p) => p.text.trim().length === 0);
  const overCount = posts.length > max;
  const canSave = !pending && posts.length >= 1 && !hasEmpty && !overCount;

  const setText = (index: number, text: string) =>
    setPosts((prev) => prev.map((p, i) => (i === index ? { ...p, text } : p)));

  const move = (index: number, dir: -1 | 1) =>
    setPosts((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const addPost = () =>
    setPosts((prev) =>
      prev.length >= max ? prev : [...prev, { localId: `new-${localSeq++}`, text: "" }],
    );

  const removePost = (index: number) =>
    setPosts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  function save() {
    startTransition(async () => {
      const res = await updateDraftAction({
        draft_id: draft.id,
        expected_updated_at: draft.updated_at,
        posts: posts.map((p) => ({ local_id: p.localId, text: p.text })),
      });
      if (res.status === "error") {
        toast.show({
          tone: "error",
          title: "保存できませんでした",
          description:
            res.code === "job_conflict"
              ? "下書きが他の場所で更新されました。最新の状態に再読み込みしてください。"
              : res.message,
        });
        return;
      }
      // **保存できたことを伝える**（T-M8-18）。編集画面が閉じるだけで、これまでは無言だった。
      toast.show({ tone: "success", title: "下書きを保存しました" });
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="mt-3 space-y-3">
      <ol className="space-y-3">
        {posts.map((post, index) => {
          const len = weightedLength(post.text);
          const over = len > MAX_WEIGHTED;
          return (
            <li className="rounded-lg border bg-background p-3" key={post.localId}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {index + 1}ポスト目
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label="上へ"
                    disabled={index === 0 || pending}
                    onClick={() => move(index, -1)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    ↑
                  </Button>
                  <Button
                    aria-label="下へ"
                    disabled={index === posts.length - 1 || pending}
                    onClick={() => move(index, 1)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    ↓
                  </Button>
                  <Button
                    aria-label="削除"
                    disabled={posts.length <= 1 || pending}
                    onClick={() => removePost(index)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    ×
                  </Button>
                </div>
              </div>
              <textarea
                aria-label={`${index + 1}ポスト目の本文`}
                className="w-full rounded-md border px-3 py-2 text-sm"
                onChange={(e) => setText(index, e.target.value)}
                rows={4}
                value={post.text}
              />
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className={over ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {len} / {MAX_WEIGHTED}
                </span>
                {over ? <span className="text-destructive">文字数超過</span> : null}
                {post.text.trim().length === 0 ? (
                  <span className="text-destructive">本文が空です</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={posts.length >= max || pending} onClick={addPost} size="sm" type="button" variant="outline">
          ＋ポストを追加
        </Button>
        <span className="text-xs text-muted-foreground">
          {posts.length} / {max} ポスト
        </span>
      </div>

      {overCount ? (
        <p className="text-sm text-destructive" role="alert">
          このパターンの最大 {max} ポストを超えています。
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button disabled={!canSave} onClick={save} size="lg" type="button">
          {pending ? "保存中…" : "保存"}
        </Button>
        <Button disabled={pending} onClick={onDone} size="lg" type="button" variant="outline">
          キャンセル
        </Button>
      </div>
    </div>
  );
}
