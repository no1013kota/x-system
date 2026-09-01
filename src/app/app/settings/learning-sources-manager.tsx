"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  addLearningSourceAction,
  applyLearningToSettingsAction,
  learningApplyStatusAction,
  listLearningSourcesAction,
  removeLearningSourceAction,
} from "@/app/actions/learning-sources";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatJst } from "@/lib/format";
import type { LearningSourceView } from "@/lib/learning-sources";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/**
 * 参考ソース（L-1/L-2, 要件06 §9, T-M5-07）。参考アカウント/参考投稿の追加（type別上限）、
 * 削除、進行/失敗表示、removing中の生成停止案内。
 *
 * **アカウント設定を作る入口**（T-M8-344・運営者の指示 2026-08-27）。以前は
 * アカウント設定を保存した後にしか出せなかったが、順序を逆にした——
 * 「誰に何を発信するか」を最初から言葉にできる人ばかりではないので、
 * **真似したいアカウントを挙げるところから始められる**方が入口として易しい。
 * 反映は登録時の自動ではなく**ボタンを押したとき**に行う（いつ設定が変わるかを利用者が決める）。
 */

type RefType = "ref_account" | "ref_post";

/** 種別ごとの上限・入力例・説明（T-M8-112。欄を分けたので1か所にまとめる）。 */
const REF_FIELDS: {
  type: RefType;
  max: number;
  placeholder: string;
  hint: string;
}[] = [
  {
    type: "ref_account",
    max: 3,
    placeholder: "https://x.com/handle",
    hint: "文体・構成・題材の傾向を学びます（直近20投稿）。",
  },
  {
    type: "ref_post",
    max: 10,
    placeholder: "https://x.com/handle/status/123",
    hint: "伸びた投稿1件から、再現できる型を学びます。",
  },
];
const TYPE_LABEL: Record<string, string> = {
  ref_account: "参考アカウント",
  ref_post: "参考投稿",
};

/**
 * 欄に出す上限の言い方（T-M8-349・運営者の指示 2026-08-28）。
 * **上限は押してから知らせない。** 何件まで入れられるかが分からないと、
 * 書き足してから弾かれることになる（原則2）。
 */
function limitLabel(type: RefType, used: number): string {
  const field = REF_FIELDS.find((f) => f.type === type)!;
  return `${used} / ${field.max}件`;
}
const STATUS_LABEL: Record<string, string> = {
  pending: "分析待ち",
  analyzed: "反映済み",
  failed: "失敗",
  removing: "削除処理中",
};
/**
 * 状態→色は**意味で決める**（`Badge` の tone・デザイン §カラー）。x-accounts と同じ形にして、
 * 状態色の決め方をアプリ全体で1つに揃える（T-M8-36）。
 *
 * 以前は背景色・文字色の指定が無い生の span で、4状態が**すべて同じ見た目**だった。
 * 学習の失敗はアカウント.mdへ知見が反映されない状態なので、一覧をざっと見て気付けないと実害がある。
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "info",
  analyzed: "success",
  failed: "danger",
  removing: "warn",
};

/**
 * 分析の完了を待つ間隔と回数（T-M8-349）。参考アカウント1件の分析は実測で30〜60秒。
 * 3秒 × 60回 = 3分まで待ち、それでも終わらなければ理由を出して押し直してもらう。
 */
const ANALYSIS_WAIT_INTERVAL_MS = 3_000;
const ANALYSIS_WAIT_TRIES = 60;

function uuid(): string {
  return crypto.randomUUID();
}

export function LearningSourcesManager({
  xAccountId,
  initialNowMs,
  initialSources,
  initialApplying,
  settingsMissing,
}: {
  xAccountId: string;
  /** サーバーが描画した時刻（ミリ秒）。滞留判定の初期値。 */
  initialNowMs: number;
  initialSources: LearningSourceView[];
  /** 反映のjobが進行中か（再訪しても「書き換え中」が出るように・T-M8-344）。 */
  initialApplying: boolean;
  /** アカウント設定が未保存か。文言を「作る」「更新する」で切り替える。 */
  settingsMissing: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sources, setSources] = useState<LearningSourceView[]>(initialSources);
  // 参考アカウント／参考投稿は別々の欄にする（T-M8-112）。種別selectを挟むと、
  // 「どちらを登録しようとしているか」を毎回選ばせることになり、上限や入力例も1つしか出せない。
  /**
   * 記入欄（T-M8-346・運営者の指示 2026-08-28）。**欄ごとの「追加」ボタンは置かない。**
   * 参考アカウント・参考投稿をその場に並べて書き、下の1つのボタンでまとめて反映する——
   * 「追加」を何度も押させると、どこまで登録できたのかを利用者が数える羽目になる。
   */
  const [rows, setRows] = useState<{ type: RefType; url: string }[]>([
    { type: "ref_account", url: "" },
    { type: "ref_post", url: "" },
  ]);
  const toast = useToast();
  /**
   * 「分析が進んでいない」の判定に使う現在時刻（T-M8-113）。**初期値はサーバーが測った時刻**。
   * `Date.now()` を初期値にすると、ちょうど60秒あたりのソースでサーバーの描画と
   * ブラウザの描画で判定が割れ、表示が食い違って描き直しになる。
   */
  const [now, setNow] = useState(initialNowMs);
  /**
   * アカウント設定へ反映中か（T-M8-344）。**押した後の状態を画面に出す**——
   * 完了まで数十秒かかるので、何も出ないと「押せていないのでは」と分からなくなる（原則1）。
   * 初期値はサーバーが見たjobの有無（再訪でも進行が分かる）。
   */
  const [applying, setApplying] = useState(initialApplying);
  /**
   * 分析が終わらないまま待ち時間を使い切ったか（T-M8-349）。
   * **「押したのに何も起きない」を作らない**——理由を画面に出して、押し直せるようにする。
   */
  const [waitingAnalysis, setWaitingAnalysis] = useState(false);

  // pending の経過秒（>60秒で遅延案内）を判定するため定期的に現在時刻を更新する。
  useEffect(() => {
    if (!sources.some((s) => s.status === "pending" || s.status === "removing")) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sources]);

  const removing = sources.some((s) => s.status === "removing");

  async function refresh() {
    const res = await listLearningSourcesAction();
    if (res.status === "success" && res.sources) setSources(res.sources);
  }

  /** 失敗をトーストで伝える（T-M8-18）。設定導線があれば一緒に載せる。 */
  function showError(res: { message?: string; details?: Record<string, unknown> }) {
    const path = res.details?.settingsPath;
    toast.show({
      tone: "error",
      title: "実行できませんでした",
      description: res.message ?? "処理に失敗しました。",
      ...(typeof path === "string" ? { action: { href: path, label: "設定を開く" } } : {}),
    });
  }

  /** 記入欄を1つ増やす（種別ごとの上限まで）。 */
  function addRow(type: RefType) {
    setRows((current) => [...current, { type, url: "" }]);
  }

  function setRowUrl(index: number, url: string) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, url } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  /** その種別で、いま登録済み＋記入中の合計（上限判定に使う）。 */
  function plannedCount(type: RefType): number {
    return (
      sources.filter((s) => s.type === type).length +
      rows.filter((r) => r.type === type && r.url.trim()).length
    );
  }

  function remove(sourceId: string) {
    if (!confirm("この参考ソースを削除しますか？反映済みの場合は、アカウント設定からその知見を取り除く処理が走ります。")) return;
    startTransition(async () => {
      const res = await removeLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, source_id: sourceId });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "参考ソースを削除しました" });
        await refresh();
      } else {
        showError(res);
      }
    });
  }

  /** 記入中のURLが1つでもあるか（ボタンを押せる条件の片方）。 */
  const hasEnteredUrl = rows.some((r) => r.url.trim().length > 0);

  /** 分析が終わっているソース（反映の材料）。記入も無くこれも0なら押せない。 */
  const analyzedCount = sources.filter((s) => s.status === "analyzed").length;

  /**
   * 反映中は定期的に見に行き、終わったら画面を作り直す（T-M8-344）。
   * **完了を待たずにボタンを戻さない**——戻すと「終わったのに設定が古いまま」に見える。
   */
  useEffect(() => {
    if (!applying) return;
    const timer = setInterval(async () => {
      const res = await learningApplyStatusAction({ x_account_id: xAccountId });
      if (res.status === "success" && res.running === false) {
        setApplying(false);
        // 設定そのものはサーバーが描画しているので、画面ごと取り直す。
        router.refresh();
        toast.show({
          tone: "success",
          title: "アカウント.mdの入力項目へ反映しました",
          description:
            "プロンプト > アカウント.md で内容を確認し、「アカウント設定を保存」を押すと確定します。",
        });
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [applying, router, toast, xAccountId]);

  /**
   * **記入した内容を登録して、アカウント設定へ「反映」する**（T-M8-349）。
   *
   * 1つのボタンで「登録 → 分析 → 反映」まで進む。**反映＝保存ではない**——
   * 結果は保存前の提案として下のフォームへ入り、利用者が確認して
   * 「アカウント設定を保存」を押したときに確定する（運営者の指示 2026-08-28）。
   */
  function applyToSettings() {
    const entered = rows.map((r) => ({ ...r, url: r.url.trim() })).filter((r) => r.url);
    startTransition(async () => {
      setApplying(true);
      setWaitingAnalysis(false);
      for (const row of entered) {
        const res = await addLearningSourceAction({
          request_key: uuid(),
          x_account_id: xAccountId,
          type: row.type,
          url: row.url,
        });
        if (res.status !== "success") {
          setApplying(false);
          showError(res);
          return;
        }
      }
      if (entered.length > 0) {
        setRows([{ type: "ref_account", url: "" }]);
        await refresh();
      }
      /*
        分析が終わってから反映を起票する。**待たずに起票すると弾かれる**——
        サーバーは「分析中は重ねない」ので `job_conflict`、材料が無ければ検証エラーになる。
        待つあいだも画面は「書き換え中」のままなので、利用者から見れば1つの操作。
      */
      const started = await waitForAnalysisThenApply();
      if (!started) setApplying(false);
    });
  }

  /**
   * 分析の完了を待って反映を起票する。起票できたら true。
   *
   * **待ち切れなかったら起票しない**（T-M8-349）。以前は待ち時間を使い切ったあとに
   * そのまま起票していたため、分析が動いている間は必ず `job_conflict` になり、
   * 画面には「ほかの操作と重なりました。画面を再読み込みしてから…」という
   * **何をすればよいか分からない文言**だけが出ていた（運営者の報告 2026-08-28）。
   * 分析が終わっていないのなら、そう言って待ってもらう方が短い。
   */
  async function waitForAnalysisThenApply(): Promise<boolean> {
    let running = true;
    for (let i = 0; i < ANALYSIS_WAIT_TRIES; i++) {
      const status = await learningApplyStatusAction({ x_account_id: xAccountId });
      if (status.status === "success" && status.running === false) {
        running = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, ANALYSIS_WAIT_INTERVAL_MS));
    }
    if (running) {
      // まだ分析中。**押し直せる状態に戻して理由を出す**（黙って失敗させない）。
      await refresh();
      setWaitingAnalysis(true);
      return false;
    }
    const res = await applyLearningToSettingsAction({
      request_key: uuid(),
      x_account_id: xAccountId,
    });
    if (res.status === "success") return true;
    showError(res);
    return false;
  }

  function isStalePending(s: LearningSourceView): boolean {
    return s.status === "pending" && now - new Date(s.updatedAt).getTime() > 60_000;
  }

  return (
    <div className="space-y-6">
      {removing ? (
        <Notice tone="warn">
          参考ソースの削除処理中です。削除が完了するまで、このアカウントの新規生成を一時停止しています。
        </Notice>
      ) : null}

      {/*
        **押した後の状態をここに出す**（T-M8-344）。反映には数十秒かかるので、
        何も出ないと「押せていないのでは」と分からなくなる（原則1）。
        完了したら画面を作り直して、新しい設定が上に出る。
      */}
      {applying ? (
        <Notice role="status" tone="info">
          参考ソースを読み込んでアカウント設定を作っています。1〜2分ほどで、上の欄へ入ります
          （この画面を離れても続きます）。
        </Notice>
      ) : null}

      {/*
        **待ち切れなかったことを言う**（T-M8-349）。以前はここで反映を起票していたため
        「ほかの操作と重なりました」という、何をすればよいか分からない失敗になっていた。
      */}
      {waitingAnalysis ? (
        <Notice role="status" tone="warn">
          参考ソースの分析がまだ終わっていません。下の一覧が「反映済み」になったら、
          もう一度「アカウント設定を反映する」を押してください。
        </Notice>
      ) : null}

      {/*
        **1つの枠で完結させる**（T-M8-346・運営者の指示 2026-08-28）。記入欄をこの中に置き、
        欄ごとの「追加」ボタンは持たない。1つのボタンで「登録→分析→反映」まで進む——
        押すたびに何が起きたかを利用者に数えさせない。
        **枠はアカウント設定のカードの中**（T-M8-356・運営者の指示 2026-08-28）。
        ペルソナの上に置き、区切り線で分ける。
      */}
      <section className="border-b border-hairline pb-6">
        <CardTitle>
          {settingsMissing ? "参考ソースからアカウント設定を作る" : "参考ソースで設定を更新する"}
        </CardTitle>
        <p className="mt-1 text-body leading-6 text-ink-2">
          真似したいXアカウントや投稿のURLを入れて、下のボタンを押してください。
        </p>

        <div className="mt-4 space-y-3">
          {rows.map((row, index) => {
            const field = REF_FIELDS.find((f) => f.type === row.type)!;
            const inputId = `ref-url-${index}`;
            return (
              <div className="flex flex-wrap items-center gap-2" key={index}>
                <label className="w-40 shrink-0 text-body font-medium text-ink" htmlFor={inputId}>
                  {TYPE_LABEL[row.type]}
                  {/* **上限は入力の前に見せる**（T-M8-349）。押してから弾かれない。 */}
                  <span className="ml-1 text-caption font-normal text-ink-3">
                    （{limitLabel(row.type, plannedCount(row.type))}）
                  </span>
                </label>
                <input
                  className="min-h-11 min-w-0 flex-1 rounded-card border border-hairline bg-surface px-3 disabled:opacity-50"
                  disabled={applying || removing}
                  id={inputId}
                  onChange={(e) => setRowUrl(index, e.target.value)}
                  placeholder={field.placeholder}
                  type="url"
                  value={row.url}
                />
                {/* 行を減らせる（増やせるだけだと書き間違いを消せない）。1行目は残す。 */}
                {rows.length > 1 ? (
                  <button
                    aria-label={`${TYPE_LABEL[row.type]}の欄を削除`}
                    className="min-h-11 rounded-card px-2 text-body text-ink-3 hover:text-ink disabled:opacity-50"
                    disabled={applying}
                    onClick={() => removeRow(index)}
                    type="button"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {REF_FIELDS.map((field) => {
            const full = plannedCount(field.type) >= field.max;
            return (
              <Button
                disabled={applying || removing || full}
                key={field.type}
                onClick={() => addRow(field.type)}
                size="sm"
                type="button"
                variant="subtle"
              >
                ＋ {TYPE_LABEL[field.type]}の欄を増やす
                {full ? `（上限${field.max}件）` : ""}
              </Button>
            );
          })}
        </div>

        {/* 登録済みの一覧はこの枠の中（実行ボタンの上）。**押す前に何が材料か見える。** */}
        <div className="mt-5 border-t border-hairline pt-4">
          <p className="text-body font-medium text-ink">登録済みの参考ソース</p>
        {sources.length === 0 ? (
          <p className="mt-2 rounded-card border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            まだ参考ソースはありません。上の欄から追加してください。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sources.map((s) => (
              <li className="rounded-card border border-hairline bg-surface p-4" key={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{TYPE_LABEL[s.type] ?? s.type}</Badge>
                  <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">分析日時: {formatJst(s.updatedAt)}</span>
                </div>
                {s.url ? (
                  <a className="mt-1 block truncate text-sm hover:underline" href={s.url} rel="noopener noreferrer" target="_blank">
                    {s.url}
                  </a>
                ) : null}
                {isStalePending(s) ? (
                  <p className="mt-2 text-xs text-warn-fg">開始が遅れています。自動で再開されます（最大5分）。</p>
                ) : s.status === "pending" ? (
                  <p className="mt-2 text-xs text-muted-foreground">分析中です…</p>
                ) : null}
                {s.status === "failed" ? (
                  <p className="mt-2 text-xs text-danger-fg">
                    分析に失敗しました。対象が非公開/削除されていないかご確認ください。
                    削除して再登録するとやり直せます。
                  </p>
                ) : null}
                {s.status !== "removing" ? (
                  <button
                    className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={pending || removing}
                    onClick={() => remove(s.id)}
                    type="button"
                  >
                    削除
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        </div>
        {/*
          **実行ボタンはこの枠の右下**（T-M8-356・運営者の指示 2026-08-28）。
          記入 → 材料の確認 → 実行、の順で目が動く並びにする。
        */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {/* **押せない理由を出す**（T-M8-37）。無効化だけでは壊れているのか分からない。 */}
          {!hasEnteredUrl && analyzedCount === 0 ? (
            <span className="text-caption text-ink-3">
              XのURLを入れると押せます（{TYPE_LABEL.ref_account}か{TYPE_LABEL.ref_post}）。
            </span>
          ) : (
            <span className="text-caption text-ink-3">
              押すと登録・分析して、上のアカウント設定の欄へ入れます（1〜2分）。
              内容を確認して「アカウント設定を保存」を押すと確定します。
            </span>
          )}
          <Button
            disabled={pending || applying || removing || (!hasEnteredUrl && analyzedCount === 0)}
            onClick={applyToSettings}
            type="button"
            variant="brand"
          >
            {applying ? "反映しています…" : "アカウント設定を反映する"}
          </Button>
        </div>
      </section>
    </div>
  );
}
