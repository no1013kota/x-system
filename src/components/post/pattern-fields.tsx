"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import {
  alertDialogBackdropClassName,
  alertDialogPopupClassName,
} from "@/components/ui/alert-dialog-classes";
import { Icon } from "@/components/ui/icon";

import {
  PATTERN_DESCRIPTION_MAX_CHARS,
  PATTERN_NAME_MAX_CHARS,
  PATTERN_PLACEHOLDER_MAX,
  PATTERN_PLACEHOLDER_NAME_MAX_CHARS,
  PATTERN_PROMPT_MAX_CHARS,
  threadCountFromPromptLabel,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";

/**
 * 投稿パターンの入力欄（T-M8-130）。
 *
 * **設定＞パターン管理と投稿作成画面の両方で同じ部品を使う。** 同じものを作る操作なので、
 * 画面によって項目や言い方が変わらないようにする（要件06 §1.0）。
 *
 * 分量は**スレッド数**で聞く（運営者の指示・2026-08-18）。0 は「メインポストのみ」。
 * DBは総ポスト数（`max_posts`）で持ち、ここで変換する——`max_posts` はスレッド配列の
 * 上限としてコード全体で使われており、意味を変えると解釈が全箇所でずれる。
 */


/** 画面が扱う1件分の値。`maxPosts` は総ポスト数（表示はスレッド数へ変換する）。 */
export interface PatternDraft {
  name: string;
  description: string;
  prompt: string;
  /** プロンプト内の `{名前}` に差し込む入力の定義。 */
  placeholders: { name: string }[];
}

/** 新規作成の初期値。プロンプトは雛形を入れて渡す（呼び出し側で `NEW_PATTERN_PROMPT_TEMPLATE`）。 */
export function emptyPatternDraft(prompt: string): PatternDraft {
  return { name: "", description: "", prompt, placeholders: [] };
}

export function toPatternDraft(
  item: PatternOption,
  prompt: PatternPromptView | undefined,
): PatternDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    prompt: prompt?.content ?? "",
    placeholders: item.placeholders.map((ph) => ({ name: ph.name })),
  };
}

/**
 * サーバーへ送る形（`snake_case`）。
 * 既定パターンで本文がシステム既定と同じなら `null`（＝既定のまま）にする。
 */
export function toPatternPayload(draft: PatternDraft, systemDefaultPrompt: string | null) {
  const prompt = draft.prompt.trim();
  const isDefaultBody = systemDefaultPrompt !== null && prompt === systemDefaultPrompt.trim();
  return {
    name: draft.name,
    description: draft.description.trim() === "" ? null : draft.description.trim(),
    prompt: isDefaultBody ? null : prompt,
    placeholders: draft.placeholders
      .map((ph) => ({ name: ph.name.trim() }))
      .filter((ph) => ph.name.length > 0),
  };
}

/** `validation_error` の理由を、直す場所が分かる日本語にする（CLAUDE.md 原則2）。 */
export function patternReasonMessage(
  reason: string | undefined,
  message: string | undefined,
): string {
  switch (reason) {
    case "name_length":
      return `名前は1〜${PATTERN_NAME_MAX_CHARS}字で入力してください。`;
    case "name_unsafe_chars":
      return "名前に改行と「<」「>」は使えません（改善提案の生成に使われるため）。";
    case "name_taken":
      return "同じ名前のパターンがすでにあります。別の名前にしてください。";
    case "description_length":
      return `説明は${PATTERN_DESCRIPTION_MAX_CHARS}字以内で入力してください。`;
  case "placeholder_name_length":
    return `プレースホルダー名は1〜${PATTERN_PLACEHOLDER_NAME_MAX_CHARS}字で入力してください。`;
    case "placeholder_name_unsafe":
    return "プレースホルダー名に「{」「}」「<」「>」改行は使えません。";
    case "placeholder_duplicated":
    return "同じ名前のプレースホルダーが2つあります。名前を分けてください。";
    case "placeholder_not_used":
    return "プレースホルダーを作ったら、プロンプトの中に {プレースホルダー名} と書いてください（書かないと入力しても使われません）。";
    case "placeholder_too_many":
    return `プレースホルダーは${PATTERN_PLACEHOLDER_MAX}個までです。`;
    case "prompt_required":
      return "プロンプトを入力してください（自分で作ったパターンには既定がありません）。";
    case "too_long":
      return `プロンプトは${PATTERN_PROMPT_MAX_CHARS.toLocaleString()}字以内で入力してください。`;
    case "empty":
      return "プロンプトを入力してください。";
    case "last_pattern":
      return "最後のパターンは削除できません（投稿を作れなくなります）。先に別のパターンを追加してください。";
    default:
      return message ?? "保存できませんでした。";
  }
}

/** Server Action の戻りから `details.reason` を取り出す（形が違えば undefined）。 */
export function actionReason(res: unknown): string | undefined {
  const details = (res as { details?: Record<string, unknown> } | null)?.details;
  return typeof details?.reason === "string" ? details.reason : undefined;
}

export function PatternFields({
  draft,
  idPrefix,
  onChange,
  promptRequired,
}: {
  draft: PatternDraft;
  idPrefix: string;
  onChange: (next: Partial<PatternDraft>) => void;
  promptRequired: boolean;
}) {
  const over = draft.prompt.length > PATTERN_PROMPT_MAX_CHARS;
  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-body">
          <span className="block font-medium">名前</span>
          <input
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-name`}
            maxLength={PATTERN_NAME_MAX_CHARS}
            onChange={(e) => onChange({ name: e.target.value })}
            value={draft.name}
          />
        </label>
        <label className="block text-body">
          <span className="block font-medium">説明（任意）</span>
          <input
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-description`}
            maxLength={PATTERN_DESCRIPTION_MAX_CHARS}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="選ぶときの手がかり（スレッド数は自動で付きます）"
            value={draft.description}
          />
        </label>
      </div>

      {/*
        **入力項目（プレースホルダー）**（T-M8-132・運営者の指示 2026-08-18）。
        プロンプトの中に `{名前}` と書いておくと、投稿作成画面にその名前の入力欄が出て、
        入力した内容が `{名前}` の位置へ差し込まれる。
        「自分の考え」のような固定の入力欄をやめ、型ごとに何を毎回入れたいかを決められるようにした。
      */}
      <fieldset>
        <legend className="mb-1 text-body font-medium">プレースホルダー（任意）</legend>
        <p className="mb-2 text-caption text-ink-3">
        ここでプレースホルダー名を決めて、下のプロンプトの中に <code>{"{プレースホルダー名}"}</code>{" "}
          と書いてください。投稿作成のときにその名前の入力欄が出て、入力した内容が{" "}
          <code>{"{プレースホルダー名}"}</code> の位置に入ります。
        </p>
        <div className="space-y-2">
          {draft.placeholders.map((ph, index) => (
            <div className="flex items-center gap-2" key={index}>
              <input
                aria-label={`プレースホルダー名${index + 1}`}
                className="h-9 w-full max-w-xs rounded-card border border-hairline bg-surface px-2 text-body"
                id={`${idPrefix}-placeholder-${index}`}
                maxLength={PATTERN_PLACEHOLDER_NAME_MAX_CHARS}
                onChange={(e) =>
                  onChange({
                    placeholders: draft.placeholders.map((cur, i) =>
                      i === index ? { name: e.target.value } : cur,
                    ),
                  })
                }
                placeholder="例: 自分の考え"
                value={ph.name}
              />
              <span className="text-caption text-ink-3">
                プロンプトには <code>{`{${ph.name || "名前"}}`}</code>
              </span>
            <button
                // パターン自体の「削除」と紛れないよう、読み上げ名を分ける。
                aria-label={`プレースホルダー${ph.name ? `「${ph.name}」` : index + 1}を削除`}
                className="ml-auto shrink-0 text-body text-danger-fg hover:underline"
                onClick={() =>
                  onChange({ placeholders: draft.placeholders.filter((_, i) => i !== index) })
                }
                type="button"
              >
                削除
              </button>
            </div>
          ))}
        </div>
        {draft.placeholders.length < PATTERN_PLACEHOLDER_MAX ? (
          <button
            className="mt-2 text-body text-info-fg hover:underline"
            onClick={() => onChange({ placeholders: [...draft.placeholders, { name: "" }] })}
            type="button"
          >
          プレースホルダーを追加
          </button>
        ) : null}
      </fieldset>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-body font-medium" htmlFor={`${idPrefix}-prompt`}>
            生成プロンプト{promptRequired ? "" : "（空にすると既定に戻ります）"}
          </label>
          <span className={`text-caption ${over ? "font-semibold text-danger-fg" : "text-ink-3"}`}>
            {draft.prompt.length.toLocaleString()} / {PATTERN_PROMPT_MAX_CHARS.toLocaleString()} 字
          </span>
        </div>
      <textarea
          className="mt-1 h-64 w-full resize-y rounded-card border border-hairline bg-surface p-3 font-mono text-xs leading-5"
          id={`${idPrefix}-prompt`}
          onChange={(e) => onChange({ prompt: e.target.value })}
          spellCheck={false}
          value={draft.prompt}
        />
        {/*
          **分量はプロンプトから読む**（T-M8-132）。読み取った結果をその場に出す——
          書いたつもりの本数と実際に作られる本数が違うことに、生成してから気付かないようにする。
        */}
        <p className="mt-1 text-caption text-ink-3">{threadCountFromPromptLabel(draft.prompt)}</p>
      </div>
    </div>
  );
}

/**
 * 削除の確認。**何が起きるかを先に書く**（CLAUDE.md 原則1）。
 * 「過去は残る」「予約は停止する」を言わないと、履歴が消えると思って押せない。
 */
export function DeletePatternButton({
  disabled,
  name,
  onConfirm,
  variant = "button",
}: {
  disabled: boolean;
  name: string;
  onConfirm: () => void;
  /**
   * `icon` はパターンのカード内に置く小さな削除（T-M8-134・運営者の指示 2026-08-18）。
   * **アイコンだけなので読み上げ名にパターン名を入れる**——カードが並ぶので
   * 「削除」だけだとどれを消すのか音声では区別できない。
   */
  variant?: "button" | "icon";
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        aria-label={variant === "icon" ? `「${name}」を削除` : undefined}
        className={
          variant === "icon"
            ? "inline-flex size-7 items-center justify-center rounded-card text-ink-3 transition-colors duration-150 hover:bg-danger-bg hover:text-danger-fg disabled:pointer-events-none disabled:opacity-40"
            : "ml-auto inline-flex h-9 items-center rounded-card border border-hairline px-3 text-body text-danger-fg transition-colors duration-150 hover:bg-danger-bg disabled:opacity-50"
        }
        disabled={disabled}
      >
        {variant === "icon" ? <Icon name="delete" size={16} /> : "削除"}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={alertDialogBackdropClassName} />
        <AlertDialog.Popup className={alertDialogPopupClassName()}>
          <AlertDialog.Title className="text-body font-bold text-ink">
            「{name}」を削除しますか？
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body text-ink-2">
            過去の下書き・履歴の表示は名前のまま残ります。このパターンを使っている予約は
            停止し、曜日・時刻・テーマは残るので別のパターンを選べば再開できます。
            はじめから用意されているパターンは、あとから「既定のパターンを戻す」で復元できます。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Close className="inline-flex h-9 items-center rounded-card border border-hairline px-4 text-body">
              キャンセル
            </AlertDialog.Close>
            <AlertDialog.Close
              className="inline-flex h-9 items-center rounded-card bg-danger-fg px-4 text-body font-medium text-white"
              onClick={onConfirm}
            >
              削除する
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
