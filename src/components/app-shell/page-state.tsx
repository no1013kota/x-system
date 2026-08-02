import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

interface StateProps {
  description: string;
  title: string;
}

interface ErrorStateProps extends StateProps {
  retry?: () => void;
}

interface EmptyStateProps extends StateProps {
  actionHref?: string;
  actionLabel?: string;
}

// 空状態はカード内 padding 44px・中央寄せ・灰円アイコン48px（デザイン §補助画面 E）。
const cardClassName =
  "rounded-card border border-hairline bg-surface px-6 py-11 text-center shadow-[var(--shadow-card)]";

/** 空状態・エラーの丸アイコン。周囲に淡い円を敷いて視線を集める。 */
function StateIcon({ name, tone = "neutral" }: { name: Parameters<typeof Icon>[0]["name"]; tone?: "neutral" | "danger" }) {
  return (
    <span
      className={`mx-auto grid size-12 place-items-center rounded-pill ${
        tone === "danger" ? "bg-danger-bg text-danger-fg" : "bg-black/[0.04] text-ink-3"
      }`}
    >
      <Icon name={name} size={24} />
    </span>
  );
}

/**
 * 軽量な空状態カード（破線枠・中央寄せ・muted の1行メッセージ）。アイコン付きの重量版
 * `EmptyState` と対で、一覧が空のときのインライン表示に使う。各一覧に手書きで重複していた
 * 同一マークアップの単一正本。
 */
export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-hairline bg-surface px-6 py-11 text-center text-[12.5px] leading-5 text-ink-2 shadow-[var(--shadow-card)]">
      {children}
    </div>
  );
}

export function LoadingState({
  description = "画面を準備しています。",
  title = "読み込み中",
}: Partial<StateProps>) {
  return (
    <div aria-live="polite" className={cardClassName} role="status">
      <Icon className="mx-auto animate-spin text-ink-3" name="progress_activity" size={28} />
      <p className="mt-4 text-[14px] font-bold text-ink">{title}</p>
      <p className="mt-2 text-[12.5px] leading-5 text-ink-2">{description}</p>
    </div>
  );
}

export function EmptyState({
  actionHref,
  actionLabel,
  description,
  title,
}: EmptyStateProps) {
  return (
    <section className={cardClassName}>
      <StateIcon name="drafts" />
      <h2 className="mt-3.5 text-[14px] font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-5 text-ink-2">
        {description}
      </p>
      {actionHref && actionLabel ? (
        <Link
          className="mt-4 inline-flex min-h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={actionHref}
        >
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}

export function ErrorState({ description, retry, title }: ErrorStateProps) {
  return (
    <section aria-live="assertive" className={cardClassName} role="alert">
      <StateIcon name="error" tone="danger" />
      <h2 className="mt-3.5 text-[14px] font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-lg text-[12.5px] leading-5 text-ink-2">
        {description}
      </p>
      {retry ? (
        <button
          className="mt-4 min-h-9 rounded-card border border-hairline px-4 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={retry}
          type="button"
        >
          もう一度試す
        </button>
      ) : null}
    </section>
  );
}
