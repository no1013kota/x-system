"use client";

import { useTransition } from "react";

import { Icon } from "@/components/ui/icon";

/**
 * ログアウト（PRD A-2・要件03 §1「Supabase sessionを破棄し `/login` へ遷移」）。
 *
 * `signOut` Server Action が session破棄後に `/login` へ redirect するため、遷移先の判断は
 * ここに持たない。押した直後に無効化して二重送信を防ぐ（redirect完了まで数百ms空く）。
 *
 * ラベルは狭い幅で隠れるが、`aria-label` で常に読み上げられる（ヘッダの他の操作と同じ方式）。
 */
export function SignOutButton({
  label = true,
  signOutAction,
}: {
  label?: boolean;
  signOutAction: () => Promise<never>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      aria-label="ログアウト"
      className="inline-flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-card px-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
      disabled={pending}
      onClick={() => startTransition(async () => void (await signOutAction()))}
      type="button"
    >
      <Icon name="output" size={20} />
      {label ? (
        <span className="hidden md:inline">{pending ? "ログアウトしています…" : "ログアウト"}</span>
      ) : (
        <span>{pending ? "ログアウトしています…" : "ログアウト"}</span>
      )}
    </button>
  );
}
