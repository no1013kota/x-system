"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

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
  PlaceholderCallout,
  PlaceholderOverflowWarning,
  actionReason,
  emptyPatternDraft,
  patternReasonMessage,
  toPatternPayload,
  type PatternDraft,
} from "@/components/post/pattern-fields";
import {
  checkDraftSchedule,
  DRAFT_SCHEDULE_REASONS,
} from "@/lib/draft-schedule";
import { defaultScheduleValue } from "./schedule-draft-control";
import { AutomationConsentModal } from "@/components/x/automation-consent-modal";
import { recordXAutomationConsentAction } from "@/app/actions/schedule";
import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { selectablePostThemeOptions } from "@/lib/post/post-theme";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  createPatternAction,
  deletePatternAction,
  updatePatternPromptAction,
} from "@/app/actions/post-patterns";
import { createPollGuard, POLL_INTERVAL_MS, pollGiveUpMessage } from "@/lib/ui/poll-guard";

/** プロンプトの上限（AI設定＞プロンプトの保存上限 `PROMPT_TEMPLATE_MAX_CHARS` と同値・T-M8-92）。 */
const PROMPT_MAX_CHARS = 8000;

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
 * 予約日時の不備を日本語で返す（問題なければ null・T-M8-331）。
 * 生成前なので下書きはまだ無い。**日時そのものの妥当性だけ**を見る
 * （下書きの状態とアカウントの有効性は受理時にサーバーが見る）。
 */
function scheduleReason(value: string): string | null {
  const check = checkDraftSchedule({ status: "draft", xAccountActive: true }, value, Date.now());
  return check.ok || !check.reason ? null : DRAFT_SCHEDULE_REASONS[check.reason];
}

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
  newsPrefill = null,
  automationConsented = false,
  accountHandle = null,
}: {
  xAccountId: string;
  patterns: PatternOption[];
  imageProviders: string[];
  initialJob?: ActiveJob | null;
  /** サーバーが描画した時刻（ミリ秒）。経過表示の初期値。 */
  initialNowMs: number;
  /** null = 編集権限なし（未契約）。編集セクションごと出さない。パターンID→本文。 */
  promptTemplates?: Record<string, PromptTemplateProp> | null;
  /** ニュースからの引き継ぎ（T-M8-210）。ニュース解説を選択し {ニュース} へ記事を自動入力する。 */
  newsPrefill?: {
    patternId: string;
    newsItemId: string;
    newsText: string;
    sourceUrl: string;
  } | null;
  /** 自動投稿に同意済みか（T-M8-331）。「すぐに投稿」「予約投稿」を選ぶと同意を求める。 */
  automationConsented?: boolean;
  /** 同意モーダルに出す対象アカウント（@handle）。 */
  accountHandle?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [pattern, setPattern] = useState(newsPrefill?.patternId ?? patterns[0]?.id ?? "");
  const [sourceUrl, setSourceUrl] = useState(newsPrefill?.sourceUrl ?? "");
  /**
   * テーマ。**選択は必須**（2026-08-03 ユーザー判断）。空文字は「まだ選んでいない」状態で、
   * 生成ボタンを押せない状態にする（`lib/post/post-theme.ts` の判断）。
   */
  // ニュース引き継ぎ時は記事そのものが題材なので「その他」を初期選択にする（1押しで生成できる形）。
  const [theme, setTheme] = useState(newsPrefill ? "other" : "");
  const [instructions, setInstructions] = useState("");
/** パターンの入力項目の値（`{名前}` へ差し込む・T-M8-132）。 */
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>(
    newsPrefill ? { ニュース: newsPrefill.newsText } : {},
  );
  /**
   * 生成したあとどうするか（T-M8-331・運営者の指示 2026-08-27）。
   *
   * **「作って終わり」ではないことを、作る前に決められるようにする。** 以前は必ず下書きになり、
   * 投稿したい人は生成完了を待って下書きタブへ移動し、もう一度押す必要があった。
   * - `draft`: 下書きに置く（従来どおり・既定）
   * - `now`: 生成が終わったらそのまま投稿する
   * - `scheduled`: 生成が終わったら指定日時で予約する（下書き画面と同じ判定を使う）
   */
  const [mode, setMode] = useState<"draft" | "now" | "scheduled">("draft");
  const [scheduledAt, setScheduledAt] = useState("");
  /**
   * 予約日時の不備（T-M8-331）。**押す前に理由を出す**（原則2）。
   * 判定は下書き画面と同じ `checkDraftSchedule`——別々に持つと
   * 「ここでは通るのにサーバーで弾かれる」が起きる。
   * 描画中ではなく入力のたびに判定する（`Date.now()` を描画で呼ばない）。
   */
  const [scheduleProblem, setScheduleProblem] = useState<string | null>(null);
  /** 自動投稿の同意（このアカウント単位）。サーバーの現況を初期値にする。 */
  const [consented, setConsented] = useState(automationConsented);
  const [showConsent, setShowConsent] = useState(false);
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
  // アカウント.md・画像プロンプトの編集は設定＞プロンプトが担う（T-M8-203で本画面から撤去。
  // 折りたたみ「生成に使うプロンプト」の3タブは、パターンの編集欄と二重で分かりにくかった）。
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
  /** 追加を開く前に選んでいたパターン（キャンセルで戻すため・T-M8-203）。 */
  const prevPatternRef = useRef<string>("");

  /** 追加フォームを開く。既存パターンのアクティブを外す（運営者の指示 2026-08-22）。 */
  function openAddPattern() {
    prevPatternRef.current = pattern;
    setPattern("");
    setPromptDraft(null);
    setPromptApply("once");
    setNewPattern(emptyPatternDraft(NEW_PATTERN_PROMPT_TEMPLATE));
  }

  /** 追加をやめて元の選択へ戻す。 */
  function cancelAddPattern() {
    setNewPattern(null);
    setNewPatternError(null);
    setPattern(prevPatternRef.current || (options[0]?.id ?? ""));
  }

  /** 選択中のパターン。入力欄の出し分け（意見の入力）と表示名に使う。 */
  const selectedPattern = options.find((option) => option.id === pattern) ?? null;
  const currentTemplate = templates?.[pattern] ?? null;
  const promptValue = promptDraft ?? currentTemplate?.content ?? "";
  /*
    入力項目（プレースホルダー）は**いま画面に見えているプロンプト本文**から導出する
    （T-M8-186/203）。パターンを追加中は**追加中フォームの本文**を見る——編集で {名前} を
    増減すると、下の入力欄もその場で増減する。生成側も同じく本文基準で差し込む。
  */
  const activePlaceholderNames = extractPlaceholderNames(newPattern ? newPattern.prompt : promptValue);
  const promptEdited = promptDraft !== null && promptDraft !== (currentTemplate?.content ?? "");
  const promptOverLimit = promptValue.length > PROMPT_MAX_CHARS;

  /**
   * パターンの追加。**送信中は他の操作と同じく無効化する**（T-M8-248）。
   * 以前は `void (async () => …)()` で走らせていたため `pending` に乗らず、
   * 押し続けると同じ型が何本も作られた（予約画面側は既に `startTransition` で揃っている）。
   */
  function addPattern() {
    if (!newPattern) return;
    setNewPatternError(null);
    startTransition(async () => {
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
    });
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

  /**
   * 生成を始める（T-M8-331）。**投稿まで進む指定なら、先に自動投稿の同意を取る。**
   * 同意が無いまま送るとサーバーが `automation_consent_required` で弾く——
   * 押してから分かる失敗にしない（原則2）。
   */
  function submit() {
    if (mode !== "draft" && !consented) {
      setShowConsent(true);
      return;
    }
    doSubmit();
  }

  /** 同意モーダルの「同意して生成する」→ 記録できたらそのまま生成を始める。 */
  function confirmConsentAndSubmit() {
    startTransition(async () => {
      const res = await recordXAutomationConsentAction({
        x_account_id: xAccountId,
        consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
        confirmed: true,
      });
      if (res.status !== "success") {
        toast.show({ tone: "error", title: "同意を記録できませんでした", description: res.message });
        return;
      }
      setConsented(true);
      setShowConsent(false);
      doSubmit();
    });
  }

  function doSubmit() {
    setPrereq(null);
    startTransition(async () => {
      // 編集して「保存して以後も使う」を選んだブロックは、生成の前に保存を確定する
      // （保存に失敗したのに生成だけ走ると、どのプロンプトで生成されたか分からなくなる）。
      // 保存が1つでも失敗したら生成を始めない。
      /** パターンのプロンプト保存（`post_patterns.prompt`・T-M8-129 U3）。 */
      async function saveTemplate(key: string, content: string): Promise<boolean> {
        const expected = templates?.[key]?.updatedAt ?? null;
        const saved = await updatePatternPromptAction({
          pattern_id: key,
          content,
          expected_updated_at: expected,
        });
        const savedView = saved.prompt;
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
      const res = await createGenerationJobAction({
        request_key: crypto.randomUUID(),
        x_account_id: xAccountId,
        // **`pattern_id` で送る**（T-M8-330）。T-M8-129 U5 で内部IDからパターンIDへ改めたとき、
        // スケジュール側だけ追随し**この画面は `pattern` のままだった**ため、
        // 生成が毎回「入力内容に誤りがあります」で弾かれていた（赤くなる項目も出ない）。
        pattern_id: pattern,
        // ニュース引き継ぎ時は下書きへ紐づけ、一覧の「作成済み」バッジの導出元にする（T-M8-210）。
        news_item_id: newsPrefill?.newsItemId,
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
        // 生成したあとどうするか（T-M8-331）。予約日時は**素の値のまま**送り、
        // JST解釈とUTC変換はサーバー側の純粋層（`@/lib/draft-schedule`）に任せる。
        post_mode: mode,
        scheduled_at: mode === "scheduled" ? scheduledAt : undefined,
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
            // 追加中に既存パターンを選んだら追加をやめてそちらへ（フォームを2つ同時に出さない）。
            if (newPattern) {
              setNewPattern(null);
              setNewPatternError(null);
            }
            setPattern(next);
            // 型を切り替えたら編集中のプロンプトを破棄する（別の型に前の編集を持ち越さない）。
            setPromptDraft(null);
            setPromptApply("once");
          }}
          // 追加は一覧の最後のパネル（T-M8-331）。編集権限のあるプランだけ。
          onAdd={templates && !newPattern ? openAddPattern : undefined}
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
                <Button disabled={pending} onClick={cancelAddPattern} type="button" variant="subtle">
                  キャンセル
                </Button>
              </div>
            </div>
          ) : null
        ) : null}

        {/*
          選択中パターンのプロンプト編集（T-M8-203・運営者の指示 2026-08-22）。
          折りたたみ「生成に使うプロンプト」（アカウント.md/投稿の型/画像の3タブ）は廃止し、
          「パターンを追加」の記入欄と同じUIをインラインで出す。アカウント.md・画像プロンプトの
          編集は設定＞プロンプトが担う。追加フォームを開いている間は出さない（編集欄を2つ並べない）。
        */}
        {templates && !newPattern && selectedPattern ? (
          <div className={`${cardClassName} p-4`}>
            <PromptBlock
              edited={promptEdited}
              footer={
                <>
                  <PlaceholderOverflowWarning prompt={promptValue} />
                  <PlaceholderCallout />
                </>
              }
              groupName="create-prompt-apply-pattern"
              label={`生成プロンプト（${selectedPattern.name}）`}
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
          </div>
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

        {/* **モードは追加指示の下**（運営者の指示 2026-08-27）。作る前に行き先を決める。 */}
        <fieldset className="space-y-2">
          <legend className="text-body font-medium text-ink">生成したあと</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(
              [
                ["draft", "下書きに置く"],
                ["now", "すぐに投稿"],
                ["scheduled", "予約投稿"],
              ] as const
            ).map(([value, label]) => (
              <label
                className="flex min-h-9 cursor-pointer items-center gap-1.5 text-body text-ink"
                key={value}
              >
                <input
                  checked={mode === value}
                  className="size-4"
                  name="post-mode"
                  onChange={() => {
                    setMode(value);
                    if (value !== "scheduled") {
                      setScheduleProblem(null);
                      return;
                    }
                    // 予約を選んだ瞬間に空欄から選ばせない（下書き画面と同じ「+5分」の既定）。
                    const next = scheduledAt || defaultScheduleValue();
                    setScheduledAt(next);
                    setScheduleProblem(scheduleReason(next));
                  }}
                  type="radio"
                  value={value}
                />
                {label}
              </label>
            ))}
          </div>
          {mode === "scheduled" ? (
            <div>
              <label className="block text-body font-medium text-ink" htmlFor="scheduled-at">
                投稿する日時
              </label>
              <input
                className="mt-1 rounded-card border border-hairline px-3 py-2 text-body focus:border-brand focus:outline-none"
                id="scheduled-at"
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                  setScheduleProblem(scheduleReason(e.target.value));
                }}
                type="datetime-local"
                value={scheduledAt}
              />
              {scheduleProblem ? (
                <p className="mt-1 text-xs text-danger-fg" role="alert">
                  {scheduleProblem}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

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
          disabled={pending || inProgress || !theme || !pattern || promptOverLimit || scheduleProblem !== null}
          onClick={submit}
          type="button"
          variant="gradient"
        >
          <Icon name="star_shine" size={17} />
          {inProgress
            ? "生成中…"
            : pending
              ? "生成を開始しています…"
              : /* **押す前に行き先が分かる文言にする**（T-M8-331）。 */
                mode === "now"
                ? "生成してすぐに投稿する"
                : mode === "scheduled"
                  ? "生成して予約する"
                  : "ポストを生成する"}
        </Button>
        {/*
          **押せない理由を画面に出す**（T-M8-37）。無効化だけだと「なぜ押せないのか」が分からない。
          以前はテーマ未選択でも押せて、サーバ側の `z.enum` で弾かれ「入力内容を確認してください」
          という**どの項目が悪いか分からない**トーストが5秒で消えるだけだった。
        */}
        {!theme && !inProgress ? (
          <p className="text-caption text-ink-2">テーマを選ぶと生成できます。</p>
        ) : null}
        {newPattern && !inProgress ? (
          <p className="text-caption text-ink-2">
            パターンを追加中です。「追加」または「キャンセル」で確定すると生成できます。
          </p>
        ) : null}
        {mode !== "draft" && !inProgress ? (
          <p className="text-caption text-ink-2">
            {mode === "now"
              ? "生成が終わり次第、内容を確認せずにXへ投稿します。"
              : "生成した本文を指定日時に投稿します。それまでは下書きとして編集・取り消しができます。"}
          </p>
        ) : null}
      </section>

      {/* 自動投稿の同意（スケジュール画面と同じモーダル・要件06 §3.5）。 */}
      <AutomationConsentModal
        accountHandle={accountHandle}
        confirmLabel="同意して生成する"
        firstRunLabel={null}
        onConfirm={confirmConsentAndSubmit}
        onOpenChange={setShowConsent}
        open={showConsent}
        pending={pending}
        settingSummary={
          mode === "now"
            ? "いま生成した本文を、確認なしでXへ投稿します。"
            : "いま生成した本文を、指定した日時に確認なしでXへ投稿します。"
        }
      />

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
            {/*
              **結果は選んだモードで言い分ける**（T-M8-331）。「下書きを作成しました」だけだと、
              すぐに投稿を選んだ人には**投稿されたのかどうかが分からない**（原則1）。
              投稿そのものは `post_publish` が続けるので、ここでは「進んでいる」ことまでを伝える。
            */}
            <Notice tone="success" role="status">
              {mode === "now"
                ? "生成が完了しました。続けてXへ投稿します（結果は下書き・履歴で確認できます）。"
                : mode === "scheduled"
                  ? "生成が完了し、指定日時の予約として保存しました。"
                  : "生成が完了し、下書きを作成しました。"}
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
            「ポストを生成する」を押すと、ここに結果が表示されます。
          </p>
        ) : null}
      </section>
    </div>
  );
}
