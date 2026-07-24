"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { refreshSuggestionsAction } from "@/app/actions/suggestions";
import type { SuggestionDisplay } from "@/lib/analytics-server";

/**
 * SC-09 改善提案（表示専用, K-2, 要件06 §10, PRD 5.6, T-M5-19）。「提案を更新」でSUGGESTを起動し、生成中を
 * 表示、最新提案（content＋evidence: 対象投稿リンク/本文冒頭・metric・checkpoint・diff_pct・summary）を出す。
 * 承認・却下・自動反映は存在しない。拒否理由（1日1回・新metricsなし・前提不足）と、実績不足時の必要件数、
 * 「発信設定やベースmd編集（md/premium）で自ら反映する」案内を表示する。
 */

const SUGGEST_MIN_GROUP = 3;

function uuid(): string {
  return crypto.randomUUID();
}

function rejectionMessage(res: { code?: string; details?: Record<string, unknown>; message?: string }): string {
  const reason = typeof res.details?.reason === "string" ? res.details.reason : undefined;
  if (res.code === "job_conflict") {
    switch (reason) {
      case "already_today":
        return "本日はすでに更新済みです。改善提案の更新は1日1回までです。";
      case "no_new_metrics":
        return "前回の更新以降、新しい実績データがありません。新しい計測が入ると更新できます。";
      case "active_suggestion_exists":
        return "提案を生成中です。完了までお待ちください。";
      case "too_many_active_jobs":
        return "実行中の処理が多いため、しばらくしてから再度お試しください。";
      case "x_account_mismatch":
        return "表示中のXアカウントが切り替わりました。ページを再読み込みしてください。";
      default:
        return res.message ?? "処理が競合しました。";
    }
  }
  return res.message ?? "改善提案を更新できませんでした。";
}

export function SuggestionsPanel({
  suggestions,
  generating,
  comparablePostCount,
}: {
  suggestions: SuggestionDisplay[];
  generating: boolean;
  comparablePostCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  function refresh() {
    startTransition(async () => {
      const res = await refreshSuggestionsAction({ request_key: uuid() });
      if (res.status === "success") {
        setNote({ kind: "info", text: "改善提案を生成中です。少し待ってから再読み込みしてください。" });
        router.refresh();
      } else {
        setNote({ kind: "error", text: rejectionMessage(res) });
      }
    });
  }

  return (
    <section className="rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">改善提案</h2>
        {generating ? (
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">生成中…</span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
            type="button"
          >
            再読み込み
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            disabled={pending || generating}
            onClick={refresh}
            type="button"
          >
            提案を更新
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        提案は表示専用です。承認・却下や自動反映は行いません。内容は発信設定や、ベースmd編集（md・premiumプラン）でご自身で反映してください。
      </p>

      {note ? (
        <p
          className={`mt-3 rounded-lg border px-4 py-2 text-sm ${
            note.kind === "error" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-sky-300 bg-sky-50 text-sky-950"
          }`}
        >
          {note.text}
        </p>
      ) : null}

      {suggestions.length === 0 ? (
        <div className="mt-4 rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {comparablePostCount < SUGGEST_MIN_GROUP ? (
            <>
              改善提案には、同じ計測時点（投稿後1日または7日）の実績がある投稿が{SUGGEST_MIN_GROUP}件以上必要です。
              <br />
              現在の対象投稿は {comparablePostCount} 件です。投稿を続けて実績が集まると提案が表示されます。
            </>
          ) : generating ? (
            "改善提案を生成中です。"
          ) : (
            "現時点で目立った改善提案はありません。投稿を続けると新しい観点が見つかることがあります。"
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {suggestions.map((s, i) => (
            <li className="rounded-xl border bg-background p-4" key={i}>
              <p className="text-sm font-medium">{s.content}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-2 py-0.5">{s.metric}</span>
                {s.checkpointDays !== null ? <span className="rounded bg-muted px-2 py-0.5">{s.checkpointDays}日checkpoint</span> : null}
                {s.diffPct !== null ? <span className="rounded bg-muted px-2 py-0.5">差 {s.diffPct}%</span> : null}
              </div>
              {s.summary ? <p className="mt-2 text-sm text-muted-foreground">{s.summary}</p> : null}
              {s.posts.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">根拠にした投稿</p>
                  <ul className="mt-1 space-y-1">
                    {s.posts.map((p) => (
                      <li className="text-xs" key={p.tweetId}>
                        <a className="text-sky-700 hover:underline" href={p.url} rel="noopener noreferrer" target="_blank">
                          {p.body ? `${p.body}${p.body.length >= 100 ? "…" : ""}` : `投稿 ${p.tweetId}`}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
