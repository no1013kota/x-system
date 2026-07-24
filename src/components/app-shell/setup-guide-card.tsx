import { Check, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";

import type { SetupChecklistItem } from "@/lib/execution-prereqs";

/**
 * ホーム初期設定ガイドカード（SC-05, 要件06 §3.1・要件01 §5, T-M2-24）。前提が不足している間だけ
 * 表示し、各項目の充足/未充足と該当設定画面への導線を示す。全項目充足なら呼び出し側が非表示にする。
 */
export function SetupGuideCard({ items }: { items: SetupChecklistItem[] }) {
  const remaining = items.filter((i) => !i.satisfied).length;
  return (
    <section
      aria-labelledby="setup-guide-heading"
      className="rounded-2xl border border-sky-200 bg-sky-50 p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-sky-950" id="setup-guide-heading">
        初期設定ガイド
      </h2>
      <p className="mt-1 text-sm text-sky-900">
        投稿の生成・自動運用を始めるには、残り{remaining}件の設定が必要です。
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
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
              <span className="flex-1 font-medium">{item.label}</span>
              <span className="text-xs text-muted-foreground">
                {item.satisfied ? "設定済み" : "未設定"}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
