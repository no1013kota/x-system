"use client";

import { useState } from "react";

/** 追跡URLをクリップボードへ（T-M8-423）。失敗したら選択して手でコピーできるよう入力欄は残す。 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rounded-md border border-hairline px-2 py-1 text-xs text-ink-2 hover:text-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}
