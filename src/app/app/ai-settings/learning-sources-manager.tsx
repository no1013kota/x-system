"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  addLearningSourceAction,
  listLearningSourcesAction,
  reimportOwnPostsAction,
  removeLearningSourceAction,
} from "@/app/actions/learning-sources";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatJst } from "@/lib/format";
import type { LearningSourceView } from "@/lib/learning-sources";
import { CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/**
 * SC-10 学習ソースタブ（L-1〜3, 要件06 §9, T-M5-07）。参考アカウント/参考投稿の追加（type別上限）、
 * 自己過去投稿の取り込み/再取り込み（30日制御）、削除、進行/失敗表示、removing中の生成停止案内。
 */

const REF_ACCOUNT_MAX = 3;
const REF_POST_MAX = 10;
const TYPE_LABEL: Record<string, string> = {
  ref_account: "参考アカウント",
  ref_post: "参考投稿",
  own_posts: "自分の過去投稿",
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
 * 学習の失敗はベースmdへ知見が反映されない状態なので、一覧をざっと見て気付けないと実害がある。
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

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function LearningSourcesManager({
  xAccountId,
  initialSources,
  initialOwnPostsNextEligibleAt,
  plan,
}: {
  xAccountId: string;
  initialSources: LearningSourceView[];
  initialOwnPostsNextEligibleAt: string | null;
  plan: "standard" | "md" | "premium";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sources, setSources] = useState<LearningSourceView[]>(initialSources);
  const [ownPostsNextEligibleAt, setNextEligible] = useState<string | null>(initialOwnPostsNextEligibleAt);
  const [type, setType] = useState<"ref_account" | "ref_post">("ref_account");
  const [url, setUrl] = useState("");
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());

  // pending の経過秒（>60秒で遅延案内）を判定するため定期的に現在時刻を更新する。
  useEffect(() => {
    if (!sources.some((s) => s.status === "pending" || s.status === "removing")) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sources]);

  const refCount = (t: string) => sources.filter((s) => s.type === t).length;
  const removing = sources.some((s) => s.status === "removing");
  const ownPosts = sources.find((s) => s.type === "own_posts") ?? null;
  const ownPostsBlockedDays = ownPostsNextEligibleAt ? daysUntil(ownPostsNextEligibleAt) : 0;

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

  function add() {
    // 押せない状態にしてあるので通常は到達しない（保険）。**黙って return しない**のが要点で、
    // 以前はここで無言で抜けており、ボタンは押せるのに何も起きなかった（T-M8-37）。
    if (!url.trim()) {
      toast.show({ tone: "error", title: "XのURLを入力してください" });
      return;
    }
    startTransition(async () => {
      const res = await addLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, type, url: url.trim() });
      if (res.status === "success") {
        setUrl("");
        toast.show({ tone: "success", title: "学習ソースを追加しました" });
        await refresh();
      } else {
        showError(res);
      }
    });
  }

  function remove(sourceId: string) {
    if (!confirm("この学習ソースを削除しますか？反映済みの場合はベースmdから知見を取り除く処理が実行されます。")) return;
    startTransition(async () => {
      const res = await removeLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, source_id: sourceId });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "学習ソースを削除しました" });
        await refresh();
      } else {
        showError(res);
      }
    });
  }

  function reimport() {
    startTransition(async () => {
      const res = await reimportOwnPostsAction({ request_key: uuid(), x_account_id: xAccountId });
      if (res.status === "success") {
        toast.show({
          tone: "success",
          title: "再取り込みを開始しました",
          description: "完了すると学習の反映状況が更新されます。",
        });
        await refresh();
        router.refresh(); // サーバの次回可能日時を更新
      } else {
        if (res.details?.next_available_at) {
          setNextEligible(String(res.details.next_available_at));
        }
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
          学習ソースの削除処理中です。削除が完了するまで、このアカウントの新規生成を一時停止しています。
        </Notice>
      ) : null}

      {/* 追加フォーム（参考アカウント/参考投稿） */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <CardTitle>参考ソースを追加</CardTitle>
        {/* 上限は種別セレクトの (n/3) 表示に一本化する（T-M8-66）。 */}
        <p className="mt-1 text-xs text-muted-foreground">
          参考にしたいXアカウントや投稿のURLを登録すると、文体・型を学習してベースmdへ反映します。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">種別</span>
            <select
              className="mt-1 rounded-md border px-2 py-1"
              onChange={(e) => setType(e.target.value as "ref_account" | "ref_post")}
              value={type}
            >
              <option disabled={refCount("ref_account") >= REF_ACCOUNT_MAX} value="ref_account">
                参考アカウント{refCount("ref_account") >= REF_ACCOUNT_MAX ? "（上限）" : `（${refCount("ref_account")}/${REF_ACCOUNT_MAX}）`}
              </option>
              <option disabled={refCount("ref_post") >= REF_POST_MAX} value="ref_post">
                参考投稿{refCount("ref_post") >= REF_POST_MAX ? "（上限）" : `（${refCount("ref_post")}/${REF_POST_MAX}）`}
              </option>
            </select>
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">URL</span>
            <input
              className="mt-1 w-full rounded-md border px-2 py-1"
              onChange={(e) => setUrl(e.target.value)}
              placeholder={type === "ref_account" ? "https://x.com/handle" : "https://x.com/handle/status/123"}
              type="url"
              value={url}
            />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={
              pending ||
              removing ||
              !url.trim() ||
              refCount(type) >= (type === "ref_account" ? REF_ACCOUNT_MAX : REF_POST_MAX)
            }
            onClick={add}
            type="button"
          >
            追加
          </button>
        </div>
        {/* **押せない理由を出す**（T-M8-37）。無効化だけだと壊れているのか区別できない。 */}
        {!url.trim() && !removing ? (
          <p className="mt-2 text-xs text-muted-foreground">XのURLを入力すると追加できます。</p>
        ) : null}
      </section>

      {/* 自己過去投稿の取り込み/再取り込み */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <CardTitle>自分の過去投稿から学習</CardTitle>
        {/* 30日ルールの例外（失敗時）は失敗表示側の導線が伝える。事前に読ませない（T-M8-66）。 */}
        <p className="mt-1 text-xs text-muted-foreground">
          直近100件の投稿から「自分らしさ」を学習し、ベースmdへ反映します。再取り込みは30日に1回までです。
          {plan === "premium" ? "（生成枠を1消費）" : ""}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending || removing || ownPostsBlockedDays > 0}
            onClick={reimport}
            type="button"
          >
            {ownPosts ? "再取り込み" : "取り込み"}
          </button>
          {ownPostsBlockedDays > 0 ? (
            <span className="text-xs text-muted-foreground">次回の再取り込みまであと{ownPostsBlockedDays}日</span>
          ) : null}
        </div>
      </section>

      {/* 一覧 */}
      <section>
        <CardTitle>登録済みの学習ソース</CardTitle>
        {sources.length === 0 ? (
          <p className="mt-2 rounded-card border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            まだ学習ソースはありません。
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
                    {s.type === "own_posts"
                      ? "上の「再取り込み」からやり直せます。"
                      : "削除して再登録するとやり直せます。"}
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
