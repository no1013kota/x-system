import Link from "next/link";

import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { SetupChecklistItem } from "@/lib/execution-prereqs";

/**
 * ホーム初期設定ガイドカード（SC-05, 要件06 §3.1・要件01 §5, T-M2-24）。前提が不足している間だけ
 * 表示する。手順は順序依存（X APIキー→X連携など）があるため、先頭の未充足項目を「次にやること」
 * として主導線に格上げし、残りは補助表示にする。全項目充足なら呼び出し側が非表示にする。
 *
 * 見た目は新デザイン（T-M8-06）。**進捗（n/m 完了）とグラデーションの進捗バー**を出す。
 * 「あと何件か」が一目で分かることが、この画面の目的（設定を最後まで終わらせる）に直結する。
 */
export function SetupGuideCard({ items }: { items: SetupChecklistItem[] }) {
  const pending = items.filter((item) => !item.satisfied);
  const next = pending[0];
  const rest = items.filter((item) => item !== next);
  const done = items.length - pending.length;
  const ratio = items.length === 0 ? 0 : Math.round((done / items.length) * 100);

  return (
    <Card aria-labelledby="setup-guide-heading" className="overflow-hidden" role="region">
      <CardBody>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle id="setup-guide-heading">
            初期設定ガイド
          </CardTitle>
          <span className="text-[12px] font-bold tabular-nums text-brand">
            {done} / {items.length} 完了
          </span>
          <div
            aria-hidden="true"
            className="h-1.5 min-w-[140px] flex-1 overflow-hidden rounded-pill bg-black/[0.06]"
          >
            <div
              className="h-full rounded-pill"
              style={{ width: `${ratio}%`, backgroundImage: "var(--brand-gradient)" }}
            />
          </div>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-5 text-ink-2">
          投稿の生成・自動運用を始めるには、残り{pending.length}件の設定が必要です。上から順に進めてください。
        </p>

        {next ? (
          <div className="mt-3.5 rounded-card border border-brand/25 bg-brand-subtle/40 p-4">
            <p className="text-[11px] font-bold text-brand">次にやること</p>
            <p className="mt-1 text-[14px] font-bold text-ink">{next.label}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{next.description}</p>
            <Link
              className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href={next.settingsPath}
            >
              この手順から始める
              <Icon name="chevron_right" size={16} />
            </Link>
          </div>
        ) : null}

        {rest.length > 0 ? (
          <ul className="mt-3.5 space-y-1.5">
            {rest.map((item) => (
              <li key={item.item}>
                <Link
                  className="flex items-center gap-3 rounded-card border border-hairline px-4 py-2.5 transition-colors duration-150 hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  href={item.settingsPath}
                >
                  <Icon
                    className={item.satisfied ? "text-success-icon" : "text-ink-3"}
                    filled={item.satisfied}
                    name={item.satisfied ? "check_circle" : "radio_button_unchecked"}
                    size={19}
                  />
                  <span className="flex-1">
                    <span className="block text-[13.5px] font-medium text-ink">{item.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-3">
                      {item.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-3">
                    {item.satisfied ? "設定済み" : "未設定"}
                  </span>
                  <Icon className="shrink-0 text-ink-3" name="chevron_right" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
