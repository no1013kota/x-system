"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  getBaseMdAction,
  rollbackBaseMdAction,
  updateBaseMdManualAction,
} from "@/app/actions/base-md";
import { useToast } from "@/components/ui/toast";
import type { BaseMdVersionView } from "@/lib/base-md";
import { BASE_MD_SECTION_TITLES } from "@/lib/persona-settings";
import { formatJst } from "@/lib/format";

/**
 * SC-10 ベースmdエディタ（M-1, 要件06 §9, T-M5-09）。md/premium のみ編集可。6見出し構造/5,000字を
 * サーバ検証し、保存成功／構造エラー／version競合（409→再読込）の3状態を表示。履歴からロールバック
 * （確認ダイアログ→新version）。学習ジョブrunning中は編集不可。セクション1〜4は発信設定保存で上書き
 * される旨を常時注意表示。モバイルは閲覧可・編集はPC推奨（要件06 §2）。
 */

const MAX_CHARS = 5000;

const CHANGE_SOURCE_LABEL: Record<string, string> = {
  settings: "発信設定",
  learning: "学習反映",
  manual: "手動編集",
  rollback: "ロールバック",
};

/**
 * **画面に残す通知だけ**（T-M8-18）。操作の成否はトーストへ出す。
 * - `validation`: 何を直せばよいかを本文の近くに置く必要がある（トーストは5秒で消える）。
 * - `conflict`: 「再読み込み」ボタンを伴う。トーストの導線は `<a>` 1本しか持てない。
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

function reasonOf(res: ActionError): string | undefined {
  const r = res.details?.reason;
  return typeof r === "string" ? r : undefined;
}

export function BaseMdEditor({
  xAccountId,
  initialContent,
  initialVersion,
  initialHistory,
  learningRunning: initialLearningRunning,
}: {
  xAccountId: string;
  initialContent: string;
  initialVersion: number;
  initialHistory: BaseMdVersionView[];
  learningRunning: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState(initialContent);
  const [version, setVersion] = useState(initialVersion);
  const [history, setHistory] = useState<BaseMdVersionView[]>(initialHistory);
  const [learningRunning, setLearningRunning] = useState(initialLearningRunning);
  const [note, setNote] = useState<Note>(null);
  const toast = useToast();
  const [dirty, setDirty] = useState(false);

  const editingDisabled = pending || learningRunning;
  const overLimit = content.length > MAX_CHARS;

  function applyError(res: ActionError) {
    const reason = reasonOf(res);
    if (res.code === "job_conflict" && reason === "base_md_version_changed") {
      setNote({
        kind: "conflict",
        text: "別の場所でベースmdが更新されました。最新の内容を再読み込みしてください（未保存の編集は失われます）。",
      });
      return;
    }
    if (res.code === "job_conflict" && reason === "base_md_learning_in_progress") {
      // 画面上部に編集不可の案内が常時出るので、ここでは結果だけ伝える。
      setLearningRunning(true);
      toast.show({ tone: "error", title: "学習の反映処理中です", description: "完了後に編集できます。" });
      return;
    }
    if (res.code === "validation_error" && reason === "too_long") {
      setNote({ kind: "validation", text: `本文が長すぎます（${MAX_CHARS.toLocaleString()}字以内）。` });
      return;
    }
    if (res.code === "validation_error" && reason === "structure") {
      setNote({
        kind: "validation",
        text: "見出し構造が不正です。「## 1.」〜「## 6.」の6見出しを順番どおり各1回だけ含めてください。",
      });
      return;
    }
    toast.show({ tone: "error", title: "実行できませんでした", description: res.message ?? "処理に失敗しました。" });
  }

  async function reload() {
    const res = await getBaseMdAction({ x_account_id: xAccountId });
    if (res.status === "success" && res.content !== undefined && res.version !== undefined) {
      setContent(res.content);
      setVersion(res.version);
      setHistory(res.history ?? []);
      setLearningRunning(res.learningRunning ?? false);
      setDirty(false);
      setNote(null);
      toast.show({ tone: "success", title: "最新の内容を読み込みました" });
    } else {
      applyError(res);
    }
  }

  function save() {
    startTransition(async () => {
      const res = await updateBaseMdManualAction({
        x_account_id: xAccountId,
        content,
        expected_version: version,
      });
      if (res.status === "success" && res.version !== undefined) {
        setVersion(res.version);
        setDirty(false);
        setNote(null);
        toast.show({ tone: "success", title: `保存しました（version ${res.version}）` });
        const refreshed = await getBaseMdAction({ x_account_id: xAccountId });
        if (refreshed.status === "success") {
          setHistory(refreshed.history ?? []);
          setLearningRunning(refreshed.learningRunning ?? false);
        }
        router.refresh();
      } else {
        applyError(res);
      }
    });
  }

  function rollback(target: number) {
    if (
      !confirm(
        `version ${target} の内容で新しいversionを作成します。現在の編集内容は破棄されます。よろしいですか？`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await rollbackBaseMdAction({
        x_account_id: xAccountId,
        version: target,
        expected_version: version,
      });
      if (res.status === "success" && res.version !== undefined) {
        setNote(null);
        toast.show({
          tone: "success",
          title: `version ${target} の内容で version ${res.version} を作成しました`,
        });
        const refreshed = await getBaseMdAction({ x_account_id: xAccountId });
        if (refreshed.status === "success" && refreshed.content !== undefined && refreshed.version !== undefined) {
          setContent(refreshed.content);
          setVersion(refreshed.version);
          setHistory(refreshed.history ?? []);
          setLearningRunning(refreshed.learningRunning ?? false);
          setDirty(false);
        }
        router.refresh();
      } else {
        applyError(res);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* PC推奨（編集はモバイル非推奨） */}
      <p className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground lg:hidden">
        ベースmdの編集はPCでの操作を推奨します。モバイルでは閲覧のみを想定しています。
      </p>

      {/* セクション1〜4の上書き注意（常時） */}
      <p className="rounded-lg border border-warn-fg/25 bg-warn-bg px-4 py-2 text-sm text-warn-fg">
        手で直した「1. {BASE_MD_SECTION_TITLES[0]}」〜「4. {BASE_MD_SECTION_TITLES[3]}」は、次に「発信設定」を保存すると上書きされます。恒久的に変えたい場合は、発信設定側でも同じ内容にしてください。この画面の変更履歴からは、いつでも以前の版に戻せます。
      </p>

      {/* 学習running中の編集不可 */}
      {learningRunning ? (
        <p className="rounded-lg border border-warn-fg/25 bg-warn-bg px-4 py-2 text-sm text-warn-fg">
          学習の反映処理中のため、ベースmdは編集できません。完了までお待ちください。
        </p>
      ) : null}

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
              onClick={() => startTransition(reload)}
              type="button"
            >
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}

      {/* エディタ */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">ベースmd（現在: version {version}）</h2>
          <span
            className={`ml-auto text-xs ${overLimit ? "font-semibold text-danger-fg" : "text-muted-foreground"}`}
          >
            {content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 字
          </span>
        </div>
        <textarea
          aria-label="ベースmd本文"
          className="mt-3 h-96 w-full resize-y rounded-md border p-3 font-mono text-sm disabled:bg-muted/40"
          disabled={editingDisabled}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          value={content}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={editingDisabled || overLimit || !dirty}
            onClick={save}
            type="button"
          >
            保存
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending}
            onClick={() => startTransition(reload)}
            type="button"
          >
            再読み込み
          </button>
        </div>
      </section>

      {/* 履歴・ロールバック */}
      <section>
        <h2 className="text-sm font-semibold">変更履歴</h2>
        {history.length === 0 ? (
          <p className="mt-2 rounded-card border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            まだ履歴はありません。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {history.map((h) => (
              <li className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-surface p-4" key={h.version}>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">v{h.version}</span>
                <span className="rounded px-2 py-0.5 text-xs">{CHANGE_SOURCE_LABEL[h.changeSource] ?? h.changeSource}</span>
                {h.summary ? <span className="text-xs text-muted-foreground">{h.summary}</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">{formatJst(h.createdAt)}</span>
                {h.version !== version ? (
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={editingDisabled}
                    onClick={() => rollback(h.version)}
                    type="button"
                  >
                    この版へ戻す
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">現在</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
