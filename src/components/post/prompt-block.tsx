"use client";

import { Notice } from "@/components/ui/notice";

/**
 * 生成に使うプロンプトの編集欄（T-M8-92／T-M8-135で共有化）。
 *
 * **投稿作成と予約の両方で同じ部品を使う。** 同じ「AIへの指示を確認して直す」操作なので、
 * 画面によって見た目や操作が変わらないようにする（要件06 §1.0）。
 *
 * 記入欄の見た目は「パターンを追加」の記入欄（`PatternFields`）と同じにする
 * （T-M8-194・運営者の指示 2026-08-22）: 見えるラベル＋右上に字数、h-64のmono textarea、
 * 下に補足（分量やプレースホルダー）。違うのは「この生成にだけ／保存して以後も」の2択だけ。
 */
export function PromptBlock({
  label,
  value,
  limit,
  edited,
  mode,
  note,
  onChange,
  onMode,
  onReset,
  onceLabel = "この生成にだけ使う",
  saveLabel = "保存して以後の生成にも使う",
  footer,
  groupName,
}: {
  label: string;
  value: string;
  limit: number;
  edited: boolean;
  mode: "once" | "save";
  note?: string;
  onChange: (next: string) => void;
  onMode: (next: "once" | "save") => void;
  onReset: () => void;
  /**
   * 編集した内容をどこへ効かせるかの2択の文言。
   * **画面ごとに意味が違うので呼び出し側が決める**——投稿作成は「この生成」、
   * 予約は「この予約」。同じ言葉を使い回すと、予約なのに1回だけと読めてしまう。
   */
  onceLabel?: string;
  saveLabel?: string;
  /** textareaの直下に出す補足（分量の読み取り・プレースホルダー一覧など）。 */
  footer?: React.ReactNode;
  /**
   * 2択ラジオのグループ名。**同一ページに複数のフォームが並ぶ画面（予約）では必須**——
   * `name` が無いとブラウザはグループとして扱わず、キーボードの矢印で移動できないうえ
   * 別フォームのラジオと同時に選択された状態に見える。
   */
  groupName: string;
}) {
  const over = value.length > limit;
  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-body font-medium">{label}</span>
          <span
            className={`shrink-0 text-caption ${over ? "font-semibold text-danger-fg" : "text-ink-3"}`}
          >
            {value.length.toLocaleString()} / {limit.toLocaleString()} 字
          </span>
        </div>
        <textarea
          aria-label={label}
          className="mt-1 h-64 w-full resize-y rounded-card border border-hairline bg-surface p-3 font-mono text-xs leading-5 transition-colors duration-150 focus:border-brand focus:outline-none"
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          value={value}
        />
        {footer}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {edited ? (
          <>
            <label className="flex items-center gap-1.5 text-body">
              <input
                checked={mode === "once"}
                name={groupName}
                onChange={() => onMode("once")}
                type="radio"
              />
              {onceLabel}
            </label>
            <label className="flex items-center gap-1.5 text-body">
              <input
                checked={mode === "save"}
                name={groupName}
                onChange={() => onMode("save")}
                type="radio"
              />
              {saveLabel}
            </label>
            <button className="text-body text-info-fg hover:underline" onClick={onReset} type="button">
              元に戻す
            </button>
          </>
        ) : null}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {over ? (
        <Notice tone="danger">{limit.toLocaleString()}字以内で入力してください。</Notice>
      ) : null}
    </div>
  );
}
