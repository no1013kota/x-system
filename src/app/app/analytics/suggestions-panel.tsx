"use client";

import Link from "next/link";
import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import type { SuggestionDisplay, SuggestionGoodPost } from "@/lib/analytics-server";
import { formatJst } from "@/lib/format";
import { legacyPatternLabel } from "@/lib/analytics/humanize-report";
import { postThemeLabel } from "@/lib/post/post-theme";
import { CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";

/**
 * SC-09 分析レポート（表示専用, K-2, 要件06 §8, PRD §5.6, T-M8-94）。
 *
 * **毎朝8:00 JSTに自動で生成される**（手動の「提案を更新」は 2026-08-15 に廃止・運営者の指示）。
 *
 * 画面は上から ①まとめ ②良かった投稿 ③近づけるための設定 の3段で、
 * **段ごとに番号付きの見出しを置く**（T-M8-114）。以前は総評・投稿リンク・推奨が
 * 同じ濃さの文字で続いていて、どこまでが何の話か読み取れなかった。
 *
 * 承認・却下・自動反映は存在しない（PRD §10「自動反映しない」）。
 * プロンプトの保存先（AI設定＞プロンプト）は mdプラン以上のため、standard には全文を出さず
 * 案内だけ出す（貼り先の無い文字列を渡さない）。
 */

/** 段の見出し。番号で順序を示し、本文と見た目を分ける。 */
function SectionHeading({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-caption font-semibold text-ink-3">
      <span
        aria-hidden="true"
        className="inline-flex size-5 flex-none items-center justify-center rounded-full bg-brand-subtle text-caption font-bold text-brand"
      >
        {step}
      </span>
      {children}
    </h3>
  );
}

/** 数値1つ。取得できていない値は「—」にして0と区別する（原則1）。 */
function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-ink-3">{label}</span>
      <span className="font-semibold tabular-nums text-ink">
        {value === null ? "—" : value.toLocaleString()}
      </span>
    </span>
  );
}

/**
 * 良かった投稿1件。
 *
 * **本文と数値をその場に出す**（T-M8-114）。以前は「この投稿を開く」というリンク1本だけで、
 * どの投稿の話なのかXを開くまで分からなかった。開かなくても分かるようにし、
 * 開く操作は右上のボタンへ独立させる。
 */
function GoodPostCard({ post }: { post: SuggestionGoodPost }) {
  const p = post.post;
  return (
    <li className="rounded-card border border-hairline bg-page p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {p ? (
            <p className="line-clamp-3 text-body leading-5 whitespace-pre-wrap text-ink">{p.text}</p>
          ) : (
            // 保存対象外・削除済みの投稿。理由だけは読めるので、行き止まりにしない。
            <p className="text-body leading-5 text-ink-3">
              この投稿の本文は保存されていません（Xで開くと確認できます）。
            </p>
          )}
        </div>
        <a
          className="inline-flex h-8 flex-none items-center gap-1 rounded-card border border-hairline bg-surface px-2.5 text-body font-medium text-ink transition-colors duration-150 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={post.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Icon name="open_in_new" size={14} />
          Xで開く
          <span className="sr-only">（新しいタブで開きます）</span>
        </a>
      </div>

      {p ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
          <Metric label="表示" value={p.impressions} />
          <Metric label="いいね" value={p.likes} />
          <Metric label="リポスト" value={p.reposts} />
          <Metric label="返信" value={p.replies} />
          {p.postedAt ? <span className="text-ink-3">{formatJst(p.postedAt)}</span> : null}
          {p.patternName ? <Badge tone="neutral">{p.patternName}</Badge> : null}
          {p.theme ? <Badge tone="neutral">{postThemeLabel(p.theme)}</Badge> : null}
          {p.hasImage ? <Badge tone="neutral">画像あり</Badge> : null}
        </div>
      ) : null}

      {post.why ? (
        <p className="mt-2 border-t border-hairline pt-2 text-body leading-5 text-ink-2">{post.why}</p>
      ) : null}
    </li>
  );
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

/** 貼って使う提案（アカウント.md・投稿作成プロンプト）の共通の器。 */
function ProposalBlock({
  title,
  reason,
  content,
  copied,
  onCopy,
  href,
  linkLabel,
}: {
  title: string;
  reason?: string;
  content: string;
  copied: boolean;
  onCopy: () => void;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mt-3 rounded-card border border-hairline bg-page p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-caption font-semibold text-ink-3">{title}</p>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-1 rounded-card border px-3 text-body font-medium transition-colors duration-150 hover:bg-accent"
            onClick={onCopy}
            type="button"
          >
            <Icon name={copied ? "check_circle" : "content_copy"} size={14} />
            {copied ? "コピーしました" : "コピー"}
          </button>
          <Link className="text-body text-info-fg hover:underline" href={href}>
            {linkLabel}
          </Link>
        </div>
      </div>
      {reason ? <p className="mt-2 text-body leading-5 text-ink-2">{reason}</p> : null}
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-card bg-surface p-3 text-xs leading-5 text-ink">
        {content}
      </pre>
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
  // 提案は2つ（アカウント.md・投稿作成プロンプト）あるため、どちらをコピーしたかを持つ（T-M8-106）。
  const [copied, setCopied] = useState<"account_md" | "prompt" | null>(null);

  /**
   * 提案全文のコピー（api-key-settings.tsx の callback URLコピーと同じ作法・T-M8-38）。
   * **失敗を黙って捨てない**——非セキュアコンテキスト・権限拒否で失敗するため、手動コピーへ誘導する。
   */
  async function copyProposal(target: "account_md" | "prompt", content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      toast.show({
        tone: "error",
        title: "コピーできませんでした",
        description: "全文を選択して手動でコピーしてください。",
      });
      return;
    }
    setCopied(target);
    window.setTimeout(() => setCopied(null), 2000);
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
            "まだレポートがありません。毎朝8時ごろに自動で作られます（Xに投稿が1件も無い場合は作られません）。"
          )}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {suggestions.map((s, i) => (
            <li className="rounded-card border border-hairline bg-surface p-4" key={i}>
              {/* ① まとめ。 */}
              <SectionHeading step={1}>まとめ</SectionHeading>
              <p className="mt-1.5 text-sm font-medium leading-6 text-ink">{s.content}</p>

              {s.kind === "legacy" ? (
                // 旧形式（〜2026-08-15の軸ベース提案）。翌朝の自動実行で新形式に置き換わる。
                s.legacySummary ? (
                  <p className="mt-2 text-sm text-muted-foreground">{s.legacySummary}</p>
                ) : null
              ) : (
                <>
                  {s.goodPosts.length > 0 ? (
                    <div className="mt-5">
                      <SectionHeading step={2}>良かった投稿</SectionHeading>
                      <ul className="mt-2 space-y-2">
                        {s.goodPosts.map((p) => (
                          <GoodPostCard key={p.tweetId} post={p} />
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {s.advice ? (
                    <div className="mt-5">
                      <SectionHeading step={3}>近づけるための設定</SectionHeading>
                      <p className="mt-1 text-caption text-ink-3">
                        投稿作成・スケジュールの画面で、そのまま選べます。
                      </p>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                        {s.advice.pattern ? (
                          <AdviceCard
                            label="投稿の型"
                            reason={s.advice.pattern.reason}
                            // 2026-08-18 以降は名前が入る。それ以前のレポートは内部IDなので直す。
                            value={legacyPatternLabel(s.advice.pattern.recommended)}
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

                      {(s.advice.prompt || s.advice.accountMd) && plan === "standard" ? (
                        // 貼り先（設定＞プロンプト）が mdプラン以上のため、standardには全文を出さない。
                        <p className="mt-3 rounded-card border border-hairline bg-page px-3.5 py-3 text-body leading-5 text-ink-2">
                          この特徴を毎回の生成に反映する編集提案（アカウント.md・投稿作成プロンプト）も用意しました。
                          <Link
                            className="text-info-fg hover:underline"
                            href="/app/settings?tab=prompts&sec=post-prompt"
                          >
                            プロンプトのカスタマイズ（mdプラン以上）
                          </Link>
                          で利用できます。
                        </p>
                      ) : null}

                      {/* アカウント.mdの編集提案（T-M8-106）。全パターン共通の土台なので先に出す。 */}
                      {s.advice.accountMd && plan !== "standard" ? (
                        <ProposalBlock
                          content={s.advice.accountMd.content}
                          copied={copied === "account_md"}
                          href="/app/settings?tab=prompts&sec=account-md"
                          linkLabel="設定で編集する"
                          onCopy={() => copyProposal("account_md", s.advice!.accountMd!.content)}
                          reason={s.advice.accountMd.reason}
                          title="アカウント.mdへの編集提案 — そのまま貼って保存できます"
                        />
                      ) : null}

                      {s.advice.prompt && plan !== "standard" ? (
                        <ProposalBlock
                          content={s.advice.prompt.content}
                          copied={copied === "prompt"}
                          href="/app/settings?tab=prompts&sec=post-prompt"
                          linkLabel="設定で保存する"
                          onCopy={() => copyProposal("prompt", s.advice!.prompt!.content)}
                          title={`投稿作成プロンプト（${legacyPatternLabel(
                            s.advice.prompt.kind,
                          )}）— そのまま貼って使えます`}
                        />
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
