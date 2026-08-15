"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { refreshSuggestionsAction } from "@/app/actions/suggestions";
import { useToast } from "@/components/ui/toast";
import type { SuggestionDisplay } from "@/lib/analytics-server";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import { postThemeLabel } from "@/lib/post/post-theme";
import { CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * SC-09 改善提案（表示専用, K-2, 要件06 §8, PRD §5.6, T-M8-91）。
 *
 * 2026-08-15 刷新: 「提案を更新」でXタイムラインの直近30日の全投稿（Exos製かに依らない）を分析し、
 * ①良かった投稿の特徴（総評＋投稿リンクと理由）②実行可能なアドバイス（推奨の型・テーマ・画像有無・
 * **そのまま貼れるプロンプト全文**）を表示する。固定の分析軸・実績3件の下限は廃止した。
 *
 * 承認・却下・自動反映は存在しない（PRD §10「改善提案は自動反映しない」）。
 * プロンプトの保存先（AI設定＞プロンプト）は mdプラン以上のため、standard にはプロンプト全文を
 * 出さず案内だけ出す（貼り先の無い文字列を渡さない）。
 */

/** 生成中の自動再取得（間隔・上限）。上限に達したら手動の「再読み込み」へ委ねる。 */
const POLL_INTERVAL_MS = 5000;
const POLL_MAX = 24;

function uuid(): string {
  return crypto.randomUUID();
}

function rejectionMessage(res: { code?: string; details?: Record<string, unknown>; message?: string }): string {
  const reason = typeof res.details?.reason === "string" ? res.details.reason : undefined;
  if (res.code === "job_conflict") {
    switch (reason) {
      case "already_today":
        return "本日はすでに更新済みです。改善提案の更新は1日1回までです。";
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

/** アドバイス1枚（推奨値＋理由）。 */
function AdviceCard({ label, value, reason }: { label: string; value: string; reason: string }) {
  return (
    <div className="rounded-card border border-hairline bg-page px-3.5 py-3">
      <dt className="text-caption text-ink-3">{label}</dt>
      <dd className="mt-0.5">
        <span className="font-bold text-ink">{value}</span>
        <span className="mt-0.5 block text-body leading-5 text-ink-2">{reason}</span>
      </dd>
    </div>
  );
}

export function SuggestionsPanel({
  suggestions,
  generating,
  plan,
}: {
  suggestions: SuggestionDisplay[];
  generating: boolean;
  plan: "standard" | "md" | "premium";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const [polls, setPolls] = useState(0);
  const [copied, setCopied] = useState(false);

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
        toast.show({
          tone: "success",
          title: "分析を始めました",
          description: "直近30日の投稿を分析します。完了すると自動で表示に反映されます。",
        });
        setPolls(0);
        router.refresh();
      } else {
        toast.show({ tone: "error", title: "更新できませんでした", description: rejectionMessage(res) });
      }
    });
  }

  /**
   * プロンプト全文のコピー（api-key-settings.tsx の callback URLコピーと同じ作法・T-M8-38）。
   * **失敗を黙って捨てない**——非セキュアコンテキスト・権限拒否で失敗するため、手動コピーへ誘導する。
   */
  async function copyPrompt(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      toast.show({
        tone: "error",
        title: "コピーできませんでした",
        description: "プロンプト全文を選択して手動でコピーしてください。",
      });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
          <Badge aria-live="polite" tone="info">
            分析中…
          </Badge>
        ) : latestAt ? (
          <span className="text-xs text-muted-foreground">最終更新 {formatJst(latestAt)}</span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button
            className="inline-flex h-9 items-center rounded-card border px-4 text-body font-medium transition-colors duration-150 hover:bg-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
            type="button"
          >
            再読み込み
          </button>
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={pending || generating}
            onClick={refresh}
            type="button"
          >
            提案を更新
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        直近30日にXへ投稿したポストを分析します（このアプリで作った投稿に限りません）。更新は1日1回までです。
      </p>

      {suggestions.length === 0 ? (
        <div className="mt-4 rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {generating
            ? "投稿を分析しています。"
            : "まだ提案がありません。「提案を更新」を押すと、直近30日の投稿から良かった投稿の特徴と設定のアドバイスを作ります（直近30日に投稿が無い場合、提案は作られません）。"}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {suggestions.map((s, i) => (
            <li className="rounded-card border border-hairline bg-surface p-4" key={i}>
              {/* 総評（良かった投稿の特徴）。 */}
              <p className="text-sm font-medium leading-6">{s.content}</p>

              {s.kind === "legacy" ? (
                // 旧形式（〜2026-08-15の軸ベース提案）。次の「提案を更新」で新形式に置き換わる。
                s.legacySummary ? (
                  <p className="mt-2 text-sm text-muted-foreground">{s.legacySummary}</p>
                ) : null
              ) : (
                <>
                  {s.goodPosts.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-muted-foreground">良かった投稿</p>
                      <ul className="mt-1 space-y-1.5">
                        {s.goodPosts.map((p) => (
                          <li className="text-body leading-5" key={p.tweetId}>
                            <a
                              className="text-info-fg hover:underline"
                              href={p.url}
                              rel="noopener noreferrer"
                              target="_blank"
                            >
                              この投稿を開く
                            </a>
                            <span className="ml-1.5 text-ink-2">{p.why}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {s.advice ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground">
                        近づけるための設定（投稿作成・スケジュールで選べます）
                      </p>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                        {s.advice.pattern ? (
                          <AdviceCard
                            label="投稿の型"
                            reason={s.advice.pattern.reason}
                            value={POST_PATTERN_LABELS[s.advice.pattern.recommended] ?? s.advice.pattern.recommended}
                          />
                        ) : null}
                        {s.advice.theme ? (
                          <AdviceCard
                            label="テーマ"
                            reason={s.advice.theme.reason}
                            value={postThemeLabel(s.advice.theme.recommended)}
                          />
                        ) : null}
                        {s.advice.image ? (
                          <AdviceCard
                            label="画像"
                            reason={s.advice.image.reason}
                            value={s.advice.image.recommended ? "付ける" : "付けない"}
                          />
                        ) : null}
                      </dl>

                      {s.advice.prompt ? (
                        plan === "standard" ? (
                          // 貼り先（AI設定＞プロンプト）が mdプラン以上のため、standardには全文を出さない。
                          <p className="mt-3 rounded-card border border-hairline bg-page px-3.5 py-3 text-body leading-5 text-ink-2">
                            この特徴を毎回の生成に反映する専用プロンプトも用意しました。
                            <Link className="text-info-fg hover:underline" href="/app/ai-settings?tab=prompts">
                              プロンプトのカスタマイズ（mdプラン以上）
                            </Link>
                            で利用できます。
                          </p>
                        ) : (
                          <div className="mt-3 rounded-card border border-hairline bg-page p-3.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-caption font-semibold text-ink-3">
                                プロンプト（
                                {POST_PATTERN_LABELS[s.advice.prompt.kind] ?? s.advice.prompt.kind}
                                ）— そのまま貼って使えます
                              </p>
                              <div className="ml-auto flex items-center gap-2">
                                <button
                                  className="inline-flex h-8 items-center rounded-card border px-3 text-body font-medium transition-colors duration-150 hover:bg-accent"
                                  onClick={() => copyPrompt(s.advice!.prompt!.content)}
                                  type="button"
                                >
                                  {copied ? "コピーしました" : "コピー"}
                                </button>
                                <Link
                                  className="text-body text-info-fg hover:underline"
                                  href="/app/ai-settings?tab=prompts"
                                >
                                  AI設定で保存する
                                </Link>
                              </div>
                            </div>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-card bg-surface p-3 text-xs leading-5 text-ink">
                              {s.advice.prompt.content}
                            </pre>
                          </div>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
