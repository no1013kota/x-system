import Link from "next/link";

import { PREREQ_ITEM_LABELS, type PrereqItem } from "@/lib/execution-prereqs";
import { primaryLinkClassName } from "@/components/ui/link-button";

/**
 * 実行前提不足を受けた画面が共通で表示する通知（要件06 §3.1・要件05 §2.2, T-M2-23）。
 * メッセージ・不足項目・設定画面への「設定へ」ボタンを出す。エラーコードに依存せず、Actionが返す
 * message／settingsPath／missing をそのまま描画するため、どのエラーコードの表示にも使える。
 */
export function ExecutionPrereqNotice({
  message,
  settingsPath,
  missing,
  settingsLabel = "設定へ",
}: {
  message: string;
  settingsPath: string;
  missing?: PrereqItem[];
  settingsLabel?: string;
}) {
  return (
    <div
      className="rounded-card border border-warn-fg/25 bg-warn-bg p-5 text-warn-fg"
      role="alert"
    >
      <p className="font-semibold">{message}</p>
      {missing && missing.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {missing.map((item) => (
            <li key={item}>{PREREQ_ITEM_LABELS[item] ?? item}</li>
          ))}
        </ul>
      ) : null}
      <Link
        className={`mt-4 ${primaryLinkClassName}`}
        href={settingsPath}
      >
        {settingsLabel}
      </Link>
    </div>
  );
}
