"use client";

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
  NEW_PATTERN_PROMPT_TEMPLATE,
  threadCountLabel,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";
import {
  DeletePatternButton,
  PatternFields,
  actionReason,
  emptyPatternDraft,
  patternReasonMessage,
  toPatternDraft,
  toPatternPayload,
  type PatternDraft,
} from "@/components/post/pattern-fields";

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
    Object.fromEntries(initialPatterns.map((p) => [p.id, toPatternDraft(p, initialPrompts[p.id])])),
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
      setDrafts(Object.fromEntries(items.map((p) => [p.id, toPatternDraft(p, res.prompts![p.id])])));
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
          ...toPatternPayload(draft, systemDefaultPrompts[item.id] ?? null),
        }),
      );
    if (res.status === "success" && res.pattern) {
        const saved = res.pattern;
        setPatterns((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        setErrors((prev) => ({ ...prev, [item.id]: "" }));
        toast.show({ tone: "success", title: `「${saved.name}」を保存しました` });
        router.refresh();
      } else {
        const reason = actionReason(res);
        setErrors((prev) => ({ ...prev, [item.id]: patternReasonMessage(reason, res.message) }));
      }
    })();
  }

  function create() {
    if (!creating) return;
    void (async () => {
      const res = await run(() => createPatternAction(toPatternPayload(creating, null)));
    if (res.status === "success" && res.pattern) {
        const added = res.pattern;
        setPatterns((prev) => [...prev, added]);
        setDrafts((prev) => ({ ...prev, [added.id]: toPatternDraft(added, { content: added.hasCustomPrompt ? creating.prompt : "", isOverride: added.hasCustomPrompt, updatedAt: null }) }));
        setCreating(null);
        toast.show({ tone: "success", title: `「${added.name}」を追加しました` });
        router.refresh();
      } else {
        const reason = actionReason(res);
        setErrors((prev) => ({ ...prev, new: patternReasonMessage(reason, res.message) }));
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
        const reason = actionReason(res);
        toast.show({
          tone: "error",
          title: "削除できませんでした",
          description: patternReasonMessage(reason, res.message),
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
              onClick={() => setCreating(emptyPatternDraft(NEW_PATTERN_PROMPT_TEMPLATE))}
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
                {threadCountLabel(item.maxPosts)}・編集は{item.maxPostsEdit}ポストまで
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
