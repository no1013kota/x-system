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
  const [urls, setUrls] = useState<Record<RefType, string>>({ ref_account: "", ref_post: "" });
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

  // pending の経過秒（>60秒で遅延案内）を判定するため定期的に現在時刻を更新する。
  useEffect(() => {
    if (!sources.some((s) => s.status === "pending" || s.status === "removing")) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sources]);

  const refCount = (t: string) => sources.filter((s) => s.type === t).length;
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

  function add(type: RefType) {
    // 押せない状態にしてあるので通常は到達しない（保険）。**黙って return しない**のが要点で、
    // 以前はここで無言で抜けており、ボタンは押せるのに何も起きなかった（T-M8-37）。
    const url = urls[type].trim();
    if (!url) {
      toast.show({ tone: "error", title: "XのURLを入力してください" });
      return;
    }
    startTransition(async () => {
      const res = await addLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, type, url });
      if (res.status === "success") {
        setUrls((current) => ({ ...current, [type]: "" }));
        toast.show({ tone: "success", title: `${TYPE_LABEL[type]}を追加しました` });
        await refresh();
      } else {
        showError(res);
      }
    });
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

  /** 分析が終わっているソース（反映の材料）。1件も無ければ押せない。 */
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
          title: "アカウント設定を更新しました",
          description: "内容を確認して、必要なら直してください。",
        });
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [applying, router, toast, xAccountId]);

  function applyToSettings() {
    startTransition(async () => {
      const res = await applyLearningToSettingsAction({
        request_key: uuid(),
        x_account_id: xAccountId,
      });
      if (res.status === "success") {
        setApplying(true);
      } else {
        showError(res);
      }
    });
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
          アカウント設定を書き換え中です。1分ほどで終わります（この画面を離れても続きます）。
        </Notice>
      ) : null}

      {/*
        **アカウント設定を作る／更新するボタン**（T-M8-344・運営者の指示 2026-08-27）。
        登録しただけでは設定は変わらない——いつ書き換わるかを利用者が決められるようにする。
      */}
      <section className="rounded-card border border-brand/40 bg-brand-subtle p-4">
        <CardTitle>
          {settingsMissing
            ? "参考ソースからアカウント設定を作る"
            : "参考ソースでアカウント設定を更新する"}
        </CardTitle>
        <p className="mt-1 text-body leading-6 text-ink-2">
          {settingsMissing
            ? "登録した参考ソースの分析から、発信者・読者・テーマ・トーンを組み立てます。作ったあとは、この下の「アカウント設定」でいつでも直せます。"
            : "登録した参考ソースの分析を、いまのアカウント設定へ反映します。変更後の内容はこの下の「アカウント設定」で確認・修正できます。"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            disabled={pending || applying || removing || analyzedCount === 0}
            onClick={applyToSettings}
            type="button"
            variant="brand"
          >
            {applying
              ? "書き換え中…"
              : settingsMissing
                ? "アカウント設定を作る"
                : "アカウント設定を更新する"}
          </Button>
          {/* **押せない理由を出す**（T-M8-37）。無効化だけでは壊れているのか分からない。 */}
          {analyzedCount === 0 ? (
            <span className="text-caption text-ink-3">
              {sources.length === 0
                ? "先に参考アカウントか参考投稿を追加してください。"
                : "分析が終わるまで待ってください（1分ほど）。"}
            </span>
          ) : (
            <span className="text-caption text-ink-3">分析済み {analyzedCount} 件を使います。</span>
          )}
        </div>
      </section>

      {/* 追加フォーム: 参考アカウントと参考投稿で欄を分ける（T-M8-112）。 */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <CardTitle>参考ソースを追加</CardTitle>
        <p className="mt-1 text-body leading-6 text-ink-2">
          真似したいXアカウントや投稿のURLを登録すると、文体・構成・題材の傾向を分析します。
          {/* **登録だけでは設定は変わらない**ことを明示する（T-M8-344）。反映は上のボタン。 */}
          分析が終わったら、上の「{settingsMissing ? "アカウント設定を作る" : "アカウント設定を更新する"}」を押してください。
        </p>
        <div className="mt-4 space-y-4">
          {REF_FIELDS.map(({ type, max, placeholder, hint }) => {
            const count = refCount(type);
            const full = count >= max;
            const value = urls[type];
            const inputId = `ref-url-${type}`;
            return (
              <div key={type}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <label className="text-sm font-medium" htmlFor={inputId}>
                    {TYPE_LABEL[type]}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {count}/{max}
                    {full ? "（上限）" : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 disabled:opacity-50"
                    disabled={full || removing}
                    id={inputId}
                    onChange={(e) => setUrls((current) => ({ ...current, [type]: e.target.value }))}
                    placeholder={placeholder}
                    type="url"
                    value={value}
                  />
                  <button
                    // 「追加」ボタンが2つ並ぶため、読み上げでどちらか分かるようにする（WCAG 2.2 AA）。
                    aria-label={`${TYPE_LABEL[type]}を追加`}
                    className="inline-flex h-11 items-center rounded-card bg-brand px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
                    disabled={pending || removing || !value.trim() || full}
                    onClick={() => add(type)}
                    type="button"
                  >
                    追加
                  </button>
                </div>
                {/* **押せない理由を欄ごとに出す**（T-M8-37）。無効化だけだと壊れているのか区別できない。 */}
                {full ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    上限の{max}件です。追加するには、下の一覧からどれかを削除してください。
                  </p>
                ) : !value.trim() && !removing ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">XのURLを入力すると追加できます。</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* 一覧 */}
      <section>
        <CardTitle>登録済みの参考ソース</CardTitle>
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
      </section>
    </div>
  );
}
