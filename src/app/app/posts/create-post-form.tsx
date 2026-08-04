"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  cancelGenerationJobAction,
  createGenerationJobAction,
  getGenerationJobAction,
  retryGenerationJobAction,
} from "@/app/actions/generation-jobs";
import { ExecutionPrereqNotice } from "@/components/app-shell/execution-prereq-notice";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import type { PrereqItem } from "@/lib/execution-prereqs";
import { PatternRadioGroup } from "@/components/post/pattern-radio-group";
import type { PostPatternOption } from "@/lib/post/post-patterns";
import { POST_THEME_OPTIONS } from "@/lib/post/post-theme";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { createPollGuard, POLL_INTERVAL_MS, pollGiveUpMessage } from "@/lib/ui/poll-guard";

export interface ActiveJob {
  id: string;
  status: string;
  progressStage: string | null;
  draftId: string | null;
  createdAt: string;
  /** 失敗理由。表示するのは code と利用者向け message だけ（provider_raw_error は使わない）。 */
  error?: JobFailure | null;
}

export interface JobFailure {
  code: string | null;
  message: string | null;
}

/** job.error（jsonb）から表示に使う code / message だけを取り出す。 */
function toJobFailure(value: unknown): JobFailure | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { code?: unknown; message?: unknown };
  return {
    code: typeof raw.code === "string" ? raw.code : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

const STAGE_LABEL: Record<string, string> = {
  validating: "前提を確認しています",
  research: "情報をリサーチしています",
  writing: "本文を作成しています",
  image: "画像を生成しています",
};
const STAGE_ORDER = ["validating", "research", "writing", "image"];

/** 再試行しても直らない失敗（前提不足）。それぞれの設定画面へ誘導する。 */
const PREREQ_FAILURE_PATH: Record<string, string> = {
  subscription_required: "/app/settings?tab=billing",
  api_key_required: "/app/settings?tab=api-keys",
  x_account_required: "/app/settings?tab=x-accounts",
  persona_required: "/app/ai-settings?tab=persona",
};
const PREREQ_FAILURE_CODES = new Set(Object.keys(PREREQ_FAILURE_PATH));
const QUEUED_SLOW_MS = 60_000;
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * **前提が足りずに始められなかった**ときだけ画面へ残す（T-M8-18）。解決先へのリンクを伴い、
 * 直しに行って戻ってきたときにも見えている必要があるため、消えるトーストにはしない。
 * それ以外の「始められなかった」はトーストへ出す。
 */
interface PrereqError {
  message: string;
  settingsPath: string;
  missing?: PrereqItem[];
}

export function CreatePostForm({
  xAccountId,
  patterns,
  imageProviders,
  initialJob = null,
}: {
  xAccountId: string;
  patterns: PostPatternOption[];
  imageProviders: string[];
  initialJob?: ActiveJob | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState(patterns[0]?.id ?? "p1");
  const [sourceUrl, setSourceUrl] = useState("");
  /**
   * テーマ。**選択は必須**（2026-08-03 ユーザー判断）。空文字は「まだ選んでいない」状態で、
   * 生成ボタンを押せない状態にする（`lib/post/post-theme.ts` の判断）。
   */
  const [theme, setTheme] = useState("");
  const [instructions, setInstructions] = useState("");
  const [userOpinion, setUserOpinion] = useState("");
  const [imageEnabled, setImageEnabled] = useState(false);
  const [prereq, setPrereq] = useState<PrereqError | null>(null);
  const toast = useToast();
  const [job, setJob] = useState<ActiveJob | null>(initialJob);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 進行中のあいだ getGenerationJob をポーリングして状態を更新する（再訪時も initialJob から再開）。
  //
  // **取得できない状態が続いたら打ち切って伝える**（T-M8-51）。以前は失敗を黙って捨てて回り続けて
  // いたため、「生成中…」が永遠に出たままトーストが1つも出なかった。
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const guard = createPollGuard();
    const timer = setInterval(async () => {
      setNowMs(Date.now());
      const res = await getGenerationJobAction({ job_id: job.id });
      const ok = res.status === "success" && Boolean(res.job);
      if (guard.tick(ok) === "give-up") {
        clearInterval(timer);
        toast.show({ tone: "error", ...pollGiveUpMessage(guard.reason()) });
        return;
      }
      if (ok && res.job) {
        const nextJob = res.job;
        setJob((prev) => ({
          id: nextJob.id,
          status: nextJob.status,
          progressStage: nextJob.progress_stage,
          draftId: nextJob.draft_id,
          createdAt: prev?.createdAt ?? job.createdAt,
          error: toJobFailure(nextJob.error),
        }));
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, job?.createdAt, job, toast]);

  function submit() {
    setPrereq(null);
    startTransition(async () => {
      const res = await createGenerationJobAction({
        request_key: crypto.randomUUID(),
        x_account_id: xAccountId,
        pattern,
        source_url: sourceUrl.trim() || undefined,
        theme,
        user_opinion: pattern === "p2" ? userOpinion.trim() || undefined : undefined,
        instructions: instructions.trim() || undefined,
        image_enabled: imageEnabled,
      });
      if (res.status === "error") {
        const settingsPath = res.details?.settingsPath as string | undefined;
        if (settingsPath) {
          setPrereq({
            message: res.message,
            settingsPath,
            missing: res.details?.missing as PrereqItem[] | undefined,
          });
        } else {
          toast.show({ tone: "error", title: "生成を開始できませんでした", description: res.message });
        }
        return;
      }
      if (res.jobId) {
        setJob({
          id: res.jobId,
          status: "queued",
          progressStage: null,
          draftId: null,
          createdAt: new Date(nowMs).toISOString(),
        });
      }
    });
  }

  function retry() {
    if (!job) return;
    const failedId = job.id;
    startTransition(async () => {
      const res = await retryGenerationJobAction({
        request_key: crypto.randomUUID(),
        job_id: failedId,
      });
      if (res.status === "error") {
        toast.show({ tone: "error", title: "再試行できませんでした", description: res.message });
        return;
      }
      if (res.jobId) {
        setJob({
          id: res.jobId,
          status: "queued",
          progressStage: null,
          draftId: null,
          createdAt: new Date().toISOString(),
        });
      }
    });
  }

  function cancel() {
    if (!job) return;
    const jobId = job.id;
    startTransition(async () => {
      const res = await cancelGenerationJobAction({ job_id: jobId });
      if (res.status === "error") {
        toast.show({ tone: "error", title: "キャンセルできませんでした", description: res.message });
        return;
      }
      setJob((prev) => (prev ? { ...prev, status: res.jobStatus ?? "canceled" } : prev));
    });
  }

  const inProgress = job !== null && !TERMINAL.has(job.status);
  const elapsedSec = job ? Math.max(0, Math.floor((nowMs - new Date(job.createdAt).getTime()) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;
  const queuedSlow =
    job?.status === "queued" && nowMs - new Date(job.createdAt).getTime() > QUEUED_SLOW_MS;

  return (
    // デザインは入力→生成中→確認の**順に進む**1カラム（左右2ペインではない）。
    // 横に並べるとパターン6枚が潰れ、選びにくくなる（実測で3列が2列に落ちた）。
    <div className="space-y-3.5">
      {/* 入力（ステート1） */}
      <section
        aria-label="生成入力"
        className={`${cardClassName} space-y-5 p-5`}
      >
        {/*
          パターン選択はスケジュール画面と同じ部品を使う（T-M8-29）。
          同じものを選ぶ操作なので、画面によって見た目や情報量が変わらないようにする。
        */}
        <PatternRadioGroup
          name="pattern"
          onChange={setPattern}
          options={patterns}
          value={pattern}
        />

        <div>
          <label className="block text-[13px] font-medium text-ink" htmlFor="theme">
            テーマ
          </label>
          <select
            aria-describedby="theme-help"
            className="mt-1 h-10 w-full rounded-card border border-hairline bg-surface px-3 text-[13px] transition-colors duration-150 focus:border-brand focus:outline-none"
            id="theme"
            onChange={(e) => setTheme(e.target.value)}
            required
            value={theme}
          >
            <option value="">選択してください</option>
            {POST_THEME_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground" id="theme-help">
            そのテーマに絞って題材を探します。「AI設定 → 発信設定」の発信テーマと同じ選択肢です。
            決めずに書かせたいときは「その他」を選び、追加指示に書いてください。
          </p>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-ink" htmlFor="source_url">
            参考URL（任意）
          </label>
          <input
            className="mt-1 h-10 w-full rounded-card border border-hairline px-3 text-[13px] transition-colors duration-150 focus:border-brand focus:outline-none"
            id="source_url"
            inputMode="url"
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            value={sourceUrl}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            空欄のままでも、上のテーマと発信設定・ベースmdからAIが題材を選んでリサーチします。
          </p>
        </div>

        {pattern === "p2" ? (
          <div>
            <label className="block text-[13px] font-medium text-ink" htmlFor="user_opinion">
              自分の考え（任意）
            </label>
            <textarea
              className="mt-1 w-full rounded-card border border-hairline px-3 py-2 text-[13px] transition-colors duration-150 focus:border-brand focus:outline-none"
              id="user_opinion"
              maxLength={2000}
              onChange={(e) => setUserOpinion(e.target.value)}
              rows={3}
              value={userOpinion}
            />
          </div>
        ) : null}

        <div>
          <label className="block text-[13px] font-medium text-ink" htmlFor="instructions">
            追加指示（任意）
          </label>
          <textarea
            className="mt-1 w-full rounded-card border border-hairline px-3 py-2 text-[13px] transition-colors duration-150 focus:border-brand focus:outline-none"
            id="instructions"
            maxLength={2000}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            value={instructions}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input
              checked={imageEnabled}
              disabled={imageProviders.length === 0}
              onChange={(e) => setImageEnabled(e.target.checked)}
              type="checkbox"
            />
            画像を生成する
            {imageProviders.length === 0 ? (
              <span className="text-xs font-normal text-muted-foreground">
                （利用可能な画像AIキーがありません）
              </span>
            ) : null}
          </label>
          {imageEnabled ? (
            <p className="text-xs text-muted-foreground">
              画像を作るAIは、AI設定の「AI用途」で選んだものを使います。
            </p>
          ) : null}
        </div>

        {/* グラデーションは「AIが動く瞬間」の合図（デザイン §カラー）。ここ以外へ広げない。 */}
        <Button
          className="h-10 w-full gap-1.5 text-[13.5px]"
          disabled={pending || inProgress || !theme}
          onClick={submit}
          type="button"
          variant="gradient"
        >
          <Icon name="star_shine" size={17} />
          {inProgress ? "生成中…" : pending ? "生成を開始しています…" : "スレッドを生成する"}
        </Button>
        {/*
          **押せない理由を画面に出す**（T-M8-37）。無効化だけだと「なぜ押せないのか」が分からない。
          以前はテーマ未選択でも押せて、サーバ側の `z.enum` で弾かれ「入力内容を確認してください」
          という**どの項目が悪いか分からない**トーストが5秒で消えるだけだった。
        */}
        {!theme && !inProgress ? (
          <p className="text-[12px] text-ink-2">テーマを選ぶと生成できます。</p>
        ) : null}
      </section>

      {/* 結果（ステート2・3） */}
      <section aria-label="プレビュー・結果"
        className={`${cardClassName} space-y-4 p-5`}>
        <CardTitle>結果</CardTitle>

        {prereq ? (
          <ExecutionPrereqNotice
            message={prereq.message}
            missing={prereq.missing}
            settingsPath={prereq.settingsPath}
          />
        ) : null}

        {inProgress ? (
          <div aria-live="polite" className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
              <p>
                生成には通常60〜90秒かかります。この画面を離れても生成は続き、完了すると「下書き」タブに追加されます。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">経過 {elapsedLabel}</p>
            </div>
            {/* 進捗ステップ（デザイン §画面一覧 3.投稿作成 ステート2）。完了=緑チェック／実行中=キー色の脈動／待機=灰丸。 */}
            <ol className="space-y-1.5">
              {STAGE_ORDER.filter((s) => s !== "image" || imageEnabled).map((stage) => {
                const active = job?.progressStage === stage;
                const done =
                  job?.progressStage != null &&
                  STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(job.progressStage);
                return (
                  <li
                    className={`flex items-center gap-2 text-[13px] ${
                      active ? "font-medium text-ink" : done ? "text-ink-2" : "text-ink-3"
                    }`}
                    key={stage}
                  >
                    {done ? (
                      <Icon className="text-success-icon" filled name="check_circle" size={16} />
                    ) : active ? (
                      <Icon className="animate-pulse text-brand" name="progress_activity" size={16} />
                    ) : (
                      <Icon className="text-ink-3/60" name="radio_button_unchecked" size={16} />
                    )}
                    {STAGE_LABEL[stage]}
                  </li>
                );
              })}
            </ol>
            {queuedSlow ? (
              <Notice tone="warn" role="status">
                開始が遅れています。自動で再開されます（最大5分）。
              </Notice>
            ) : null}
            {job?.status === "queued" ? (
              <Button disabled={pending} onClick={cancel} size="sm" type="button" variant="outline">
                生成をキャンセル
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                生成が始まっているため、途中で止めることはできません。完了までお待ちください。
              </p>
            )}
          </div>
        ) : null}

        {job?.status === "succeeded" ? (
          <div className="space-y-3">
            <Notice tone="success" role="status">
              生成が完了し、下書きを作成しました。
            </Notice>
            <Link
              className={primaryLinkClassName}
              href="/app/posts?tab=drafts"
            >
              下書きを確認する
            </Link>
          </div>
        ) : null}

        {job?.status === "failed" ? (
          <div className="space-y-3">
            <Notice role="alert" tone="danger">
              {job.error?.message ?? "生成に失敗しました。時間をおいて再試行してください。"}
            </Notice>
            {/* 押しても直らない再試行は出さない。上限到達・前提不足はそれぞれの解決先へ送る。 */}
            {job.error?.code === "usage_limit_exceeded" ? (
              <Link
                className="inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium"
                href="/app/settings?tab=billing"
              >
                利用状況とプランを確認する
              </Link>
            ) : PREREQ_FAILURE_CODES.has(job.error?.code ?? "") ? (
              <Link
                className={primaryLinkClassName}
                href={PREREQ_FAILURE_PATH[job.error?.code ?? ""] ?? "/app/settings"}
              >
                設定を確認する
              </Link>
            ) : (
              <Button disabled={pending} onClick={retry} size="lg" type="button" variant="outline">
                再試行する
              </Button>
            )}
          </div>
        ) : null}

        {!prereq && job === null ? (
          <p className="text-sm text-muted-foreground">
            パターンと入力を選んで「生成する」を押すと、ここに生成結果が表示されます。生成される内容は毎回変わります。まず1本作って、下書きで編集するか、追加指示を付けて再生成してください。
          </p>
        ) : null}
      </section>
    </div>
  );
}
