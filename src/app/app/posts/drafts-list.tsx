"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  cloneFailedDraftForRetryAction,
  discardDraftAction,
  reconcileDraftPostingAction,
} from "@/app/actions/drafts";
import {
  getGenerationJobAction,
  publishDraftAction,
  regenerateDraftAction,
  regenerateImageAction,
} from "@/app/actions/generation-jobs";
import { Button } from "@/components/ui/button";
import type { DraftView } from "@/lib/drafts";

import { DraftEditor } from "./draft-editor";

const POLL_MS = 2500;
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

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
  imageRegenEnabled,
  quotePostEnabled,
}: {
  drafts: DraftView[];
  selectedDraftId?: string;
  imageRegenEnabled: boolean;
  quotePostEnabled: boolean;
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
        <DraftCard
          draft={draft}
          highlighted={draft.id === selectedDraftId}
          imageRegenEnabled={imageRegenEnabled}
          key={draft.id}
          quotePostEnabled={quotePostEnabled}
        />
      ))}
    </ul>
  );
}

function DraftCard({
  draft,
  highlighted,
  imageRegenEnabled,
  quotePostEnabled,
}: {
  draft: DraftView;
  highlighted: boolean;
  imageRegenEnabled: boolean;
  quotePostEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [publishJobId, setPublishJobId] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const readyImage = draft.images.find((img) => img.status === "ready");
  const imageFailed = draft.images.some((img) => img.status === "failed");
  const hasWarnings = draft.thread.some((p) => p.warnings.length > 0) || imageFailed;
  const editable = draft.status === "draft";
  // failed の投稿状態（要件06 §7）: 作成履歴あり=直接再投稿/破棄不可（cloneで再開）。
  // 残存/曖昧=未解決（reconcile必要）。全削除確認済み（履歴あり・未解決なし）=clone可能。
  const lpe = draft.last_post_error;
  const hasCreationHistory = draft.status === "failed" && draft.tweet_ids.length > 0;
  const unresolvedPosting =
    draft.status === "failed" &&
    ((lpe?.remaining_tweet_ids?.length ?? 0) > 0 ||
      (lpe?.ambiguous_create_indices?.length ?? 0) > 0 ||
      (lpe?.ambiguous_delete_tweet_ids?.length ?? 0) > 0);
  const cloneEligible = hasCreationHistory && !unresolvedPosting;
  // P-5 は flag OFF の間、閲覧のみ（編集・再生成・画像再生成・投稿を無効化, 要件06 §4.1）。
  const p5Disabled = draft.pattern === "p5" && !quotePostEnabled;
  // 投稿中は編集・破棄・再生成・再投稿を無効化する（要件06 §7）。
  const publishing = pending || publishJobId !== null;
  const locked = publishing || editing;

  function discard() {
    startTransition(async () => {
      const res = await discardDraftAction({
        draft_id: draft.id,
        expected_updated_at: draft.updated_at,
      });
      if (res.status === "success") router.refresh();
    });
  }

  function cloneForRetry() {
    startTransition(async () => {
      const res = await cloneFailedDraftForRetryAction({
        request_key: crypto.randomUUID(),
        draft_id: draft.id,
      });
      if (res.status === "success") router.refresh();
    });
  }

  function publish() {
    setPublishNotice(null);
    startTransition(async () => {
      const res = await publishDraftAction({
        request_key: crypto.randomUUID(),
        draft_id: draft.id,
      });
      if (res.status !== "success" || !res.jobId) {
        setPublishNotice(res.message);
        return;
      }
      setPublishJobId(res.jobId);
    });
  }

  // 投稿jobを終端までpoll。成功→履歴へ（refreshで下書きから消える）、失敗→下書きに残り通知。
  useEffect(() => {
    if (!publishJobId) return;
    const timer = setInterval(async () => {
      const res = await getGenerationJobAction({ job_id: publishJobId });
      if (res.status !== "success" || !res.job) return;
      if (!TERMINAL.has(res.job.status)) return;
      clearInterval(timer);
      setPublishJobId(null);
      if (res.job.status === "succeeded") {
        router.refresh();
      } else {
        setPublishNotice("投稿に失敗しました。下書きの状態をご確認ください。");
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [publishJobId, router]);

  return (
    <li
      className={`scroll-mt-24 rounded-2xl border bg-card p-5 shadow-sm ${
        highlighted ? "ring-2 ring-ring" : ""
      }`}
      id={`draft-${draft.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}</span>
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
          {publishing ? (
            <span className="text-xs font-medium text-muted-foreground" role="status">
              投稿中…
            </span>
          ) : null}
          {p5Disabled ? (
            <span className="text-xs text-muted-foreground">
              引用ポスト機能は現在利用できません
            </span>
          ) : null}
          {editable && !editing && !publishing && !p5Disabled ? (
            <Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
              編集
            </Button>
          ) : null}
          {!editing && !publishing && !p5Disabled ? (
            <Button
              onClick={() => setRegenerating((v) => !v)}
              size="sm"
              type="button"
              variant="outline"
            >
              再生成
            </Button>
          ) : null}
          {editable && !editing && !p5Disabled ? (
            <PublishButton disabled={publishing} onConfirm={publish} />
          ) : null}
          {/* 全削除確認済み（作成履歴あり・未解決なし）は新draftとして再試行（要件06 §7）。 */}
          {cloneEligible ? (
            <Button disabled={pending} onClick={cloneForRetry} size="sm" type="button">
              新しい下書きとして再試行
            </Button>
          ) : null}
          {/* 作成履歴・未解決がある間は破棄不可（clone/reconcileで扱う, 要件06 §7）。 */}
          <DiscardButton
            disabled={locked || hasCreationHistory || unresolvedPosting}
            onConfirm={discard}
          />
        </div>
      </div>

      {unresolvedPosting ? <ReconcilePanel draftId={draft.id} /> : null}
      {publishNotice ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {publishNotice}
        </p>
      ) : null}

      {regenerating ? (
        <RegenerateBox draftId={draft.id} onDone={() => setRegenerating(false)} />
      ) : null}

      {readyImage || imageFailed ? (
        <ImageSection
          enabled={imageRegenEnabled && !publishing && !p5Disabled}
          failed={imageFailed && !readyImage}
          imageUrl={readyImage?.signed_url}
          draftId={draft.id}
        />
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

function ImageSection({
  draftId,
  imageUrl,
  failed,
  enabled,
}: {
  draftId: string;
  imageUrl?: string;
  failed: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  const running = pending || jobId !== null;

  // 再生成jobを終端までpollする。成功でrefresh（新画像の署名URLを取り直す）。失敗は既存画像を維持。
  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(async () => {
      const res = await getGenerationJobAction({ job_id: jobId });
      if (res.status !== "success" || !res.job) return;
      if (!TERMINAL.has(res.job.status)) return;
      clearInterval(timer);
      setJobId(null);
      if (res.job.status === "succeeded") {
        router.refresh();
      } else {
        setNotice({ tone: "error", message: "画像を再生成できませんでした。既存の画像はそのままです。" });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, router]);

  function regenerate() {
    setNotice(null);
    startTransition(async () => {
      const res = await regenerateImageAction({
        request_key: crypto.randomUUID(),
        draft_id: draftId,
      });
      if (res.status !== "success" || !res.jobId) {
        setNotice({ tone: "error", message: res.message });
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
        ) : failed ? (
          <div className="flex h-24 w-40 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            画像なし（生成失敗）
          </div>
        ) : null}
        {running ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-xs font-medium text-white">
            再生成中…
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={!enabled || running}
          onClick={regenerate}
          size="sm"
          type="button"
          variant="outline"
        >
          {running ? "再生成中…" : "画像を再生成"}
        </Button>
        {!enabled ? (
          <span className="text-xs text-muted-foreground">
            画像プロバイダのAPIキーが未登録です。
          </span>
        ) : null}
      </div>
      {notice ? (
        <p className="text-xs text-destructive" role="alert">
          {notice.message}
        </p>
      ) : null}
    </div>
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

function ReconcilePanel({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  // 再照合しても一意に確定できなかった場合に X リンク＋サポート導線を出す（要件06 §7）。
  const [needsManual, setNeedsManual] = useState(false);

  function reconcile() {
    setResult(null);
    startTransition(async () => {
      const res = await reconcileDraftPostingAction({ draft_id: draftId });
      if (res.status === "error") {
        setResult({ tone: "error", message: res.message });
        return;
      }
      if (res.reconcileStatus === "posted") {
        router.refresh(); // 履歴タブへ移動
        return;
      }
      setNeedsManual(res.reconcileStatus === "still_failed");
      setResult({ tone: res.reconcileStatus === "still_failed" ? "error" : "success", message: res.message });
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
      <p className="text-xs leading-5">
        投稿の状態が未解決です。破棄する前にXと再照合して、投稿済み・削除済みを確定してください。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} onClick={reconcile} size="sm" type="button" variant="outline">
          {pending ? "再照合中…" : "Xと再照合"}
        </Button>
        {needsManual ? (
          <a
            className="text-xs underline"
            href="https://x.com/home"
            rel="noopener noreferrer"
            target="_blank"
          >
            Xで状態を確認
          </a>
        ) : null}
      </div>
      {result ? (
        <p
          className={`text-xs ${result.tone === "success" ? "text-emerald-800" : "text-destructive"}`}
          role={result.tone === "success" ? "status" : "alert"}
        >
          {result.message}
        </p>
      ) : null}
      {needsManual ? (
        <p className="text-xs text-muted-foreground">
          解決しない場合は、Xの投稿状況をご確認のうえサポートへお問い合わせください。
        </p>
      ) : null}
    </div>
  );
}

function PublishButton({
  disabled,
  onConfirm,
}: {
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button disabled={disabled} size="sm" type="button" />}>
        投稿
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg outline-none">
          <AlertDialog.Title className="text-lg font-semibold">この内容で投稿しますか？</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            スレッドをXへ順に投稿します。途中で失敗した場合は、作成済みのポストを自動で削除します。
            <span className="font-medium text-foreground">削除したポストはX上で復元できません。</span>
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close onClick={onConfirm} render={<Button size="lg" type="button" />}>
              投稿する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
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
