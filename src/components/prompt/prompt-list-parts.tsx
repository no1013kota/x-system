"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cardClassName } from "@/components/ui/card";

/**
 * プロンプト画面の共通パーツ（T-M8-332・運営者の指示 2026-08-27）。
 *
 * **アカウント.md・投稿作成プロンプト・画像生成プロンプトで同じ形にする。**
 * 3つとも「AIへ渡す文章を育てる」同じ操作なのに、見出し・追加の位置・保存の位置が
 * バラバラで、区分を移るたびに操作を探し直すことになっていた。
 * ここに置いた部品だけを使えば、3区分の見た目が自動的に揃う。
 */

/** 一覧の上の1行（何に効くか＋件数＋再読み込み）。 */
export function PromptListLead({
  count,
  lead,
  maxCount,
  onReload,
  pending,
}: {
  count: number;
  lead: string;
  /** 持てる件数の上限（T-M8-350）。**上限は作る前に見せる**——書き終えてから弾かれない。 */
  maxCount?: number;
  onReload?: () => void;
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-body text-ink-2">
        {lead}
        {maxCount ? `${count} / ${maxCount}件。` : count > 0 ? `${count}件。` : ""}
      </p>
      {onReload ? (
        <Button disabled={pending} onClick={onReload} size="sm" type="button" variant="ghost">
          再読み込み
        </Button>
      ) : null}
    </div>
  );
}

/** 1件分のパネル（見出し＋バッジ＋中身）。 */
export function PromptPanelCard({
  badges,
  children,
  title,
}: {
  badges?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <li className={`${cardClassName} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* 見出しは**編集中の名前**を映す（保存前の名前を出すと直した実感が消える）。 */}
        <h3 className="text-body font-bold text-ink">{title}</h3>
        {badges}
      </div>
      {children}
    </li>
  );
}

/** 一覧の最後に置く「追加」パネル（既存パネルと同じ寸法・破線で「まだ無いもの」を示す）。 */
export function PromptAddPanel({
  disabled,
  hint,
  label,
  onClick,
}: {
  disabled?: boolean;
  hint: string;
  label: string;
  onClick: () => void;
}) {
  return (
    /* `contents` でボタン自身をグリッドの1マスにする（`self-start` を効かせるため）。 */
    <li className="contents">
      <button
        className="flex w-full cursor-pointer items-center gap-2 self-start rounded-card border border-dashed border-hairline bg-surface px-4 py-4 text-left transition-colors duration-150 hover:border-brand hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-3">
          ＋
        </span>
        <span className="min-w-0">
          <span className="block text-body font-medium text-ink">{label}</span>
          <span className="mt-0.5 block text-caption leading-4 text-ink-3">{hint}</span>
        </span>
      </button>
    </li>
  );
}

/** 名前＋本文（字数カウンタつき）。3区分で同じ並び・同じラベル位置にする。 */
export function PromptBodyField({
  bodyLabel,
  content,
  idPrefix,
  maxChars,
  name,
  onChange,
}: {
  bodyLabel: string;
  content: string;
  idPrefix: string;
  maxChars: number;
  name: string;
  onChange: (next: { name?: string; content?: string }) => void;
}) {
  const over = content.length > maxChars;
  return (
    <div className="mt-3 space-y-3">
      <label className="block text-body">
        <span className="block font-medium">名前</span>
        <input
          className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
          id={`${idPrefix}-name`}
          maxLength={30}
          onChange={(e) => onChange({ name: e.target.value })}
          value={name}
        />
      </label>
      <div>
        <div className="flex items-center justify-between">
          <label className="text-body font-medium" htmlFor={`${idPrefix}-content`}>
            {bodyLabel}
          </label>
          <span className={`text-caption ${over ? "font-semibold text-danger-fg" : "text-ink-3"}`}>
            {content.length.toLocaleString()} / {maxChars.toLocaleString()} 字
          </span>
        </div>
        <textarea
          className="mt-1 h-64 w-full resize-y rounded-card border border-hairline bg-surface p-3 font-mono text-xs leading-5"
          id={`${idPrefix}-content`}
          onChange={(e) => onChange({ content: e.target.value })}
          spellCheck={false}
          value={content}
        />
      </div>
    </div>
  );
}
