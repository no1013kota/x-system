"use client";

import { useState, useTransition } from "react";

import { createGenerationJobAction } from "@/app/actions/generation-jobs";
import { ExecutionPrereqNotice } from "@/components/app-shell/execution-prereq-notice";
import { Button } from "@/components/ui/button";
import type { PrereqItem } from "@/lib/execution-prereqs";

export interface PatternOption {
  id: string;
  label: string;
  description: string;
}

const IMAGE_PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  google: "Google (Gemini)",
};

interface ActionError {
  message: string;
  settingsPath?: string;
  missing?: PrereqItem[];
}

export function CreatePostForm({
  xAccountId,
  patterns,
  imageProviders,
}: {
  xAccountId: string;
  patterns: PatternOption[];
  imageProviders: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState(patterns[0]?.id ?? "p1");
  const [sourceUrl, setSourceUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [userOpinion, setUserOpinion] = useState("");
  const [imageEnabled, setImageEnabled] = useState(false);
  const [imageProvider, setImageProvider] = useState(imageProviders[0] ?? "");
  const [error, setError] = useState<ActionError | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);

  function submit() {
    setError(null);
    setStartedJobId(null);
    startTransition(async () => {
      const res = await createGenerationJobAction({
        request_key: crypto.randomUUID(),
        x_account_id: xAccountId,
        pattern,
        source_url: sourceUrl.trim() || undefined,
        user_opinion: pattern === "p2" ? userOpinion.trim() || undefined : undefined,
        instructions: instructions.trim() || undefined,
        image_enabled: imageEnabled,
        image_provider: imageEnabled && imageProvider ? imageProvider : undefined,
      });
      if (res.status === "error") {
        setError({
          message: res.message,
          settingsPath: res.details?.settingsPath as string | undefined,
          missing: res.details?.missing as PrereqItem[] | undefined,
        });
        return;
      }
      setStartedJobId(res.jobId ?? null);
    });
  }

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
          {imageEnabled && imageProviders.length > 0 ? (
            <select
              aria-label="画像プロバイダ"
              className="h-10 w-full max-w-xs rounded-lg border px-3 text-sm"
              onChange={(e) => setImageProvider(e.target.value)}
              value={imageProvider}
            >
              {imageProviders.map((p) => (
                <option key={p} value={p}>
                  {IMAGE_PROVIDER_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <Button disabled={pending} onClick={submit} size="lg" type="button">
          {pending ? "生成を開始しています…" : "生成する"}
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
        {startedJobId ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
            生成を開始しました。進捗と結果はまもなくここに表示されます。
          </p>
        ) : null}
        {!error && !startedJobId ? (
          <p className="text-sm text-muted-foreground">
            パターンと入力を選んで「生成する」を押すと、ここに生成結果が表示されます。
          </p>
        ) : null}
      </section>
    </div>
  );
}
