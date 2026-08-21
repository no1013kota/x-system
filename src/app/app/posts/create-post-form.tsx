"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import {
  cancelGenerationJobAction,
  createGenerationJobAction,
  getGenerationJobAction,
  retryGenerationJobAction,
} from "@/app/actions/generation-jobs";
import { ExecutionPrereqNotice } from "@/components/app-shell/execution-prereq-notice";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import type { PrereqItem } from "@/lib/execution-prereqs";
import { PatternRadioGroup } from "@/components/post/pattern-radio-group";
import { PromptBlock } from "@/components/post/prompt-block";
import { extractPlaceholderNames } from "@/lib/post/pattern-spec";
import {
  NEW_PATTERN_PROMPT_TEMPLATE,
  threadCountLabel,
  type PatternOption,
} from "@/lib/post/post-patterns-store";
import {
  PatternFields,
  PlaceholderSummary,
  actionReason,
  emptyPatternDraft,
  patternReasonMessage,
  toPatternPayload,
  type PatternDraft,
} from "@/components/post/pattern-fields";
import { selectablePostThemeOptions } from "@/lib/post/post-theme";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { updateBaseMdManualAction } from "@/app/actions/base-md";
import {
  createPatternAction,
  deletePatternAction,
  updatePatternPromptAction,
} from "@/app/actions/post-patterns";
import { updatePromptTemplateAction } from "@/app/actions/prompt-templates";
import { createPollGuard, POLL_INTERVAL_MS, pollGiveUpMessage } from "@/lib/ui/poll-guard";

/** プロンプトの上限（AI設定＞プロンプトの保存上限 `PROMPT_TEMPLATE_MAX_CHARS` と同値・T-M8-92）。 */
const PROMPT_MAX_CHARS = 8000;
/** アカウント.mdの上限（`BASE_MD_MAX_CHARS` と同値・T-M8-93）。 */
const BASE_MD_MAX = 5000;

export interface ActiveJob {
  id: string;
  status: string;
  progressStage: string | null;
  draftId: string | null;
  createdAt: string;
  /** 失敗理由。表示するのは code と利用者向け message だけ（provider_raw_error は使わない）。 */
  error?: JobFailure | null;
}

export interface JobFailure {
  code: string | null;
  message: string | null;
}

/** job.error（jsonb）から表示に使う code / message だけを取り出す。 */
function toJobFailure(value: unknown): JobFailure | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { code?: unknown; message?: unknown };
  return {
    code: typeof raw.code === "string" ? raw.code : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

const STAGE_LABEL: Record<string, string> = {
  validating: "前提を確認しています",
  research: "情報をリサーチしています",
  writing: "本文を作成しています",
  image: "画像を生成しています",
};
const STAGE_ORDER = ["validating", "research", "writing", "image"];

/** 再試行しても直らない失敗（前提不足）。それぞれの設定画面へ誘導する。 */
const PREREQ_FAILURE_PATH: Record<string, string> = {
  subscription_required: "/app/settings?tab=billing",
  api_key_required: "/app/settings?tab=api-keys",
  x_account_required: "/app/settings?tab=x-accounts",
  persona_required: "/app/settings?tab=account",
};
const PREREQ_FAILURE_CODES = new Set(Object.keys(PREREQ_FAILURE_PATH));
const QUEUED_SLOW_MS = 60_000;
const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * **前提が足りずに始められなかった**ときだけ画面へ残す（T-M8-18）。解決先へのリンクを伴い、
 * 直しに行って戻ってきたときにも見えている必要があるため、消えるトーストにはしない。
 * それ以外の「始められなかった」はトーストへ出す。
 */
interface PrereqError {
  message: string;
  settingsPath: string;
  missing?: PrereqItem[];
}

/** 生成に使うプロンプト（型ごと）。updatedAt は「保存」の楽観ロックに使う（T-M8-92）。 */
export interface PromptTemplateProp {
  content: string;
  updatedAt: string | null;
  isOverride: boolean;
}

export function CreatePostForm({
  xAccountId,
  patterns,
  imageProviders,
  initialJob = null,
  initialNowMs,
  promptTemplates = null,
  baseMd = null,
}: {
  xAccountId: string;
  patterns: PatternOption[];
  imageProviders: string[];
  initialJob?: ActiveJob | null;
  /** サーバーが描画した時刻（ミリ秒）。経過表示の初期値。 */
  initialNowMs: number;
  /** null = 編集権限なし（未契約）。セクションごと出さない。p1〜p6＋image。 */
  promptTemplates?: Record<string, PromptTemplateProp> | null;
  /** アカウント.md（T-M8-93）。version は保存の楽観ロック。standard は null。 */
  baseMd?: { content: string; version: number } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState(patterns[0]?.id ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  /**
   * テーマ。**選択は必須**（2026-08-03 ユーザー判断）。空文字は「まだ選んでいない」状態で、
   * 生成ボタンを押せない状態にする（`lib/post/post-theme.ts` の判断）。
   */
  const [theme, setTheme] = useState("");
  const [instructions, setInstructions] = useState("");
/** パターンの入力項目の値（`{名前}` へ差し込む・T-M8-132）。 */
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [imageEnabled, setImageEnabled] = useState(false);
  /**
   * 生成に使うプロンプト（T-M8-92・md/premium）。
   * `templates` はサーバー解決値のローカルコピー（「保存」成功時に更新する）。
   * `promptDraft` は編集中の本文（null = 未編集）。型を切り替えたら編集を破棄する
   * （別の型のプロンプトに前の型の編集を残すと、意図しない指示で生成される）。
   */
  const [templates, setTemplates] = useState(promptTemplates);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [promptApply, setPromptApply] = useState<"once" | "save">("once");
  /** アカウント.md・画像プロンプト（T-M8-93）。型と独立に編集できるため状態も分ける。 */
  // 既定はアカウント.md（T-M8-105・運営者の指示 2026-08-15。全パターン共通の土台を先に見せる）。
  const [promptTab, setPromptTab] = useState<"pattern" | "base_md" | "image">("base_md");
  const [baseMdState, setBaseMdState] = useState(baseMd);
  const [baseMdDraft, setBaseMdDraft] = useState<string | null>(null);
  const [baseMdApply, setBaseMdApply] = useState<"once" | "save">("once");
  const [imageDraft, setImageDraft] = useState<string | null>(null);
  const [imageApply, setImageApply] = useState<"once" | "save">("once");
  const [prereq, setPrereq] = useState<PrereqError | null>(null);
  const toast = useToast();
  const [job, setJob] = useState<ActiveJob | null>(initialJob);
  /**
   * 経過表示の基準時刻（T-M8-113）。**初期値はサーバーが測った時刻を使う。**
   * `Date.now()` を初期値にすると、サーバーが描いた時刻とブラウザがJSで追いつく時刻の
   * あいだで秒が変わり、「経過 0:06」と「経過 0:07」が食い違って React が木を捨てて
   * 描き直す（Hydration mismatch）。生成中に画面を開き直したときだけ出るため再現しにくく、
   * 放置すると本当の不整合が起きても同じ警告に紛れて気付けなくなる。
   * サーバーの測った時刻をそのまま初期値にすれば両者が必ず一致し、しかも初回描画から
   * 正しい経過秒が出る。以後はポーリングのたびにブラウザの実時刻へ更新される。
   */
  const [nowMs, setNowMs] = useState(initialNowMs);

  // 進行中のあいだ getGenerationJob をポーリングして状態を更新する（再訪時も initialJob から再開）。
  //
  // **取得できない状態が続いたら打ち切って伝える**（T-M8-51）。以前は失敗を黙って捨てて回り続けて
  // いたため、「生成中…」が永遠に出たままトーストが1つも出なかった。
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const guard = createPollGuard();
    const timer = setInterval(async () => {
      setNowMs(Date.now());
      const res = await getGenerationJobAction({ job_id: job.id });
      const ok = res.status === "success" && Boolean(res.job);
      if (guard.tick(ok) === "give-up") {
        clearInterval(timer);
        toast.show({ tone: "error", ...pollGiveUpMessage(guard.reason()) });
        return;
      }
      if (ok && res.job) {
        const nextJob = res.job;
        setJob((prev) => ({
          id: nextJob.id,
          status: nextJob.status,
          progressStage: nextJob.progress_stage,
          draftId: nextJob.draft_id,
          createdAt: prev?.createdAt ?? job.createdAt,
          error: toJobFailure(nextJob.error),
        }));
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, job?.createdAt, job, toast]);

/**
   * パターンの追加（T-M8-130・運営者の指示 2026-08-18）。
   * **設定画面へ行かずにここで作れる。** 投稿を作ろうとして「この型が無い」と気付くのは
   * この画面なので、そこで作れないと目的（投稿を作る）が中断する。
   * 追加したらそのまま選択された状態にする。
   */
  const [options, setOptions] = useState(patterns);
  const [newPattern, setNewPattern] = useState<PatternDraft | null>(null);
  const [newPatternError, setNewPatternError] = useState<string | null>(null);

  /** 選択中のパターン。入力欄の出し分け（意見の入力）と表示名に使う。 */
  const selectedPattern = options.find((option) => option.id === pattern) ?? null;
  const currentTemplate = templates?.[pattern] ?? null;
  const promptValue = promptDraft ?? currentTemplate?.content ?? "";
  /*
    入力項目（プレースホルダー）は**いま画面に見えているプロンプト本文**から導出する（T-M8-186）。
    編集で {名前} を増減すると、入力欄もその場で増減する。定義（pattern.placeholders）を
    見ないのは、上書き編集中は定義とズレるため——生成側も同じく本文基準で差し込む。
  */
  const activePlaceholderNames = extractPlaceholderNames(promptValue);
  const promptEdited = promptDraft !== null && promptDraft !== (currentTemplate?.content ?? "");
  const promptOverLimit = promptValue.length > PROMPT_MAX_CHARS;
  const imageTemplate = templates?.["image"] ?? null;
  const imageValue = imageDraft ?? imageTemplate?.content ?? "";
  const imageEdited = imageDraft !== null && imageDraft !== (imageTemplate?.content ?? "");
  const imageOverLimit = imageValue.length > PROMPT_MAX_CHARS;
  const baseMdValue = baseMdDraft ?? baseMdState?.content ?? "";
  const baseMdEdited = baseMdDraft !== null && baseMdDraft !== (baseMdState?.content ?? "");
  const baseMdOverLimit = baseMdValue.length > BASE_MD_MAX;
  /** アカウント.mdはアカウント設定の保存で初めて作られる。無いあいだは編集対象が無い。 */
  const baseMdReady = (baseMdState?.version ?? 0) >= 1 && (baseMdState?.content ?? "") !== "";
  const anyPromptOverLimit = promptOverLimit || imageOverLimit || baseMdOverLimit;
  const anyPromptEdited = promptEdited || imageEdited || baseMdEdited;

function addPattern() {
    if (!newPattern) return;
    void (async () => {
      const res = await createPatternAction({ x_account_id: xAccountId, ...toPatternPayload(newPattern, null) });
      if (res.status === "success" && res.pattern) {
        const added = res.pattern;
        setOptions((prev) => [...prev, added]);
        // 作った型をそのまま選ぶ（作った直後に選び直させない）。
        setPattern(added.id);
        setPromptDraft(null);
        setTemplates((prev) => ({
          ...(prev ?? {}),
          // `updatedAt` は作成時の実値（T-M8-135）。null だと直後の「保存して以後も使う」が
          // `prompt is null` 条件に当たって必ず衝突する。
          [added.id]: {
            content: newPattern.prompt,
            updatedAt: added.promptUpdatedAt,
            isOverride: true,
          },
        }));
        setNewPattern(null);
        setNewPatternError(null);
        toast.show({ tone: "success", title: `「${added.name}」を追加しました` });
      } else {
        setNewPatternError(patternReasonMessage(actionReason(res), res.message));
      }
    })();
  }

/**
   * パターンの削除（T-M8-133・運営者の指示 2026-08-18）。
   * **選んでいる型が要らないと気付くのもこの画面**なので、ここで消せるようにする。
   * 消したら選択を先頭へ戻す（消した型が選ばれたままにしない）。
   */
function removePattern(target: PatternOption) {
    startTransition(async () => {
    const res = await deletePatternAction({ pattern_id: target.id });
      if (res.status === "success") {
        const rest = options.filter((o) => o.id !== target.id);
        setOptions(rest);
        if (pattern === target.id) {
          setPattern(rest[0]?.id ?? "");
          setPromptDraft(null);
        }
        const stopped = res.disabledSlots ?? 0;
        toast.show({
          tone: "success",
          title: `「${res.deletedName ?? target.name}」を削除しました`,
          description:
            stopped > 0
              ? `このパターンを使っていた予約${stopped}件を停止しました（曜日・時刻は残っています）。`
              : "過去の下書き・履歴の表示はそのまま残ります。",
        });
      } else {
      toast.show({
          tone: "error",
          title: "削除できませんでした",
          description: patternReasonMessage(actionReason(res), res.message),
        });
      }
    });
  }

  function submit() {
    setPrereq(null);
    startTransition(async () => {
      // 編集して「保存して以後も使う」を選んだブロックは、生成の前に保存を確定する
      // （保存に失敗したのに生成だけ走ると、どのプロンプトで生成されたか分からなくなる）。
      // 保存が1つでも失敗したら生成を始めない。
      /**
       * `key` はパターンID（uuid）か `"image"`。**保存先が違う**（T-M8-129 U3）:
       * パターンは `post_patterns.prompt`、画像は `prompt_templates`。
       */
      async function saveTemplate(key: string, content: string): Promise<boolean> {
        const expected = templates?.[key]?.updatedAt ?? null;
        const saved =
          key === "image"
            ? await updatePromptTemplateAction({
                kind: "image",
                x_account_id: xAccountId,
                content,
                expected_updated_at: expected,
              })
            : await updatePatternPromptAction({
                pattern_id: key,
                content,
                expected_updated_at: expected,
              });
        // 戻りの形が違う（画像は `template`、パターンは `prompt`）。どちらも同じ3項目を持つ。
        const savedView =
          "template" in saved
            ? saved.template
            : ("prompt" in saved ? saved.prompt : undefined);
        if (saved.status === "error" || !savedView) {
          toast.show({
            tone: "error",
            title: "プロンプトを保存できませんでした",
            description:
              saved.code === "job_conflict"
                ? "プロンプトが別の場所で更新されています。ページを再読み込みしてから、もう一度お試しください。"
                : saved.message,
          });
          return false;
        }
        setTemplates((prev) => ({
          ...(prev ?? {}),
          [key]: {
            content: savedView.content,
            updatedAt: savedView.updatedAt,
            isOverride: savedView.isOverride,
          },
        }));
        return true;
      }

      let promptOverride: string | undefined;
      if (templates && promptEdited && promptDraft !== null) {
        if (promptApply === "save") {
          if (!(await saveTemplate(pattern, promptDraft))) return;
          setPromptDraft(null);
          // 保存済み＝通常の解決で同じ内容が使われるため、override は送らない。
        } else {
          promptOverride = promptDraft;
        }
      }
      let imagePromptOverride: string | undefined;
      if (templates && imageEdited && imageDraft !== null) {
        if (imageApply === "save") {
          if (!(await saveTemplate("image", imageDraft))) return;
          setImageDraft(null);
        } else {
          imagePromptOverride = imageDraft;
        }
      }
      let baseMdOverride: string | undefined;
      if (baseMdState && baseMdEdited && baseMdDraft !== null) {
        if (baseMdApply === "save") {
          const saved = await updateBaseMdManualAction({
            x_account_id: xAccountId,
            content: baseMdDraft,
            expected_version: baseMdState.version,
          });
          if (saved.status === "error" || typeof saved.version !== "number") {
            toast.show({
              tone: "error",
              title: "アカウント.mdを保存できませんでした",
              description:
                saved.code === "job_conflict"
                  ? "アカウント.mdが別の場所で更新されています。ページを再読み込みしてから、もう一度お試しください。"
                  : saved.message,
            });
            return;
          }
          setBaseMdState({ content: baseMdDraft, version: saved.version });
          setBaseMdDraft(null);
        } else {
          baseMdOverride = baseMdDraft;
        }
      }
      const res = await createGenerationJobAction({
        request_key: crypto.randomUUID(),
        x_account_id: xAccountId,
        pattern,
        source_url: sourceUrl.trim() || undefined,
        theme,
      // このパターンが持つ項目だけを送る（型を切り替えても前の型の値を持ち越さない）。
        // 空でも名前ごと送る（上書きで増やした項目を生成側が「（未指定）」で埋めるため・T-M8-186）。
        placeholder_values: Object.fromEntries(
          activePlaceholderNames.map((name) => [name, (placeholderValues[name] ?? "").trim()]),
        ),
        instructions: instructions.trim() || undefined,
        image_enabled: imageEnabled,
        prompt_override: promptOverride,
        base_md_override: baseMdOverride,
        image_prompt_override: imagePromptOverride,
      });
      if (res.status === "error") {
        const settingsPath = res.details?.settingsPath as string | undefined;
        if (settingsPath) {
          setPrereq({
            message: res.message,
            settingsPath,
            missing: res.details?.missing as PrereqItem[] | undefined,
          });
        } else {
          toast.show({ tone: "error", title: "生成を開始できませんでした", description: res.message });
        }
        return;
      }
      if (res.jobId) {
        setJob({
          id: res.jobId,
          status: "queued",
          progressStage: null,
          draftId: null,
          createdAt: new Date().toISOString(),
        });
      }
    });
  }

  function retry() {
    if (!job) return;
    const failedId = job.id;
    startTransition(async () => {
      const res = await retryGenerationJobAction({
        request_key: crypto.randomUUID(),
        job_id: failedId,
      });
      if (res.status === "error") {
        toast.show({ tone: "error", title: "再試行できませんでした", description: res.message });
        return;
      }
      if (res.jobId) {
        setJob({
          id: res.jobId,
          status: "queued",
          progressStage: null,
          draftId: null,
          createdAt: new Date().toISOString(),
        });
      }
    });
  }

  function cancel() {
    if (!job) return;
    const jobId = job.id;
    startTransition(async () => {
      const res = await cancelGenerationJobAction({ job_id: jobId });
      if (res.status === "error") {
        toast.show({ tone: "error", title: "キャンセルできませんでした", description: res.message });
        return;
      }
      setJob((prev) => (prev ? { ...prev, status: res.jobStatus ?? "canceled" } : prev));
    });
  }

  const inProgress = job !== null && !TERMINAL.has(job.status);
  const elapsedSec = job ? Math.max(0, Math.floor((nowMs - new Date(job.createdAt).getTime()) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;
  const queuedSlow =
    job?.status === "queued" && nowMs - new Date(job.createdAt).getTime() > QUEUED_SLOW_MS;

  return (
    // デザインは入力→生成中→確認の**順に進む**1カラム（左右2ペインではない）。
    // 横に並べるとパターン6枚が潰れ、選びにくくなる（実測で3列が2列に落ちた）。
    <div className="space-y-3.5">
      {/* 入力（ステート1） */}
      <section
        aria-label="生成入力"
        className={`${cardClassName} space-y-5 p-5`}
      >
        {/* テーマを先頭に置く（T-M8-101・運営者の指示 2026-08-15。何を書くかを先に決め、書き方の型をその後に選ぶ）。 */}
        <div>
          <label className="block text-body font-medium text-ink" htmlFor="theme">
            テーマ
          </label>
          <select
            aria-describedby="theme-help"
            className="mt-1 h-10 w-full rounded-card border border-hairline bg-surface px-3 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
            id="theme"
            onChange={(e) => setTheme(e.target.value)}
            required
            value={theme}
          >
            <option value="">選択してください</option>
            {/* 選択肢は最新ニュース画面と同じ運用テーマ＋その他（T-M8-100）。既存の旧値は保全される。 */}
            {selectablePostThemeOptions(theme).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground" id="theme-help">
            決めずに書かせたいときは「その他」を選び、追加指示に書いてください。
          </p>
        </div>

        {/*
          パターン選択はスケジュール画面と同じ部品を使う（T-M8-29）。
          同じものを選ぶ操作なので、画面によって見た目や情報量が変わらないようにする。
        */}
      <PatternRadioGroup
          deleteDisabled={pending}
          name="pattern"
          onChange={(next) => {
            setPattern(next);
            // 型を切り替えたら編集中のプロンプトを破棄する（別の型に前の編集を持ち越さない）。
            setPromptDraft(null);
            setPromptApply("once");
          }}
          // 削除は各カードの中に置く（T-M8-134）。設定画面まで行かなくても消せる。
          onDelete={templates ? removePattern : undefined}
          options={options}
          value={pattern}
        />

      {/*
          **選ぶと何が変わるかをその場に出す**（T-M8-131・運営者の指摘 2026-08-18）。
          設定（スレッド数・Web検索・参考URL）は生成のたびにAIへの指示として渡るが、
          画面に出ていないと「設定したのに効いていないのでは」と分からない。
        */}
        {selectedPattern ? (
          <p className="mt-2 text-caption text-ink-3">
        この型の分量: {threadCountLabel(selectedPattern.maxPosts)}
            {/* Web検索や参考URLの扱いはプロンプトに書く方式にしたので、ここには出さない（T-M8-132）。 */}
          </p>
        ) : null}

        {/* パターンの追加（T-M8-130）。設定画面と同じ入力欄を使う。 */}
        {templates ? (
          newPattern ? (
            <div className={`${cardClassName} mt-2 p-4`}>
              <CardTitle>新しいパターン</CardTitle>
              {newPatternError ? <Notice tone="danger">{newPatternError}</Notice> : null}
              <PatternFields
                draft={newPattern}
                idPrefix="new-pattern"
                onChange={(next) => setNewPattern((cur) => (cur ? { ...cur, ...next } : cur))}
                promptRequired
              />
              <div className="mt-3 flex gap-2">
                <Button disabled={pending} onClick={addPattern} type="button" variant="brand">
                  追加
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    setNewPattern(null);
                    setNewPatternError(null);
                  }}
                  type="button"
                  variant="subtle"
                >
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Button
                disabled={pending}
                onClick={() => setNewPattern(emptyPatternDraft(NEW_PATTERN_PROMPT_TEMPLATE))}
                type="button"
                variant="subtle"
              >
                パターンを追加
              </Button>
            </div>
          )
        ) : null}

        {templates ? (
          <details className="rounded-card border border-hairline bg-page">
            <summary className="cursor-pointer select-none px-4 py-3 text-body font-medium text-ink">
              生成に使うプロンプト
              {anyPromptEdited ? <span className="ml-2 text-caption text-brand">編集中</span> : null}
            </summary>
            <div className="space-y-3 px-4 pb-4">
              <p className="text-xs text-muted-foreground">
                この生成に使われる指示を確認・編集できます。編集して、この生成にだけ使うか、保存して以後の生成にも使うかを選べます。
              </p>
              {/* 3ブロックの切替（アカウント.md／投稿の型／画像）。アカウント.mdを一番左に（T-M8-105）。roleはtabだが実装は単純なボタン群。 */}
              <div aria-label="プロンプトの種類" className="flex flex-wrap gap-1.5" role="tablist">
                {(
                  [
                    ["base_md", "アカウント.md", baseMdEdited],
                    ["pattern", "投稿の型", promptEdited],
                    ["image", "画像生成", imageEdited],
                  ] as const
                ).map(([id, label, edited]) => (
                  <button
                    aria-selected={promptTab === id}
                    className={`inline-flex h-8 items-center rounded-pill border px-3 text-body transition-colors duration-150 ${
                      promptTab === id
                        ? "border-brand bg-brand-subtle font-medium text-brand"
                        : "border-hairline text-ink-2 hover:bg-black/[0.03]"
                    }`}
                    key={id}
                    onClick={() => setPromptTab(id)}
                    role="tab"
                    type="button"
                  >
                    {label}
                    {edited ? <span aria-label="編集中" className="ml-1 text-brand">●</span> : null}
                  </button>
                ))}
              </div>

              {promptTab === "pattern" ? (
                <PromptBlock
                  edited={promptEdited}
                  // プレースホルダーは「パターンを追加」の記入欄と同じ形で出す（T-M8-194）。
                  // 分量の行はここには出さない——実際の上限は保存済みのmax_postsで決まり、
                  // プロンプトの読み取りと食い違う（既定パターンは本文にスレッド語彙を持たない）。
                  // 分量は上の「この型の分量」が正しい値を出している（レビュー指摘・T-M8-192）。
                  footer={<PlaceholderSummary prompt={promptValue} />}
                  groupName="create-prompt-apply-pattern"
                  label={`選択中の型（${selectedPattern?.name ?? "未選択"}）の生成プロンプト`}
                  limit={PROMPT_MAX_CHARS}
                  mode={promptApply}
                  onChange={setPromptDraft}
                  onMode={setPromptApply}
                  onReset={() => {
                    setPromptDraft(null);
                    setPromptApply("once");
                  }}
                  value={promptValue}
                />
              ) : promptTab === "base_md" ? (
                baseMdReady ? (
                  <PromptBlock
                    edited={baseMdEdited}
                    groupName="create-prompt-apply-basemd"
                    label="アカウント.md（全パターン共通の発信定義書。AI設定＞アカウント.mdと同じもの）"
                    limit={BASE_MD_MAX}
                    mode={baseMdApply}
                    note="保存すると新しいversionとして履歴に残ります（AI設定から戻せます）。見出し構成を変えると保存できません。"
                    onChange={setBaseMdDraft}
                    onMode={setBaseMdApply}
                    onReset={() => {
                      setBaseMdDraft(null);
                      setBaseMdApply("once");
                    }}
                    value={baseMdValue}
                  />
                ) : (
                  <p className="rounded-card border border-hairline bg-surface px-3.5 py-3 text-body leading-5 text-ink-2">
                    アカウント.mdはアカウント設定を保存すると作られます。まず
                    <Link className="text-info-fg hover:underline" href="/app/settings?tab=account">
                      アカウント設定
                    </Link>
                    を保存してください。
                  </p>
                )
              ) : (
                <PromptBlock
                  edited={imageEdited}
                  groupName="create-prompt-apply-image"
                  label="画像生成プロンプト（「画像を生成する」がONのとき使われます）"
                  limit={PROMPT_MAX_CHARS}
                  mode={imageApply}
                  onChange={setImageDraft}
                  onMode={setImageApply}
                  onReset={() => {
                    setImageDraft(null);
                    setImageApply("once");
                  }}
                  value={imageValue}
                />
              )}
            </div>
          </details>
        ) : null}

        <div>
          <label className="block text-body font-medium text-ink" htmlFor="source_url">
            参考URL（任意）
          </label>
          <input
            className="mt-1 h-10 w-full rounded-card border border-hairline px-3 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
            id="source_url"
            inputMode="url"
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            value={sourceUrl}
          />
        {/*
              **設定の「投稿に参考URLを付ける」とは別物**。ここは題材として渡すURLで、
              あちらは生成した投稿に参考URLを添えるかどうか（T-M8-131）。
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              AIがこのURLを読んで題材にします。空欄ならAIが自分で題材を探します。
            </p>
        </div>

      {/*
          **入力項目（プレースホルダー）**（T-M8-132）。パターンが `{名前}` を持つとき、
          その名前の入力欄をここに出し、入力内容をプロンプトの `{名前}` へ差し込む。
          以前は「自分の考え」だけが固定の欄だった（`<input>` に `自分の考え: …` として
          載せるだけで、プロンプトのどこへ効くかは型の書き方任せだった）。
        */}
        {activePlaceholderNames.map((name) => (
          <div key={name}>
            <label
              className="block text-body font-medium text-ink"
              htmlFor={`placeholder-${name}`}
            >
              {name}（任意）
            </label>
            <textarea
              className="mt-1 w-full rounded-card border border-hairline px-3 py-2 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
              id={`placeholder-${name}`}
              onChange={(e) =>
                setPlaceholderValues((prev) => ({ ...prev, [name]: e.target.value }))
              }
              rows={2}
              value={placeholderValues[name] ?? ""}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              プロンプトの <code>{`{${name}}`}</code> に入ります。空欄なら「（未指定）」になります。
            </p>
          </div>
        ))}

        <div>
          <label className="block text-body font-medium text-ink" htmlFor="instructions">
            追加指示（任意）
          </label>
          <textarea
            className="mt-1 w-full rounded-card border border-hairline px-3 py-2 text-body transition-colors duration-150 focus:border-brand focus:outline-none"
            id="instructions"
            maxLength={2000}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            value={instructions}
          />
        </div>

        <div className="space-y-2">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-body font-medium text-ink">
            <input
              checked={imageEnabled}
              className="size-4"
              disabled={imageProviders.length === 0}
              onChange={(e) => setImageEnabled(e.target.checked)}
              type="checkbox"
            />
            画像を生成する
            {imageProviders.length === 0 ? (
              <span className="text-xs font-normal text-muted-foreground">
                （利用可能な画像AIキーがありません）
              </span>
            ) : null}
          </label>
          {/* どのAIが使われるかは操作に影響しない内部説明のため出さない（T-M8-66）。 */}
        </div>

        {/* グラデーションは「AIが動く瞬間」の合図（デザイン §カラー）。ここ以外へ広げない。 */}
        <Button
          className="h-10 w-full gap-1.5 text-body"
          disabled={pending || inProgress || !theme || anyPromptOverLimit}
          onClick={submit}
          type="button"
          variant="gradient"
        >
          <Icon name="star_shine" size={17} />
          {inProgress ? "生成中…" : pending ? "生成を開始しています…" : "スレッドを生成する"}
        </Button>
        {/*
          **押せない理由を画面に出す**（T-M8-37）。無効化だけだと「なぜ押せないのか」が分からない。
          以前はテーマ未選択でも押せて、サーバ側の `z.enum` で弾かれ「入力内容を確認してください」
          という**どの項目が悪いか分からない**トーストが5秒で消えるだけだった。
        */}
        {!theme && !inProgress ? (
          <p className="text-caption text-ink-2">テーマを選ぶと生成できます。</p>
        ) : null}
      </section>

      {/* 結果（ステート2・3） */}
      <section aria-label="プレビュー・結果"
        className={`${cardClassName} space-y-4 p-5`}>
        <CardTitle>結果</CardTitle>

        {prereq ? (
          <ExecutionPrereqNotice
            message={prereq.message}
            missing={prereq.missing}
            settingsPath={prereq.settingsPath}
          />
        ) : null}

        {inProgress ? (
          <div aria-live="polite" className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-6">
              <p>
                生成には通常60〜90秒かかります。この画面を離れても生成は続き、完了すると「下書き」タブに追加されます。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">経過 {elapsedLabel}</p>
            </div>
            {/* 進捗ステップ（デザイン §画面一覧 3.投稿作成 ステート2）。完了=緑チェック／実行中=キー色の脈動／待機=灰丸。 */}
            <ol className="space-y-1.5">
              {STAGE_ORDER.filter((s) => s !== "image" || imageEnabled).map((stage) => {
                const active = job?.progressStage === stage;
                const done =
                  job?.progressStage != null &&
                  STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(job.progressStage);
                return (
                  <li
                    className={`flex items-center gap-2 text-body ${
                      active ? "font-medium text-ink" : done ? "text-ink-2" : "text-ink-3"
                    }`}
                    key={stage}
                  >
                    {done ? (
                      <Icon className="text-success-icon" filled name="check_circle" size={16} />
                    ) : active ? (
                      <Icon className="animate-pulse text-brand" name="progress_activity" size={16} />
                    ) : (
                      <Icon className="text-ink-3/60" name="radio_button_unchecked" size={16} />
                    )}
                    {STAGE_LABEL[stage]}
                  </li>
                );
              })}
            </ol>
            {queuedSlow ? (
              <Notice tone="warn" role="status">
                開始が遅れています。自動で再開されます（最大5分）。
              </Notice>
            ) : null}
            {job?.status === "queued" ? (
              <Button disabled={pending} onClick={cancel} size="sm" type="button" variant="outline">
                生成をキャンセル
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                生成が始まったため、途中では止められません。
              </p>
            )}
          </div>
        ) : null}

        {job?.status === "succeeded" ? (
          <div className="space-y-3">
            <Notice tone="success" role="status">
              生成が完了し、下書きを作成しました。
            </Notice>
            <Link
              className={primaryLinkClassName}
              href="/app/posts?tab=drafts"
            >
              下書きを確認する
            </Link>
          </div>
        ) : null}

        {job?.status === "failed" ? (
          <div className="space-y-3">
            <Notice role="alert" tone="danger">
              {job.error?.message ?? "生成に失敗しました。時間をおいて再試行してください。"}
            </Notice>
            {/* 押しても直らない再試行は出さない。上限到達・前提不足はそれぞれの解決先へ送る。 */}
            {job.error?.code === "usage_limit_exceeded" || job.error?.code === "usage_paused" ? (
              <Link
                className="inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium"
                href="/app/settings?tab=billing"
              >
                利用状況とプランを確認する
              </Link>
            ) : PREREQ_FAILURE_CODES.has(job.error?.code ?? "") ? (
              <Link
                className={primaryLinkClassName}
                href={PREREQ_FAILURE_PATH[job.error?.code ?? ""] ?? "/app/settings"}
              >
                設定を確認する
              </Link>
            ) : (
              <Button disabled={pending} onClick={retry} size="lg" type="button" variant="outline">
                再試行する
              </Button>
            )}
          </div>
        ) : null}

        {!prereq && job === null ? (
          <p className="text-sm text-muted-foreground">
            「スレッドを生成する」を押すと、ここに結果が表示されます。
          </p>
        ) : null}
      </section>
    </div>
  );
}
