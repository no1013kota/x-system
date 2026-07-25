import { CircleAlert, Inbox, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

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

const cardClassName =
  "rounded-2xl border border-dashed bg-card px-6 py-12 text-center shadow-sm";

/**
 * 軽量な空状態カード（破線枠・中央寄せ・muted の1行メッセージ）。アイコン付きの重量版
 * `EmptyState` と対で、一覧が空のときのインライン表示に使う。各一覧に手書きで重複していた
 * 同一マークアップの単一正本。
 */
export function EmptyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
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
      <LoaderCircle aria-hidden="true" className="mx-auto size-8 animate-spin text-muted-foreground" />
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
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
      <Inbox aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {actionHref && actionLabel ? (
        <Link
          className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
      <CircleAlert aria-hidden="true" className="mx-auto size-8 text-destructive" />
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {retry ? (
        <button
          className="mt-5 min-h-10 rounded-lg border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={retry}
          type="button"
        >
          もう一度試す
        </button>
      ) : null}
    </section>
  );
}
