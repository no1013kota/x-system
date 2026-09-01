"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { removeDraftImageAction, uploadDraftImageAction } from "@/app/actions/drafts";
import { getGenerationJobAction, regenerateImageAction } from "@/app/actions/generation-jobs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createPollGuard, POLL_INTERVAL_MS, pollGiveUpMessage } from "@/lib/ui/poll-guard";

/** job の終端状態（pollを止める条件）。 */
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * 下書きの画像パネル（T-M8-355でdrafts-listから切り出した）。
 *
 * **1枚の画像に対する操作をここへ集める**——再生成（AI）・アップロード（自分の画像）・
 * 取り外し。下書きカードは「どの画像を渡すか」だけを知っていればよく、
 * jobのpollやファイル選択の作法を知らずに済む。
 */
export function DraftImagePanel({
  canUpload,
  draftId,
  enabled,
  failed,
  hasImage,
  imageUrl,
  uploaded,
  postLocalId,
}: {
  /** 自分の画像を添えられるか（編集できる下書きで、投稿処理中でない）。 */
  canUpload: boolean;
  draftId: string;
  enabled: boolean;
  failed: boolean;
  hasImage: boolean;
  imageUrl?: string;
  /** いまの画像が自分でアップロードしたものか（生成物と区別して出す）。 */
  uploaded: boolean;
  /** このパネルが担当するポスト（T-M8-398。スレッド内のポストごとに1枚）。 */
  postLocalId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputId = `draft-image-${draftId}-${postLocalId}`;
  const toast = useToast();

  const running = pending || jobId !== null || uploading;

  /**
   * 自分の画像に差し替える（T-M8-353）。**投稿に使われるのは1枚**なので置き換えにする。
   * 大きさ・形式の判定はサーバーが行い、理由をそのまま出す（原則2）。
   */
  function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.set("draft_id", draftId);
    form.set("post_local_id", postLocalId);
    form.set("file", file);
    void uploadDraftImageAction(form)
      .then((res) => {
        if (res.status === "success") {
          toast.show({ tone: "success", title: "画像をアップロードしました" });
          router.refresh();
        } else {
          toast.show({
            tone: "error",
            title: "アップロードできませんでした",
            description: res.message,
          });
        }
      })
      .finally(() => setUploading(false));
  }

  function removeImage() {
    startTransition(async () => {
      const res = await removeDraftImageAction({ draft_id: draftId, post_local_id: postLocalId });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "画像を外しました" });
        router.refresh();
      } else {
        toast.show({ tone: "error", title: "画像を外せませんでした", description: res.message });
      }
    });
  }

  // 再生成jobを終端までpollする。成功でrefresh（新画像の署名URLを取り直す）。失敗は既存画像を維持。
  // 取得できない状態が続いたら打ち切って伝える（T-M8-51）。
  useEffect(() => {
    if (!jobId) return;
    const guard = createPollGuard();
    const timer = setInterval(async () => {
      const res = await getGenerationJobAction({ job_id: jobId });
      const ok = res.status === "success" && Boolean(res.job);
      if (guard.tick(ok) === "give-up") {
        clearInterval(timer);
        setJobId(null);
        toast.show({ tone: "error", ...pollGiveUpMessage(guard.reason()) });
        router.refresh();
        return;
      }
      if (!ok || !res.job) return;
      if (!TERMINAL.has(res.job.status)) return;
      clearInterval(timer);
      setJobId(null);
      if (res.job.status === "succeeded") {
        // 成功が無言だと「押しても何も起きない」ように見える（T-M8-16）。
        toast.show({ tone: "success", title: "画像を再生成しました" });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          title: "画像を再生成できませんでした",
          description: "既存の画像はそのままです。",
        });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [jobId, router, toast]);

  function regenerate() {
    startTransition(async () => {
      const res = await regenerateImageAction({
        request_key: crypto.randomUUID(),
        draft_id: draftId,
        post_local_id: postLocalId,
      });
      if (res.status !== "success" || !res.jobId) {
        toast.show({
          tone: "error",
          title: "画像の再生成を開始できませんでした",
          description: res.message,
        });
        return;
      }
      setJobId(res.jobId);
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="relative inline-block">
        {imageUrl ? (
          // 署名URLは短時間・外部domainのため next/image ではなく素の img を使う。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="生成画像プレビュー"
            className="max-h-48 rounded-lg border object-contain"
            src={imageUrl}
          />
        ) : (
          <div className="flex h-24 w-40 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            {failed ? "画像なし（生成失敗）" : "画像なし"}
          </div>
        )}
        {running ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-xs font-medium text-white">
            {uploading ? "アップロード中…" : "再生成中…"}
          </div>
        ) : null}
      </div>
      {hasImage ? (
        <p className="text-xs text-muted-foreground">
          {uploaded ? "自分でアップロードした画像です。" : "AIが生成した画像です。"}
          このポストに添付されます。
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!enabled || running}
          onClick={regenerate}
          size="sm"
          type="button"
          variant="outline"
        >
          {running ? "生成中…" : hasImage ? "画像を再生成" : "画像を生成する"}
        </Button>
        {/*
          **自分の画像を添える**（T-M8-353）。`<label>` で `<input type="file">` を包み、
          見た目はボタンにそろえる（素のファイル選択はブラウザごとに見た目が違う）。
        */}
        {canUpload ? (
          <label
            className="inline-flex min-h-9 cursor-pointer items-center rounded-card border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-page focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
            htmlFor={fileInputId}
          >
            {hasImage ? "画像を差し替える" : "画像をアップロードする"}
            <input
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={running}
              id={fileInputId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // 同じファイルを選び直しても変化を拾えるように値を空へ戻す。
                event.target.value = "";
                if (file) upload(file);
              }}
              type="file"
            />
          </label>
        ) : null}
        {canUpload && hasImage ? (
          <Button disabled={running} onClick={removeImage} size="sm" type="button" variant="ghost">
            画像を外す
          </Button>
        ) : null}
        {!enabled ? (
          <span className="text-xs text-muted-foreground">
            画像プロバイダのAPIキーが未登録です。
          </span>
        ) : null}
      </div>
    </div>
  );
}
