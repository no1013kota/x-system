"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

import { signOut } from "@/app/actions/auth";

/**
 * ログアウト（PRD A-2・要件03 §1「Supabase sessionを破棄し `/login` へ遷移」）。
 *
 * `signOut` Server Action が session破棄後に `/login` へ redirect するため、遷移先の判断は
 * ここに持たない。押した直後に無効化して二重送信を防ぐ（redirect完了まで数百ms空く）。
 *
 * ラベルは狭い幅で隠れるが、`aria-label` で常に読み上げられる（ヘッダの他の操作と同じ方式）。
 */
export function SignOutButton({ label = true }: { label?: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      aria-label="ログアウト"
      className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60"
      disabled={pending}
      onClick={() => startTransition(async () => void (await signOut()))}
      type="button"
    >
      <LogOut aria-hidden="true" className="size-5" />
      {label ? (
        <span className="hidden md:inline">{pending ? "ログアウトしています…" : "ログアウト"}</span>
      ) : (
        <span>{pending ? "ログアウトしています…" : "ログアウト"}</span>
      )}
    </button>
  );
}
