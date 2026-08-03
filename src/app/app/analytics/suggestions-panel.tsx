"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { refreshSuggestionsAction } from "@/app/actions/suggestions";
import { useToast } from "@/components/ui/toast";
import type { SuggestionDisplay } from "@/lib/analytics-server";
import { formatJst } from "@/lib/format";
import { CardTitle } from "@/components/ui/card";

/**
 * SC-09 改善提案（表示専用, K-2, 要件06 §10, PRD 5.6, T-M5-19）。「提案を更新」でSUGGESTを起動し、生成中を
 * 表示、最新提案（content＋evidence: 対象投稿リンク/本文冒頭・metric・checkpoint・diff_pct・summary）を出す。
 * 承認・却下・自動反映は存在しない。拒否理由（1日1回・新metricsなし・前提不足）と、実績不足時の必要件数、
 * 「発信設定やベースmd編集（md/premium）で自ら反映する」案内を表示する。
 */

const SUGGEST_MIN_GROUP = 3;
/** 生成中の自動再取得（間隔・上限）。上限に達したら手動の「再読み込み」へ委ねる。 */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX = 24;

/** 分析軸を画面表記へ（要件06 §8: 画面に内部用語を出さない）。 */
const AXIS_LABEL: Record<string, string> = {
  pattern_time: "型と時間帯",
  length: "投稿の長さ",
  line_blocks: "改行の入れ方",
  image: "画像の有無",
  url: "本文のURL",
};

/** 内部の metric キーを画面表記へ（要件06 §8: 画面に内部用語を出さない）。 */
const METRIC_LABEL: Record<string, string> = {
  impressions: "表示回数",
  likes: "いいね",
  reposts: "リポスト",
  profile_clicks: "プロフィール表示",
};

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
  const toast = useToast();
  const [polls, setPolls] = useState(0);

  // 生成中は完了まで自動で取り直す（利用者に手動再読み込みを強いない）。上限で自動停止し、
  // 以降は手動の「再読み込み」に委ねる。カウンタは「提案を更新」を押したときにリセットする。
  const polling = generating && polls < POLL_MAX;
  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [polling, polls, router]);

  function refresh() {
    startTransition(async () => {
      const res = await refreshSuggestionsAction({ request_key: uuid() });
      if (res.status === "success") {
        // 進行中であること自体は見出し横の「生成中…」が出し続ける（トーストは5秒で消える）。
        toast.show({
          tone: "success",
          title: "改善提案の生成を始めました",
          description: "完了すると自動で表示に反映されます。",
        });
        setPolls(0);
        router.refresh();
      } else {
        toast.show({ tone: "error", title: "更新できませんでした", description: rejectionMessage(res) });
      }
    });
  }

  // listSuggestions は created_at 昇順のため、最終更新は最大値を採る。
  const latestAt = suggestions.reduce<string | null>(
    (max, s) => (max === null || s.createdAt > max ? s.createdAt : max),
    null,
  );

  return (
    <section className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>改善提案</CardTitle>
        {generating ? (
          <span
            aria-live="polite"
            className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {polling ? "生成中…（完了すると自動で表示されます）" : "生成中…"}
          </span>
        ) : latestAt ? (
          <span className="text-xs text-muted-foreground">最終更新 {formatJst(latestAt)}</span>
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
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={pending || generating}
            onClick={refresh}
            type="button"
          >
            提案を更新
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        提案は表示専用です。承認・却下や自動反映は行いません。内容は発信設定や、ベースmd編集（mdプラン・プレミアムプラン）でご自身で反映してください。
      </p>

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
            <li className="rounded-card border border-hairline bg-surface p-4" key={i}>
              <p className="text-sm font-medium">{s.content}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {s.axis ? (
                  <span className="rounded bg-muted px-2 py-0.5">
                    {AXIS_LABEL[s.axis] ?? s.axis}
                  </span>
                ) : null}
                <span className="rounded bg-muted px-2 py-0.5">
                  {METRIC_LABEL[s.metric] ?? s.metric}
                </span>
                {s.checkpointDays !== null ? (
                  <span className="rounded bg-muted px-2 py-0.5">投稿後{s.checkpointDays}日の実績</span>
                ) : null}
                {s.diffPct !== null ? <span className="rounded bg-muted px-2 py-0.5">差 {s.diffPct}%</span> : null}
              </div>
              {s.summary ? <p className="mt-2 text-sm text-muted-foreground">{s.summary}</p> : null}
              {s.posts.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">根拠にした投稿</p>
                  <ul className="mt-1 space-y-1">
                    {s.posts.map((p) => (
                      <li className="text-xs" key={p.tweetId}>
                        <a className="text-info-fg hover:underline" href={p.url} rel="noopener noreferrer" target="_blank">
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
