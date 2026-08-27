"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createPromptPresetAction,
  deletePromptPresetAction,
  listPromptPresetsAction,
  setPromptPresetInUseAction,
  updatePromptPresetAction,
} from "@/app/actions/prompt-presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { actionReason } from "@/components/post/pattern-fields";
import { PRESET_MAX_CHARS, type PromptPresetKind, type PromptPresetView } from "@/lib/prompts/prompt-presets";

import { PromptListLead, PromptPanelCard, PromptAddPanel, PromptBodyField } from "./prompt-list-parts";

/**
 * アカウント.md・画像生成プロンプトの本棚（T-M8-332・運営者の指示 2026-08-27）。
 *
 * **投稿作成プロンプト（パターン管理）と同じ形にする。** 3区分は「AIへ渡す文章を育てる」
 * という同じ操作なのに、片方はカードの一覧、片方は1枚のテキストエリアで、
 * 画面ごとに操作を覚え直す必要があった。並べ方・保存の位置・追加の位置を揃える。
 *
 * **使用中は1件だけ。** どれが生成に使われているかを一覧の中で示し（バッジ）、
 * 切り替えはカードの中のボタンで行う。切り替えると生成が読む置き場へ写される
 * （`lib/prompts/prompt-presets-server.ts`）。
 */

interface Draft {
  name: string;
  content: string;
}

export function PromptPresetManager({
  emptyContentTemplate,
  initialPresets,
  kind,
  lead,
  bodyLabel,
  xAccountId,
}: {
  /** 「追加」で開いたときに本文へ入れておく雛形（空欄から書き始めさせない）。 */
  emptyContentTemplate: string;
  initialPresets: PromptPresetView[];
  kind: PromptPresetKind;
  /** 一覧の上に出す1文（この区分が何に効くか）。 */
  lead: string;
  /** 本文欄のラベル。 */
  bodyLabel: string;
  /** 表示中のXアカウント。保存の宛先ズレ防止に送る（T-M8-196）。 */
  xAccountId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [presets, setPresets] = useState(initialPresets);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialPresets.map((p) => [p.id, { name: p.name, content: p.content }])),
  );
  const [creating, setCreating] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const maxChars = PRESET_MAX_CHARS[kind];

  /** 待ちはサーバー処理の間だけ（T-M8-68。`router.refresh()` を待つとボタンが固まって見える）。 */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    setPending(true);
    try {
      return await action();
    } finally {
      setPending(false);
    }
  }

  function setDraft(id: string, next: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }

  /**
   * **理由を「どこを直せばよいか」に翻訳する**（原則2）。
   * サーバーは `details.reason` を返すが、画面へ出る `message` はコード共通の汎用文なので、
   * ここで具体的な文言にしないと「保存できません」だけが出る（T-M8-329 と同じ問題）。
   */
  function messageFor(res: { message?: string; details?: Record<string, unknown> }): string {
    switch (actionReason(res)) {
      case "structure":
        return "見出しの形が合っていません。「## 1.」から「## 6.」までを順に1つずつ入れてください。";
      case "empty":
        return "本文を入力してください。";
      case "too_long":
        return `本文は${maxChars.toLocaleString()}字以内で入力してください。`;
      case "name_length":
        return "名前は1〜30字で入力してください。";
      case "name_unsafe":
        return "名前に改行と「<」「>」は使えません。";
      case "name_taken":
        return "同じ名前がすでにあります。別の名前を付けてください。";
      case "preset_in_use":
        return "使用中のものは削除できません。先に別のものを「使用中にする」を押してください。";
      case "preset_changed":
        return "別の場所で更新されています。「再読み込み」を押してから保存し直してください。";
      case "base_md_learning_in_progress":
        return "学習の反映処理中です。完了してから保存してください。";
      default:
        return res.message ?? "保存できませんでした。";
    }
  }

  async function reload(): Promise<void> {
    const res = await run(() => listPromptPresetsAction({ kind, x_account_id: xAccountId }));
    if (res.status === "success" && res.presets) {
      setPresets(res.presets);
      setDrafts(Object.fromEntries(res.presets.map((p) => [p.id, { name: p.name, content: p.content }])));
      setErrors({});
      router.refresh();
      return;
    }
    toast.show({
      tone: "error",
      title: "読み込めませんでした",
      description: res.message ?? "時間をおいてもう一度お試しください。",
    });
  }

  function save(item: PromptPresetView) {
    const draft = drafts[item.id];
    if (!draft) return;
    void (async () => {
      const res = await run(() =>
        updatePromptPresetAction({
          x_account_id: xAccountId,
          preset_id: item.id,
          name: draft.name,
          content: draft.content,
          expected_updated_at: item.updatedAt,
        }),
      );
      if (res.status === "success" && res.preset) {
        const saved = res.preset;
        setPresets((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        setErrors((prev) => ({ ...prev, [item.id]: "" }));
        toast.show({
          tone: "success",
          title: `「${saved.name}」を保存しました`,
          description: saved.inUse ? "使用中なので、次の生成から反映されます。" : undefined,
        });
        router.refresh();
        return;
      }
      setErrors((prev) => ({ ...prev, [item.id]: messageFor(res) }));
    })();
  }

  function create() {
    if (!creating) return;
    void (async () => {
      const res = await run(() =>
        createPromptPresetAction({
          x_account_id: xAccountId,
          kind,
          name: creating.name,
          content: creating.content,
        }),
      );
      if (res.status === "success" && res.preset) {
        const added = res.preset;
        setPresets((prev) => [...prev, added]);
        setDrafts((prev) => ({ ...prev, [added.id]: { name: added.name, content: added.content } }));
        setCreating(null);
        setErrors((prev) => ({ ...prev, new: "" }));
        toast.show({
          tone: "success",
          title: `「${added.name}」を追加しました`,
          // **追加しただけでは切り替わらない**ことを言う（黙って生成が変わらない・原則1）。
          description: "使うときは「使用中にする」を押してください。",
        });
        router.refresh();
        return;
      }
      setErrors((prev) => ({ ...prev, new: messageFor(res) }));
    })();
  }

  function switchToPreset(item: PromptPresetView) {
    void (async () => {
      const res = await run(() =>
        setPromptPresetInUseAction({ x_account_id: xAccountId, preset_id: item.id }),
      );
      if (res.status === "success") {
        setPresets((prev) => prev.map((p) => ({ ...p, inUse: p.id === item.id })));
        toast.show({
          tone: "success",
          title: `「${item.name}」を使用中にしました`,
          description: "次の生成から使われます。",
        });
        router.refresh();
        return;
      }
      toast.show({
        tone: "error",
        title: "切り替えられませんでした",
        description: messageFor(res),
      });
    })();
  }

  function remove(item: PromptPresetView) {
    void (async () => {
      const res = await run(() =>
        deletePromptPresetAction({ x_account_id: xAccountId, preset_id: item.id }),
      );
      if (res.status === "success") {
        setPresets((prev) => prev.filter((p) => p.id !== item.id));
        toast.show({ tone: "success", title: `「${res.deletedName ?? item.name}」を削除しました` });
        router.refresh();
        return;
      }
      toast.show({ tone: "error", title: "削除できませんでした", description: messageFor(res) });
    })();
  }

  return (
    <div className="space-y-4">
      <PromptListLead count={presets.length} lead={lead} onReload={() => void reload()} pending={pending} />

      <ul className="grid gap-4 lg:grid-cols-2">
        {presets.map((item) => {
          const draft = drafts[item.id];
          if (!draft) return null;
          const dirty = draft.name !== item.name || draft.content !== item.content;
          return (
            <PromptPanelCard
              badges={
                item.inUse ? (
                  <Badge tone="brand">使用中</Badge>
                ) : (
                  <Badge tone="neutral">控え</Badge>
                )
              }
              key={item.id}
              title={draft.name || item.name}
            >
              {errors[item.id] ? (
                <div className="mt-2">
                  <Notice tone="danger">{errors[item.id]}</Notice>
                </div>
              ) : null}
              <PromptBodyField
                bodyLabel={bodyLabel}
                content={draft.content}
                idPrefix={`preset-${item.id}`}
                maxChars={maxChars}
                name={draft.name}
                onChange={(next) => setDraft(item.id, next)}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  disabled={pending || !dirty || draft.content.length > maxChars}
                  onClick={() => save(item)}
                  type="button"
                  variant="brand"
                >
                  保存
                </Button>
                {!item.inUse ? (
                  <Button disabled={pending} onClick={() => switchToPreset(item)} type="button" variant="subtle">
                    使用中にする
                  </Button>
                ) : null}
                {/* **使用中は消させない**（サーバーも拒否する）。押せてしまうと理由の分からない失敗になる。 */}
                <Button
                  disabled={pending || item.inUse}
                  onClick={() => remove(item)}
                  type="button"
                  variant="ghost"
                >
                  削除
                </Button>
              </div>
            </PromptPanelCard>
          );
        })}

        {creating ? (
          <PromptPanelCard title="新しいプロンプト">
            {errors.new ? (
              <div className="mt-2">
                <Notice tone="danger">{errors.new}</Notice>
              </div>
            ) : null}
            <PromptBodyField
              bodyLabel={bodyLabel}
              content={creating.content}
              idPrefix="new-preset"
              maxChars={maxChars}
              name={creating.name}
              onChange={(next) => setCreating((cur) => (cur ? { ...cur, ...next } : cur))}
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
          </PromptPanelCard>
        ) : (
          /* 追加は**一覧の最後**に同じパネル形式で置く（T-M8-331 と同じ考え方）。 */
          <PromptAddPanel
            disabled={pending}
            hint="いまの内容は残したまま、別の書き方を試せます"
            label="プロンプトを追加"
            onClick={() => setCreating({ name: "", content: emptyContentTemplate })}
          />
        )}
      </ul>
    </div>
  );
}
