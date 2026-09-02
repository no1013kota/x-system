"use client";

import { Icon } from "@/components/ui/icon";

/**
 * チップ型の複数選択（設定＞通知で使っていたものをT-M8-412で共通化）。
 * 選択中は色だけでなくチェックアイコンでも示す（色覚に依存しない）。
 */
export function ChipCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-pill border px-3 text-body transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
        checked
          ? "border-brand/50 bg-brand-subtle font-medium text-brand"
          : "border-hairline bg-surface text-ink-2 hover:bg-black/[0.02]"
      }`}
    >
      <input checked={checked} className="sr-only" onChange={onChange} type="checkbox" />
      {checked ? <Icon name="check" size={14} /> : null}
      {label}
    </label>
  );
}
