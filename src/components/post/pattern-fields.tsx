"use client";

import {
  PATTERN_DESCRIPTION_MAX_CHARS,
  PATTERN_MAX_THREAD_COUNT,
  PATTERN_NAME_MAX_CHARS,
  PATTERN_PROMPT_MAX_CHARS,
  maxPostsFromThreadCount,
  threadCountOf,
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

export type PatternPolicyValue = "always" | "with_url" | "never";

const POLICY_OPTIONS: { value: PatternPolicyValue; webLabel: string; sourceLabel: string }[] = [
  { value: "always", webLabel: "毎回使う", sourceLabel: "必ず付ける" },
  { value: "with_url", webLabel: "入力があるときだけ", sourceLabel: "入力があるときだけ" },
  { value: "never", webLabel: "使わない", sourceLabel: "付けない" },
];

/** 画面が扱う1件分の値。`maxPosts` は総ポスト数（表示はスレッド数へ変換する）。 */
export interface PatternDraft {
  name: string;
  description: string;
  prompt: string;
  maxPosts: number;
  webSearchPolicy: PatternPolicyValue;
  sourcePolicy: PatternPolicyValue;
  includeNewsDigest: boolean;
  asksUserOpinion: boolean;
  requiresQuoteUrl: boolean;
}

/** 新規作成の初期値。プロンプトは雛形を入れて渡す（呼び出し側で `NEW_PATTERN_PROMPT_TEMPLATE`）。 */
export function emptyPatternDraft(prompt: string): PatternDraft {
  return {
    name: "",
    description: "",
    prompt,
    // 既定はスレッド2本（メイン＋2＝3ポスト）。単発にしたい人は 0 を選べる。
    maxPosts: 3,
    webSearchPolicy: "always",
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
  };
}

export function toPatternDraft(
  item: PatternOption,
  prompt: PatternPromptView | undefined,
): PatternDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    prompt: prompt?.content ?? "",
    maxPosts: item.maxPosts,
    webSearchPolicy: item.webSearchPolicy,
    sourcePolicy: item.sourcePolicy,
    includeNewsDigest: item.includeNewsDigest,
    asksUserOpinion: item.asksUserOpinion,
    requiresQuoteUrl: item.requiresQuoteUrl,
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
    max_posts: draft.maxPosts,
    web_search_policy: draft.webSearchPolicy,
    source_policy: draft.sourcePolicy,
    include_news_digest: draft.includeNewsDigest,
    asks_user_opinion: draft.asksUserOpinion,
    requires_quote_url: draft.requiresQuoteUrl,
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
    case "max_posts_range":
      return `スレッド数は0〜${PATTERN_MAX_THREAD_COUNT}で指定してください。`;
    case "prompt_required":
      return "プロンプトを入力してください（自分で作ったパターンには既定がありません）。";
    case "too_long":
      return `プロンプトは${PATTERN_PROMPT_MAX_CHARS.toLocaleString()}字以内で入力してください。`;
    case "empty":
      return "プロンプトを入力してください。";
    case "quote_with_digest":
      return "「引用URLを毎回指定する」と「ニュースをまとめて渡す」は同時に使えません。";
    case "last_pattern":
      return "最後のパターンは削除できません（投稿を作れなくなります）。先に別のパターンを追加してください。";
    case "no_system_default":
      return "自分で作ったパターンには戻す既定がありません。";
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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-body">
          <span className="block font-medium">スレッド数</span>
          <select
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-thread-count`}
            onChange={(e) => onChange({ maxPosts: maxPostsFromThreadCount(Number(e.target.value)) })}
            value={threadCountOf(draft.maxPosts)}
          >
            {Array.from({ length: PATTERN_MAX_THREAD_COUNT + 1 }, (_, n) => n).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "0（メインポストのみ）" : `${n}（メイン＋最大${n}）`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-body">
        <span className="block font-medium">Web検索を使う</span>
          <select
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-web-search`}
            onChange={(e) => onChange({ webSearchPolicy: e.target.value as PatternPolicyValue })}
            value={draft.webSearchPolicy}
          >
            {POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.webLabel}
              </option>
            ))}
          </select>
        </label>
      <label className="block text-body">
          {/* 投稿作成画面の「参考にするURL（入力）」とは別物なので、**出力側だと分かる書き方**にする。 */}
          <span className="block font-medium">投稿に参考URLを付ける</span>
          <select
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-source`}
            onChange={(e) => onChange({ sourcePolicy: e.target.value as PatternPolicyValue })}
            value={draft.sourcePolicy}
          >
            {POLICY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.sourceLabel}
              </option>
            ))}
          </select>
        </label>
      </div>

    <p className="text-caption text-ink-3">
        スレッド数・Web検索・参考URLは、生成のたびにAIへの指示（<code>pattern_rules</code>）として
        渡されます。スレッド数は生成後にも上限として適用されます。
      </p>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-body font-medium">この型の入力</legend>
        <label className="flex items-center gap-1.5 text-body">
          <input
            checked={draft.asksUserOpinion}
            onChange={(e) => onChange({ asksUserOpinion: e.target.checked })}
            type="checkbox"
          />
          自分の意見を毎回入力する
        </label>
        <label className="flex items-center gap-1.5 text-body">
          <input
            checked={draft.includeNewsDigest}
            disabled={draft.requiresQuoteUrl}
            onChange={(e) => onChange({ includeNewsDigest: e.target.checked })}
            type="checkbox"
          />
          直近のニュースをまとめて渡す
        </label>
        <label className="flex items-center gap-1.5 text-body">
          <input
            checked={draft.requiresQuoteUrl}
            onChange={(e) =>
              onChange({
                requiresQuoteUrl: e.target.checked,
                ...(e.target.checked ? { includeNewsDigest: false } : {}),
              })
            }
            type="checkbox"
          />
          引用するX投稿のURLを毎回指定する
        </label>
      </fieldset>
      {draft.requiresQuoteUrl ? (
        <p className="text-caption text-ink-3">
          URLを毎回指定する必要があるため、このパターンはスケジュール（定期実行）には使えません。
        </p>
      ) : null}

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
      </div>
    </div>
  );
}
