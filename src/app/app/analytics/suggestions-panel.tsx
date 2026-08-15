"use client";

import Link from "next/link";
import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import type { SuggestionDisplay } from "@/lib/analytics-server";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import { postThemeLabel } from "@/lib/post/post-theme";
import { CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * SC-09 分析レポート（表示専用, K-2, 要件06 §8, PRD §5.6, T-M8-94）。
 *
 * **毎朝8:00 JSTに自動で生成される**（手動の「提案を更新」は 2026-08-15 に廃止・運営者の指示）。
 * 内容: ①良かった投稿の特徴（総評＋投稿リンクと理由）②近づけるための設定
 * （推奨の型・テーマ・画像有無・そのまま貼れるプロンプト全文）。
 *
 * 承認・却下・自動反映は存在しない（PRD §10「自動反映しない」）。
 * プロンプトの保存先（AI設定＞プロンプト）は mdプラン以上のため、standard には全文を出さず
 * 案内だけ出す（貼り先の無い文字列を渡さない）。
 */

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
  needsAiKey = false,
}: {
  suggestions: SuggestionDisplay[];
  generating: boolean;
  plan: "standard" | "md" | "premium";
  /** BYOKでvalidなAIキーが無い＝毎朝の分析が始まらない状態（T-M8-95。登録導線を出す）。 */
  needsAiKey?: boolean;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

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
        <CardTitle>分析レポート</CardTitle>
        {generating ? (
          <Badge aria-live="polite" tone="info">
            分析中…
          </Badge>
        ) : latestAt ? (
          <span className="text-xs text-muted-foreground">最終更新 {formatJst(latestAt)}</span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        毎朝8時ごろ、Xへ投稿したポスト（このアプリで作った投稿に限りません）を自動で取得・分析します。
        操作は不要です。
      </p>

      {suggestions.length === 0 ? (
        <div className="mt-4 rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {generating ? (
            "投稿を分析しています。しばらくすると、ここに結果が表示されます。"
          ) : needsAiKey ? (
            // BYOKはAIキーが無いと毎朝の分析jobがそもそも作られない（起票側のゲート）。
            // 「待っていれば出る」ように見せず、始まらない理由と直し方を出す（原則1）。
            <>
              分析にはAIのAPIキーが必要です。
              <Link className="mx-1 text-info-fg hover:underline" href="/app/settings?tab=api-keys">
                設定のAPIキー
              </Link>
              から登録すると、毎朝8時ごろの自動分析が始まります。
            </>
          ) : (
            "まだレポートがありません。毎朝8時ごろに自動で作られます（直近に投稿が無い場合は作られません）。"
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {suggestions.map((s, i) => (
            <li className="rounded-card border border-hairline bg-surface p-4" key={i}>
              {/* 総評（良かった投稿の特徴）。 */}
              <p className="text-sm font-medium leading-6">{s.content}</p>

              {s.kind === "legacy" ? (
                // 旧形式（〜2026-08-15の軸ベース提案）。翌朝の自動実行で新形式に置き換わる。
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
