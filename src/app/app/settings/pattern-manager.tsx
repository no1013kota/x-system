"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createPatternAction,
  deletePatternAction,
  listPatternsAction,
  restoreDefaultPatternsAction,
  updatePatternAction,
} from "@/app/actions/post-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import {
  PATTERN_DESCRIPTION_MAX_CHARS,
  PATTERN_MAX_POSTS_LIMIT,
  PATTERN_NAME_MAX_CHARS,
  PATTERN_PROMPT_MAX_CHARS,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";

/**
 * 投稿パターンの管理（T-M8-129 U4b・ADR-0008・要件06 §9）。
 *
 * **プルダウンで1つずつ選ぶのをやめ、全パターンを最初から並べる**（運営者の指示・2026-08-18）。
 * 以前は「プロンプト種別」のselectで1件ずつ切り替える形で、いま何が設定されているのかを
 * 一覧で把握できなかった。パターンは利用者が追加・編集・削除できるようになったので、
 * **一覧＝設定の全体像**である必要がある。
 *
 * 既定パターンも削除できる。最後の1件だけは残す（0件になると投稿を作る手段が画面から消える）。
 */

const POLICY_OPTIONS: { value: PatternPolicyValue; webLabel: string; sourceLabel: string }[] = [
  { value: "always", webLabel: "毎回使う", sourceLabel: "必ず付ける" },
  { value: "with_url", webLabel: "参考URLがあるときだけ", sourceLabel: "参考URLがあるときだけ" },
  { value: "never", webLabel: "使わない", sourceLabel: "求めない" },
];

type PatternPolicyValue = "always" | "with_url" | "never";

/** 画面が扱う1件分の値。サーバーの `PatternOption` ＋ プロンプト本文。 */
interface PatternDraft {
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

function toDraft(item: PatternOption, prompt: PatternPromptView | undefined): PatternDraft {
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

const EMPTY_DRAFT: PatternDraft = {
  name: "",
  description: "",
  prompt: "",
  maxPosts: 3,
  webSearchPolicy: "always",
  sourcePolicy: "with_url",
  includeNewsDigest: false,
  asksUserOpinion: false,
  requiresQuoteUrl: false,
};

/** サーバーへ送る形（`snake_case`）。既定パターンで本文が既定と同じなら `null`（＝既定のまま）。 */
function toPayload(draft: PatternDraft, systemDefaultPrompt: string | null) {
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
function reasonMessage(reason: string | undefined, message: string | undefined): string {
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
      return `ポスト数は1〜${PATTERN_MAX_POSTS_LIMIT}で指定してください。`;
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

export function PatternManager({
  initialPatterns,
  initialPrompts,
  systemDefaultPrompts,
}: {
  initialPatterns: PatternOption[];
  initialPrompts: Record<string, PatternPromptView>;
  /** 既定パターンのシステム既定本文（パターンID → 本文）。「既定に戻す」の判定に使う。 */
  systemDefaultPrompts: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
const [patterns, setPatterns] = useState(initialPatterns);
  const [drafts, setDrafts] = useState<Record<string, PatternDraft>>(() =>
    Object.fromEntries(initialPatterns.map((p) => [p.id, toDraft(p, initialPrompts[p.id])])),
  );
  const [creating, setCreating] = useState<PatternDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const missingDefaults = 6 - patterns.filter((p) => p.isSystemDefault).length;

  /**
   * 待ちはサーバー処理の間だけ（T-M8-68）。`router.refresh()` を待つと、
   * トーストが出た後もボタンが固まって見える。
   */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    setPending(true);
    try {
      return await action();
    } finally {
      setPending(false);
    }
  }

  function setDraft(id: string, next: Partial<PatternDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }

/**
   * 一覧を取り直す。**成功トーストの後には呼ばない**（T-M8-68）。
   * 呼ぶと再取得の間ずっと `pending` のままで、保存できたのに画面が固まって見える。
   * 保存・追加・削除は action の戻り値で手元の状態を直し、`router.refresh()` は待たない。
   */
  async function reload(): Promise<void> {
    const res = await run(() => listPatternsAction());
    if (res.status === "success" && res.patterns && res.prompts) {
      const items = res.patterns;
      setPatterns(items);
      setDrafts(Object.fromEntries(items.map((p) => [p.id, toDraft(p, res.prompts![p.id])])));
      setErrors({});
      router.refresh();
    } else {
      toast.show({
        tone: "error",
        title: "読み込めませんでした",
        description: res.message ?? "時間をおいてもう一度お試しください。",
      });
    }
  }

  function save(item: PatternOption) {
    const draft = drafts[item.id];
    void (async () => {
      const res = await run(() =>
        updatePatternAction({
          pattern_id: item.id,
          ...toPayload(draft, systemDefaultPrompts[item.id] ?? null),
        }),
      );
    if (res.status === "success" && res.pattern) {
        const saved = res.pattern;
        setPatterns((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        setErrors((prev) => ({ ...prev, [item.id]: "" }));
        toast.show({ tone: "success", title: `「${saved.name}」を保存しました` });
        router.refresh();
      } else {
        const reason =
          typeof (res as { details?: Record<string, unknown> }).details?.reason === "string"
            ? ((res as { details?: Record<string, string> }).details!.reason as string)
            : undefined;
        setErrors((prev) => ({ ...prev, [item.id]: reasonMessage(reason, res.message) }));
      }
    })();
  }

  function create() {
    if (!creating) return;
    void (async () => {
      const res = await run(() => createPatternAction(toPayload(creating, null)));
    if (res.status === "success" && res.pattern) {
        const added = res.pattern;
        setPatterns((prev) => [...prev, added]);
        setDrafts((prev) => ({ ...prev, [added.id]: toDraft(added, { content: added.hasCustomPrompt ? creating.prompt : "", isOverride: added.hasCustomPrompt, updatedAt: null }) }));
        setCreating(null);
        toast.show({ tone: "success", title: `「${added.name}」を追加しました` });
        router.refresh();
      } else {
        const reason =
          typeof (res as { details?: Record<string, unknown> }).details?.reason === "string"
            ? ((res as { details?: Record<string, string> }).details!.reason as string)
            : undefined;
        setErrors((prev) => ({ ...prev, new: reasonMessage(reason, res.message) }));
      }
    })();
  }

  function remove(item: PatternOption) {
    void (async () => {
      const res = await run(() => deletePatternAction({ pattern_id: item.id }));
      if (res.status === "success") {
        const stopped = res.disabledSlots ?? 0;
        toast.show({
          tone: "success",
          title: `「${res.deletedName ?? item.name}」を削除しました`,
          description:
            stopped > 0
              ? `このパターンを使っていた予約${stopped}件を停止しました（曜日・時刻は残っています）。`
              : "過去の下書き・履歴の表示はそのまま残ります。",
        });
      setPatterns((prev) => prev.filter((p) => p.id !== item.id));
        router.refresh();
      } else {
        const reason =
          typeof (res as { details?: Record<string, unknown> }).details?.reason === "string"
            ? ((res as { details?: Record<string, string> }).details!.reason as string)
            : undefined;
        toast.show({
          tone: "error",
          title: "削除できませんでした",
          description: reasonMessage(reason, res.message),
        });
      }
    })();
  }

  function restoreDefaults() {
    void (async () => {
      const res = await run(() => restoreDefaultPatternsAction());
      if (res.status === "success") {
        const n = res.restored ?? 0;
        toast.show({
          tone: "success",
          title: n > 0 ? `既定のパターンを${n}件戻しました` : "既定のパターンはすべて揃っています",
        description:
            n > 0 ? "同じ名前のパターンがあった分は「（復元）」を付けて追加しました。" : undefined,
        });
        // 復元は「何が入ったか」が action の戻り（件数）だけでは分からないので取り直す。
        // トーストは先に出してあるので、待っている間に固まって見えることはない。
        if (n > 0) void reload();
      } else {
        toast.show({
          tone: "error",
          title: "復元できませんでした",
          description: res.message ?? "時間をおいてもう一度お試しください。",
        });
      }
    })();
  }

  return (
    <div className="space-y-4">
      <p className="rounded-card border border-hairline bg-page px-4 py-2 text-caption text-ink-3 lg:hidden">
        プロンプトの編集はPCでの操作を推奨します。モバイルでは閲覧のみを想定しています。
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-ink-2">
          投稿作成とスケジュールで選べるパターンです。{patterns.length}件。
        </p>
        <div className="flex flex-wrap gap-2">
          {missingDefaults > 0 ? (
            <Button disabled={pending} onClick={restoreDefaults} type="button" variant="subtle">
              既定のパターンを戻す（{missingDefaults}件）
            </Button>
          ) : null}
          {!creating ? (
            <Button
              disabled={pending}
              onClick={() => setCreating({ ...EMPTY_DRAFT })}
              type="button"
              variant="brand"
            >
              パターンを追加
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <section className={`${cardClassName} p-4`}>
          <CardTitle>新しいパターン</CardTitle>
          {errors.new ? <Notice tone="danger">{errors.new}</Notice> : null}
          <PatternFields
            draft={creating}
            idPrefix="new"
            onChange={(next) => setCreating((cur) => (cur ? { ...cur, ...next } : cur))}
            promptRequired
          />
          <div className="mt-3 flex gap-2">
            <Button disabled={pending} onClick={create} type="button" variant="brand">
              追加
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setCreating(null);
                setErrors((prev) => ({ ...prev, new: "" }));
              }}
              type="button"
              variant="subtle"
            >
              キャンセル
            </Button>
          </div>
        </section>
      ) : null}

      {/* **全パターンを並べる。** プルダウンで1件ずつ選ぶ形はやめた（運営者の指示・2026-08-18）。 */}
      <ul className="space-y-4">
        {patterns.map((item) => {
          const draft = drafts[item.id];
          if (!draft) return null;
          const defaultBody = systemDefaultPrompts[item.id] ?? null;
          const isDefaultBody =
            defaultBody !== null && draft.prompt.trim() === defaultBody.trim();
          return (
            <li className={`${cardClassName} p-4`} key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
              {/* 見出しは**編集中の名前**を映す。保存前の名前を出すと、直したつもりが
                    反映されていないように見える。 */}
                <h3 className="text-body font-bold text-ink">{draft.name || item.name}</h3>
              <Badge tone={item.hasCustomPrompt ? "brand" : "neutral"}>
                  {item.hasCustomPrompt ? "プロンプト変更済み" : "既定のプロンプト"}
                </Badge>
                {item.isSystemDefault ? <Badge tone="neutral">はじめから用意</Badge> : null}
                {item.requiresQuoteUrl ? <Badge tone="neutral">予約に使えません</Badge> : null}
                <span className="ml-auto text-caption text-ink-3">
                  最大{item.maxPosts}ポスト・編集は{item.maxPostsEdit}まで
                </span>
              </div>

              {errors[item.id] ? (
                <div className="mt-2">
                  <Notice tone="danger">{errors[item.id]}</Notice>
                </div>
              ) : null}

              <PatternFields
                draft={draft}
                // **数字で始まるidにしない。** uuidをそのまま使うとCSSセレクタとして無効になり、
                // 検証（E2E）からもラベルの `htmlFor` からも引けなくなる。
                idPrefix={`pattern-${item.id}`}
                onChange={(next) => setDraft(item.id, next)}
                promptRequired={!item.isSystemDefault}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button disabled={pending} onClick={() => save(item)} type="button" variant="brand">
                  保存
                </Button>
                {item.isSystemDefault && !isDefaultBody ? (
                  <Button
                    disabled={pending}
                    onClick={() => setDraft(item.id, { prompt: defaultBody ?? "" })}
                    type="button"
                    variant="subtle"
                  >
                    プロンプトを既定に戻す
                  </Button>
                ) : null}
                <DeletePatternButton
                  disabled={pending || patterns.length <= 1}
                  name={item.name}
                  onConfirm={() => remove(item)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 1件分の入力欄。作成と編集で**同じ部品**を使う（画面によって項目が違わないようにする）。 */
function PatternFields({
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
            placeholder="選ぶときの手がかり（ポスト数は自動で付きます）"
            value={draft.description}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-body">
          <span className="block font-medium">ポスト数</span>
          <select
            className="mt-1 h-9 w-full rounded-card border border-hairline bg-surface px-2"
            id={`${idPrefix}-max-posts`}
            onChange={(e) => onChange({ maxPosts: Number(e.target.value) })}
            value={draft.maxPosts}
          >
            {Array.from({ length: PATTERN_MAX_POSTS_LIMIT }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1ポスト（単発）" : `最大${n}ポスト`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-body">
          <span className="block font-medium">Web検索</span>
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
          <span className="block font-medium">出典URL</span>
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
          <span
            className={`text-caption ${over ? "font-semibold text-danger-fg" : "text-ink-3"}`}
          >
            {draft.prompt.length.toLocaleString()} /{" "}
            {PATTERN_PROMPT_MAX_CHARS.toLocaleString()} 字
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

/**
 * 削除の確認。**何が起きるかを先に書く**（CLAUDE.md 原則1）。
 * 「過去は残る」「予約は停止する」を言わないと、履歴が消えると思って押せない。
 */
function DeletePatternButton({
  disabled,
  name,
  onConfirm,
}: {
  disabled: boolean;
  name: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className="ml-auto inline-flex h-9 items-center rounded-card border border-hairline px-3 text-body text-danger-fg transition-colors duration-150 hover:bg-danger-bg disabled:opacity-50"
        disabled={disabled}
      >
        削除
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/30" />
        <AlertDialog.Popup
          className={`${cardClassName} fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5`}
        >
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
