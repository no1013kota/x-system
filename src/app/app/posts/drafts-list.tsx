"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import dynamic from "next/dynamic";
import { WARNING_LABEL, warningSummary } from "@/lib/post/warning-labels";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  cloneFailedDraftForRetryAction,
  discardDraftAction,
  reconcileDraftPostingAction,
} from "@/app/actions/drafts";
import { DraftImagePanel } from "./draft-image-panel";
import {
  ScheduleDraftPanel,
  ScheduleDraftToggle,
  scheduledLabel,
} from "./schedule-draft-control";
import {
  getGenerationJobAction,
  publishDraftAction,
  regenerateDraftAction,
} from "@/app/actions/generation-jobs";
import { EmptyNotice } from "@/components/app-shell/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardClassName, cardTitleClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { createPollGuard, POLL_INTERVAL_MS, pollGiveUpMessage } from "@/lib/ui/poll-guard";
import { useToast } from "@/components/ui/toast";
import type { DraftView } from "@/lib/drafts";
import { draftActionState } from "@/lib/post/draft-actions";
import {
  alertDialogBackdropClassName,
  alertDialogPopupClassName,
} from "@/components/ui/alert-dialog-classes";

/**
 * 下書きエディタは**編集を開いたときに初めて読み込む**（T-M8-68）。
 * 文字数計算に使う `twitter-text` が約1.2MBあり、静的importだと下書き一覧を開くだけで
 * 落ちてくる。編集は一覧を見るたびに行う操作ではないため、初期表示の重さに見合わない。
 */
const DraftEditor = dynamic(() => import("./draft-editor").then((m) => m.DraftEditor), {
  loading: () => (
    <p className="mt-3 rounded-lg border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
      編集画面を読み込んでいます…
    </p>
  ),
});

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

function WarningBadge({ code }: { code: string }) {
  return (
    <Badge tone="warn">{WARNING_LABEL[code] ?? code}</Badge>
  );
}

export function DraftsList({
  xAccountActive = true,
  xPremium = false,
  drafts,
  generatingJobs = [],
  selectedDraftId,
  imageRegenEnabled,
  quotePostEnabled,
}: {
  drafts: DraftView[];
  /** 操作中XアカウントのX Premium加入。文字数上限の緩和（T-M8-221）。 */
  xPremium?: boolean;
  /** 進行中の生成job（T-M8-209）。あるだけ先頭に「作成中」の枠を出す。 */
  generatingJobs?: { id: string; createdAt: string }[];
  selectedDraftId?: string;
  imageRegenEnabled: boolean;
  quotePostEnabled: boolean;
  /**
   * 対象Xアカウントが active か（T-M8-157）。この一覧は解決済みの選択中アカウントに
   * スコープされ、`resolveActiveXAccountForUser` が active のみ返すため既定は true。
   * 明示的に受けるのは、予約可否の理由を画面で出す判定に使うため。
   */
  xAccountActive?: boolean;
}) {
  if (drafts.length === 0 && generatingJobs.length === 0) {
    return (
      <EmptyNotice>
        未投稿の下書きはありません。「作成」タブから生成できます。
      </EmptyNotice>
    );
  }
  /*
   * 投稿に失敗した下書きは**専用の枠で先頭に集める**（T-M8-227・運営者の指示 2026-08-22）。
   * 対象は status=failed（X上に記録が残る失敗）と、Xへ出す前に差し戻された
   * status=draft＋last_post_error（理由つき）。予約・自動投稿の失敗はここに載り、
   * 各カードの保存済み理由（Notice）と既存の操作（編集・投稿・日時指定予約・再試行）で
   * やり直せる。別タブに分けないのは、失敗は見に行かないと気付けない場所に置かず、
   * 下書きの操作（編集・予約）と同じ場所で完結させるため（原則1）。
   */
  const failedDrafts = drafts.filter(
    (d) => d.status === "failed" || d.last_post_error != null,
  );
  const normalDrafts = drafts.filter((d) => !failedDrafts.includes(d));
  const cards = (list: DraftView[]) =>
    list.map((draft) => (
      <DraftCard
        draft={draft}
        highlighted={draft.id === selectedDraftId}
        imageRegenEnabled={imageRegenEnabled}
        key={draft.id}
        quotePostEnabled={quotePostEnabled}
        xAccountActive={xAccountActive}
        xPremium={xPremium}
      />
    ));
  return (
    <div className="space-y-4">
      {failedDrafts.length > 0 ? (
        <section
          aria-label="投稿に失敗した下書き"
          className="rounded-card border border-danger-fg/30 bg-danger-bg/30 p-3"
        >
          <h3 className="text-body font-bold text-danger-fg">投稿に失敗した下書き</h3>
          <p className="mt-0.5 text-caption leading-4 text-ink-2">
            各カードに失敗の理由が出ています。内容を確認して、編集・投稿・日時指定の予約をやり直せます。
          </p>
          <ul className="mt-3 space-y-4">{cards(failedDrafts)}</ul>
        </section>
      ) : null}
      <ul className="space-y-4">
        {/* 作成中の枠（T-M8-209・運営者の指示 2026-08-22）。完了すると次の読込で実物に置き換わる。 */}
        {generatingJobs.map((job) => (
          <li
            className={`${cardClassName} border-dashed p-4`}
            key={job.id}
          >
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-2.5 flex-none">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-brand opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-pill bg-brand" />
              </span>
              <p className="text-body font-medium text-ink">下書きを作成しています…</p>
              <span className="ml-auto text-caption text-ink-3">通常60〜90秒</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-pill bg-page">
              <div className="h-full w-[60%] animate-pulse rounded-pill [background-image:var(--brand-gradient)]" />
            </div>
          </li>
        ))}
        {cards(normalDrafts)}
      </ul>
    </div>
  );
}

function DraftCard({
  xAccountActive,
  xPremium,
  draft,
  highlighted,
  imageRegenEnabled,
  quotePostEnabled,
}: {
  draft: DraftView;
  highlighted: boolean;
  imageRegenEnabled: boolean;
  quotePostEnabled: boolean;
  xAccountActive: boolean;
  xPremium: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // 予約パネルの開閉はカードが持つ（T-M8-226。ボタン群の内側で開くとヘッダー行が折り返して崩れる）。
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [publishJobId, setPublishJobId] = useState<string | null>(null);

  // 下書きから決まる可否は純関数へ（T-M8-41）。`.tsx` は単体テストの網に入らないため、
  // 「Xに残ったポストをどう扱うか」のルールをここに置いておくとテストで守れない。
  const {
    cloneEligible,
    editable,
    hasCreationHistory,
    hasWarnings,
    autoPostBlocked,
    imageFailed,
    lengthExceeded,
    posting,
    quoteDisabled: p5Disabled,
    unresolvedPosting,
  } = draftActionState(draft, { quotePostEnabled, xPremium });
  // 画面の一時状態と合成する（ここだけは純関数に渡せない）。
  // 投稿中は編集・破棄・再生成・再投稿を無効化する。リロードしても復元できるよう status も見る（要件06 §7）。
  const publishing = pending || publishJobId !== null || posting;
  const warningLines = warningSummary(draft.thread);
  const locked = publishing || editing;

  function discard() {
    startTransition(async () => {
      const res = await discardDraftAction({
        draft_id: draft.id,
        expected_updated_at: draft.updated_at,
      });
      // 失敗を握り潰すと「押しても何も起きない」状態になるため理由を出す（T-M8-16）。
      if (res.status === "success") {
        toast.show({ tone: "success", title: "下書きを破棄しました" });
        router.refresh();
      } else {
        toast.show({ tone: "error", title: "破棄できませんでした", description: res.message });
      }
    });
  }

  function cloneForRetry() {
    startTransition(async () => {
      const res = await cloneFailedDraftForRetryAction({
        request_key: crypto.randomUUID(),
        draft_id: draft.id,
      });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "新しい下書きとして複製しました" });
        router.refresh();
      } else {
        toast.show({ tone: "error", title: "再試行できませんでした", description: res.message });
      }
    });
  }

  function publish() {
    startTransition(async () => {
      const res = await publishDraftAction({
        request_key: crypto.randomUUID(),
        draft_id: draft.id,
      });
      if (res.status !== "success" || !res.jobId) {
        toast.show({ tone: "error", title: "投稿を開始できませんでした", description: res.message });
        return;
      }
      setPublishJobId(res.jobId);
    });
  }

  // 投稿jobを終端までpoll。成功→履歴へ（refreshで下書きから消える）、失敗→下書きに残り通知。
  //
  // **取得できない状態が続いたら打ち切って伝える**（T-M8-51）。以前は失敗を黙って return して
  // いたため、通信やサーバーが継続的に失敗すると「投稿中…」が永遠に出たままトーストが1つも
  // 出なかった（進んでいるのか壊れているのか区別できない）。
  useEffect(() => {
    if (!publishJobId) return;
    const guard = createPollGuard();
    const timer = setInterval(async () => {
      const res = await getGenerationJobAction({ job_id: publishJobId });
      const ok = res.status === "success" && Boolean(res.job);
      if (guard.tick(ok) === "give-up") {
        clearInterval(timer);
        setPublishJobId(null);
        toast.show({ tone: "error", ...pollGiveUpMessage(guard.reason()) });
        router.refresh();
        return;
      }
      if (!ok || !res.job) return;
      if (!TERMINAL.has(res.job.status)) return;
      clearInterval(timer);
      setPublishJobId(null);
      if (res.job.status === "succeeded") {
        // これまで成功は無言で、押しても何が起きたか分からなかった（T-M8-16）。
        toast.show({
          tone: "success",
          title: "投稿しました",
          action: { href: "/app/posts?tab=history", label: "履歴で見る" },
        });
        router.refresh();
      } else {
        toast.show({
          tone: "error",
          title: "投稿に失敗しました",
          description: "下書きの状態をご確認ください。",
        });
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [publishJobId, router, toast]);

  return (
    <li
      className={`${cardClassName} scroll-mt-24 p-5 ${
        highlighted ? "ring-2 ring-ring" : ""
      }`}
      id={`draft-${draft.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{draft.pattern_name}</span>
          {draft.status === "failed" ? (
            <Badge tone="danger">失敗</Badge>
          ) : null}
          {/*
            止まる警告と止まらない警告を言い分ける（F2）。以前は警告が1つでもあれば
            「自動投稿は停止します」と出していたため、`length_over_target` のように
            止めない警告でも停止を名乗っていた（要件06 §4.3）。
          */}
          {hasWarnings ? (
            autoPostBlocked ? (
              <Badge tone="warn">警告あり（自動投稿は停止します）</Badge>
            ) : (
              <Badge tone="info">確認おすすめ（自動投稿は続きます）</Badge>
            )
          ) : null}
          {imageFailed ? <WarningBadge code="image_failed" /> : null}
          {/* 予約済みは日時ごと出す（T-M8-157）。いつ投稿されるかを開かずに分かるようにする。 */}
          {draft.status === "draft" && draft.scheduled_at ? (
            <Badge tone="info">{scheduledLabel(draft.scheduled_at)}</Badge>
          ) : null}
          {/* 更新日時の常時表示は置かない（運営者の指示 2026-08-22。タイトル横の現在日時に見えて紛らわしい）。 */}
        </div>
        {/* 状態テキストとボタンが同居する行。折り返せないと狭い幅で横にはみ出す（T-M8-70）。 */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {publishing ? (
            <span className="text-xs font-medium text-muted-foreground" role="status">
              投稿中…（この画面を離れても続きます）
            </span>
          ) : null}
          {p5Disabled ? (
            <span className="text-xs text-muted-foreground">
              引用ポスト機能は現在利用できません
            </span>
          ) : null}
          {editable && !editing && !publishing && !p5Disabled ? (
            <ScheduleDraftToggle
              disabled={locked}
              onToggle={() => setScheduleOpen((v) => !v)}
              open={scheduleOpen}
              scheduledAt={draft.scheduled_at}
            />
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
            lengthExceeded ? (
              <span className="text-xs text-warn-fg">
                280字を超えているポストがあります。編集してから投稿できます。
              </span>
            ) : (
              <PublishButton
                disabled={publishing}
                onConfirm={publish}
                warnings={warningLines}
              />
            )
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

      {/* 予約パネルはヘッダー行の下の独立した行（T-M8-226。ボタン群の中で開くと折り返して崩れる）。
          開閉ボタンが右端にあるため右揃えで置く（運営者の指示 2026-08-22）。 */}
      {scheduleOpen && editable && !editing && !publishing && !p5Disabled ? (
        <div className="mt-2 flex justify-end">
          <ScheduleDraftPanel
            disabled={locked}
            draftId={draft.id}
            onClose={() => setScheduleOpen(false)}
            scheduledAt={draft.scheduled_at}
            updatedAt={draft.updated_at}
            xAccountActive={xAccountActive}
          />
        </div>
      ) : null}

      {/*
        **保存された失敗理由をそのまま出す**（T-M8-51）。
        投稿実行は「2本目の本文が長すぎます…Xへの投稿は1件も行っていません」のように、
        何が起きて何をすればよいかを書いて保存している。ここで出さないと利用者へ届かず、
        汎用の失敗文しか見えない（「Xへ出ていない」が伝わらないと、Xを見に行くまで確認できない）。
      */}
      {draft.last_post_error?.message ? (
        <Notice className="mt-3" role="alert" tone="danger">
          {draft.last_post_error.message}
        </Notice>
      ) : null}

      {hasCreationHistory || unresolvedPosting ? (
        // 押せない理由と次の一手だけを書く。複製の仕組みの説明は読まなくても操作できる（T-M8-66）。
        <p className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
          Xに投稿された記録が残っているため、この下書きは破棄できません。
          {cloneEligible
            ? "「新しい下書きとして再試行」からやり直せます。"
            : "まずX上に残ったポストの扱いを確定してください。"}
        </p>
      ) : null}

      {unresolvedPosting ? <ReconcilePanel draftId={draft.id} /> : null}

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
        <DraftEditor draft={draft} onDone={() => setEditing(false)} xPremium={xPremium} />
      ) : (
        <ol className="mt-3 space-y-2">
          {draft.thread.map((post) => {
            /*
              画像は**ポストごとに1枚**（T-M8-398・運営者の指示 2026-09-01）。
              旧データ（post_local_id無し）は1ポスト目のものとして表示する。
            */
            const firstLocalId = draft.thread[0]?.local_id ?? "p1";
            const postImage = draft.images.find(
              (img) =>
                img.status === "ready" &&
                (img.post_local_id ?? firstLocalId) === post.local_id,
            );
            const postImageFailed = draft.images.some(
              (img) =>
                img.status === "failed" &&
                (img.post_local_id ?? firstLocalId) === post.local_id,
            );
            return (
              <li className="rounded-lg border bg-background p-3" key={post.local_id}>
                <p className="text-sm whitespace-pre-wrap">{post.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{post.weighted_length} / 280</span>
                  {post.warnings.map((w) => (
                    <WarningBadge code={w} key={w} />
                  ))}
                </div>
                {postImage || postImageFailed || editable ? (
                  <DraftImagePanel
                    canUpload={editable && !publishing}
                    draftId={draft.id}
                    enabled={imageRegenEnabled && !publishing && !p5Disabled}
                    failed={postImageFailed && !postImage}
                    hasImage={Boolean(postImage)}
                    imageUrl={postImage?.signed_url}
                    postLocalId={post.local_id}
                    uploaded={postImage?.provider === "upload"}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function RegenerateBox({ draftId, onDone }: { draftId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [instructions, setInstructions] = useState("");
  const toast = useToast();

  function run() {
    startTransition(async () => {
      const res = await regenerateDraftAction({
        request_key: crypto.randomUUID(),
        draft_id: draftId,
        additional_instructions: instructions.trim() || undefined,
      });
      if (res.status === "success") {
        toast.show({
          tone: "success",
          title: "再生成を開始しました",
          description: "完了すると、派生した下書きがこの一覧に並びます。",
        });
        onDone();
      } else {
        toast.show({ tone: "error", title: "再生成を開始できませんでした", description: res.message });
      }
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
      <label className="block text-xs font-medium" htmlFor={`regen-${draftId}`}>
        追加指示（任意）
      </label>
      <textarea
        className="w-full rounded-card border border-hairline px-3 py-2 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
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
    </div>
  );
}

function ReconcilePanel({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  // 再照合しても一意に確定できなかった場合に X リンク＋サポート導線を出す（要件06 §7）。
  const [needsManual, setNeedsManual] = useState(false);

  function reconcile() {
    startTransition(async () => {
      const res = await reconcileDraftPostingAction({ draft_id: draftId });
      if (res.status === "error") {
        toast.show({ tone: "error", title: "再照合できませんでした", description: res.message });
        return;
      }
      if (res.reconcileStatus === "posted") {
        toast.show({ tone: "success", title: "投稿済みと確認しました" });
        router.refresh(); // 履歴タブへ移動
        return;
      }
      const stillFailed = res.reconcileStatus === "still_failed";
      setNeedsManual(stillFailed);
      toast.show({
        tone: stillFailed ? "error" : "success",
        title: stillFailed ? "状態を確定できませんでした" : "状態を確定しました",
        description: res.message,
      });
      router.refresh();
    });
  }

  return (
    <Notice className="mt-3 space-y-2" tone="warn">
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
      {needsManual ? (
        <p className="text-xs text-muted-foreground">
          解決しない場合は、Xの投稿状況をご確認のうえサポートへお問い合わせください。
        </p>
      ) : null}
    </Notice>
  );
}

function PublishButton({
  disabled,
  onConfirm,
  warnings,
}: {
  disabled: boolean;
  onConfirm: () => void;
  /** 「2ポスト目: NG設定の語が含まれています」形式の警告要約。 */
  warnings: string[];
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={<Button disabled={disabled} size="sm" type="button" />}>
        投稿
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName()}>
          <AlertDialog.Title className={cardTitleClassName}>この内容で投稿しますか？</AlertDialog.Title>
          {warnings.length > 0 ? (
            <Notice className="mt-3" tone="warn">
              <p className="font-medium">注意: 次の警告があります</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {/* 失敗時のロールバックは実行後にバッジと失敗理由で伝わる。操作前に読ませない（T-M8-66）。 */}
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            スレッドをXへ順に投稿します。
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
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName()}>
          <AlertDialog.Title className={cardTitleClassName}>
            下書きを破棄しますか？
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            下書きと生成画像を削除します。この操作は取り消せません。
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button size="lg" type="button" variant="outline" />}>
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close
              onClick={onConfirm}
              render={<Button size="lg" type="button" variant="danger" />}
            >
              破棄する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
