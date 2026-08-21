"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useState } from "react";

import {
  listPromptTemplatesAction,
  resetPromptTemplateAction,
  updatePromptTemplateAction,
} from "@/app/actions/prompt-templates";
import type { PromptTemplateView } from "@/lib/prompts/prompt-templates";
import { Badge } from "@/components/ui/badge";

/**
 * SC-10 プロンプトエディタ（M-2/M-3, 要件06 §9, T-M5-11）。md/premium のみ編集可。kind選択（p1〜p4/p6・
 * image。p5はflag OFF中非表示）→編集→保存／「システム既定に戻す」。override有無バッジ・文字数カウンタ・
 * 楽観lock競合（409→再読込）を表示。モバイルは閲覧可・編集はPC推奨（要件06 §2）。
 */

const MAX_CHARS = 8000;

/**
 * kind → 見出し。**この画面は U4b でパターン管理画面へ置き換わる**（T-M8-129）。
 * それまでの間、既定パターンの名前は当時の対応表から出す（利用者が名前を変えても
 * この画面の見出しは変わらないが、正しい編集先は `post_patterns` なので実害はない）。
 */
/**
 * この画面が扱うのは画像プロンプトだけ（T-M8-140）。
 * 以前は投稿の型（p1〜p6）のラベルへも落ちる分岐があり、**再読み込みで対象がすり替わったとき
 * 見出しが「ニュース解説」に変わって、間違ったものを編集している自覚を奪っていた**。
 */
const PROMPT_HEADING = "画像プロンプト";

/**
 * **画面に残す通知だけ**（T-M8-18）。判断は `base-md-editor.tsx` と同じ。
 * 操作の成否はトーストへ出し、入力検証と「再読み込み」ボタンを伴う競合だけをここに残す。
 */
type Note =
  | { kind: "validation"; text: string }
  | { kind: "conflict"; text: string }
  | null;

interface ActionError {
  code?: string;
  details?: Record<string, unknown>;
  message?: string;
}

export function PromptTemplatesEditor({
  initialTemplates,
  xAccountId,
}: {
  initialTemplates: PromptTemplateView[];
  /** 表示中のXアカウント。保存・リセットの宛先ズレ防止に送る（T-M8-196）。 */
  xAccountId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /**
   * 待ち状態は**サーバー処理そのものの間だけ**にする（T-M8-68）。
   * transition の中で `router.refresh()` を呼んでいたため、保存が終わって
   * トーストが出た後も再取得が終わるまでボタンが「保存中…」のまま固まっていた。
   * 表示中の内容は action の戻り値（applyTemplate）で更新済みなので refresh は待たない。
   * finally で必ず戻すので、例外時も押せない画面にならない。
   */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    setPending(true);
    try {
      return await action();
    } finally {
      setPending(false);
    }
  }
  const [templates, setTemplates] = useState<PromptTemplateView[]>(initialTemplates);

  /**
   * この画面が扱うのは画像プロンプトだけ（投稿の型はパターン管理へ移った・T-M8-129 U4b）。
   *
   * **入力データで対象を決めない**（T-M8-139）。以前は `visible[0].kind` だったため、
   * 「再読み込み」が p1〜p6 も含む一覧を取り込んだ瞬間に編集対象が p1 へすり替わり、
   * 保存すると投稿パターンのプロンプトを画像プロンプトの本文で上書きした。
   * 一覧側も画像だけを返すようにしたが、ここも固定して二重に防ぐ。
   */
  const selectedKind = "image" as const;
  const current = templates.find((t) => t.kind === selectedKind) ?? null;
  const [draft, setDraft] = useState<string>(current?.content ?? "");
  const [note, setNote] = useState<Note>(null);
  const toast = useToast();

  const overLimit = draft.length > MAX_CHARS;
  const dirty = current ? draft !== current.content : false;

  function applyTemplate(t: PromptTemplateView) {
    setTemplates((prev) => prev.map((p) => (p.kind === t.kind ? t : p)));
    setDraft(t.content);
  }

  function applyError(res: ActionError) {
    const reason = typeof res.details?.reason === "string" ? res.details.reason : undefined;
    if (res.code === "job_conflict") {
      setNote({
        kind: "conflict",
        text: "別の場所でこのプロンプトが更新されました。最新の内容を再読み込みしてください（未保存の編集は失われます）。",
      });
      return;
    }
    if (res.code === "validation_error" && reason === "too_long") {
      setNote({ kind: "validation", text: `本文が長すぎます（${MAX_CHARS.toLocaleString()}字以内）。` });
      return;
    }
    if (res.code === "validation_error" && reason === "empty") {
      setNote({ kind: "validation", text: "本文を入力してください。" });
      return;
    }
    toast.show({ tone: "error", title: "実行できませんでした", description: res.message ?? "処理に失敗しました。" });
  }

  async function reload() {
    const res = await run(() => listPromptTemplatesAction());
    if (res.status === "success" && res.templates) {
      setTemplates(res.templates);
      setDraft(res.templates.find((t) => t.kind === selectedKind)?.content ?? "");
      setNote(null);
      toast.show({ tone: "success", title: "最新の内容を読み込みました" });
    } else {
      applyError(res);
    }
  }

  function save() {
    if (!current) return;
    void (async () => {
      const res = await run(() =>
        updatePromptTemplateAction({
          kind: selectedKind,
          x_account_id: xAccountId,
          content: draft,
          expected_updated_at: current.updatedAt,
        }),
      );
      if (res.status === "success" && res.template) {
        applyTemplate(res.template);
        setNote(null);
        toast.show({ tone: "success", title: "保存しました" });
        router.refresh();
      } else {
        applyError(res);
      }
    })();
  }

  function reset() {
    if (!current?.isOverride) return;
    if (!confirm("このプロンプトをシステム既定に戻します。カスタム内容は削除されます。よろしいですか？")) {
      return;
    }
    void (async () => {
      const res = await run(() =>
        resetPromptTemplateAction({ kind: selectedKind, x_account_id: xAccountId }),
      );
      if (res.status === "success" && res.template) {
        applyTemplate(res.template);
        setNote(null);
        toast.show({ tone: "success", title: "システム既定に戻しました" });
        router.refresh();
      } else {
        applyError(res);
      }
    })();
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground lg:hidden">
        プロンプトの編集はPCでの操作を推奨します。モバイルでは閲覧のみを想定しています。
      </p>

      {note ? (
        <div
          className="rounded-card border border-hairline bg-warn-bg px-4 py-2 text-sm text-warn-fg"
          role="alert"
        >
          {note.text}
          {note.kind === "conflict" ? (
            <button
              className="ml-2 font-medium underline underline-offset-2 disabled:opacity-50"
              disabled={pending}
              onClick={() => void reload()}
              type="button"
            >
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-card border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            **プルダウンは置かない**（T-M8-129 U4b・運営者の指示 2026-08-18）。
            この画面が扱うのは画像プロンプト1件だけで、選択肢が1つのselectは
            「他に何かある」と思わせるだけの操作になる。投稿の型は「投稿作成プロンプト」の
            パターン管理（全件を並べる）で編集する。
          */}
          <h3 className="text-body font-bold text-ink">{PROMPT_HEADING}</h3>
          {current ? (
            <Badge className="mt-4" tone={current.isOverride ? "brand" : "neutral"}>
              {current.isOverride ? "カスタム" : "既定"}
            </Badge>
          ) : null}
          <span
            className={`ml-auto mt-4 text-xs ${overLimit ? "font-semibold text-danger-fg" : "text-muted-foreground"}`}
          >
            {draft.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 字
          </span>
        </div>

        <textarea
          aria-label="プロンプト本文"
          className="mt-3 h-96 w-full resize-y rounded-md border p-3 font-mono text-sm disabled:bg-muted/40"
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          value={draft}
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={pending || overLimit || !dirty}
            onClick={save}
            type="button"
          >
            保存
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending || !current?.isOverride}
            onClick={reset}
            type="button"
          >
            システム既定に戻す
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => void reload()}
            type="button"
          >
            再読み込み
          </button>
        </div>
        {/* 編集できる対象は「プロンプト種別」の選択肢が示す。内部ID（SYS-GEN）は出さない（T-M8-66）。 */}
      </section>
    </div>
  );
}
