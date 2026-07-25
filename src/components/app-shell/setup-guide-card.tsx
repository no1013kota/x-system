import { ArrowRight, Check, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";

import type { SetupChecklistItem } from "@/lib/execution-prereqs";

/**
 * ホーム初期設定ガイドカード（SC-05, 要件06 §3.1・要件01 §5, T-M2-24）。前提が不足している間だけ
 * 表示する。手順は順序依存（X APIキー→X連携など）があるため、先頭の未充足項目を「次にやること」
 * として主導線に格上げし、残りは補助表示にする。全項目充足なら呼び出し側が非表示にする。
 */
export function SetupGuideCard({ items }: { items: SetupChecklistItem[] }) {
  const pending = items.filter((item) => !item.satisfied);
  const next = pending[0];
  const rest = items.filter((item) => item !== next);

  return (
    <section
      aria-labelledby="setup-guide-heading"
      className="rounded-2xl border border-sky-200 bg-sky-50 p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-sky-950" id="setup-guide-heading">
        初期設定ガイド
      </h2>
      <p className="mt-1 text-sm text-sky-900">
        投稿の生成・自動運用を始めるには、残り{pending.length}件の設定が必要です。上から順に進めてください。
      </p>

      {next ? (
        <div className="mt-4 rounded-xl border border-sky-300 bg-background p-4">
          <p className="text-xs font-semibold text-sky-800">次にやること</p>
          <p className="mt-1 text-base font-semibold">{next.label}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{next.description}</p>
          <Link
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={next.settingsPath}
          >
            この手順から始める
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      ) : null}

      {rest.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {rest.map((item) => (
            <li key={item.item}>
              <Link
                className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href={item.settingsPath}
              >
                {item.satisfied ? (
                  <Check aria-hidden="true" className="size-5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1">
                  <span className="block font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.satisfied ? "設定済み" : "未設定"}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
