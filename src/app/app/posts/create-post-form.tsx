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
import type { PrereqItem } from "@/lib/execution-prereqs";

export interface PatternOption {
  id: string;
  label: string;
  description: string;
}

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
const POLL_MS = 2500;
const QUEUED_SLOW_MS = 60_000;
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

interface ActionError {
  message: string;
  settingsPath?: string;
  missing?: PrereqItem[];
}

export function CreatePostForm({
  xAccountId,
  patterns,
  imageProviders,
  initialJob = null,
}: {
  xAccountId: string;
  patterns: PatternOption[];
  imageProviders: string[];
  initialJob?: ActiveJob | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState(patterns[0]?.id ?? "p1");
  const [sourceUrl, setSourceUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [userOpinion, setUserOpinion] = useState("");
  const [imageEnabled, setImageEnabled] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [job, setJob] = useState<ActiveJob | null>(initialJob);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 進行中のあいだ getGenerationJob をポーリングして状態を更新する（再訪時も initialJob から再開）。
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const timer = setInterval(async () => {
      setNowMs(Date.now());
      const res = await getGenerationJobAction({ job_id: job.id });
      if (res.status === "success" && res.job) {
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
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, job?.createdAt, job]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createGenerationJobAction({
        request_key: crypto.randomUUID(),
        x_account_id: xAccountId,
        pattern,
        source_url: sourceUrl.trim() || undefined,
        user_opinion: pattern === "p2" ? userOpinion.trim() || undefined : undefined,
        instructions: instructions.trim() || undefined,
        image_enabled: imageEnabled,
      });
      if (res.status === "error") {
        setError({
          message: res.message,
          settingsPath: res.details?.settingsPath as string | undefined,
          missing: res.details?.missing as PrereqItem[] | undefined,
        });
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
        setError({ message: res.message });
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
        setError({ message: res.message });
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 左ペイン: パターン選択＋入力 */}
      <section className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm" aria-label="生成入力">
        <div>
          <h2 className="text-sm font-medium">パターン</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {patterns.map((p) => (
              <label
                className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm ${
                  pattern === p.id ? "border-foreground bg-accent" : "hover:bg-accent/50"
                }`}
                key={p.id}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    checked={pattern === p.id}
                    className="sr-only"
                    name="pattern"
                    onChange={() => setPattern(p.id)}
                    type="radio"
                    value={p.id}
                  />
                  {p.label}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">{p.description}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium" htmlFor="source_url">
            参考URL（任意）
          </label>
          <input
            className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"
            id="source_url"
            inputMode="url"
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            value={sourceUrl}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            空欄のままでも、発信設定とベースmdからAIが題材を選んでリサーチします。
          </p>
        </div>

        {pattern === "p2" ? (
          <div>
            <label className="block text-sm font-medium" htmlFor="user_opinion">
              自分の考え（任意）
            </label>
            <textarea
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              id="user_opinion"
              maxLength={2000}
              onChange={(e) => setUserOpinion(e.target.value)}
              rows={3}
              value={userOpinion}
            />
          </div>
        ) : null}

        <div>
          <label className="block text-sm font-medium" htmlFor="instructions">
            追加指示（任意）
          </label>
          <textarea
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            id="instructions"
            maxLength={2000}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            value={instructions}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
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

        <Button disabled={pending || inProgress} onClick={submit} size="lg" type="button">
          {inProgress ? "生成中…" : pending ? "生成を開始しています…" : "生成する"}
        </Button>
      </section>

      {/* 右ペイン: プレビュー・結果 */}
      <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm" aria-label="プレビュー・結果">
        <h2 className="text-sm font-medium">結果</h2>

        {error ? (
          error.settingsPath ? (
            <ExecutionPrereqNotice
              message={error.message}
              missing={error.missing}
              settingsPath={error.settingsPath}
            />
          ) : (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
              {error.message}
            </p>
          )
        ) : null}

        {inProgress ? (
          <div aria-live="polite" className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
              <p>
                生成には通常60〜90秒かかります。この画面を離れても生成は続き、完了すると「下書き」タブに追加されます。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">経過 {elapsedLabel}</p>
            </div>
            <ol className="space-y-1.5 text-sm">
              {STAGE_ORDER.filter((s) => s !== "image" || imageEnabled).map((stage) => {
                const active = job?.progressStage === stage;
                const done =
                  job?.progressStage != null &&
                  STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(job.progressStage);
                return (
                  <li
                    className={`flex items-center gap-2 ${
                      active ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                    }`}
                    key={stage}
                  >
                    <span aria-hidden="true">{done ? "✓" : active ? "…" : "○"}</span>
                    {STAGE_LABEL[stage]}
                  </li>
                );
              })}
            </ol>
            {queuedSlow ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                開始が遅れています。自動で再開されます（最大5分）。
              </p>
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
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
              生成が完了し、下書きを作成しました。
            </p>
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
              href="/app/posts?tab=drafts"
            >
              下書きを確認する
            </Link>
          </div>
        ) : null}

        {job?.status === "failed" ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900" role="alert">
              {job.error?.message ?? "生成に失敗しました。時間をおいて再試行してください。"}
            </p>
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
                className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
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

        {!error && job === null ? (
          <p className="text-sm text-muted-foreground">
            パターンと入力を選んで「生成する」を押すと、ここに生成結果が表示されます。生成される内容は毎回変わります。まず1本作って、下書きで編集するか、追加指示を付けて再生成してください。
          </p>
        ) : null}
      </section>
    </div>
  );
}
